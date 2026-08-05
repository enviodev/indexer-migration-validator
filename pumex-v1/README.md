# Pumex v1 — subgraph vs HyperIndex

Validator config for the Pumex/Lynex v1 DEX migration.

| | |
|---|---|
| Subgraph | `lynex-v1` (Goldsky), factory `0xBc7695Fd00E3b32D08124b7a4287493aEE99f9ee` |
| HyperIndex | [enviodev/pumex-v1-indexer](https://github.com/enviodev/pumex-v1-indexer), deployment `2a01622` |
| Chain | Linea (59144) — **single chain**, see below |
| Entities | 16 matched (+ `PairLookup`, HyperIndex-only by design) |

## Run it

```bash
pnpm compare                  # all entities, 50 random samples each
pnpm compare --entity Pair    # one entity
pnpm compare --sample 200     # bigger sample
pnpm compare --deep --entity Token   # every record (see limits below)
```

`.env` at the repo root already points at this directory. Nothing else to set up.

## About the "one subgraph per chain" question

**It does not apply to this migration.** The v1 subgraph and this HyperIndex
indexer both cover exactly one chain, Linea 59144 — confirmed from the
deployment's own metadata:

```
chain_metadata: [{ chain_id: 59144, latest_processed_block: 31536364 }]
```

Entity IDs are therefore **not** chain-prefixed; they are byte-identical to the
subgraph's. So there is a single subgraph endpoint, a single HyperIndex endpoint,
and IDs line up 1:1.

If you later validate a genuinely multichain Envio indexer against per-chain
subgraph deployments, your instinct is right *only* when IDs are not
chain-prefixed — then extra chains' rows show up as "missing in subgraph" and you
read the per-chain slice out of the noise. If the indexer prefixes IDs with the
chain ID (the usual multichain practice), **no** IDs will match and every entity
reports a total mismatch. In that case you need either a per-chain HyperIndex
filter (this tool has no `where` support) or an ID-normalisation override.

## Why `hyperindex-schema.graphql` is generated, not copied

Do **not** copy the indexer's authoring `schema.graphql` here. Regenerate with:

```bash
pnpm introspect     # reads HYPERINDEX_URL, writes HYPERINDEX_SCHEMA
```

The matcher maps a subgraph relation (`token0: Token!`) onto the HyperIndex flat
foreign key `token0_id`, and it looks that name up in *this file*. An Envio
authoring schema declares `token0: Token!` and contains no `token0_id`, so every
relation silently ends up unmapped and **uncompared** — `Pair` had
`nestedFields: {}` before this was fixed. Introspection emits the real queryable
columns instead.

## Overrides

| Key | Why |
|---|---|
| `idMatchConfirmed: ["Swap"]` | `configGenerator.detectIdMismatch()` flags any entity whose name contains "Swap", and `--deep` **silently skips** flagged entities, reporting 0/0 — which reads as a pass. Swap is the largest entity here (~1.27M rows) and its IDs are byte-identical, so the heuristic is cleared. |
| `skipFields: {LiquidityPosition: ["user"], LiquidityPositionSnapshot: ["user"]}` | The subgraph declares `user: User!` but `handleMint`/`handleBurn` create positions without creating the `User`. ~1,878 of 18,722 snapshots reference a non-existent User, so selecting `user { id }` makes the subgraph's own API return `Null value resolved for non-null field 'user'` and the whole batch yields **zero records**. Skipping just `user` keeps `pair` and `liquidityPosition` comparable (those FKs are intact — 0 dangling). |

No `fieldMappings` are needed: entity and field names are identical on both sides.

## Current result

15/16 entities clean, 0 records missing in either direction.

The one outstanding item is **`Factory.untrackedVolumeUSD`**:

```
subgraph   923174174.6742832902312540222780047
hyperindex 923174174.5434202296475401630989955
delta      0.1308630606      (1.4e-8 relative)
```

This is **not** block skew — both sides were read at exactly block 31,536,364,
with identical `txCount` (1,336,080) and byte-identical `totalVolumeUSD`.
Localised to **exactly 1 pair of 334**:

```
pair   0xa3c6236d46bfec75387e91d5324939c288b9976b   (BULL / WETH)
token0 0x7e37624613ebc2deea15b8e710edfd373175662a   BULL
```

Its present state matches exactly — `reserve0/1`, `reserveETH`, `token0Price`,
`token1Price`, `txCount`, and `derivedETH` (0 on both sides). Only the
*accumulated* `untrackedVolumeUSD` differs, on the pair, the token and the
factory. Tracked volume is unaffected because BULL is not whitelisted, so
`getTrackedVolumeUSD` takes the WETH side only, which matches.

So the divergence is historical, confined to the derived-price path
(`derivedAmountUSD = (d0·amount0 + d1·amount1)/2 · ethPrice`), and it did **not**
exist at block 4,000,000 — the pre-deployment parity run matched 16/16 exactly
over ~192,000 rows there.

**Root cause not established.** The likely amplifier is the discrete threshold in
`findEthPerToken`: it returns `token1Price` or `0` depending on
`pair.reserveETH > 0.1`, so an infinitesimal difference in `reserveETH` near that
boundary flips `derivedETH` between a large value and zero. This pair's
`reserveETH` is now ~1e-18, far below the threshold. Confirming it needs a
targeted replay of BULL's ~3,111 transactions; it is recorded here rather than
guessed at.

## Limitations of this tool (relevant here)

- **No block pinning.** Both endpoints are queried live, so any mutable
  accumulator (`Factory`, `Token`, `Pair`, `DayData`, …) will drift if the two
  are at different heads. Check heads before trusting a diff. For an exactly
  pinned comparison use `parity/compare.mjs --end <block>` in the indexer repo,
  which uses The Graph's time-travel argument on the subgraph side.
- **`--deep` caps at ~100k records per entity** (`skip > 100000`), and The Graph
  caps `skip` well below that. `Swap` (~1.27M) and `Transaction` (~1M) cannot be
  fully paginated this way — sample mode is the practical option for them.
- **Array fields are not compared.** `Transaction.mints/burns/swaps` are id
  arrays (subgraph `[Mint!]`, HyperIndex `[String!]!`) and stay unmapped — hence
  the standing `[low_confidence] Transaction: Only 50% of fields matched`
  warning. The indexer repo's own `parity/compare.mjs` does compare them, by
  membership.

## Fixes made to the tool while wiring this up

All three were pre-existing bugs, not specific to this migration:

1. **`loadOverrides` always returned `{}`.** It used `require('fs')` inside an
   ESM package (`"type": "module"`); the `ReferenceError` was swallowed by a bare
   `catch`. Every override — `fieldMappings`, `knownIdMismatch`, `skipEntities` —
   was silently ignored on every run, for every migration. Now uses an ESM import
   and reports failures instead of hiding them.
2. **`--generate-config` ignored `OVERRIDES_PATH`**, hardcoding
   `./overrides.json`, so its preview did not reflect what `compare` would do.
3. **`introspect-hyperindex.ts` did not exist** even though `package.json`
   referenced it via `pnpm introspect`. Added.

Plus two additive override keys: `idMatchConfirmed` and `skipFields` (see above).
Both default to off, so existing configs are unaffected.
