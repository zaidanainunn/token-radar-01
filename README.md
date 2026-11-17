# Token Radar

[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/zaidanainunn/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/zaidanainunn/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01):
every protocol in a sealed DefiLlama snapshot that still records no token, ranked by an
implied launch value fitted from the snapshot's own live-token protocols.

## Run it

Node 22, standard library only, no install step, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That reads the sealed snapshot (`input/snapshot.json` in the kit), fits the radar-2 model,
writes the ranked board to `out/board.json`, the dashboard dataset to `out/data.js`, copies
`dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json` — the summary the
judge reads. The program exits non-zero if the board fails the gate (watchlist coverage,
ranks 1..n, implied value descending, 3–12 farm steps per row) or if fewer than three
screenshots are present. Two runs on the same input are byte-identical.

## What it does

- **Board:** all 40 watchlist protocols (the floor, never the ceiling) plus pre-token
  protocols below the $50M floor that pass the watchlist's own classification rule —
  178 rows in this snapshot. Live-token protocols are kept apart and shown with the
  market's own values, never mixed into the ranked board.
- **Model (radar-2):** implied = TVL × multiple(TVL) × growth × maturity. The multiple is
  fitted at run time by a log-log regression of market-cap-to-TVL against TVL over the
  94 launch-comparable live-token comps in the snapshot — not a constant anyone chose.
  Before the clamp it is implied = 8085 × TVL^0.4049 × growth × maturity.
- **Farm plans:** seven steps per protocol, derived from the protocol's own record
  (category, chains, TVL, age). Steps that depend on something the snapshot does not
  show are written as conditional scenarios, and costs are assumed budgets per step,
  never verified fees. Nothing promises eligibility, a points program or a reward, and
  this entry never executes transactions.

## Limitations — read before trusting the numbers

- **Implied values are PROXIES, not valuations.** A circulating market cap is not a
  protocol valuation and not an FDV. The typical error is a factor of ~3.1×
  (leave-one-category-out median |log error| 1.13; median standard APE 81%).
- **The error measures are two different numbers.** The factor error
  (exp(|log error|) − 1) × 100 is the symmetric multiplicative miss; the standard
  absolute percentage error |pred / actual − 1| × 100 is the familiar one. Predicting
  half the actual is a 100% factor error but a 50% standard APE.
- **Leave-one-category-out is not entity-disjoint validation.** The snapshot carries
  no parent or issuer linkage, so a held-out protocol's related products can still sit
  in the train set. Categories are DefiLlama's labels, not protocol families.
- **99 of 178 rows carry a sparse category support tag** (fewer than 4
  launch-comparable comps in their category). That is a count label, not a calibrated
  probability — and four or more comps is not high confidence either.
- **Risk Curators (33 rows) have exactly one launch-comparable comp (Api3).** The
  snapshot has no vault linkage, so curator/vault double-counting cannot be ruled out
  from the snapshot alone; implied values are never summed into a total.
- **`listed_at` is the day DefiLlama began tracking the protocol** — "time tracked by
  DefiLlama; proxy only". It is not necessarily the protocol's age or how long it has
  run with no token. Unknown age counts as 365 days — an imputation, not a fact.
- **A protocol that records no token may still have one.** DefiLlama's record is not
  proof; "pre-token" here means the record carries no token, nothing more.
- **One comp carries a version marker: Aave V2.** It is the only Aave product in the
  snapshot that records the AAVE token's market cap, while Aave V3 ($14.36B of TVL)
  records none — the parent token's market cap is attributed to one version's TVL.
  The sensitivity (fit with and without it) is reported in the dashboard methodology.

## Layout

- `main.ts` — entrypoint: reads the snapshot, scores, writes the board and dossier.
- `lib/model.ts` — the radar-2 model: fit, validation, classification, farm plans.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`), no framework.
- `screenshots/` — the three screenshots the judge sees (board, detail, filtered).
- `vendor/makefun-board.ts` — the make.fun dossier builder, vendored from the kit.

## License

MIT. See [LICENSE](LICENSE).
