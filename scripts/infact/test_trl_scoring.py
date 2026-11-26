"""Run with: uv run --with pytest pytest scripts/infact -q"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from evidence import collect_sources, normalise, quote_match
from followup import FORBIDDEN_QUERY, clean_query, flagged_claims, template_queries, url_key
from trl_scoring import (
    Constraint,
    DesignStatus,
    SourceJudgement,
    design_status,
    parse_band,
    score,
)

NONE = Constraint(False)
UNKNOWN = DesignStatus(None)


def src(url: str, tech: tuple[int, int] | None = None, app: tuple[int, int] | None = None, **kw) -> SourceJudgement:
    def c(r: tuple[int, int] | None) -> Constraint:
        return Constraint(True, r[0], r[1], kw.get("strength", "strong")) if r else NONE

    return SourceJudgement(
        url=url,
        technology=c(tech),
        application=c(app),
        source_type=kw.get("source_type", "peer_reviewed_or_government"),
        text_available=kw.get("text_available", True),
    )


def probs(result: dict) -> dict[str, float]:
    return {dim: r.get("probability") for dim, r in result["results"].items()}


def test_parse_band() -> None:
    assert parse_band("3-4") == [3, 4]
    assert parse_band("6") == [6]
    assert parse_band("4-6") == [4, 5, 6]
    assert parse_band(None) == []


def test_design_status_categories() -> None:
    assert design_status(["Conceptual design", "NEA licensing 2/6"]).category == "design"
    assert design_status(["Basic design", "Under construction"]).category == "under_construction"
    assert design_status(["Basic design", "In operation", None]) == DesignStatus("operating", 0)
    assert design_status(["Detailed design", None]) == DesignStatus("design", 1)
    assert design_status([None]).category is None


def test_irrelevant_sources_are_neutral() -> None:
    bands = {"technology": [9], "application": [6]}
    base = score([], UNKNOWN, bands)
    with_noise = score([src("https://a.org"), src("https://b.org")], UNKNOWN, bands)
    assert probs(base) == pytest.approx(probs(with_noise))
    assert "insufficient_evidence" in with_noise["results"]["technology"]["flags"]


def test_technology_evidence_does_not_need_built_reactor() -> None:
    """Proven elsewhere -> high technology TRL even though the design is on paper."""
    result = score(
        [src("https://a.org", tech=(9, 9)), src("https://b.org", tech=(8, 9))],
        DesignStatus("design"),
        {"technology": [9], "application": [3, 4]},
    )
    tech = result["results"]["technology"]
    app = result["results"]["application"]
    assert tech["probability"] > 0.6
    assert app["trl_estimate"] <= 6  # capped by the design status only


def test_design_status_counts_once() -> None:
    """Repeating 'not built' across sources is no longer possible: it is one item."""
    bands = {"technology": [], "application": [7, 8, 9]}
    app = score([], DesignStatus("design"), bands)["results"]["application"]
    assert app["probability"] < app["prior_probability"]  # cap at 6
    assert app["num_relevant"] == 1
    steps = score([src("https://a.org"), src("https://b.org")], DesignStatus("design"), bands)["steps"]
    assert len(steps) == 3
    assert steps[2]["application"]["probability"] == pytest.approx(app["probability"])


def test_unbuilt_design_never_lowers_technology_trl() -> None:
    bands = {"technology": [9], "application": [7, 8, 9]}
    for category in ("design", "under_construction"):
        r = score([], DesignStatus(category), bands)["results"]["technology"]
        assert r["probability"] == pytest.approx(r["prior_probability"])


def test_operating_reactor_sets_floor() -> None:
    result = score([], DesignStatus("operating"), {"technology": [], "application": [7, 8, 9]})
    app, tech = result["results"]["application"], result["results"]["technology"]
    assert app["probability"] > 5 * app["prior_probability"]
    # A <= T, so the floor on the application also lifts the technology TRL
    assert tech["trl_estimate"] >= 7


def test_application_never_exceeds_technology() -> None:
    result = score([src("https://a.org", tech=(4, 4)), src("https://b.org", app=(9, 9))], UNKNOWN, {"technology": [4], "application": [9]})
    app = result["results"]["application"]["distribution"]
    tech = result["results"]["technology"]["distribution"]
    assert sum(app[str(t)] for t in range(1, 10) if t > 4) < sum(tech[str(t)] for t in range(5, 10)) + 1e-9


def test_order_independent() -> None:
    items = [("https://a.org", (5, 6), None), ("https://b.org", (2, 4), (2, 3)), ("https://c.org", (6, 8), (5, 6))]
    bands = {"technology": [6], "application": [5]}
    forward = probs(score([src(u, t, a) for u, t, a in items], DesignStatus("design"), bands))
    backward = probs(score([src(u, t, a) for u, t, a in reversed(items)], DesignStatus("design"), bands))
    assert forward == pytest.approx(backward)


def test_same_domain_is_dampened_per_dimension() -> None:
    js = [src("https://www.a.org/1", tech=(6, 6)), src("https://a.org/2", tech=(6, 6), app=(5, 5))]
    score(js, UNKNOWN, {"technology": [6], "application": [5]})
    assert js[1].weights["technology"] == pytest.approx(js[0].weights["technology"] * 0.5)
    assert js[1].weights["application"] == pytest.approx(1.0)  # first application item from a.org


def test_interval_contains_probability() -> None:
    result = score([src("https://a.org", tech=(5, 6)), src("https://b.org", tech=(6, 6))], UNKNOWN, {"technology": [6], "application": [6]})
    r = result["results"]["technology"]
    assert r["interval"][0] <= r["probability"] <= r["interval"][1]


def test_missing_claim_is_flagged() -> None:
    r = score([], UNKNOWN, {"technology": [], "application": [6]})["results"]["technology"]
    assert "probability" not in r and "no_claim" in r["flags"]


def test_collect_sources_groups_by_url() -> None:
    deployment = {
        "evidence": [{"url": "u1", "claim": "trl_band", "quote": "q"}],
        "suppliers": [{"name": "X", "url": "u1"}],
        "milestones": [{"date": "2020", "event": "e", "url": "u2"}],
        "sources": [{"label": "W1", "title": "T1", "url": "u1"}, {"label": "W2", "title": "T2", "url": "u3"}],
        "deep_research": {"learnings": [{"fact": "f", "quote": "q2", "url": "u2"}]},
    }
    sources = collect_sources(deployment)
    assert [s.url for s in sources] == ["u1", "u2", "u3"]
    assert sources[0].title == "T1" and len(sources[0].notes) == 2
    assert sources[2].notes == []


def test_quote_match_handles_unicode_hyphens() -> None:
    text = normalise("The high\u2011speed electric motor was tested at 25,000 RPM in CO2.")
    assert quote_match("high-speed electric motor was tested at 25,000 RPM", text) == "exact"
    assert quote_match("something completely different here today", text) == "missing"


def test_followup_only_for_flagged_claims() -> None:
    results = {
        "technology": {"flags": []},
        "application": {"flags": ["insufficient_evidence"]},
    }
    assert flagged_claims(results) == ["application"]
    assert flagged_claims({"technology": {"flags": ["no_claim"]}}) == []


def test_template_queries_are_neutral() -> None:
    for dim in ("technology", "application"):
        queries = template_queries("High-speed electric motor", ["HOLOS-QUAD", "NANO LOKI"], dim)
        assert len(queries) == 2
        assert not any(FORBIDDEN_QUERY.search(q) for q in queries)


def test_clean_query_rejects_trl_steering() -> None:
    assert clean_query("metallic thorium fuel TRL 9 commercial") is None
    assert clean_query("thorium fuel technology readiness level") is None
    assert clean_query("thorium fuel maturity 6-7") is None
    assert clean_query('  "EBR-II" thorium metal fuel irradiation results ') == "EBR-II thorium metal fuel irradiation results"


def test_url_key_deduplicates_variants() -> None:
    assert url_key("https://www.holosgen.com/technology/") == url_key("http://holosgen.com/technology#top")
    assert url_key("https://a.org/x?p=1") != url_key("https://a.org/x?p=2")


def test_mentions_technology_filters_off_topic_hits() -> None:
    from evidence import name_terms
    from followup import mentions_technology

    phrases, _ = name_terms("Shore refuelling", [])
    assert mentions_technology("Floating units use shore refuelling at a base.", phrases)
    assert not mentions_technology("Marina fuel dock opening hours and boat repair.", phrases)
    assert mentions_technology("The units are refueled at a shore-based facility.", phrases)
    phrases, _ = name_terms("Metallic thorium fuel", [])
    assert mentions_technology("Thorium metal fuel pins: metallic alloys ...", phrases)
    assert not mentions_technology("Thorium oxide fuel pellets for heavy water reactors.", phrases)
    # long alias lists must not raise the bar for the main name
    phrases, _ = name_terms("High-speed electric motor", ["high-speed permanent magnet motor-generator", "direct drive"])
    assert mentions_technology("The high speed electric generator and motor were tested", phrases)
