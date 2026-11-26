# InFact v2: re-judging the deep-research TRL claims

`analyze_all_nodes.py` checks the two TRL claims deep research made for each
technology against the sources deep research itself cited:

- **technology TRL** (`deployment.trl_family`): maturity of the technology
  anywhere — other reactors, industries, test facilities. **Primary result.**
- **application TRL** (`deployment.trl_band`): maturity in the listed SMR
  designs. Never above the technology TRL.

If a technology has no `trl_family`, the technology TRL is still estimated
(flag `no_claim`) and the application claim becomes the primary result.

It talks to a local Ollama model directly; the old InFact `/analyze` service
(port 8007) is no longer used.

```
uv run scripts/infact/analyze_all_nodes.py --node "Shore refuelling" --node "High-speed electric motor"
uv run scripts/infact/analyze_all_nodes.py            # all technologies, resumes from the CSV
uv run scripts/infact/render_reports.py               # HTML next to each JSON
uv run --with pytest pytest scripts/infact -q         # scoring / evidence unit tests
```

Options: `--model` (default `qwen3.8:27b`, env `INFACT_MODEL`), `--ollama-url`
(default `http://localhost:11434`, env `OLLAMA_URL`; ds3's Ollama is forwarded
there by the `ds3` ssh config), `--think` (let the model reason first; slower),
`--output-dir` (default `outputs/infact-v2`), `--refresh`, `--limit`, `--db`.

Test set used during development: Shore refuelling, High-speed electric motor,
Metallic thorium fuel (implausible technology claim TRL 9), Reserve shutdown
system (one design already in operation).

## Pipeline

1. **Sources** (`evidence.py`): every URL in the deployment block — evidence,
   learnings, milestones, suppliers, per-reactor TRL links and the source list —
   grouped by URL with all deep-research notes (claim / fact / quote) citing it.
2. **Download + text**: HTML via the stdlib parser, PDF via `pypdf`; cached in
   `<output-dir>/docs/<slug>/`. Failed downloads are retried on the next run.
   Each deep-research quote is checked against the text (`exact` /
   `approximate` / `missing`). Long documents are cut to a ~12k-char excerpt
   around the quotes, the technology name and maturity terms.
3. **Per-source judgement** (LLM, JSON schema output), separately for
   technology and application: `constrains`, `at_least` (highest TRL the source
   shows was already achieved), `at_most` (below 9 only for an explicit stated
   limit), `strength`; plus `source_type`, maturity facts with quotes,
   limitations, rationale. The model is **not shown the claimed TRLs**, is told
   that missing mentions are not evidence, and must **ignore the build /
   licensing status of the reactors**. Judgements are cached per model +
   prompt version + think flag.
4. **Design status** (reactor dataset, `nodes.smr.status`): the most advanced
   status of the designs using the technology enters **once** — so "not built
   yet" repeated in many sources is not counted repeatedly. On paper /
   licensing caps the integration at 6, under construction at 7; a design in
   operation sets a floor of 7 on the application TRL. Half weight if some
   designs have no status.
5. **Scoring** (`trl_scoring.py`, deterministic): grid over technology TRL T
   and integration progress D (independent, uniform); application TRL
   A = min(T, D). So A <= T, and the design status (which limits D) never
   lowers T. Each constraining judgement multiplies the belief by
   `exp(-min(w * distance_to_range, 3))` on T or A, with
   `w = strength x source type x (0.6 if only quotes, no text)`, halved for
   every repeat of the same domain. Non-constraining judgements are neutral;
   results do not depend on source order. Per claim: distribution, P(claim),
   median TRL, 80% range and a 90% interval from re-sampling the weights
   (Gamma(2, 0.5)).
6. **Flags** per claim: `insufficient_evidence` (< 2 constraining items, interval
   wider than 0.6, or 80% range spanning >= 5 levels), `claim_disputed`
   (P(claim) < 0.2 and below its prior), `no_claim`.
7. **Follow-up search** (`followup.py`, Tavily; skip with `--no-followup`): for
   every claim flagged `insufficient_evidence` or `claim_disputed`, one round of
   at most 3 queries — 2 neutral templates (achieved maturity / stated
   limitations, with "nuclear reactor" context for ambiguous names) and 1
   model-proposed query from the gaps and limitations found so far. Queries
   containing "TRL", "readiness level" or a TRL range are rejected. Hits that
   deep research already used, syndicated copies (same title) and pages that do
   not name the technology are skipped; the rest (max 12 per node) are judged
   exactly like the original sources (`origin: infact_followup`), then the node
   is re-scored. The JSON keeps the queries and the results before follow-up.
   Tavily `/extract` also recovers the text of deep-research sources whose
   direct download failed (bot blocking, JavaScript pages).
   Key: `$TAVILY_API_KEY`, else `TAVILY_API_KEY` from `$INFACT_TAVILY_ENV`
   (default `~/Documents/smr-info-extraction/.env_local`). Responses are cached
   in `<output-dir>/tavily-cache/`; the run prints the number of new API calls.

## Output

`<output-dir>/node-infact-results.csv` (one column group per claim) and
`<output-dir>/node-infact-details/<slug>.json` with `method: "infact-v2"`,
`primary`, `claims`, `results.{technology,application}`, and `evidence`:
the design-status item first, then one entry per source (judgement, notes with
quote check, `weights` and cumulative `steps` per claim). Each entry also has
flat `probability` / `interval` / `l_plus` / `l_minus` fields for the primary
claim, and the top-level `trl_current` is the primary claim, so the files can be
copied to `data/extracted/<db>/infact-smr-analysis/nodes/node-infact-details/`
and ingested by `npm run seed <db>` / `npm run seed:infact` unchanged.
