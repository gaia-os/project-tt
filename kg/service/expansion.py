"""Resolve entity names to SMR-KG nodes and expand them into profiles/evidence.

Shared by the kg-service tools (find_entities / expand_concept /
entity_evidence) — the output is LLM-facing, not the materialized overlay.

Graph shape (ontology: ~/Documents/fusion_kg_builder/ontology/ontology.json):
  Domain entities carry __Entity__ + DocumentedEntity + one concrete label:
    SMRDesign     — reactor designs from the IAEA SMR Technology Catalogue
                    (2026 ed.) and/or the NEA SMR Dashboard (3rd ed., 2025)
    Organisation  — developers, vendors, labs, regulators (also :Regulator)
    Technology    — fuels, materials, systems, processes the designs rely on
  Provenance: (e)-[:DOCUMENTED_IN]->(:SourceRecord)-[:EXTRACTED_FROM]->(:UpstreamDocument)
  Evidence:   (e)-[:SUPPORTED_BY_EVIDENCE]->(:EvidenceItem)
              (ev)-[:CITES_WEB_SOURCE]->(:WebSource) / [:CITES_LITERATURE]->(:LiteratureReference)
"""

from __future__ import annotations

import re
from typing import Any

from neo4j import Session

# Labels that mark graph infrastructure, provenance and record-level nodes —
# never resolvable domain entities. (TechnicalTerm stays resolvable: it is how
# acronyms like "LBE" or "HTSE" get looked up.)
_INFRA_LABELS = {
    "Chunk",
    "Document",
    "Session",
    "Message",
    "__KGBuilder__",
    "__Entity__",
    "DocumentedEntity",  # superclass only — the concrete kind is what matters
    "SourceRecord",
    "UpstreamDocument",
    "WebSource",
    "LiteratureReference",
    "EvidenceItem",
    "ReportedParameterValue",
    "ReadinessAssessment",
    "DesignDescriptionSection",
    "ThematicPassage",
    "Milestone",
    "ReferencedDesign",
    "ScalingFactor",
    "FundingMention",
}

# Preferred display order when a node carries several concrete labels
# (Regulator nodes are also :Organisation — Regulator is more specific).
_KIND_ORDER = [
    "SMRDesign",
    "Regulator",
    "Organisation",
    "Technology",
    "Programme",
    "Site",
    "Facility",
    "Country",
    "TechnologyLine",
    "TargetApplication",
]

# Tech-tree label prefixes that must be stripped before resolving, e.g.
# "Concept: NuScale" -> "NuScale".
_LABEL_PREFIX_RE = re.compile(r"^\s*(concept|milestone|enabling\s+tech[nology]*)\s*:\s*", re.I)


def normalize_label(label: str) -> str:
    """Strip tech-tree type prefixes and whitespace from a node label."""
    return _LABEL_PREFIX_RE.sub("", label).strip()


def _domain_labels(node_labels: list[str]) -> list[str]:
    out = [l for l in node_labels if l not in _INFRA_LABELS]
    return sorted(out, key=lambda l: (_KIND_ORDER.index(l) if l in _KIND_ORDER else 99, l))


def _kind(node_labels: list[str]) -> str:
    dl = _domain_labels(node_labels)
    return dl[0] if dl else "Entity"


