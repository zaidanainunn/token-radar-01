// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor that pass the watchlist's own classification rule:
// not a wrapped, staked or bridged product of a token that already trades, not an exchange, not a
// versioned pool. A protocol is pre-token when its index entry records no token (no market cap, no
// CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown as the
// market's own values, never mixed into the ranked board. Say a protocol records no token, never
// that it has none: DefiLlama's record is not proof, and a protocol on the list may still have a
// token its record does not carry.
//
// Implied value follows only from the snapshot's own figures. The base multiple is NOT a constant
// asserted by hand: it is fitted from the snapshot's own live-token protocols at run time, by a
// log-log regression of market-cap-to-TVL against TVL over the launch-comparable comps (see
// fitMultiple below). The multiple is a PROXY: a circulating market cap is not a protocol
// valuation and not an FDV, and an implied value is this entry's own claim about what a launch
// would be worth if the protocol's record stayed as it is. It does not predict whether or when a
// token is issued, or what it would trade at afterwards.
//
//   multiple(tvl) = clamp(exp(intercept + slope * ln(tvl)), 0.01, 3.0)   (fitted, see below)
//   growth         = clamp(change_7d, -60, 120) per cent
//   growthMult     = 1 + (growth / 100) * 0.5
//   maturity       = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age_days unknown: 365)
//   implied        = max(1, round(tvl_usd * multiple(tvl) * growthMult * maturity))
//
// The same formula in power-law form, before the clamp: implied = exp(intercept) x
// TVL^(1 + slope) x growthMult x maturityMult. With the fitted intercept 8.9978 and slope
// -0.5951 (rounded to four decimals from the run's own fit) that is
// implied = 8085 x TVL^0.4049 x growth x maturity. The constant is exp(8.9978) = 8085, not
// 8090: the coefficients come from the least-squares fit on this snapshot, not from a rule
// asserted by hand, and the dashboard states them with that rounding. The clamp binds nowhere
// on this board: it would cap the multiple at 3.0 below $581K of TVL (under the snapshot's
// $5M floor) and floor it at 0.01 above $8.45B (above the board's $2.75B maximum).
//
// What the fit is, exactly. The OLS target is log(mcap_usd / tvl_usd) regressed on log(tvl_usd),
// both in whole US dollars, over the 94 launch-comparable live-token comps (see compsOf).
// Zero and missing values never enter the fit: a comp needs mcap_usd > 0, tvl_usd > 0 and a
// non-null category; change_7d null counts as 0% growth; listed_at null counts as 365 days of
// age. The comps span $5.0M–$10.2B of TVL and the board's candidates $5.0M–$2.75B, so the fit
// interpolates across the candidates' range rather than extrapolating past it. Regressing
// log(mcap / TVL) on log(TVL) is the same line as regressing log(mcap) on log(TVL) with the
// slope shifted by -1: the slope is a description of how the ratio varies with size, not causal
// evidence of a size discount. exp(predicted log) is a geometric-center estimate under log-error
// assumptions, not an expected mean dollar value — no smearing correction is applied, and none
// is claimed.
//
// Why a size-adjusted multiple: across the snapshot's live-token protocols, log(market cap / TVL)
// falls with log(TVL) (correlation -0.45 on 94 comps) — big protocols trade at far lower multiples
// of TVL than small ones, so one flat multiple misprices both ends. Per-category multiples were
// fitted and tested too, and REJECTED: leave-one-out on the same comps gives them a median
// |log error| of 1.60 against 1.51 for the flat 0.25, because within a category the ratios still
// span orders of magnitude. The size fit is the one that survives its own check (see validateFit).
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: the growth and maturity weights, and the multiple's clamp. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.01,
  multiple_cap: 3.0,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * Categories whose tokens are not launch-comparable comps and whose protocols are not launches:
 * the watchlist's own rule (input/README.md). A bridge's TVL is value in transit, a liquid-staking
 * token is a receipt for a token that already trades, an exchange token is an exchange's token.
 */
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol name must not begin with (the watchlist's rule). */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking anywhere in a name, in any case. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  /** True when this row's category has fewer than 4 launch-comparable comps: no family-level
   * validation exists for it, so its implied value carries wider uncertainty (see the dashboard). */
  low_confidence: boolean;
  model: {
    multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  /** True when this row's category has fewer than 4 launch-comparable comps. */
  low_confidence: boolean;
  /** Launch-comparable comps in this row's category (0 when the category has none). */
  category_comps: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One family's held-out results: the group size, and this model against radar-1 on that family alone. */
export interface PerFamilyResult {
  family: string;
  /** How many held-out predictions this family contributes. */
  n: number;
  median_log_error: number;
  median_ape_pct: number;
  mean_ape_pct: number;
  radar1_median_log_error: number;
  radar1_median_ape_pct: number;
  radar1_mean_ape_pct: number;
}

/** One out-of-sample check, stated with the number the run itself measured. */
export interface ValidationCheck {
  /** What was held out: one protocol at a time, or one whole family (category) at a time. */
  held_out: string;
  /** How many predictions the median is over. */
  n: number;
  /** This model's median |log(pred / actual market cap)|, pooled over all held-out predictions. */
  median_log_error: number;
  /** The same, as a median absolute percentage error (pooled). */
  median_ape_pct: number;
  /** The mean absolute percentage error (pooled): the average miss, not just the middle one. */
  mean_ape_pct: number;
  /** radar-1 (flat 0.25) on the same held-out predictions, for comparison. */
  radar1_median_log_error: number;
  radar1_median_ape_pct: number;
  radar1_mean_ape_pct: number;
  /** Macro-average: the mean of the per-family medians, so a big family cannot hide a small one. */
  macro_median_log_error: number;
  /** Macro-average of the per-family mean APEs. */
  macro_mean_ape_pct: number;
  /** This model against radar-1, family by family. */
  per_family: PerFamilyResult[];
}

/** One ablation variant: the same held-out predictions, scored with fewer of the model's parts. */
export interface AblationVariant {
  /** flat-0.25 (radar-1) | size-only | size+growth | full (radar-2). */
  variant: string;
  loo_median_log_error: number;
  loo_median_ape_pct: number;
  loo_mean_ape_pct: number;
  lofo_median_log_error: number;
  lofo_median_ape_pct: number;
  lofo_mean_ape_pct: number;
}

/** The fitted multiple and its own checks, as the run measured them. */
export interface ModelFit {
  /** log(mcap / TVL) = intercept + slope * log(TVL), fitted on the comps below. */
  intercept: number;
  slope: number;
  /** Launch-comparable live-token comps the fit ran on. */
  n_comps: number;
  /** Median mcap / TVL over the same comps, for reference. */
  global_median_multiple: number;
  /** TVL range of the comps the fit ran on, in whole USD. */
  comps_tvl_min: number;
  comps_tvl_max: number;
  /** TVL range of the board's candidates, in whole USD: the fit must cover it, not extrapolate past it. */
  candidates_tvl_min: number;
  candidates_tvl_max: number;
  /** Launch-comparable comps per category, most first: the basis for low-confidence labels. */
  comps_by_category: { category: string; n: number }[];
  leave_one_out: ValidationCheck;
  leave_one_family_out: ValidationCheck;
  /** Baseline flat 0.25 / size-only / size+growth / full, each on the same held-out predictions. */
  ablation: AblationVariant[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: ModelFit;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  /** Early candidates the strict classification rule kept out (wrapped / staked / bridged). */
  early_excluded: number;
  live_size: number;
  /** The board's own double-count smoke test: rows sharing an exact TVL value, and groups of rows
   * sharing a project's first name word (e.g. a curator and its vaults). The snapshot carries no
   * parent/vault linkage, so same-project rows cannot be proven distinct from the snapshot alone;
   * implied values are never summed into a total. */
  overlap: { exact_tvl_duplicates: number; same_stem_groups: number; same_stem_rows: number };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted copy: the middle value, or the mean of the two middle ones. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The mean of a list of numbers. */
function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// ---------------------------------------------------------------- the fit

/** A live-token protocol with a usable market cap and TVL, sorted by slug for determinism. */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== null && !EXCLUDED_CATEGORIES.has(p.category))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/**
 * Ordinary least squares on (log TVL, log(mcap / TVL)) over the comps: the size-adjusted multiple.
 * Falls back to a flat 0.25 when the pool cannot fit a line (fewer than two comps, or no TVL spread),
 * so the model always scores. The pool is slug-sorted, so the sums — and the fit — are identical
 * on every run.
 */
export function fitMultiple(pool: SnapshotProtocol[]): { intercept: number; slope: number } {
  if (pool.length < 2) return { intercept: Math.log(0.25), slope: 0 };
  const xs = pool.map((p) => Math.log(p.tvl_usd));
  const ys = pool.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const n = xs.length;
  const mx = xs.reduce((a, x) => a + x, 0) / n;
  const my = ys.reduce((a, y) => a + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  if (sxx === 0) return { intercept: Math.log(0.25), slope: 0 };
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/** The size-adjusted multiple for one TVL, clamped to the model's floor and cap. */
export function sizeMultiple(tvlUsd: number, fit: { intercept: number; slope: number }, model: ModelConstants = MODEL): number {
  const raw = Math.exp(fit.intercept + fit.slope * Math.log(Math.max(1, tvlUsd)));
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
}

/** The three multipliers and the implied value one protocol gets under `model` and `fit`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: { intercept: number; slope: number },
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const multiple = sizeMultiple(protocol.tvl_usd, fit, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, age };
}

/** radar-1's implied value, for the validation comparison: a flat 0.25 multiple, same growth and maturity. */
function impliedValueRadar1(protocol: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): number {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  return Math.max(1, Math.round(protocol.tvl_usd * 0.25 * growthMult * maturityMult));
}

/**
 * The fit's own checks, measured on the snapshot's live-token comps — the only protocols whose
 * market cap is known, so the only ones a multiple can be checked against. Every fold refits
 * from TRAIN only: the held-out protocol or family never enters the fit, the fallback or any
 * outlier rule, so there is no family leakage. The growth and maturity multipliers are fixed
 * formulas, not fitted, and the validation scores the same final formula the board displays.
 *
 * leave-one-out: each comp in turn is predicted from a fit on all the other comps. That tests
 * whether the fitted multiple generalises to a protocol it never saw.
 *
 * leave-one-family-out: each category with at least four comps in turn is predicted from a fit
 * on every other category's comps. That tests whether the size relationship generalises across
 * protocol families — not whether it predicts a future price or airdrop, which no check on this
 * one frozen snapshot can test. A median absolute percentage error near 200% says plainly what
 * the implied values are: order-of-magnitude proxies, not valuations.
 *
 * The ablation scores the same held-out predictions with fewer of the model's parts: the flat
 * 0.25 house model, the size fit alone, the size fit with growth, and the full model. Pooled
 * figures are over all held-out predictions; macro figures average the per-family figures, so
 * a big family cannot hide a small one. Repeated model selection on these same folds makes the
 * numbers optimistic — they are reported as-is, without temporal forecast claims.
 */
type VariantKey = 'flat' | 'sizeOnly' | 'sizeGrowth' | 'full';
const VARIANTS: VariantKey[] = ['flat', 'sizeOnly', 'sizeGrowth', 'full'];
const VARIANT_LABELS: Record<VariantKey, string> = {
  flat: 'flat-0.25 (radar-1)',
  sizeOnly: 'size-only',
  sizeGrowth: 'size+growth',
  full: 'full (radar-2)',
};

/** An absolute percentage error from a |log(pred / actual)| error: the ratio miss, in per cent. */
const apeOf = (e: number): number => Math.abs(Math.exp(e) - 1) * 100;

function emptyErrors(): Record<VariantKey, number[]> {
  return { flat: [], sizeOnly: [], sizeGrowth: [], full: [] };
}

/** One held-out check, pooled and per family, for the full model against radar-1. */
function summarizeCheck(
  heldOut: string,
  byVariant: Record<VariantKey, number[]>,
  byFamily: Map<string, Record<VariantKey, number[]>>,
): ValidationCheck {
  const full = byVariant.full;
  const flat = byVariant.flat;
  const perFamily: PerFamilyResult[] = [...byFamily.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([family, errs]) => ({
      family,
      n: errs.full.length,
      median_log_error: round4(median(errs.full)),
      median_ape_pct: Math.round(median(errs.full.map(apeOf))),
      mean_ape_pct: Math.round(mean(errs.full.map(apeOf))),
      radar1_median_log_error: round4(median(errs.flat)),
      radar1_median_ape_pct: Math.round(median(errs.flat.map(apeOf))),
      radar1_mean_ape_pct: Math.round(mean(errs.flat.map(apeOf))),
    }));
  return {
    held_out: heldOut,
    n: full.length,
    median_log_error: round4(median(full)),
    median_ape_pct: Math.round(median(full.map(apeOf))),
    mean_ape_pct: Math.round(mean(full.map(apeOf))),
    radar1_median_log_error: round4(median(flat)),
    radar1_median_ape_pct: Math.round(median(flat.map(apeOf))),
    radar1_mean_ape_pct: Math.round(mean(flat.map(apeOf))),
    macro_median_log_error: round4(mean(perFamily.map((f) => f.median_log_error))),
    macro_mean_ape_pct: Math.round(mean(perFamily.map((f) => f.mean_ape_pct))),
    per_family: perFamily,
  };
}

function ablationRow(
  key: VariantKey,
  loo: Record<VariantKey, number[]>,
  lofo: Record<VariantKey, number[]>,
): AblationVariant {
  return {
    variant: VARIANT_LABELS[key],
    loo_median_log_error: round4(median(loo[key])),
    loo_median_ape_pct: Math.round(median(loo[key].map(apeOf))),
    loo_mean_ape_pct: Math.round(mean(loo[key].map(apeOf))),
    lofo_median_log_error: round4(median(lofo[key])),
    lofo_median_ape_pct: Math.round(median(lofo[key].map(apeOf))),
    lofo_mean_ape_pct: Math.round(mean(lofo[key].map(apeOf))),
  };
}

export function validateFit(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { leave_one_out: ValidationCheck; leave_one_family_out: ValidationCheck; ablation: AblationVariant[] } {
  const comps = compsOf(snapshot);
  const logErr = (pred: number, actual: number): number => Math.abs(Math.log(pred / actual));

  /** The four variants' predictions for one held-out protocol, from one train-only fit. */
  const variantsOf = (p: SnapshotProtocol, fit: { intercept: number; slope: number }): Record<VariantKey, number> => {
    const { implied, multiple, growthMult } = impliedValue(p, snapshot.as_of, fit, model);
    return {
      flat: impliedValueRadar1(p, snapshot.as_of, model),
      sizeOnly: Math.max(1, Math.round(p.tvl_usd * multiple)),
      sizeGrowth: Math.max(1, Math.round(p.tvl_usd * multiple * growthMult)),
      full: implied,
    };
  };

  const loo = emptyErrors();
  const lofo = emptyErrors();
  const looByFamily = new Map<string, Record<VariantKey, number[]>>();
  const lofoByFamily = new Map<string, Record<VariantKey, number[]>>();
  const record = (
    acc: Record<VariantKey, number[]>,
    byFamily: Map<string, Record<VariantKey, number[]>>,
    family: string,
    vs: Record<VariantKey, number>,
    actual: number,
  ): void => {
    for (const k of VARIANTS) {
      const e = logErr(vs[k], actual);
      acc[k].push(e);
      const fam = byFamily.get(family) ?? emptyErrors();
      fam[k].push(e);
      byFamily.set(family, fam);
    }
  };

  for (let i = 0; i < comps.length; i++) {
    const pool = comps.slice(0, i).concat(comps.slice(i + 1));
    const fit = fitMultiple(pool);
    const p = comps[i]!;
    record(loo, looByFamily, p.category!, variantsOf(p, fit), p.mcap_usd!);
  }

  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of comps) {
    const list = byCategory.get(p.category!) ?? [];
    list.push(p);
    byCategory.set(p.category!, list);
  }
  for (const [category, members] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (members.length < 4) continue;
    const pool = comps.filter((p) => p.category !== category);
    const fit = fitMultiple(pool);
    for (const p of members) {
      record(lofo, lofoByFamily, category, variantsOf(p, fit), p.mcap_usd!);
    }
  }

  return {
    leave_one_out: summarizeCheck('one live-token protocol at a time', loo, looByFamily),
    leave_one_family_out: summarizeCheck('one whole category (family) at a time', lofo, lofoByFamily),
    ablation: VARIANTS.map((k) => ablationRow(k, loo, lofo)),
  };
}

// ---------------------------------------------------------------- classification

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the watchlist's own
 * classification rule — not an exchange, not a versioned pool, not a wrapped, staked or bridged
 * product of a token that already trades, not exchange-named. The snapshot carries no parent
 * protocol field, so the rule is applied from the ten fields it does carry, exactly as the
 * watchlist's definition states them. This is what keeps a staked-ETH receipt or a bridge off a
 * board of launches: ranking one as a launch would be a misidentification, not a find.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; earlyExcluded: number } {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that pass the classification rule,
  // by TVL, capped. The quota is a cap, never a target: candidates that fail the rule are left out
  // rather than ranked as launches they are not.
  const belowFloor = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd);
  const earlyExcluded = belowFloor.filter((p) => !isRankable(p)).length;
  const early = belowFloor
    .filter((p) => isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const fit = fitMultiple(compsOf(snapshot));
  // Launch-comparable comps per category: a row's category with fewer than 4 comps has no
  // family-level validation, so its implied value is labelled low-confidence (see the dashboard).
  const compCounts = new Map<string, number>();
  for (const p of compsOf(snapshot)) compCounts.set(p.category!, (compCounts.get(p.category!) ?? 0) + 1);
  const scored = [...chosen.values()].map((p) => {
    const { implied, multiple, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, fit, model);
    return { p, implied, multiple, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    low_confidence: (compCounts.get(s.p.category ?? '') ?? 0) < 4,
    model: {
      multiple: round4(s.multiple),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.p.tvl_usd).map(stepText),
  }));
  return { board, earlyExcluded };
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a vault managed by ${name} on ${chain} and keep the shares. The deposit goes to the vault, not to ${name} itself, and does not by itself earn eligibility for any token ${name} may issue.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. The last step states the plan's assumptions outright: the capital, gas and hold figures
 * are estimates from typical costs, not verified fees, and nothing here promises eligibility, a
 * points program or a reward — the snapshot carries no such facts, so the plan invents none.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, tvlUsd: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, check whether the protocol publishes a points or rewards page, and claim only from a link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Assumptions behind this plan: $${capital} of capital, about $${gas} of gas to enter, a ${hold}-day hold, on a protocol with $${Math.round(tvlUsd / 1_000_000)}M of TVL. These are estimates from typical costs, not verified fees, and nothing here promises eligibility, a points program or a reward.`,
      cost: 'no extra cost',
      time: 'read this before you start',
    },
  ];
}

// ---------------------------------------------------------------- live rows and the radar

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, onWatchlist: boolean, compCounts: Map<string, number>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: onWatchlist,
    low_confidence: row.low_confidence,
    category_comps: compCounts.get(row.category ?? '') ?? 0,
  };
}

/**
 * The board's own double-count smoke test. Counts rows sharing an exact TVL value, and groups of
 * rows sharing a project's first name word (a curator and its vaults, for instance). The snapshot
 * carries no parent/vault linkage, so same-project rows cannot be proven distinct from the
 * snapshot alone — the counts are reported, not resolved.
 */
export function overlapCheck(board: BoardRow[]): { exact_tvl_duplicates: number; same_stem_groups: number; same_stem_rows: number } {
  const tvlCount = new Map<number, number>();
  for (const r of board) tvlCount.set(r.tvl_usd, (tvlCount.get(r.tvl_usd) ?? 0) + 1);
  const stems = new Map<string, string[]>();
  for (const r of board) {
    const stem = r.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')[0]!;
    const list = stems.get(stem) ?? [];
    list.push(r.slug);
    stems.set(stem, list);
  }
  const groups = [...stems.values()].filter((s) => s.length > 1);
  return {
    exact_tvl_duplicates: [...tvlCount.values()].filter((n) => n > 1).length,
    same_stem_groups: groups.length,
    same_stem_rows: groups.reduce((n, g) => n + g.length, 0),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, earlyExcluded } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const comps = compsOf(snapshot);
  const fit = fitMultiple(comps);
  const validation = validateFit(snapshot, model);
  const compCounts = new Map<string, number>();
  for (const p of comps) compCounts.set(p.category!, (compCounts.get(p.category!) ?? 0) + 1);
  const compsByCategory = [...compCounts.entries()]
    .map(([category, n]) => ({ category, n }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit: {
      intercept: round4(fit.intercept),
      slope: round4(fit.slope),
      n_comps: comps.length,
      global_median_multiple: round4(median(comps.map((p) => p.mcap_usd! / p.tvl_usd))),
      comps_tvl_min: Math.min(...comps.map((p) => p.tvl_usd)),
      comps_tvl_max: Math.max(...comps.map((p) => p.tvl_usd)),
      candidates_tvl_min: Math.min(...board.map((r) => r.tvl_usd)),
      candidates_tvl_max: Math.max(...board.map((r) => r.tvl_usd)),
      comps_by_category: compsByCategory,
      leave_one_out: validation.leave_one_out,
      leave_one_family_out: validation.leave_one_family_out,
      ablation: validation.ablation,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    early_excluded: earlyExcluded,
    live_size: live.length,
    overlap: overlapCheck(board),
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug), compCounts)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
