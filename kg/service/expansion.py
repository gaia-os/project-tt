"""Resolve tech-tree labels to KG entities and expand them into enrichment subgraphs.

Shared by enrich.py (materialized overlay) and the future kg-service HTTP API
(live /expand endpoint) — the output shape is the contract for both.

Entity kinds produced:
  paper   — provenance unit, carries a mini-bibliography
  device  — FusionDevice with design parameters
  finding — ExperimentalFinding statement
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from neo4j import Session

ENRICHMENT_SCHEMA_VERSION = 2

# Labels that are graph infrastructure / extraction internals, never domain entities.
_INFRA_LABELS = {
    "Chunk",
    "Document",
    "Session",
    "Message",
    "__KGBuilder__",
    "__Entity__",
}

# Tech-tree label prefixes that must be stripped before resolving, e.g.
# "Concept: HTS Tokamak" -> "HTS Tokamak".
_LABEL_PREFIX_RE = re.compile(r"^\s*(concept|milestone|enabling\s+tech[nology]*)\s*:\s*", re.I)


def normalize_label(label: str) -> str:
    """Strip tech-tree type prefixes and whitespace from a node label."""
    return _LABEL_PREFIX_RE.sub("", label).strip()


def _domain_labels(node_labels: list[str]) -> list[str]:
    return [l for l in node_labels if l not in _INFRA_LABELS]


def resolve_entity(session: Session, text: str, limit: int = 5) -> list[dict[str, Any]]:
    """Match a free-text term to KG entities.

    Returns up to `limit` candidates: [{name, labels, score}] sorted best-first.
    Scoring is heuristic — exact matches beat configuration-type matches beat
    substring matches. Good enough to bootstrap; curated overrides live in
    Mongo `kg_entity_map`.
    """
    q = normalize_label(text)
    if not q:
        return []

    # Keyed by lowercased name so "tokamak" (device) and "Tokamak" (config)
    # merge into one candidate with combined labels.
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
            candidates[key] = {"name": name, "labels": labels, "score": score}

    # 1. Exact (case-insensitive) name match on domain entities.
    for rec in session.run(
        """
        MATCH (n)
        WHERE toLower(n.name) = toLower($q)
        RETURN n.name AS name, labels(n) AS labels
        LIMIT $limit
        """,
        q=q,
        limit=limit,
    ):
        _add(rec["name"], rec["labels"], 1.0)

    # 2. MagneticConfiguration.configurationType match (covers "tokamak",
    #    "stellarator", "torsatron" — the config names in `name` are descriptive,
    #    e.g. "Saturn-1 three-turn stellarator configuration").
    for rec in session.run(
        """
        MATCH (mc:MagneticConfiguration)
        WHERE toLower(mc.configurationType) CONTAINS toLower($q)
        RETURN mc.name AS name, labels(mc) AS labels
        LIMIT $limit
        """,
        q=q,
        limit=limit,
    ):
        _add(rec["name"], rec["labels"], 0.9)

    # 3. Word-boundary name match as fallback (plain CONTAINS makes "iter"
    #    hit "criterion"). Java regex via =~ .
    word_re = r"(?i).*\b" + re.escape(q.lower()) + r"\b.*"
    for rec in session.run(
        """
        MATCH (n)
        WHERE n.name IS NOT NULL AND toLower(n.name) =~ $re
        RETURN n.name AS name, labels(n) AS labels
        LIMIT $limit
        """,
        re=word_re,
        limit=limit,
    ):
        _add(rec["name"], rec["labels"], 0.5)

    return sorted(candidates.values(), key=lambda c: -c["score"])[:limit]


# ---------------------------------------------------------------------------
# Expansion
# ---------------------------------------------------------------------------

def _paper_view(rec: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"paper:{rec['paperId']}",
        "kind": "paper",
        "name": rec.get("title") or rec.get("name") or rec["paperId"],
        "paper": {
            "paperId": rec["paperId"],
            "title": rec.get("title") or rec.get("name"),
            "authors": rec.get("authors") or [],
            "institute": rec.get("institute"),
            "studyKind": rec.get("studyKind"),
            "conference": rec.get("conference"),
            "sessionCode": rec.get("sessionCode"),
            "year": rec.get("year"),
        },
        "relation": rec.get("relation", "evidenced_by"),
    }


def _device_view(rec: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"device:{rec['name']}",
        "kind": "device",
        "name": rec["name"],
        "device": {
            "majorRadius": rec.get("majorRadius"),
            "minorRadius": rec.get("minorRadius"),
            "magneticFieldStrength": rec.get("magneticFieldStrength"),
            "numberOfPeriods": rec.get("numberOfPeriods"),
            "configurationType": rec.get("configurationType"),
        },
        "relation": "instance_of",
    }


def finding_id(statement: str) -> str:
    """Stable finding id. (Python's built-in hash() is randomized per process,
    which made ids — and the curations/votes keyed on them — change every run.)"""
    return "finding:" + hashlib.sha1(statement.encode("utf-8")).hexdigest()[:16]


def _finding_view(rec: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": finding_id(rec["statement"]),
        "kind": "finding",
        "name": rec.get("name") or (rec["statement"][:60] + "…"),
        "summary": rec["statement"],
        "relation": "reported_finding",
    }


# One query per resolution strategy. Each returns rows shaped like:
#   {paper-ish fields..., device fields..., finding fields...}
_QUERIES: dict[str, str] = {
    # MagneticConfiguration -> devices -> experiments -> papers + findings
    "configuration": """
        MATCH (mc:MagneticConfiguration)
        WHERE toLower(mc.configurationType) CONTAINS toLower($term)
           OR toLower(mc.name) CONTAINS toLower($term)
        OPTIONAL MATCH (d:FusionDevice)-[:HAS_CONFIGURATION]->(mc)
        OPTIONAL MATCH (e:Experiment)-[:PERFORMED_ON]->(d)
        OPTIONAL MATCH (p:Paper)-[:REPORTS_ON]->(e)
        OPTIONAL MATCH (e)-[:REPORTS_FINDING]->(f:ExperimentalFinding)
        OPTIONAL MATCH (p)-[:AUTHORED_BY]->(a:Person)
        OPTIONAL MATCH (p)-[:AFFILIATED_WITH]->(i:ResearchInstitute)
        OPTIONAL MATCH (p)-[:PRESENTED_IN_SESSION]->(s:ConferenceSession)-[:SESSION_OF]->(c:Conference)
        RETURN p.paperId AS paperId, p.title AS title, p.studyKind AS studyKind,
               collect(DISTINCT a.name)[..5] AS authors, i.name AS institute,
               c.name AS conference, c.year AS year, s.sessionCode AS sessionCode,
               d.name AS deviceName, d.majorRadius AS majorRadius, d.minorRadius AS minorRadius,
               d.magneticFieldStrength AS magneticFieldStrength, d.numberOfPeriods AS numberOfPeriods,
               mc.configurationType AS configurationType,
               collect(DISTINCT {statement: f.statement, name: f.name})[..5] AS findings
    """,
    # HeatingMethod (any subclass) -> experiments using it -> papers + findings
    "heating": """
        MATCH (hm)
        WHERE toLower(hm.name) CONTAINS toLower($term)
          AND ANY(l IN labels(hm) WHERE l IN $heating_labels)
        OPTIONAL MATCH (e:Experiment)-[:USES_HEATING_METHOD]->(hm)
        OPTIONAL MATCH (p:Paper)-[:REPORTS_ON]->(e)
        OPTIONAL MATCH (e)-[:REPORTS_FINDING]->(f:ExperimentalFinding)
        OPTIONAL MATCH (e)-[:PERFORMED_ON]->(d:FusionDevice)
        OPTIONAL MATCH (p)-[:AUTHORED_BY]->(a:Person)
        OPTIONAL MATCH (p)-[:AFFILIATED_WITH]->(i:ResearchInstitute)
        OPTIONAL MATCH (p)-[:PRESENTED_IN_SESSION]->(s:ConferenceSession)-[:SESSION_OF]->(c:Conference)
        RETURN p.paperId AS paperId, p.title AS title, p.studyKind AS studyKind,
               collect(DISTINCT a.name)[..5] AS authors, i.name AS institute,
               c.name AS conference, c.year AS year, s.sessionCode AS sessionCode,
               d.name AS deviceName, d.majorRadius AS majorRadius, d.minorRadius AS minorRadius,
               d.magneticFieldStrength AS magneticFieldStrength, d.numberOfPeriods AS numberOfPeriods,
               NULL AS configurationType,
               collect(DISTINCT {statement: f.statement, name: f.name})[..5] AS findings
    """,
    # FusionDevice -> experiments -> papers + findings
    "device": """
        MATCH (d:FusionDevice)
        WHERE toLower(d.name) CONTAINS toLower($term)
        OPTIONAL MATCH (e:Experiment)-[:PERFORMED_ON]->(d)
        OPTIONAL MATCH (p:Paper)-[:REPORTS_ON]->(e)
        OPTIONAL MATCH (e)-[:REPORTS_FINDING]->(f:ExperimentalFinding)
        OPTIONAL MATCH (d)-[:HAS_CONFIGURATION]->(mc:MagneticConfiguration)
        OPTIONAL MATCH (p)-[:AUTHORED_BY]->(a:Person)
        OPTIONAL MATCH (p)-[:AFFILIATED_WITH]->(i:ResearchInstitute)
        OPTIONAL MATCH (p)-[:PRESENTED_IN_SESSION]->(s:ConferenceSession)-[:SESSION_OF]->(c:Conference)
        RETURN p.paperId AS paperId, p.title AS title, p.studyKind AS studyKind,
               collect(DISTINCT a.name)[..5] AS authors, i.name AS institute,
               c.name AS conference, c.year AS year, s.sessionCode AS sessionCode,
               d.name AS deviceName, d.majorRadius AS majorRadius, d.minorRadius AS minorRadius,
               d.magneticFieldStrength AS magneticFieldStrength, d.numberOfPeriods AS numberOfPeriods,
               collect(DISTINCT mc.configurationType)[0] AS configurationType,
               collect(DISTINCT {statement: f.statement, name: f.name})[..5] AS findings
    """,
    # PlasmaParameter / ConfinementTime -> measurements -> experiments -> papers
    "parameter": """
        MATCH (pp)
        WHERE toLower(pp.name) CONTAINS toLower($term)
          AND ANY(l IN labels(pp) WHERE l IN ['PlasmaParameter','ConfinementTime'])
        OPTIONAL MATCH (m:Measurement)-[:MEASURES_PARAMETER]->(pp)
        OPTIONAL MATCH (e:Experiment)-[:HAS_MEASUREMENT]->(m)
        OPTIONAL MATCH (p:Paper)-[:REPORTS_ON]->(e)
        OPTIONAL MATCH (e)-[:REPORTS_FINDING]->(f:ExperimentalFinding)
        OPTIONAL MATCH (e)-[:PERFORMED_ON]->(d:FusionDevice)
        OPTIONAL MATCH (p)-[:AUTHORED_BY]->(a:Person)
        OPTIONAL MATCH (p)-[:AFFILIATED_WITH]->(i:ResearchInstitute)
        OPTIONAL MATCH (p)-[:PRESENTED_IN_SESSION]->(s:ConferenceSession)-[:SESSION_OF]->(c:Conference)
        RETURN p.paperId AS paperId, p.title AS title, p.studyKind AS studyKind,
               collect(DISTINCT a.name)[..5] AS authors, i.name AS institute,
               c.name AS conference, c.year AS year, s.sessionCode AS sessionCode,
               d.name AS deviceName, d.majorRadius AS majorRadius, d.minorRadius AS minorRadius,
               d.magneticFieldStrength AS magneticFieldStrength, d.numberOfPeriods AS numberOfPeriods,
               NULL AS configurationType,
               collect(DISTINCT {statement: f.statement, name: f.name})[..5] AS findings
    """,
    # Phenomena (instability / wave / mechanism) -> studies/experiments -> papers
    "phenomenon": """
        MATCH (ph)
        WHERE toLower(ph.name) CONTAINS toLower($term)
          AND ANY(l IN labels(ph) WHERE l IN $phenomena_labels)
        OPTIONAL MATCH (x)-[r]->(ph)
        WHERE type(r) IN ['OBSERVED_INSTABILITY','PREDICTED_INSTABILITY','USES_WAVE','EXPLAINED_BY']
           AND (x:Experiment OR x:Study OR x:ExperimentalFinding OR x:HeatingMethod OR x:WaveHeating)
        OPTIONAL MATCH (p:Paper)-[:REPORTS_ON]->(x)
        OPTIONAL MATCH (x)-[:REPORTS_FINDING]->(f:ExperimentalFinding)
        OPTIONAL MATCH (x)-[:PERFORMED_ON]->(d:FusionDevice)
        OPTIONAL MATCH (p)-[:AUTHORED_BY]->(a:Person)
        OPTIONAL MATCH (p)-[:AFFILIATED_WITH]->(i:ResearchInstitute)
        OPTIONAL MATCH (p)-[:PRESENTED_IN_SESSION]->(s:ConferenceSession)-[:SESSION_OF]->(c:Conference)
        RETURN p.paperId AS paperId, p.title AS title, p.studyKind AS studyKind,
               collect(DISTINCT a.name)[..5] AS authors, i.name AS institute,
               c.name AS conference, c.year AS year, s.sessionCode AS sessionCode,
               d.name AS deviceName, d.majorRadius AS majorRadius, d.minorRadius AS minorRadius,
               d.magneticFieldStrength AS magneticFieldStrength, d.numberOfPeriods AS numberOfPeriods,
               NULL AS configurationType,
               collect(DISTINCT {statement: f.statement, name: f.name})[..5] AS findings
    """,
    # Generic fallback: papers connected to the entity via document chunks.
    "generic": """
        MATCH (e)
        WHERE toLower(e.name) CONTAINS toLower($term)
        MATCH (e)-[:FROM_CHUNK]->(c:Chunk)-[:FROM_DOCUMENT]->(doc:Document)
        MATCH (p:Paper)-[:FROM_DOCUMENT]->(doc)
        OPTIONAL MATCH (p)-[:AUTHORED_BY]->(a:Person)
        OPTIONAL MATCH (p)-[:AFFILIATED_WITH]->(i:ResearchInstitute)
        OPTIONAL MATCH (p)-[:PRESENTED_IN_SESSION]->(s:ConferenceSession)-[:SESSION_OF]->(conf:Conference)
        RETURN p.paperId AS paperId, p.title AS title, p.studyKind AS studyKind,
               collect(DISTINCT a.name)[..5] AS authors, i.name AS institute,
               conf.name AS conference, conf.year AS year, s.sessionCode AS sessionCode,
               NULL AS deviceName, NULL AS majorRadius, NULL AS minorRadius,
               NULL AS magneticFieldStrength, NULL AS numberOfPeriods,
               NULL AS configurationType,
               [] AS findings
    """,
}

_HEATING_LABELS = [
    "HeatingMethod", "OhmicHeating", "WaveHeating", "UhfHeating",
    "IonCyclotronHeating", "LowerHybridHeating", "MagnetoAcousticHeating",
    "AdiabaticCompressionHeating", "MagneticPumping",
]
_PHENOMENA_LABELS = ["OscillationOrInstability", "PlasmaWave", "TheoreticalMechanism"]
_PARAMETER_LABELS = ["PlasmaParameter", "ConfinementTime"]
_PRODUCTION_LABELS = [
    "PlasmaProductionMethod", "OhmicDischarge", "HighFrequencyPreIonization",
    "UhfDischarge", "PlasmaGunInjection", "ElectronBeamInjection",
]


def _strategy_for(labels: list[str]) -> str:
    if "MagneticConfiguration" in labels:
        return "configuration"
    if "FusionDevice" in labels:
        return "device"
    if any(l in _HEATING_LABELS for l in labels):
        return "heating"
    if any(l in _PARAMETER_LABELS for l in labels):
        return "parameter"
    if any(l in _PHENOMENA_LABELS for l in labels):
        return "phenomenon"
    return "generic"


def expand(
    session: Session,
    entity_name: str,
    entity_labels: list[str] | None = None,
    max_papers: int = 10,
    max_devices: int = 5,
    max_findings: int = 5,
) -> dict[str, Any]:
    """Expand one resolved entity into overlay-ready {entities, meta}."""
    term = normalize_label(entity_name)
    strategy = _strategy_for(entity_labels or [])
    rows = list(
        session.run(
            _QUERIES[strategy],
            term=term,
            heating_labels=_HEATING_LABELS,
            phenomena_labels=_PHENOMENA_LABELS + _PRODUCTION_LABELS,
        )
    )

    papers: dict[str, dict[str, Any]] = {}
    devices: dict[str, dict[str, Any]] = {}
    findings: dict[str, dict[str, Any]] = {}

    for r in rows:
        rec = dict(r)
        if rec.get("paperId") and rec["paperId"] not in papers:
            papers[rec["paperId"]] = _paper_view(rec)
        if rec.get("deviceName") and rec["deviceName"] not in devices:
            devices[rec["deviceName"]] = _device_view(
                {**rec, "name": rec["deviceName"]}
            )
        for f in rec.get("findings") or []:
            if f.get("statement") and f["statement"] not in findings:
                findings[f["statement"]] = _finding_view(f)

    truncated = len(papers) > max_papers
    entities = (
        list(papers.values())[:max_papers]
        + list(devices.values())[:max_devices]
        + list(findings.values())[:max_findings]
    )

    return {
        "entities": entities,
        "meta": {
            "resolved_entity": entity_name,
            "labels": entity_labels or [],
            "strategy": strategy,
            "paper_count": len(papers),
            "truncated": truncated,
        },
    }


# ---------------------------------------------------------------------------
# Paper dossier
# ---------------------------------------------------------------------------

def paper_dossier(session: Session, paper_id: str) -> dict[str, Any] | None:
    """Full bibliography + findings for one paper (details panel / chat citations)."""
    rec = next(
        iter(
            session.run(
                """
        MATCH (p:Paper {paperId: $pid})
        OPTIONAL MATCH (p)-[:AUTHORED_BY]->(a:Person)
        OPTIONAL MATCH (p)-[:PRESENTED_BY]->(pr:Person)
        OPTIONAL MATCH (p)-[:AFFILIATED_WITH]->(i:ResearchInstitute)
        OPTIONAL MATCH (p)-[:PRESENTED_IN_SESSION]->(s:ConferenceSession)-[:SESSION_OF]->(c:Conference)
        RETURN p AS paper,
               collect(DISTINCT a.name) AS authors,
               collect(DISTINCT pr.name) AS presenters,
               collect(DISTINCT {name: i.name, city: i.city})[0] AS institute,
               collect(DISTINCT {name: c.name, year: c.year, location: c.location,
                session: s.sessionCode})[0] AS conference
        """,
                pid=paper_id,
            )
        ),
        None,
    )
    if not rec:
        return None

    p = dict(rec["paper"])

    experiments = [
        dict(r)
        for r in session.run(
            """
            MATCH (p:Paper {paperId: $pid})-[:REPORTS_ON]->(x)
            WHERE x:Experiment OR x:Study
            OPTIONAL MATCH (x)-[:PERFORMED_ON]->(d:FusionDevice)
            OPTIONAL MATCH (x)-[h:USES_HEATING_METHOD]->(hm)
            OPTIONAL MATCH (x)-[:REPORTS_FINDING]->(f:ExperimentalFinding)
            OPTIONAL MATCH (x)-[:HAS_MEASUREMENT]->(m:Measurement)
            OPTIONAL MATCH (m)-[:MEASURES_PARAMETER]->(pp)
            OPTIONAL MATCH (m)-[:USES_DIAGNOSTIC]->(dg:Diagnostic)
            OPTIONAL MATCH (x)-[:HAS_SCALABILITY_CLAIM]->(sc:ScalabilityClaim)
            OPTIONAL MATCH (x)-[:HAS_IMPLEMENTATION_CONSTRAINT]->(ic:ImplementationConstraint)
            OPTIONAL MATCH (x)-[i:OBSERVED_INSTABILITY|PREDICTED_INSTABILITY]->(oi:OscillationOrInstability)
            RETURN x.name AS name,
                   d.name AS device,
                   collect(DISTINCT {name: hm.name, frequency: h.frequency,
                                     power: h.power, pulseDuration: h.pulseDuration}) AS heatingMethods,
                   collect(DISTINCT f.statement) AS findings,
                   collect(DISTINCT {parameter: pp.name, value: m.reportedValue,
                                     unit: m.unit, diagnostic: dg.name}) AS measurements,
                   collect(DISTINCT {statement: sc.claimStatement, limit: sc.claimedLimit}) AS scalabilityClaims,
                   collect(DISTINCT ic.constraintStatement) AS constraints,
                   collect(DISTINCT {name: oi.name,
                                     observed: type(i) = 'OBSERVED_INSTABILITY'}) AS instabilities
            """,
            pid=paper_id,
        )
    ]

    # Top excerpts: up to 3 chunks of the source document.
    excerpts = [
        r["text"]
        for r in session.run(
            """
            MATCH (p:Paper {paperId: $pid})-[:FROM_DOCUMENT]->(doc:Document)
            MATCH (doc)<-[:FROM_DOCUMENT]-(c:Chunk)
            RETURN c.text AS text
            ORDER BY c.index ASC
            LIMIT 3
            """,
            pid=paper_id,
        )
    ]

    return {
        "paperId": p.get("paperId"),
        "title": p.get("title") or p.get("name"),
        "authors": rec["authors"],
        "presenters": rec["presenters"],
        "institute": rec["institute"],
        "conference": rec["conference"],
        "studyKind": p.get("studyKind"),
        "originalLanguage": p.get("originalLanguage"),
        "numPages": p.get("numPages"),
        "experiments": experiments,
        "excerpts": [e[:500] for e in excerpts if e],
    }