def resolve_entity(session: Session, text: str, limit: int = 5) -> list[dict[str, Any]]:
    """Match a free-text term to KG entities.

    Returns up to `limit` candidates: [{name, kind, labels, score}] sorted
    best-first. Scoring is heuristic — exact matches beat alias/catalogue-name
    matches beat acronym matches beat substring matches.
    """
    q = normalize_label(text)
    if not q:
        return []

    # Keyed by lowercased name so aliases resolving to the same node merge.
    candidates: dict[str, dict[str, Any]] = {}

    def _add(name: str, labels: list[str], score: float) -> None:
        labels = _domain_labels(labels)
        if not labels:
            return
        key = name.lower()
        if key in candidates:
            cur = candidates[key]
            cur["labels"] = sorted(set(cur["labels"]) | set(labels))
            cur["score"] = max(cur["score"], score)
        else:
            candidates[key] = {
                "name": name,
                "kind": _kind(labels),
                "labels": labels,
                "score": score,
            }

    # 1. Exact (case-insensitive) name match on any domain entity.
    for rec in session.run(
        """
        MATCH (n)
        WHERE toLower(n.name) = toLower($q)
          AND any(l IN labels(n) WHERE NOT l IN $infra)
        RETURN n.name AS name, labels(n) AS labels
        LIMIT $limit
        """,
        q=q,
        limit=limit,
        infra=list(_INFRA_LABELS),
    ):
        _add(rec["name"], rec["labels"], 1.0)

    # 2. Alias / catalogue-name match on DocumentedEntity (covers "NUWARD" ->
    #    "NUWARD SMR", former names, and IAEA vs NEA naming differences).
    for rec in session.run(
        """
        MATCH (n:DocumentedEntity)
        WHERE any(a IN coalesce(n.aliases, []) WHERE toLower(a) = toLower($q))
           OR toLower(coalesce(n.catalogueName, '')) = toLower($q)
           OR toLower(coalesce(n.iaeaDesignName, '')) = toLower($q)
        RETURN n.name AS name, labels(n) AS labels
        LIMIT $limit
        """,
        q=q,
        limit=limit,
    ):
        _add(rec["name"], rec["labels"], 0.9)

    # 3. Technical-term acronym / expansion match ("LBE", "HTSE"…) — resolves
    #    to the term itself; its expansion usually matches entities on retry.
    for rec in session.run(
        """
        MATCH (t:TechnicalTerm)
        WHERE toLower(t.acronym) = toLower($q) OR toLower(t.expansion) = toLower($q)
        RETURN t.name AS name, labels(t) AS labels
        LIMIT $limit
        """,
        q=q,
        limit=limit,
    ):
        _add(rec["name"], rec["labels"], 0.85)

    # 4. Word-boundary name match as fallback (plain CONTAINS makes "arc"
    #    hit "search"). Java regex via =~ .
    word_re = r"(?i).*\b" + re.escape(q.lower()) + r"\b.*"
    for rec in session.run(
        """
        MATCH (n)
        WHERE n.name IS NOT NULL AND toLower(n.name) =~ $re
          AND any(l IN labels(n) WHERE NOT l IN $infra)
        RETURN n.name AS name, labels(n) AS labels
        LIMIT $limit
        """,
        re=word_re,
        limit=limit,
        infra=list(_INFRA_LABELS),
    ):
        _add(rec["name"], rec["labels"], 0.5)

    return sorted(candidates.values(), key=lambda c: -c["score"])[:limit]


# ---------------------------------------------------------------------------
# Entity profile
# ---------------------------------------------------------------------------

