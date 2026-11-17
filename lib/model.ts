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
//   maturity       = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age_days unknown: 365 — an
//                    imputation, not a fact: listed_at is the day DefiLlama began tracking the
//                    protocol, "time tracked by DefiLlama; proxy only". It is not necessarily the
//                    protocol's age, and not necessarily how long it has run with no token.)
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
// age — an imputation, not a fact (see the maturity line above). The comps span $5.0M–$10.2B of TVL and the board's candidates $5.0M–$2.75B, so the fit
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
  /** True when this row's category has fewer than 4 launch-comparable comps: sparse category
   * support, so its implied value carries wider uncertainty (see the dashboard). This is a
   * count label, not a calibrated probability of being right. */
  sparse_support: boolean;
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
  /** True when this row's category has fewer than 4 launch-comparable comps (sparse category support). */
  sparse_support: boolean;
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

/** One category's held-out results: the group size, and this model against radar-1 on that category alone. */
export interface PerCategoryResult {
  category: string;
  /** How many held-out predictions this category contributes. */
  n: number;
  median_log_error: number;
  /** Median symmetric multiplicative (factor) error, in per cent: |exp(|log error|) − 1| × 100. NOT a standard APE. */
  median_factor_error_pct: number;
  /** Mean factor error, in per cent. */
  mean_factor_error_pct: number;
  /** Median standard absolute percentage error, in per cent: |pred / actual − 1| × 100. */
  median_std_ape_pct: number;
  /** Mean standard absolute percentage error, in per cent. */
  mean_std_ape_pct: number;
  radar1_median_log_error: number;
  radar1_median_factor_error_pct: number;
  radar1_mean_factor_error_pct: number;
  radar1_median_std_ape_pct: number;
  radar1_mean_std_ape_pct: number;
}

/** One out-of-sample check, stated with the number the run itself measured. */
export interface ValidationCheck {
  /** What was held out: one protocol at a time, or one whole category at a time. */
  held_out: string;
  /** How many predictions the median is over. */
  n: number;
  /** This model's median |log(pred / actual market cap)|, pooled over all held-out predictions. */
  median_log_error: number;
  /** The typical multiplicative factor, pooled: the median of exp(|log error|) over the held-out
   * predictions, computed directly — NOT exp(median |log error|), which differs for even samples
   * because the median of a transformed list is not the transform of the median. A factor of 3.1
   * means the typical prediction is about 3.1 times too big or too small. */
  median_factor: number;
  /** The same, as a median factor error in per cent (pooled): the median, over the held-out
   * predictions, of (exp(|log error|) − 1) × 100. That equals (median_factor − 1) × 100
   * before rounding: (f − 1) × 100 is increasing affine in f, so it commutes with the
   * sample median (including even samples). What does NOT commute is exp(median |log error|)
   * against the median of exp(|log error|) — see median_factor above. */
  median_factor_error_pct: number;
  /** The mean factor error (pooled): the average miss, not just the middle one. */
  mean_factor_error_pct: number;
  /** Median standard absolute percentage error (pooled): |pred / actual − 1| × 100. */
  median_std_ape_pct: number;
  /** Mean standard absolute percentage error (pooled). */
  mean_std_ape_pct: number;
  /** radar-1 (flat 0.25) on the same held-out predictions, for comparison. */
  radar1_median_log_error: number;
  radar1_median_factor: number;
  radar1_median_factor_error_pct: number;
  radar1_mean_factor_error_pct: number;
  radar1_median_std_ape_pct: number;
  radar1_mean_std_ape_pct: number;
  /** Macro-average: the mean of the per-category medians, so a big category cannot hide a small one. */
  macro_median_log_error: number;
  /** Macro-average of the per-category mean factor errors. */
  macro_mean_factor_error_pct: number;
  /** Macro-average of the per-category median standard APEs. */
  macro_median_std_ape_pct: number;
  /** Macro-average of the per-category mean standard APEs. */
  macro_mean_std_ape_pct: number;
  /** This model against radar-1, category by category. */
  per_category: PerCategoryResult[];
}

