"""Deterministic TRL scoring for InFact v2.

Two quantities are scored jointly:

* technology TRL (T): maturity of the technology anywhere (other reactors,
  industries, test facilities); re-judges deep research's `trl_family`.
* application TRL (A): maturity of the technology in the listed SMR designs;
  re-judges deep research's `trl_band`.

A = min(T, D), where D is how far the integration into these designs has got,
independent of T. So A can never exceed T, and the design status of the
reactors (which limits D) never lowers the technology TRL.

The LLM only classifies each source (does it constrain T and/or A, which range,
how strongly, what kind of source). The design status of the SMR designs comes
from the reactor dataset and enters once, as a single constraint on A, so the
same "not built yet" fact repeated across many sources is not counted again.

Rules:
* Prior: T and D independent and uniform on 1..9.
* A source constraining T or A with range [low, high] multiplies the belief
  by exp(-min(w * distance_to_range, CAP)) along that quantity.
  w = strength x source type x (0.6 if only quotes, no text), halved for every
  further source from the same domain. Sources that do not constrain a
  dimension are neutral for it; absence of evidence is not evidence.
* Design status: all designs still on paper / in licensing caps D at 6, under
  construction caps D at 7, any design in operation sets a floor of 7 on A
  (hence on T as well). Halved in weight when some designs are unknown.
* Intervals: every weight is multiplied by a Gamma(2, 0.5) draw (mean 1); the
  5th/95th percentiles of P(claimed band) are reported.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

import numpy as np

TRL_LEVELS = np.arange(1, 10)
MAX_LOG_PENALTY = 3.0
DOMAIN_REPEAT_FACTOR = 0.5
INTERVAL_DRAWS = 4000
INTERVAL_SEED = 0
DIMENSIONS = ("technology", "application")
AXES = ("technology", "application", "integration")

STRENGTH_WEIGHTS = {"strong": 1.0, "moderate": 0.6, "weak": 0.3}
SOURCE_TYPE_WEIGHTS = {
    "peer_reviewed_or_government": 1.0,
    "technical_report_or_conference": 0.9,
    "company_or_vendor": 0.6,
    "news_or_press": 0.5,
    "other": 0.5,
}
# Source text could not be downloaded; only deep-research quotes were judged.
QUOTES_ONLY_FACTOR = 0.6

# Structured reactor-dataset fact: counts a bit more than a single strong source.
STATUS_WEIGHT = 1.5
UNKNOWN_STATUS_FACTOR = 0.5
# category -> (axis, floor, cap); "integration" is D, "application" is A = min(T, D)
STATUS_BOUNDS = {
    "design": ("integration", None, 6),
    "under_construction": ("integration", None, 7),
    "operating": ("application", 7, None),
}
STATUS_RANK = {"design": 0, "under_construction": 1, "operating": 2}

MIN_RELEVANT_SOURCES = 2
MAX_INTERVAL_WIDTH = 0.6
# 80% credible range spanning this many levels or more: the TRL is not pinned down.
MAX_CREDIBLE_SPAN = 4
DISPUTED_BELOW = 0.2


@dataclass
class Constraint:
    relevant: bool
    trl_low: int = 1
    trl_high: int = 9
    strength: str = "weak"


@dataclass
class SourceJudgement:
    url: str
    technology: Constraint
    application: Constraint
    source_type: str
    text_available: bool
    weights: dict[str, float] = field(default_factory=dict)


@dataclass
class DesignStatus:
    """Most advanced status among the SMR designs using the technology."""

    category: str | None  # design | under_construction | operating | None (all unknown)
    unknown_designs: int = 0

    @property
    def weight(self) -> float:
        if self.category is None:
            return 0.0
        return STATUS_WEIGHT * (UNKNOWN_STATUS_FACTOR if self.unknown_designs else 1.0)


def parse_band(band: str | None) -> list[int]:
    """'3-4' -> [3, 4], '6' -> [6]; anything unparseable -> []."""
    numbers = [int(n) for n in re.findall(r"\d", band or "") if 1 <= int(n) <= 9]
    if not numbers:
        return []
    return list(range(min(numbers), max(numbers) + 1))


def status_category(status: str | None) -> str | None:
    s = (status or "").lower()
    if not s:
        return None
    if "operation" in s or "operational" in s:
        return "operating"
    if "construction" in s:
        return "under_construction"
    return "design"  # conceptual / basic / detailed design, NEA licensing x/6


def design_status(statuses: list[str | None]) -> DesignStatus:
    categories = [status_category(s) for s in statuses]
    known = [c for c in categories if c]
    best = max(known, key=STATUS_RANK.__getitem__) if known else None
    # an unknown design cannot weaken a floor from an operating one
    unknown = 0 if best == "operating" else len(categories) - len(known)
    return DesignStatus(best, unknown)


def domain_of(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def assign_weights(judgements: list[SourceJudgement]) -> None:
    """Set `weights[dim]` on every judgement in place (0 when it does not constrain dim)."""
    seen: dict[tuple[str, str], int] = {}
    for j in judgements:
        base = SOURCE_TYPE_WEIGHTS.get(j.source_type, SOURCE_TYPE_WEIGHTS["other"]) * (
            1.0 if j.text_available else QUOTES_ONLY_FACTOR
        )
        for dim in DIMENSIONS:
            c: Constraint = getattr(j, dim)
            if not c.relevant or (c.trl_low, c.trl_high) == (1, 9):
                j.weights[dim] = 0.0
                continue
            key = (dim, domain_of(j.url))
            j.weights[dim] = (
                base * STRENGTH_WEIGHTS.get(c.strength, STRENGTH_WEIGHTS["weak"])
                * DOMAIN_REPEAT_FACTOR ** seen.get(key, 0)
            )
            seen[key] = seen.get(key, 0) + 1


def _range_penalty(low: int, high: int) -> np.ndarray:
    low, high = sorted((low, high))
    return np.maximum(low - TRL_LEVELS, 0) + np.maximum(TRL_LEVELS - high, 0)


def _axis_loglik(distance: np.ndarray, weight: np.ndarray | float) -> np.ndarray:
    """Penalty along one axis; weight may be (draws,) -> (draws, 9)."""
    w = np.asarray(weight, dtype=float)
    return -np.minimum(w[..., None] * distance, MAX_LOG_PENALTY)


# A = min(T, D): index of the application level for every (t, d) cell
MIN_INDEX = np.minimum.outer(np.arange(9), np.arange(9))
APP_ONE_HOT = (MIN_INDEX[None, :, :] == np.arange(9)[:, None, None]).astype(float)


def _joint(tech_ll: np.ndarray, app_ll: np.ndarray, integ_ll: np.ndarray) -> np.ndarray:
    """Combine per-quantity log-likelihoods into the (T, D) grid: [..., t, d]."""
    return tech_ll[..., :, None] + app_ll[..., MIN_INDEX] + integ_ll[..., None, :]


def normalise(log_joint: np.ndarray) -> np.ndarray:
    flat = log_joint.reshape(*log_joint.shape[:-2], -1)
    shifted = np.exp(flat - flat.max(axis=-1, keepdims=True))
    return (shifted / shifted.sum(axis=-1, keepdims=True)).reshape(log_joint.shape)


def marginal(joint: np.ndarray, dim: str) -> np.ndarray:
    if dim == "technology":
        return joint.sum(axis=-1)
    return np.einsum("...td,ktd->...k", joint, APP_ONE_HOT)


def band_mask(dim: str, band: list[int]) -> np.ndarray:
    in_band = np.isin(TRL_LEVELS, band)
    return np.broadcast_to(in_band[:, None], (9, 9)) if dim == "technology" else in_band[MIN_INDEX]


def band_mass(dist: np.ndarray, band: list[int]) -> np.ndarray:
    return dist[..., np.isin(TRL_LEVELS, band)].sum(axis=-1)


def logit(p: float) -> float:
    p = min(max(p, 1e-12), 1 - 1e-12)
    return math.log(p / (1 - p))


def credible_range(dist: np.ndarray, mass: float = 0.8) -> tuple[int, int]:
    """Smallest contiguous TRL range holding at least `mass` of the distribution."""
    best = (1, 9)
    for lo in range(9):
        total = 0.0
        for hi in range(lo, 9):
            total += dist[hi]
            if total >= mass:
                if hi - lo < best[1] - best[0]:
                    best = (lo + 1, hi + 1)
                break
    return best


def median_trl(dist: np.ndarray) -> int:
    return int(TRL_LEVELS[int(np.searchsorted(np.cumsum(dist), 0.5))])


def _status_item(status: DesignStatus) -> dict[str, tuple[np.ndarray, float]]:
    """Design status as one item: {axis: (distance, weight)}."""
    item = {axis: (np.zeros(9), 0.0) for axis in AXES}
    if status.category is not None:
        axis, floor, cap = STATUS_BOUNDS[status.category]
        distance = np.maximum((floor or 1) - TRL_LEVELS, 0) + np.maximum(TRL_LEVELS - (cap or 9), 0)
        item[axis] = (distance, status.weight)
    return item


def _summary(dist: np.ndarray, draws: np.ndarray, band: list[int]) -> dict:
    out = {
        "distribution": {str(t): float(p) for t, p in zip(TRL_LEVELS, dist)},
        "trl_estimate": median_trl(dist),
        "trl_credible_range_80": list(credible_range(dist)),
    }
    if band:
        p_draws = band_mass(draws, band)
        out["probability"] = float(band_mass(dist, band))
        out["interval"] = [float(np.quantile(p_draws, 0.05)), float(np.quantile(p_draws, 0.95))]
    return out


def score(
    judgements: list[SourceJudgement],
    status: DesignStatus,
    bands: dict[str, list[int]],
) -> dict:
    """Score sources + design status. `bands` maps dimension -> claimed band ([] = no claim).

    Returns per-dimension results and one cumulative step per item; the design
    status is step 0, followed by one step per source.
    """
    assign_weights(judgements)
    rng = np.random.default_rng(INTERVAL_SEED)
    n_items = 1 + len(judgements)
    multipliers = rng.gamma(shape=2.0, scale=0.5, size=(INTERVAL_DRAWS, n_items, len(AXES)))

    log_joint = np.zeros((9, 9))
    log_joint_draws = np.zeros((INTERVAL_DRAWS, 9, 9))
    prior = normalise(log_joint)
    priors = {dim: float(band_mass(marginal(prior, dim), b)) for dim, b in bands.items() if b}

    # every item = per axis (distance to its range, weight); design status first
    items = [_status_item(status)]
    for j in judgements:
        item = {"integration": (np.zeros(9), 0.0)}
        for dim in DIMENSIONS:
            item[dim] = (_range_penalty(getattr(j, dim).trl_low, getattr(j, dim).trl_high), j.weights[dim])
        items.append(item)

    steps = []
    for i, item in enumerate(items):
        before = normalise(log_joint)
        ll = _joint(*(_axis_loglik(*item[axis]) for axis in AXES))
        log_joint = log_joint + ll
        log_joint_draws = log_joint_draws + _joint(
            *(_axis_loglik(item[axis][0], item[axis][1] * multipliers[:, i, k]) for k, axis in enumerate(AXES))
        )

        joint = normalise(log_joint)
        joint_draws = normalise(log_joint_draws)
        step = {}
        for dim in DIMENSIONS:
            band = bands.get(dim) or []
            if not band:
                continue
            mask = band_mask(dim, band)
            lik = np.exp(ll)
            l_plus = float(np.log((before * lik)[mask].sum() / before[mask].sum()))
            l_minus = float(np.log((before * lik)[~mask].sum() / before[~mask].sum()))
            p = float(band_mass(marginal(joint, dim), band))
            draws = band_mass(marginal(joint_draws, dim), band)
            step[dim] = {
                "l_plus": l_plus,
                "l_minus": l_minus,
                "probability": p,
                "current_posterior": logit(p),
                "interval": [float(np.quantile(draws, 0.05)), float(np.quantile(draws, 0.95))],
            }
        steps.append(step)

    joint = normalise(log_joint)
    joint_draws = normalise(log_joint_draws)
    results: dict[str, dict] = {}
    for dim in DIMENSIONS:
        band = bands.get(dim) or []
        res = _summary(marginal(joint, dim), marginal(joint_draws, dim), band)
        n_relevant = sum(1 for j in judgements if j.weights[dim] > 0)
        if dim == "application" and status.weight > 0:
            n_relevant += 1
        res["num_relevant"] = n_relevant
        res["effective_weight"] = float(
            sum(j.weights[dim] for j in judgements) + (status.weight if dim == "application" else 0.0)
        )
        res["prior_probability"] = priors.get(dim)
        low, high = res["trl_credible_range_80"]
        flags = []
        if (
            n_relevant < MIN_RELEVANT_SOURCES
            or high - low >= MAX_CREDIBLE_SPAN
            or ("interval" in res and res["interval"][1] - res["interval"][0] > MAX_INTERVAL_WIDTH)
        ):
            flags.append("insufficient_evidence")
        # disputed = low AND the evidence moved belief away from the claim
        if band and n_relevant and res["probability"] < min(DISPUTED_BELOW, res["prior_probability"]):
            flags.append("claim_disputed")
        if not band:
            flags.append("no_claim")
        res["flags"] = flags
        results[dim] = res
    return {"results": results, "steps": steps}
