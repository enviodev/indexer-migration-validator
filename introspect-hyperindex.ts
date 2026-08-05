/**
 * Generate a HyperIndex schema file from a live endpoint's introspection.
 *
 * WHY THIS EXISTS
 * ---------------
 * The matcher maps a subgraph relation (`token0: Token!`) onto the HyperIndex
 * flat foreign key (`token0_id`). It looks that name up in the HyperIndex schema
 * FILE, so the file has to describe the *queryable API shape*, not the authoring
 * shape. An Envio `schema.graphql` declares `token0: Token!`, which contains no
 * `token0_id` — so every relation silently ends up unmapped and uncompared.
 *
 * Introspecting the deployed endpoint removes the guesswork: it emits exactly
 * the scalar columns the API serves (including `*_id`), skipping object and
 * list relationships, which are Hasura navigation rather than stored columns.
 *
 * Usage:
 *   HYPERINDEX_URL=... HYPERINDEX_SCHEMA=./out.graphql pnpm introspect
 */
import { writeFileSync } from 'fs';
import 'dotenv/config';

const URL_ = process.env.HYPERINDEX_URL || '';
const OUT = process.env.HYPERINDEX_SCHEMA || './hyperindex-schema.graphql';

if (!URL_) {
  console.error('HYPERINDEX_URL is not set (put it in .env)');
  process.exit(1);
}

type TypeRef = { name: string | null; kind: string; ofType?: TypeRef | null };

/** Introspection selection deep enough for `[X!]!` and beyond. */
const TYPE_REF = `{ kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }`;

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json: any = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
  return json.data;
}

/** Peel NON_NULL / LIST wrappers down to the named type. */
function unwrap(t: TypeRef | null | undefined): TypeRef | null {
  let cur: any = t;
  while (cur && !cur.name && cur.ofType) cur = cur.ofType;
  return cur ?? null;
}

/** Render a type ref back to SDL, keeping non-null and list markers. */
function render(t: TypeRef): string {
  if (t.kind === 'NON_NULL') return `${render(t.ofType as TypeRef)}!`;
  if (t.kind === 'LIST') return `[${render(t.ofType as TypeRef)}]`;
  return t.name ?? 'String';
}

/** Entity root fields: list-of-object queries that are not Hasura extras. */
async function entityTypeNames(): Promise<string[]> {
  // `[Pair!]!` is NON_NULL(LIST(NON_NULL(Pair))) — four levels of wrapping, so
  // the introspection has to nest at least that deep or the named type is lost.
  const data = await gql<any>(`{
    __schema { queryType { fields { name type ${TYPE_REF} } } }
  }`);
  const names = new Set<string>();
  for (const f of data.__schema.queryType.fields) {
    if (/_aggregate$|_by_pk$|_stream$/.test(f.name)) continue;
    const base = unwrap(f.type);
    if (!base?.name || base.kind !== 'OBJECT') continue;
    if (/^(chain_metadata|dynamic_contract_registry|raw_events|persisted_state|event_sync_state|_meta)/.test(base.name)) continue;
    names.add(base.name);
  }
  return [...names].sort();
}

const typeNames = await entityTypeNames();
console.log(`Found ${typeNames.length} entity types on the endpoint`);

const blocks: string[] = [
  '# GENERATED from the live HyperIndex endpoint by `pnpm introspect`.',
  '# Do not hand-edit — regenerate instead.',
  '#',
  '# Relations are FLATTENED to their `<name>_id` scalar column, which is what the',
  '# API actually serves and what the matcher maps subgraph relations onto.',
  '# Object/list relationship fields are omitted: they are Hasura navigation, not',
  '# stored columns.',
  '',
];

let totalScalar = 0;
let totalSkipped = 0;

for (const name of typeNames) {
  const data = await gql<any>(`{
    __type(name: "${name}") { fields { name type ${TYPE_REF} } }
  }`);
  const fields = data.__type?.fields ?? [];
  const lines: string[] = [];
  for (const f of fields) {
    const base = unwrap(f.type);
    // Keep scalars and enums; drop object/list relationships.
    if (!base || (base.kind !== 'SCALAR' && base.kind !== 'ENUM')) {
      totalSkipped++;
      continue;
    }
    lines.push(`  ${f.name}: ${render(f.type)}`);
    totalScalar++;
  }
  if (lines.length === 0) continue;
  blocks.push(`type ${name} {`, ...lines, '}', '');
}

writeFileSync(OUT, blocks.join('\n'));
console.log(`Wrote ${OUT}`);
console.log(`  ${totalScalar} scalar fields kept, ${totalSkipped} relationship fields skipped`);
