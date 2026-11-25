# InFact API usage (analyze_all_nodes.py)

Simple notes on how `analyze_all_nodes.py` talks to the local InFact service.

## Endpoint

- Base URL: `http://127.0.0.1:8007`
- Health check: `GET /health` (called once at startup; script aborts if unreachable)
- Main call: `POST /analyze` (multipart/form-data), called once **per evidence file**, per node

Auth: optional `X-API-Key` header, value from the `INFACT_API_KEY` env var (omitted if unset).

## Hypothesis

One hypothesis string per node, reused for every evidence file for that node:

```
TRL definitions:
TRL 1: Basic principles observed (initial scientific research).
TRL 2: Technology concept formulated (practical applications invented, still speculative).
...
TRL 9: Actual system proven in operational environment (fully deployed and proven in real mission/commercial operations).

Given that the TRL definitions mean this, the current TRL level for <node label> is <trl_current>.
```

## Data sent on the first call for a node

Form fields:

| field | value |
|---|---|
| `hypothesis` | the string above |
| `prior_log_odds` | `"0.0"` |
| `current_posterior` | `"0.0"` (same as prior, nothing analyzed yet) |
| `existing_data_points` | `"[]"` (empty JSON list) |
| `file` | the first evidence file (PDF/HTML/txt downloaded from the node's reference URLs) |

## Data received back

JSON response:

| field | meaning |
|---|---|
| `redundant` | `true` if this file added no new information |
| `raw_data` | dict with `numerical_values`, `metadata`, `issues`, `confidence_assessment` |
| `l_plus` / `l_minus` | log-likelihoods for/against the hypothesis from this file |
| `posterior` | posterior log-odds after this file alone |
| `current_posterior` | running posterior log-odds (chained with prior) |
| `probability` | posterior converted to a probability |
| `interval` | `[low, high]` 95% confidence interval on that probability |
| `analysis_rationale` | code/explanation string showing how the LLM derived `l_plus`/`l_minus` |

## Data sent on subsequent calls (same node, next file)

For the next file, the request fields change:

- `current_posterior` → set to the previous response's `current_posterior` (so evidence chains/accumulates)
- `existing_data_points` → previous list **plus** one entry for the previous file, but **only if it was not redundant**:
  ```json
  {
    "raw_data": <previous raw_data>,
    "l_plus": <previous l_plus>,
    "l_minus": <previous l_minus>,
    "posterior": <previous posterior>
  }
  ```
- `prior_log_odds` and `hypothesis` stay the same for the whole node
- `file` → the next evidence file

This repeats once per file until all of the node's downloaded evidence files have been sent. The final `current_posterior`/`probability`/`interval` from the last file is the node's overall result.