/** One ablation variant: the same held-out predictions, scored with fewer of the model's parts. */
export interface AblationVariant {
  /** flat-0.25 (radar-1) | size-only | size+growth | full (radar-2). */
  variant: string;
  loo_median_log_error: number;
  loo_median_factor_error_pct: number;
  loo_mean_factor_error_pct: number;
  loo_median_std_ape_pct: number;
  loo_mean_std_ape_pct: number;
  loco_median_log_error: number;
  loco_median_factor_error_pct: number;
  loco_mean_factor_error_pct: number;
  loco_median_std_ape_pct: number;
  loco_mean_std_ape_pct: number;
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
  /** Launch-comparable comps per category, most first: the basis for sparse-support labels. */
  comps_by_category: { category: string; n: number }[];
  leave_one_out: ValidationCheck;
  leave_one_category_out: ValidationCheck;
  /** Baseline flat 0.25 / size-only / size+growth / full, each on the same held-out predictions. */
  ablation: AblationVariant[];
  /** The versioned-comp sensitivity: the fit and its leave-one-out check with and without the
   * comps whose names carry a version marker (see versionedSensitivity). */
  versioned_comp_sensitivity: VersionedCompSensitivity;
  /** The versioned-comp ranking check: the board's rows rescored with the without-versioned
   * fit, on the same candidate set (see rankingStability). Descriptive fit stability, not a
   * ranking-stability proof on its own — the numbers are the check itself. */
  versioned_ranking_stability: RankingStability;
}

/** The fit and its leave-one-out check, with and without the versioned-name comps. */
export interface VersionedCompSensitivity {
  /** How many comps carry a version marker in their name. */
  n_versioned_comps: number;
  /** Their slugs, in slug order. */
  versioned_slugs: string[];
  /** The fit on all comps, and its leave-one-out check (full model only). */
  with_versioned: { intercept: number; slope: number; n_comps: number; loo_median_log_error: number; loo_median_factor_error_pct: number; loo_median_std_ape_pct: number };
  /** The same, with the versioned-name comps removed from the pool before fitting. */
  without_versioned: { intercept: number; slope: number; n_comps: number; loo_median_log_error: number; loo_median_factor_error_pct: number; loo_median_std_ape_pct: number };
}

/** The versioned-comp ranking check: the board's rows rescored with the without-versioned
 * fit, on the SAME candidate set. The two fits are compared on the same rows, so the moves
 * below are ranking moves, not sample changes. Descriptive fit stability, not a
 * ranking-stability proof on its own — the numbers are the check itself. */
