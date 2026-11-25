"""Render HTML evidence reports for every node analyzed by analyze_all_nodes.py.

Reads each outputs/node-infact-details/<slug>.json file (written incrementally
by analyze_all_nodes.py) and renders outputs/node-infact-details/<slug>.html,
summarizing the per-evidence confidence assessments and belief evolution,
adapted from the original InFact prototype's visualization template.

Usage:
    uv run scripts/infact/render_reports.py [--details-dir outputs/node-infact-details]
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from jinja2 import Template

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DETAILS_DIR = REPO_ROOT / "outputs" / "node-infact-details"

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


def render_report(detail: dict) -> str | None:
    evidence = detail.get("evidence", [])
    if not evidence:
        return None

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
