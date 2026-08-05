# Pumex CL Analytics (TAC) — subgraph vs HyperIndex

| | |
|---|---|
| Subgraph | Goldsky `cl-analytics-tac/v1.0.1` |
| HyperIndex | `https://indexer.dev.hyperindex.xyz/ccf39cd/v1/graphql` |
| Chain | TAC (239) |
| Source pin | Algebra `@integral-v1.2.2` + `config/lynex-tac` |

## Run

```bash
# from repo root — .env already points here
pnpm introspect                 # refresh hyperindex-schema.graphql from live API
pnpm compare                    # sample 50 per entity
pnpm compare --sample 200
pnpm compare --deep --entity Pool
pnpm compare --deep --entity Swap   # capped ~100k; prefer sample for Swap
```

Regenerate HyperIndex schema after redeploys; do **not** copy the authoring `schema.graphql`.

## Overrides

| Key | Why |
|---|---|
| `idMatchConfirmed: ["Swap"]` | Name heuristic would otherwise skip Swap in `--deep` |
| `skipFields.Token.whitelistPools` | Array field; tool reports null vs empty |
| `skipFields.Transaction.[mints,burns,swaps,collects,flashes]` | Array fields not compared |

## Result (2026-08-03, tip ~23.64M, heads aligned)

**Structural / event entities mostly OK; live accumulators diverge because of a contiguous historical Swap gap.**

### ID-set highlights

| Entity | SG | EN | Notes |
|---|---:|---:|---|
| Pool / Token / Position / Tick / Mint / Plugin | match | match | OK |
| PositionSnapshot | 3908 | 3908 | OK |
| Burn | 6470 | 6471 | +1 only on Envio (`0xe38456…#1`) |
| Swap | 225075 | 222149 | **−2926 on Envio** |
| AlgebraDayData | 348 | 347 | missing day `20633` |
| Factory.txCount | 248471 | 245546 | **−2925** (= swap gap − extra burn) |

### Root cause of accumulator drift

All **2926** missing Swaps (and 0 Transactions) fall in one window:

- timestamps `1782716921` … `1782821181`
- UTC **2026-06-29 07:08 → 2026-06-30 12:06**
- blocks ~**21709896 … 21776530**
- Envio has **0** Swaps/Transactions in that window; Goldsky has all 2926
- No Mint/Burn activity in that window on either side (so Mint counts still match)

Concentrated on a handful of pools (top: `0xdd571223…` 1391, `0xde91fab4…` 517, `0x6968c134…` 417, `0x00476d2c…` 413).

This looks like a **Hypersync / indexing hole**, not handler math. Re-syncing or backfilling that block range should close Factory/Token/Pool volume & TVL drift.

### Known non-blocking noise

- BigDecimal ULP / sub-1% diffs on Mint/Burn/Swap USD fields and Bundle.maticPriceUSD
- Tool does not pin `block:` — always check heads first (this run was tip-aligned)