export interface RankingStability {
  /** Most negative implied-value move, in per cent, across the board's rows. */
  implied_pct_shift_min: number;
  /** Least negative implied-value move, in per cent, across the board's rows. */
  implied_pct_shift_max: number;
  /** Median implied-value move, in per cent. */
  implied_pct_shift_median: number;
  /** Rows whose rank changes when the without-versioned fit scores the same candidates. */
  rank_changes: number;
  /** Largest rank move, in places. */
  max_rank_move: number;
  /** Rows in the top 10 under both fits. */
  top10_overlap: number;
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
 * from TRAIN only: the held-out protocol or category never enters the fit, the fallback or any
 * outlier rule. That is refit-per-fold, not entity-disjoint validation: in leave-one-out, a
 * held-out protocol's related products (same issuer, another version, another category) can
 * still sit in the train set, and in the category split an entity that spans categories can
 * still leak across them. The snapshot carries no parent/issuer linkage, so no check here can
 * prove the folds are entity-disjoint — the limitation is labelled in the dashboard, not
 * hidden. The growth and maturity multipliers are fixed formulas, not fitted, and the
 * validation scores the same final formula the board displays.
 *
 * leave-one-out: each comp in turn is predicted from a fit on all the other comps. That tests
 * whether the fitted multiple generalises to a protocol it never saw.
 *
 * leave-one-category-out: each category with at least four comps in turn is predicted from a
 * fit on every other category's comps. That tests whether the size relationship generalises
 * across protocol categories — not whether it predicts a future price or airdrop, which no
 * check on this one frozen snapshot can test, and not across protocol issuers, which the
 * snapshot cannot group: a category is DefiLlama's label, not an issuer.
 *
 * Two error measures are reported side by side, because they answer different questions.
 * The log error |log(pred / actual)| is the fit's own scale: the median of it is the headline,
 * and the typical multiplicative factor is the median of exp(|log error|), computed directly
 * from the per-prediction factors (not exp of the median log error — the two differ on
 * even-sized samples). The factor error (exp(|log error|) − 1) × 100 is the symmetric
 * multiplicative miss in per cent: predicting half the actual is a 100% factor error. The
 * standard absolute percentage error |pred / actual − 1| × 100 is NOT the same number:
 * predicting half the actual is a 50% standard APE. The old "APE" label on the factor error
 * was a mislabel and is gone; both measures are now reported under their own names, for every
 * variant and every category, so the mean's story can be read on the right metric. A median
 * factor error near 220% says plainly what the implied values are: order-of-magnitude
 * proxies, not valuations.
 *
 * The ablation scores the same held-out predictions with fewer of the model's parts: the flat
 * 0.25 house model, the size fit alone, the size fit with growth, and the full model. Pooled
 * figures are over all held-out predictions; macro figures average the per-category figures, so
 * a big category cannot hide a small one. Repeated model selection on these same folds makes the
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

/** A symmetric multiplicative (factor) error, in per cent, from a |log(pred / actual)| error:
 * how many times too big or too small the prediction is, minus one, times 100. Predicting
 * half the actual is a 100% factor error. This is NOT a standard APE. */
const factorErrorPctOf = (e: number): number => Math.abs(Math.exp(e) - 1) * 100;

/** The standard absolute percentage error of one prediction, in per cent:
 * |pred / actual − 1| × 100. Predicting half the actual is a 50% standard APE — the same
 * prediction the factor error above scores at 100%. The two measures are not interchangeable. */
const stdApeOf = (pred: number, actual: number): number => Math.abs(pred / actual - 1) * 100;

/** One held-out prediction's two error measures, per variant. */
interface VariantErrors {
  /** |log(pred / actual)| per prediction. */
  log: number[];
  /** Standard APE |pred / actual − 1| × 100 per prediction. */
  stdApe: number[];
}

function emptyErrors(): Record<VariantKey, VariantErrors> {
  return { flat: { log: [], stdApe: [] }, sizeOnly: { log: [], stdApe: [] }, sizeGrowth: { log: [], stdApe: [] }, full: { log: [], stdApe: [] } };
}

/** One held-out check, pooled and per category, for the full model against radar-1. */
function summarizeCheck(
  heldOut: string,
  byVariant: Record<VariantKey, VariantErrors>,
  byCategory: Map<string, Record<VariantKey, VariantErrors>>,
): ValidationCheck {
  const full = byVariant.full;
  const flat = byVariant.flat;
  const perCategory: PerCategoryResult[] = [...byCategory.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([category, errs]) => ({
      category,
      n: errs.full.log.length,
      median_log_error: round4(median(errs.full.log)),
      median_factor_error_pct: Math.round(median(errs.full.log.map(factorErrorPctOf))),
      mean_factor_error_pct: Math.round(mean(errs.full.log.map(factorErrorPctOf))),
      median_std_ape_pct: round4(median(errs.full.stdApe)),
      mean_std_ape_pct: round4(mean(errs.full.stdApe)),
      radar1_median_log_error: round4(median(errs.flat.log)),
      radar1_median_factor_error_pct: Math.round(median(errs.flat.log.map(factorErrorPctOf))),
      radar1_mean_factor_error_pct: Math.round(mean(errs.flat.log.map(factorErrorPctOf))),
      radar1_median_std_ape_pct: round4(median(errs.flat.stdApe)),
      radar1_mean_std_ape_pct: round4(mean(errs.flat.stdApe)),
    }));
  return {
    held_out: heldOut,
    n: full.log.length,
    median_log_error: round4(median(full.log)),
    median_factor: round4(median(full.log.map((e) => Math.exp(e)))),
    median_factor_error_pct: Math.round(median(full.log.map(factorErrorPctOf))),
    mean_factor_error_pct: Math.round(mean(full.log.map(factorErrorPctOf))),
    median_std_ape_pct: round4(median(full.stdApe)),
    mean_std_ape_pct: round4(mean(full.stdApe)),
    radar1_median_log_error: round4(median(flat.log)),
    radar1_median_factor: round4(median(flat.log.map((e) => Math.exp(e)))),
    radar1_median_factor_error_pct: Math.round(median(flat.log.map(factorErrorPctOf))),
    radar1_mean_factor_error_pct: Math.round(mean(flat.log.map(factorErrorPctOf))),
    radar1_median_std_ape_pct: round4(median(flat.stdApe)),
    radar1_mean_std_ape_pct: round4(mean(flat.stdApe)),
    macro_median_log_error: round4(mean(perCategory.map((f) => f.median_log_error))),
    macro_mean_factor_error_pct: Math.round(mean(perCategory.map((f) => f.mean_factor_error_pct))),
    macro_median_std_ape_pct: round4(mean(perCategory.map((f) => f.median_std_ape_pct))),
    macro_mean_std_ape_pct: round4(mean(perCategory.map((f) => f.mean_std_ape_pct))),
    per_category: perCategory,
  };
}

function ablationRow(
  key: VariantKey,
  loo: Record<VariantKey, VariantErrors>,
  loco: Record<VariantKey, VariantErrors>,
): AblationVariant {
  return {
    variant: VARIANT_LABELS[key],
    loo_median_log_error: round4(median(loo[key].log)),
    loo_median_factor_error_pct: Math.round(median(loo[key].log.map(factorErrorPctOf))),
    loo_mean_factor_error_pct: Math.round(mean(loo[key].log.map(factorErrorPctOf))),
    loo_median_std_ape_pct: round4(median(loo[key].stdApe)),
    loo_mean_std_ape_pct: round4(mean(loo[key].stdApe)),
    loco_median_log_error: round4(median(loco[key].log)),
    loco_median_factor_error_pct: Math.round(median(loco[key].log.map(factorErrorPctOf))),
    loco_mean_factor_error_pct: Math.round(mean(loco[key].log.map(factorErrorPctOf))),
    loco_median_std_ape_pct: round4(median(loco[key].stdApe)),
    loco_mean_std_ape_pct: round4(mean(loco[key].stdApe)),
  };
}

/**
 * The versioned-comp sensitivity: the fit and its leave-one-out check (full model only) with
 * and without the comps whose names carry a version marker. compsOf excludes versioned
 * *candidates* from the board, but it does NOT exclude versioned *comps* from the fit — so a
 * versioned product's market cap can enter the multiple. The one versioned comp here is
 * Aave V2: the only Aave product in the snapshot that records the AAVE token's market cap
 * ($1.72B), while Aave V3 ($14.36B of TVL) records none — the parent token's market cap is
 * attributed to one version's TVL, a comparable mismatch the sensitivity makes visible.
 * The check does not delete Aave V2 for its name: it reports what changes without it.
 */
export function versionedSensitivity(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): VersionedCompSensitivity {
  const comps = compsOf(snapshot);
  const versioned = comps.filter((p) => VERSIONED.test(p.name));
  const looFull = (pool: SnapshotProtocol[]): { log: number[]; stdApe: number[] } => {
    const log: number[] = [];
    const stdApe: number[] = [];
    for (let i = 0; i < pool.length; i++) {
      const train = pool.slice(0, i).concat(pool.slice(i + 1));
      const fit = fitMultiple(train);
      const p = pool[i]!;
      const pred = impliedValue(p, snapshot.as_of, fit, model).implied;
      log.push(Math.abs(Math.log(pred / p.mcap_usd!)));
      stdApe.push(stdApeOf(pred, p.mcap_usd!));
    }
    return { log, stdApe };
  };
  const summarize = (pool: SnapshotProtocol[]): VersionedCompSensitivity['with_versioned'] => {
    const fit = fitMultiple(pool);
    const errs = looFull(pool);
    return {
      intercept: round4(fit.intercept),
      slope: round4(fit.slope),
      n_comps: pool.length,
      loo_median_log_error: round4(median(errs.log)),
      loo_median_factor_error_pct: Math.round(median(errs.log.map(factorErrorPctOf))),
      loo_median_std_ape_pct: round4(median(errs.stdApe)),
    };
  };
  const rest = comps.filter((p) => !VERSIONED.test(p.name));
  return {
    n_versioned_comps: versioned.length,
    versioned_slugs: versioned.map((p) => p.slug).sort(),
    with_versioned: summarize(comps),
    without_versioned: summarize(rest),
  };
}

/**
 * The versioned-comp ranking check: the board's rows rescored with the without-versioned
 * fit, on the SAME candidate set — so the moves below are ranking moves, not sample
 * changes. Slope alone (−0.5951 vs −0.6130) and the two LOO medians (1.1710 on 94 comps vs
 * 1.1556 on 93) do not prove ranking stability, because they are measured on different
 * samples; this check scores the same 178 rows twice and reports what actually moves.
 */
export function rankingStability(
  snapshot: Snapshot,
  board: BoardRow[],
  model: ModelConstants = MODEL,
): RankingStability {
  const comps = compsOf(snapshot);
  const fitWith = fitMultiple(comps);
  const fitWithout = fitMultiple(comps.filter((p) => !VERSIONED.test(p.name)));
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const scored = board.map((r) => {
    const p = bySlug.get(r.slug)!;
    const withV = impliedValue(p, snapshot.as_of, fitWith, model).implied;
    const withoutV = impliedValue(p, snapshot.as_of, fitWithout, model).implied;
    return { slug: r.slug, rankWith: r.rank, impliedWith: withV, impliedWithout: withoutV };
  });
  const shifts = scored.map((s) => (s.impliedWithout / s.impliedWith - 1) * 100);
  const rankedWithout = [...scored].sort((a, b) => b.impliedWithout - a.impliedWithout || (a.slug < b.slug ? -1 : 1));
  const rankWithout = new Map(rankedWithout.map((s, i) => [s.slug, i + 1]));
  let rankChanges = 0;
  let maxMove = 0;
  let top10Overlap = 0;
  for (const s of scored) {
    const rw = rankWithout.get(s.slug)!;
    if (rw !== s.rankWith) rankChanges++;
    maxMove = Math.max(maxMove, Math.abs(rw - s.rankWith));
    if (s.rankWith <= 10 && rw <= 10) top10Overlap++;
  }
  return {
    implied_pct_shift_min: round4(Math.min(...shifts)),
    implied_pct_shift_max: round4(Math.max(...shifts)),
    implied_pct_shift_median: round4(median(shifts)),
    rank_changes: rankChanges,
    max_rank_move: maxMove,
    top10_overlap: top10Overlap,
  };
}

export function validateFit(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { leave_one_out: ValidationCheck; leave_one_category_out: ValidationCheck; ablation: AblationVariant[] } {
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
  const loco = emptyErrors();
  const looByCategory = new Map<string, Record<VariantKey, VariantErrors>>();
  const locoByCategory = new Map<string, Record<VariantKey, VariantErrors>>();
  const record = (
    acc: Record<VariantKey, VariantErrors>,
    byCategory: Map<string, Record<VariantKey, VariantErrors>>,
    category: string,
    vs: Record<VariantKey, number>,
    actual: number,
  ): void => {
    for (const k of VARIANTS) {
      const e = logErr(vs[k], actual);
      acc[k].log.push(e);
      acc[k].stdApe.push(stdApeOf(vs[k], actual));
      const cat = byCategory.get(category) ?? emptyErrors();
      cat[k].log.push(e);
      cat[k].stdApe.push(stdApeOf(vs[k], actual));
      byCategory.set(category, cat);
    }
  };

  for (let i = 0; i < comps.length; i++) {
    const pool = comps.slice(0, i).concat(comps.slice(i + 1));
    const fit = fitMultiple(pool);
    const p = comps[i]!;
    record(loo, looByCategory, p.category!, variantsOf(p, fit), p.mcap_usd!);
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
      record(loco, locoByCategory, category, variantsOf(p, fit), p.mcap_usd!);
    }
  }

  return {
    leave_one_out: summarizeCheck('one live-token protocol at a time', loo, looByCategory),
    leave_one_category_out: summarizeCheck('one whole category at a time', loco, locoByCategory),
    ablation: VARIANTS.map((k) => ablationRow(k, loo, loco)),
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
  // category-level validation, so its implied value is labelled sparse category support (see the dashboard).
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
    sparse_support: (compCounts.get(s.p.category ?? '') ?? 0) < 4,
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
 * names. Every step that depends on something the snapshot does not show is written as a
 * CONDITIONAL scenario, not a claim: the action step first asks the reader to verify the
 * protocol's official interface supports it (asset, network, minimum — all unverified from the
 * snapshot); the weekly step applies only if the protocol runs a rewards program (the snapshot
 * does not say it does); the hold is a scenario, not a proven qualifying duration. Costs are
 * ASSUMED BUDGETS per step, never verified fees: TVL does not prove a minimum capital, age
 * does not prove a qualifying duration, and claiming may cost network gas. A disclaimer in the
 * last step does not cancel claims made in earlier steps, so the earlier steps are conditional
 * themselves. Nothing here promises eligibility, a points program or a reward, and this entry
 * never executes transactions — every step is a scenario to check, not an instruction to transact.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, tvlUsd: number): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  const actionLower = action.charAt(0).toLowerCase() + action.slice(1);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'assumed budget under $3 of gas for the first transaction (not a verified fee)',
      time: '5 minutes',
    },
    {
      text: `First verify on ${p.name}'s official interface that it supports this action on ${chain} — the snapshot does not confirm the interface, the asset, the network or any minimum. If it does, ${actionLower}`,
      cost: `$${capital} of capital (assumed budget) and about $${gas} of gas (assumed, not verified)`,
      time: '15 minutes to set up',
    },
    {
      text: `If the protocol runs a rewards or points program — check its official pages first, because the snapshot does not say it does — consider one small action a week, such as a deposit, a borrow, a swap or a vote. There is no snapshot evidence that weekly actions change eligibility.`,
      cost: 'assumed budget about $2 of gas a week (not a verified fee)',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days as a long-hold scenario. The snapshot does not prove a longer hold changes eligibility, and age is not proof of a qualifying duration — treat this as an untested assumption.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, check whether the protocol publishes a points or rewards page, and claim only from a link it publishes. Claiming itself may cost network gas; the snapshot carries no fee figures.`,
      cost: 'no fee to check; claiming may cost gas (amount unverified)',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Assumptions: $${capital} of capital (assumed budget — TVL does not prove a minimum), about $${gas} of gas to enter (assumed, not verified), a ${hold}-day hold (scenario — age does not prove a qualifying duration), on a protocol with $${Math.round(tvlUsd / 1_000_000)}M of TVL. Nothing here promises eligibility, a points program or a reward. This entry never executes transactions; every step is a scenario to check, not an instruction to transact.`,
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
    sparse_support: row.sparse_support,
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
      leave_one_category_out: validation.leave_one_category_out,
      ablation: validation.ablation,
      versioned_comp_sensitivity: versionedSensitivity(snapshot, model),
      versioned_ranking_stability: rankingStability(snapshot, board, model),
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