def _pick(props: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    return {k: props[k] for k in keys if props.get(k) is not None}


def _clean(items: Any) -> Any:
    """Drop collect()ed maps produced by unmatched OPTIONAL MATCHes
    (every field None)."""
    if not isinstance(items, list):
        return items
    return [
        i for i in items
        if not isinstance(i, dict) or any(v is not None for v in i.values())
    ]


def _design_profile(session: Session, name: str) -> dict[str, Any]:
    rec = session.run(
        """
        MATCH (d:SMRDesign) WHERE toLower(d.name) = toLower($name)
        OPTIONAL MATCH (d)-[:BELONGS_TO_TECHNOLOGY_LINE]->(tl:TechnologyLine)
        OPTIONAL MATCH (o:Organisation)-[:DEVELOPS]->(d)
        OPTIONAL MATCH (d)-[:TARGETS_APPLICATION]->(app:TargetApplication)
        OPTIONAL MATCH (d)-[ut:USES_TECHNOLOGY]->(t:Technology)
        OPTIONAL MATCH (d)-[:HAS_READINESS_ASSESSMENT]->(ra:ReadinessAssessment)
        OPTIONAL MATCH (d)-[:HAS_MILESTONE]->(m:Milestone)
        OPTIONAL MATCH (d)-[:ASSOCIATED_WITH_COUNTRY]->(c:Country)
        OPTIONAL MATCH (d)-[rd:RELATED_TO_DESIGN]->(other:SMRDesign)
        RETURN collect(DISTINCT tl.name) AS technologyLines,
               collect(DISTINCT o.name)[..15] AS developers,
               collect(DISTINCT app.name)[..20] AS applications,
               collect(DISTINCT {name: t.name, roleInDesign: ut.roleInDesign,
                                 trlInDesign: ut.trlInDesign,
                                 verified: ut.verified})[..30] AS technologies,
               collect(DISTINCT {dimension: ra.dimension, stage: ra.stage,
                                 level: ra.level, levelMax: ra.levelMax,
                                 edition: ra.edition})[..12] AS readiness,
               collect(DISTINCT {event: coalesce(m.event, m.name), status: m.status,
                                 date: m.dateText, startYear: m.startYear})[..15] AS milestones,
               collect(DISTINCT c.name) AS countries,
               collect(DISTINCT {name: other.name, kind: rd.relationKind})[..10] AS relatedDesigns
        """,
        name=name,
    ).single()
    out = {k: _clean(v) for k, v in dict(rec).items()}

    # Reported parameters carry the technical detail (power, coolant, fuel…);
    # REPORTED_IN says which catalogue edition stated the value.
    out["parameters"] = session.run(
        """
        MATCH (d:SMRDesign)-[:HAS_REPORTED_PARAMETER]->(pv:ReportedParameterValue)
        WHERE toLower(d.name) = toLower($name)
        OPTIONAL MATCH (pv)-[:REPORTED_IN]->(ud:UpstreamDocument)
        RETURN pv.parameter AS parameter,
               coalesce(pv.rawValue, toString(pv.numericValue)) AS value,
               pv.unit AS unit, pv.valueNote AS note,
               ud.name AS reportedIn
        ORDER BY parameter
        LIMIT 40
        """,
        name=name,
    ).data()
    return out


def _technology_profile(session: Session, name: str) -> dict[str, Any]:
    rec = session.run(
        """
        MATCH (t:Technology) WHERE toLower(t.name) = toLower($name)
        OPTIONAL MATCH (d:SMRDesign)-[ut:USES_TECHNOLOGY]->(t)
        OPTIONAL MATCH (o:Organisation)-[st:SUPPLIES_TECHNOLOGY]->(t)
        OPTIONAL MATCH (t)-[dep:DEPENDS_ON_TECHNOLOGY]->(dt:Technology)
        OPTIONAL MATCH (en:Technology)-[:DEPENDS_ON_TECHNOLOGY]->(t)
        OPTIONAL MATCH (t)-[:HAS_BROADER_TECHNOLOGY]->(bt:Technology)
        OPTIONAL MATCH (nt:Technology)-[:HAS_BROADER_TECHNOLOGY]->(t)
        OPTIONAL MATCH (t)-[:CONSTRAINED_BY]->(sf:ScalingFactor)
        OPTIONAL MATCH (t)-[:TARGETS_APPLICATION]->(app:TargetApplication)
        OPTIONAL MATCH (t)-[:HAS_MILESTONE]->(m:Milestone)
        RETURN collect(DISTINCT {name: d.name, roleInDesign: ut.roleInDesign,
                                 trlInDesign: ut.trlInDesign})[..30] AS usedByDesigns,
               collect(DISTINCT {name: o.name, role: st.role,
                                 location: st.location})[..20] AS suppliedBy,
               collect(DISTINCT {name: dt.name, kind: dep.dependencyKind,
                                 rationale: dep.rationale})[..20] AS dependsOn,
               collect(DISTINCT en.name)[..20] AS enables,
               collect(DISTINCT bt.name)[..10] AS broaderTechnologies,
               collect(DISTINCT nt.name)[..20] AS narrowerTechnologies,
               collect(DISTINCT coalesce(sf.text, sf.name))[..10] AS scalingFactors,
               collect(DISTINCT app.name)[..15] AS applications,
               collect(DISTINCT {event: coalesce(m.event, m.name), status: m.status,
                                 date: m.dateText, startYear: m.startYear})[..15] AS milestones
        """,
        name=name,
    ).single()
    return {k: _clean(v) for k, v in dict(rec).items()}


def _organisation_profile(session: Session, name: str) -> dict[str, Any]:
    rec = session.run(
        """
        MATCH (o:Organisation) WHERE toLower(o.name) = toLower($name)
        OPTIONAL MATCH (o)-[:DEVELOPS]->(d:SMRDesign)
        OPTIONAL MATCH (o)-[st:SUPPLIES_TECHNOLOGY]->(t:Technology)
        OPTIONAL MATCH (o)-[:HEADQUARTERED_IN]->(hq:Country)
        OPTIONAL MATCH (o)-[hs:HAS_STAKEHOLDER]->(sh:Organisation)
        OPTIONAL MATCH (o)-[:HAS_JURISDICTION]->(jc:Country)
        OPTIONAL MATCH (o)-[:HAS_MILESTONE]->(m:Milestone)
        RETURN collect(DISTINCT d.name)[..20] AS develops,
               collect(DISTINCT {name: t.name, role: st.role,
                                 location: st.location})[..30] AS suppliesTechnology,
               collect(DISTINCT hq.name)[..3] AS headquarteredIn,
               collect(DISTINCT {name: sh.name,
                                 role: hs.stakeholderRole})[..15] AS stakeholders,
               collect(DISTINCT jc.name)[..10] AS jurisdictions,
               collect(DISTINCT {event: coalesce(m.event, m.name), status: m.status,
                                 date: m.dateText, startYear: m.startYear})[..15] AS milestones
        """,
        name=name,
    ).single()
    return {k: _clean(v) for k, v in dict(rec).items()}


def _generic_profile(session: Session, name: str) -> dict[str, Any]:
    """1-hop neighbourhood for entities without a dedicated profile."""
    rows = session.run(
        """
        MATCH (n) WHERE toLower(n.name) = toLower($name)
        OPTIONAL MATCH (n)-[r]-(nb)
        WHERE any(l IN labels(nb) WHERE NOT l IN $infra)
        RETURN type(r) AS rel, startNode(r) = n AS outgoing,
               nb.name AS name, labels(nb) AS labels
        LIMIT 40
        """,
        name=name,
        infra=list(_INFRA_LABELS),
    ).data()
    neighbours = [
        {
            "rel": r["rel"],
            "direction": "out" if r["outgoing"] else "in",
            "name": r["name"],
            "kind": _kind(r["labels"]),
        }
        for r in rows
        if r["rel"]
    ]
    return {"neighbours": neighbours}


def _sources(session: Session, name: str) -> list[dict[str, Any]]:
    return session.run(
        """
        MATCH (e)-[:DOCUMENTED_IN]->(sr:SourceRecord)
        WHERE toLower(e.name) = toLower($name)
        OPTIONAL MATCH (sr)-[:EXTRACTED_FROM]->(ud:UpstreamDocument)
        RETURN sr.filePath AS file, sr.entityType AS entityType,
               ud.name AS upstreamDocument, ud.publisher AS publisher,
               ud.year AS year, ud.edition AS edition
        """,
        name=name,
    ).data()


_PROFILE_PROPS = {
    "SMRDesign": [
        "description", "aliases", "catalogueName", "iaeaDesignName", "coverage",
        "arisStatus", "arisLevel", "arisLevelMax", "declaredDesignStatus",
        "developmentStages", "updatedSince2024Catalogue",
    ],
    "Organisation": [
        "description", "kind", "aliases", "hqText", "hqCityRegion",
        "foundedYear", "sizeText", "employeeCount", "ticker", "valuationText",
    ],
    "Regulator": [
        "description", "kind", "aliases", "hqText", "hqCityRegion",
    ],
    "Technology": [
        "description", "aliases", "category", "abstraction", "trlBand",
        "trlBasis", "availability", "deploymentSummary", "relevanceRationale",
    ],
}


def entity_profile(session: Session, name: str) -> dict[str, Any] | None:
    """Expand one resolved entity into a profile: key properties plus the
    relationships that characterise it (per-kind), plus source provenance."""
    rec = next(
        iter(
            session.run(
                """
                MATCH (n)
                WHERE toLower(n.name) = toLower($name)
                  AND any(l IN labels(n) WHERE NOT l IN $infra)
                RETURN n, labels(n) AS labels
                LIMIT 1
                """,
                name=name,
                infra=list(_INFRA_LABELS),
            )
        ),
        None,
    )
    if not rec:
        return None

    props = dict(rec["n"])
    kind = _kind(rec["labels"])
    profile: dict[str, Any] = {
        "name": props.get("name"),
        "kind": kind,
        "labels": _domain_labels(rec["labels"]),
        "properties": _pick(props, _PROFILE_PROPS.get(kind, [])),
    }

    if kind == "SMRDesign":
        profile.update(_design_profile(session, name))
    elif kind == "Technology":
        profile.update(_technology_profile(session, name))
    elif kind in ("Organisation", "Regulator"):
        profile.update(_organisation_profile(session, name))
    else:
        profile.update(_generic_profile(session, name))

    profile["sources"] = _sources(session, name)
    return profile


def expand(
    session: Session,
    entity_name: str,
    entity_labels: list[str] | None = None,
    **_kwargs: Any,
) -> dict[str, Any]:
    """Kept for the /expand endpoint — returns the entity profile."""
    profile = entity_profile(session, normalize_label(entity_name))
    if not profile:
        return {"error": f"No KG entity named '{entity_name}'."}
    return profile


# ---------------------------------------------------------------------------
# Entity evidence (dossier)
# ---------------------------------------------------------------------------

def entity_evidence(session: Session, name: str) -> dict[str, Any] | None:
    """Provenance + quote-level evidence for one entity — the citation layer.

    Returns the source record(s) and upstream document(s) the entity was
    extracted from, every EvidenceItem (claim label, verbatim quote,
    verification status) with its cited web sources and literature, and the
    topic-tagged thematic passages.
    """
    rec = next(
        iter(
            session.run(
                """
                MATCH (n)
                WHERE toLower(n.name) = toLower($name)
                  AND any(l IN labels(n) WHERE NOT l IN $infra)
                RETURN n.name AS name, labels(n) AS labels
                LIMIT 1
                """,
                name=name,
                infra=list(_INFRA_LABELS),
            )
        ),
        None,
    )
    if not rec:
        return None

    evidence = session.run(
        """
        MATCH (e)-[:SUPPORTED_BY_EVIDENCE]->(ev:EvidenceItem)
        WHERE toLower(e.name) = toLower($name)
        OPTIONAL MATCH (ev)-[:CITES_WEB_SOURCE]->(ws:WebSource)
        OPTIONAL MATCH (ev)-[cl:CITES_LITERATURE]->(lr:LiteratureReference)
        RETURN ev.claimLabel AS claim, ev.quote AS quote,
               ev.verificationStatus AS verificationStatus,
               ev.sourceSection AS sourceSection, ev.url AS url,
               collect(DISTINCT {title: ws.title, url: ws.url})[..4] AS webSources,
               collect(DISTINCT {title: lr.title, authors: lr.authors,
                                 year: lr.year, doi: lr.doi,
                                 verdict: cl.verdict})[..4] AS literature
        ORDER BY ev.claimLabel
        LIMIT 25
        """,
        name=name,
    ).data()
    for ev in evidence:
        ev["webSources"] = _clean(ev["webSources"])
        ev["literature"] = _clean(ev["literature"])

    passages = session.run(
        """
        MATCH (e)-[:HAS_THEMATIC_PASSAGE]->(tp:ThematicPassage)
        WHERE toLower(e.name) = toLower($name)
        RETURN tp.topic AS topic, tp.sectionContext AS section,
               tp.text AS text
        LIMIT 12
        """,
        name=name,
    ).data()

    return {
        "name": rec["name"],
        "kind": _kind(rec["labels"]),
        "sources": _sources(session, rec["name"]),
        "evidence": evidence,
        "thematicPassages": passages,
    }
