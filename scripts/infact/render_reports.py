"""Render HTML evidence reports for every node analyzed by analyze_all_nodes.py.

Reads each <details-dir>/<slug>.json file and renders <slug>.html next to it.
InFact v2 files (`"method": "infact-v2"`) get the per-source judgement report
with the TRL distribution; older InFact API files keep the original template.

Usage:
    uv run scripts/infact/render_reports.py [--details-dir outputs/infact-v2/node-infact-details]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from jinja2 import Template

sys.path.insert(0, str(Path(__file__).parent))
from trl_scoring import parse_band

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DETAILS_DIR = REPO_ROOT / "outputs" / "infact-v2" / "node-infact-details"

V2_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InFact TRL check: {{ d.node_label }}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; max-width: 1200px;
               margin: 0 auto; padding: 2rem; color: #1a1a1a; background: #f7fafc; }
        .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                padding: 1.5rem; margin-bottom: 1.5rem; }
        .hypothesis { color: #4a5568; padding: 1rem; background: #f7fafc; border-radius: 6px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 1rem; }
        .two { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        .stat { background: #f7fafc; padding: 0.8rem; border-radius: 6px; text-align: center; }
        .stat-value { font-size: 1.4rem; font-weight: bold; color: #2b6cb0; }
        .stat-label { font-size: 0.8rem; color: #4a5568; }
        .primary { outline: 2px solid #2b6cb0; border-radius: 8px; padding: 0.8rem; }
        .flag { display: inline-block; background: #fef3c7; color: #92400e; border-radius: 4px;
                padding: 0.1rem 0.5rem; margin-right: 0.4rem; font-size: 0.85rem; }
        .source { border-left: 4px solid #4299e1; padding-left: 1rem; margin-bottom: 2rem; }
        .source.neutral { border-left-color: #a0aec0; }
        .source.status { border-left-color: #805ad5; }
        .source.followup { border-left-color: #38a169; }
        .origin { display: inline-block; background: #c6f6d5; color: #22543d; border-radius: 4px;
                  padding: 0 0.4rem; font-size: 0.8rem; margin-left: 0.4rem; }
        .meta { font-size: 0.85rem; color: #4a5568; }
        .ok { color: #047857; } .warn { color: #b45309; } .bad { color: #dc2626; }
        .chart { height: 280px; }
        a { color: #2b6cb0; word-break: break-all; }
        blockquote { margin: 0.3rem 0 0.3rem 1rem; color: #4a5568; font-style: italic; }
        summary { cursor: pointer; color: #2b6cb0; font-weight: 500; }
        table { border-collapse: collapse; font-size: 0.9rem; }
        td, th { padding: 0.2rem 0.8rem 0.2rem 0; text-align: left; }
    </style>
</head>
<body>
    <header class="card">
        <h1>{{ d.node_label }}</h1>
        <div class="hypothesis">{{ d.hypothesis }}</div>
        <p class="meta">Claim basis: {{ d.claim.trl_basis or 'n/a' }} &middot; deep-research confidence:
            {{ d.claim.confidence or 'n/a' }} &middot; availability: {{ d.claim.availability or 'n/a' }}</p>
        {% if d.claim.trl_rationale %}
        <details><summary>Deep-research TRL rationale (the claims being re-judged)</summary>
            <p>{{ d.claim.trl_rationale }}</p></details>
        {% endif %}
    </header>

    <section class="card">
        <h2>Re-judged result</h2>
        <div class="two">
        {% for dim, title in dims %}
            {% set r = d.results[dim] %}
            <div{% if dim == d.primary %} class="primary"{% endif %}>
                <h3>{{ title }}{% if dim == d.primary %} (primary){% endif %}</h3>
                <p class="meta">{{ dim_help[dim] }}</p>
                <div class="grid">
                    {% if r.probability is defined %}
                    <div class="stat"><div class="stat-value">{{ pct(r.probability) }}</div>
                        <div class="stat-label">P(TRL {{ d.claims[dim] }})</div></div>
                    <div class="stat"><div class="stat-value">{{ pct(r.interval[0]) }}&ndash;{{ pct(r.interval[1]) }}</div>
                        <div class="stat-label">90% interval</div></div>
                    {% else %}
                    <div class="stat"><div class="stat-value">&ndash;</div><div class="stat-label">no claim</div></div>
                    {% endif %}
                    <div class="stat"><div class="stat-value">TRL {{ r.trl_estimate }}</div>
                        <div class="stat-label">median</div></div>
                    <div class="stat"><div class="stat-value">{{ r.trl_credible_range_80[0] }}&ndash;{{ r.trl_credible_range_80[1] }}</div>
                        <div class="stat-label">80% range</div></div>
                    <div class="stat"><div class="stat-value">{{ r.num_relevant }}</div>
                        <div class="stat-label">constraining items</div></div>
                </div>
                <p>{% for f in r.flags %}<span class="flag">{{ f|replace('_', ' ') }}</span>{% endfor %}</p>
                <div class="chart"><canvas id="dist-{{ dim }}"></canvas></div>
            </div>
        {% endfor %}
        </div>
        <div class="chart" style="margin-top: 1.5rem"><canvas id="beliefChart"></canvas></div>
        <p class="meta">Model: {{ d.model }} &middot; prompt {{ d.prompt_version }}{% if d.think %} &middot; thinking{% endif %}.
            The LLM classified each source without seeing the claimed TRLs and ignoring the reactors' build status;
            the design status enters once from the reactor dataset. Application TRL = min(technology TRL,
            integration progress), so it never exceeds the technology TRL and an unbuilt reactor never lowers the
            technology TRL.</p>
    </section>

    {% if d.followup %}
    <section class="card">
        <h2>Follow-up search</h2>
        <p class="meta">Flagged after the deep-research sources: {{ d.followup.flagged|join(', ') }}.
            {{ d.followup.queries|length }} neutral queries (no TRL values), {{ d.followup.new_sources }} new sources
            judged the same way. Deep-research URLs and copies were skipped.</p>
        <table>
            <tr><th>Claim</th><th>Origin</th><th>Query</th><th>Results</th><th>Duplicates</th><th>Off-topic</th><th>Judged</th></tr>
            {% for q in d.followup.queries %}
            <tr><td>{{ q.claim }}</td><td>{{ q.origin }}</td>
                <td>{{ q.query }}{% if q.question %}<br><span class="meta">{{ q.question }}</span>{% endif %}</td>
                <td>{{ q.get('results', '-') }}</td><td>{{ q.get('duplicates', '-') }}</td>
                <td>{{ q.get('off_topic', '-') }}</td><td>{{ q.get('new_sources', '-') }}</td></tr>
            {% endfor %}
        </table>
        <h4>Before &rarr; after</h4>
        <table>
            <tr><th>Claim</th><th>P(claim)</th><th>median TRL</th><th>80% range</th><th>flags</th></tr>
            {% for dim, title in dims %}{% set b = d.followup.results_before[dim] %}{% set r = d.results[dim] %}
            <tr><td>{{ title }}</td>
                <td>{% if r.probability is defined %}{{ pct(b.probability) }} &rarr; {{ pct(r.probability) }}{% else %}&ndash;{% endif %}</td>
                <td>{{ b.trl_estimate }} &rarr; {{ r.trl_estimate }}</td>
                <td>{{ b.trl_credible_range_80|join('-') }} &rarr; {{ r.trl_credible_range_80|join('-') }}</td>
                <td>{{ b.flags|join(', ') or '-' }} &rarr; {{ r.flags|join(', ') or '-' }}</td></tr>
            {% endfor %}
        </table>
    </section>
    {% endif %}

    <section class="card">
        <h2>Evidence</h2>
        {% for e in d.evidence %}
        {% if e.kind == 'design_status' %}
        <div class="source status">
            <h3>{{ loop.index }}. {{ e.file }}</h3>
            <table><tr><th>Design</th><th>Status</th></tr>
                {% for x in e.designs %}<tr><td>{{ x.name }}</td><td>{{ x.status or 'unknown' }}</td></tr>{% endfor %}
            </table>
            <p class="meta">Most advanced: <b>{{ (e.category or 'unknown')|replace('_', ' ') }}</b>
                {% if e.unknown_designs %}({{ e.unknown_designs }} design(s) unknown, half weight){% endif %}
                &rarr; {{ status_effect[e.category] }} &middot; weight {{ "%.2f"|format(e.weights.application) }}
                &middot; P after: {% for dim, title in dims %}{% if e.steps[dim] is defined %}{{ title }} {{ pct(e.steps[dim].probability) }} {% endif %}{% endfor %}</p>
        </div>
        {% else %}
        {% set j = e.judgement %}
        <div class="source{% if not j.relevant %} neutral{% elif e.origin == 'infact_followup' %} followup{% endif %}">
            <h3>{{ loop.index }}. {{ e.file }}{% if e.origin == 'infact_followup' %}<span class="origin">follow-up search</span>{% endif %}</h3>
            {% if e.query %}<p class="meta">found by: &ldquo;{{ e.query }}&rdquo;</p>{% endif %}
            <p><a href="{{ e.url }}">{{ e.url }}</a></p>
            <p class="meta">
                download: <span class="{{ 'ok' if e.download_status == 'ok' else 'bad' }}">{{ e.download_status }}</span>
                {% if e.text_chars %}({{ e.text_chars }} chars, {{ e.excerpt_chars }} shown to the model){% endif %}
                &middot; {{ j.source_type|replace('_', ' ') }}</p>
            <table>
                <tr><th></th><th>supports</th><th>strength</th><th>weight</th><th>likelihood ratio</th><th>P after</th></tr>
                {% for dim, title in dims %}{% set c = j[dim] %}
                <tr><td>{{ title }}</td>
                    <td>{% if c.constrains %}TRL {{ c.trl_low }}&ndash;{{ c.trl_high }}{% else %}<span class="meta">nothing (neutral)</span>{% endif %}</td>
                    <td>{{ c.strength if c.constrains else '' }}</td>
                    <td>{{ "%.2f"|format(e.weights[dim]) }}</td>
                    <td>{% if e.steps[dim] is defined %}{{ "%.2f"|format(lr(e.steps[dim])) }}&times;{% endif %}</td>
                    <td>{% if e.steps[dim] is defined %}{{ pct(e.steps[dim].probability) }}{% endif %}</td></tr>
                {% endfor %}
            </table>
            <p>{{ j.rationale }}</p>
            {% if j.maturity_facts %}<h4>Maturity facts</h4><ul>
                {% for f in j.maturity_facts %}<li>{{ f.statement }}{% if f.quote %}<blockquote>&ldquo;{{ f.quote }}&rdquo;</blockquote>{% endif %}</li>{% endfor %}
            </ul>{% endif %}
            {% if j.limitations %}<h4>Limitations</h4><ul>
                {% for l in j.limitations %}<li>{{ l }}</li>{% endfor %}</ul>{% endif %}
            {% if e.notes %}<details><summary>Deep-research notes citing this source ({{ e.notes|length }})</summary><ul>
                {% for n in e.notes %}<li>[{{ n.kind }}] {{ n.text }}
                    {% if n.quote %}<blockquote>&ldquo;{{ n.quote }}&rdquo;</blockquote>
                    quote in downloaded text:
                    <span class="{{ {'exact': 'ok', 'approximate': 'warn', 'missing': 'bad'}.get(n.quote_found, 'warn') }}">
                        {{ n.quote_found or 'not checked' }}</span>{% endif %}</li>{% endfor %}
            </ul></details>{% endif %}
        </div>
        {% endif %}
        {% endfor %}
    </section>

    <script>
        const labels = ['1','2','3','4','5','6','7','8','9'];
        {% for dim, title in dims %}
        new Chart(document.getElementById('dist-{{ dim }}'), {
            type: 'bar',
            data: { labels, datasets: [{ label: 'P(TRL)', data: {{ dists[dim]|tojson }},
                backgroundColor: labels.map(t => {{ bands[dim]|tojson }}.includes(Number(t)) ? '#2b6cb0' : '#a0aec0') }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true,
                text: '{{ title }} TRL distribution (claim highlighted)' }, legend: { display: false } },
                scales: { y: { beginAtZero: true, max: 1 } } }
        });
        {% endfor %}
        new Chart(document.getElementById('beliefChart'), {
            type: 'line',
            data: { labels: ['Prior'].concat({{ step_labels|tojson }}), datasets: {{ belief_sets|tojson }} },
            options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true,
                text: 'P(claimed TRL) after each item' } }, scales: { y: { beginAtZero: true, max: 1 } } }
        });
    </script>
</body>
</html>
"""

TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InFact Analysis: {{ node_label }}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            line-height: 1.5;
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
            color: #1a1a1a;
        }

        .card {
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }

        .hypothesis {
            font-size: 1rem;
            color: #4a5568;
            margin: 1rem 0;
            padding: 1rem;
            background: #f7fafc;
            border-radius: 6px;
            white-space: pre-wrap;
        }

        .final-assessment {
            text-align: center;
            padding: 2rem;
            background: #ebf8ff;
        }

        .probability {
            font-size: 3rem;
            font-weight: bold;
            color: #2b6cb0;
        }

        .uncertainty {
            font-size: 1.2rem;
            color: #4a5568;
            margin-top: 0.5rem;
        }

        .evidence-point {
            border-left: 4px solid #4299e1;
            padding-left: 1rem;
            margin-bottom: 2rem;
        }

        .evidence-point.redundant {
            border-left-color: #a0aec0;
            opacity: 0.7;
        }

        .evidence-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1rem;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
            margin: 1rem 0;
        }

        .stat-card {
            background: #f7fafc;
            padding: 1rem;
            border-radius: 6px;
            text-align: center;
        }

        .stat-value {
            font-size: 1.5rem;
            font-weight: bold;
            color: #2b6cb0;
        }

        .stat-label {
            font-size: 0.875rem;
            color: #4a5568;
            margin-top: 0.25rem;
        }

        .chart-container {
            height: 400px;
            margin: 2rem 0;
        }

        .confidence-high { color: #047857; }
        .confidence-medium { color: #b45309; }
        .confidence-low { color: #dc2626; }

        a { color: #2b6cb0; }

        details {
            margin-top: 1rem;
        }

        summary {
            cursor: pointer;
            color: #2b6cb0;
            font-weight: 500;
        }

        pre {
            background: #f7fafc;
            padding: 1rem;
            border-radius: 6px;
            overflow-x: auto;
            font-size: 0.875rem;
            white-space: pre-wrap;
        }
    </style>
</head>
<body>
    <header>
        <h1>{{ node_label }}</h1>
        <div class="hypothesis">{{ hypothesis }}</div>
    </header>

    <main>
        <section class="card final-assessment">
            <h2>Current Assessment</h2>
            <div class="probability">
                {{ "%.1f"|format(final_probability * 100) }}%
            </div>
            <div class="uncertainty">
                ({{ "%.4f"|format(ci_low * 100) }}%, {{ "%.4f"|format(ci_high * 100) }}%)
            </div>
            <div class="interpretation">
                {% if final_probability > 0.99 %}Virtually Certain
                {% elif final_probability > 0.95 %}Extremely Likely
                {% elif final_probability > 0.90 %}Very Likely
                {% elif final_probability > 0.66 %}Likely
                {% elif final_probability > 0.33 %}Uncertain
                {% elif final_probability > 0.10 %}Unlikely
                {% elif final_probability > 0.05 %}Very Unlikely
                {% elif final_probability > 0.01 %}Extremely Unlikely
                {% else %}Virtually Impossible{% endif %}
            </div>
        </section>

        <section class="card">
            <h2>Belief Evolution</h2>
            <div class="chart-container">
                <canvas id="beliefChart"></canvas>
            </div>
        </section>

        <section class="card">
            <h2>Evidence Analysis</h2>
            {% for point in evidence_points %}
            <div class="evidence-point{% if point.redundant %} redundant{% endif %}">
                <h3>Evidence {{ loop.index }}: {{ point.file }}{% if point.redundant %} (redundant){% endif %}</h3>
                {% if point.url %}<p><a href="{{ point.url }}">{{ point.url }}</a></p>{% endif %}

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">{{ "%.1f"|format(point.prior_prob * 100) }}%</div>
                        <div class="stat-label">Prior Probability</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">{{ "%.2f"|format(point.likelihood_ratio) }}&times;</div>
                        <div class="stat-label">Likelihood Ratio</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">{{ "%.1f"|format(point.posterior * 100) }}%</div>
                        <div class="stat-label">Posterior Probability</div>
                    </div>
                </div>

                <div class="evidence-grid">
                    <div>
                        <h4>Confidence Assessment</h4>
                        <div class="confidence-score
                            {% if point.confidence_assessment.confidence_score > 0.7 %}confidence-high
                            {% elif point.confidence_assessment.confidence_score > 0.4 %}confidence-medium
                            {% else %}confidence-low{% endif %}">
                            {{ "%.0f"|format(point.confidence_assessment.confidence_score * 100) }}% Confidence
                        </div>
                        <p>{{ point.confidence_assessment.explanation }}</p>

                        {% if point.confidence_assessment.key_strengths %}
                        <h5>Key Strengths</h5>
                        <ul>
                            {% for strength in point.confidence_assessment.key_strengths %}
                            <li>{{ strength }}</li>
                            {% endfor %}
                        </ul>
                        {% endif %}

                        {% if point.confidence_assessment.key_limitations %}
                        <h5>Key Limitations</h5>
                        <ul>
                            {% for limitation in point.confidence_assessment.key_limitations %}
                            <li>{{ limitation }}</li>
                            {% endfor %}
                        </ul>
                        {% endif %}
                    </div>
                </div>

                <details>
                    <summary>Analysis Details</summary>
                    <div class="rationale">
                        {% if point.analysis_rationale %}
                        <pre><code>{{ point.analysis_rationale }}</code></pre>
                        {% else %}
                        <p>No detailed analysis rationale available.</p>
                        {% endif %}
                    </div>
                </details>
            </div>
            {% endfor %}
        </section>
    </main>

    <script>
        const ctx = document.getElementById('beliefChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Prior'].concat({{ evidence_points|map(attribute='file')|list|tojson }}),
                datasets: [{
                    label: 'Belief Probability',
                    data: [{{ prior_probability }}].concat({{ evidence_points|map(attribute='posterior')|list|tojson }}),
                    borderColor: '#2b6cb0',
                    backgroundColor: 'rgba(43, 108, 176, 0.1)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 1,
                        ticks: {
                            callback: function(value) {
                                return (value * 100) + '%';
                            }
                        }
                    },
                    x: {
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return (context.raw * 100).toFixed(1) + '%';
                            }
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>
"""

DEFAULT_CONFIDENCE_ASSESSMENT = {
    "confidence_score": 0,
    "explanation": "No confidence assessment available",
    "key_strengths": [],
    "key_limitations": [],
}


def to_probability(log_odds: float) -> float:
    return 1 / (1 + math.exp(-log_odds))


def build_evidence_points(evidence: list[dict]) -> list[dict]:
    points = []
    prior_log_odds = 0.0
    for item in evidence:
        if item.get("redundant") or item.get("l_plus") is None or item.get("l_minus") is None:
            likelihood_ratio = 1.0
            confidence_assessment = DEFAULT_CONFIDENCE_ASSESSMENT
        else:
            likelihood_ratio = math.exp(item["l_plus"] - item["l_minus"])
            confidence_assessment = (item.get("raw_data") or {}).get(
                "confidence_assessment", DEFAULT_CONFIDENCE_ASSESSMENT
            ) or DEFAULT_CONFIDENCE_ASSESSMENT
        points.append(
            {
                "file": item.get("file", "Unknown file"),
                "url": item.get("url", ""),
                "redundant": item.get("redundant", False),
                "confidence_assessment": confidence_assessment,
                "prior_prob": to_probability(prior_log_odds),
                "likelihood_ratio": likelihood_ratio,
                "posterior": item["probability"],
                "analysis_rationale": item.get("analysis_rationale") or "No analysis rationale available",
            }
        )
        prior_log_odds = item["current_posterior"]
    return points


DIMS = [("technology", "Technology"), ("application", "Application")]
DIM_HELP = {
    "technology": "Maturity of the technology anywhere (other reactors, industries, test facilities).",
    "application": "Maturity in the listed SMR designs; never above the technology TRL.",
}
STATUS_EFFECT = {
    "design": "caps the integration (and so the application TRL) at 6",
    "under_construction": "caps the integration (and so the application TRL) at 7",
    "operating": "sets a floor of 7 on the application TRL",
    None: "no constraint",
}
COLORS = {"technology": "#2b6cb0", "application": "#d69e2e"}


def render_v2_report(detail: dict) -> str:
    evidence = detail["evidence"]
    belief_sets = [
        {
            "label": f"{title} P(TRL {detail['claims'][dim]})",
            "data": [detail["results"][dim]["prior_probability"]] + [e["steps"][dim]["probability"] for e in evidence],
            "borderColor": COLORS[dim],
            "tension": 0.1,
        }
        for dim, title in DIMS
        if detail["results"][dim].get("probability") is not None
    ]
    return Template(V2_TEMPLATE).render(
        d=detail,
        dims=DIMS,
        dim_help=DIM_HELP,
        status_effect=STATUS_EFFECT,
        bands={dim: parse_band(detail["claims"][dim]) for dim, _ in DIMS},
        dists={dim: list(detail["results"][dim]["distribution"].values()) for dim, _ in DIMS},
        step_labels=[f"{i}. {e['file'][:30]}" for i, e in enumerate(evidence, 1)],
        belief_sets=belief_sets,
        pct=lambda p: f"{p * 100:.1f}%",
        lr=lambda step: math.exp(step["l_plus"] - step["l_minus"]),
    )


def render_report(detail: dict) -> str | None:
    evidence = detail.get("evidence", [])
    if not evidence:
        return None
    if detail.get("method") == "infact-v2":
        return render_v2_report(detail)

    evidence_points = build_evidence_points(evidence)
    last = evidence[-1]
    ci_low, ci_high = last["interval"]
    node_label = detail.get("node_label", "")
    trl_current = detail.get("trl_current", "")

    template = Template(TEMPLATE)
    return template.render(
        node_label=node_label,
        hypothesis=f"The current TRL level for {node_label} is {trl_current}.",
        prior_probability=to_probability(0.0),
        final_probability=last["probability"],
        ci_low=ci_low,
        ci_high=ci_high,
        evidence_points=evidence_points,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--details-dir", type=Path, default=DEFAULT_DETAILS_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.details_dir.exists():
        raise SystemExit(f"{args.details_dir} not found. Run analyze_all_nodes.py first.")

    json_files = sorted(args.details_dir.glob("*.json"))
    if not json_files:
        raise SystemExit(f"No json files found in {args.details_dir}")

    rendered, skipped = 0, 0
    for json_path in json_files:
        detail = json.loads(json_path.read_text())
        html = render_report(detail)
        if html is None:
            skipped += 1
            continue
        json_path.with_suffix(".html").write_text(html)
        rendered += 1

    print(f"rendered {rendered} report(s), skipped {skipped} node(s) with no evidence")


if __name__ == "__main__":
    main()
