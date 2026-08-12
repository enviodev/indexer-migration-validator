/**
 * Generate a subgraph-style schema file from a live subgraph's introspection.
 *
 * WHY THIS EXISTS
 * ---------------
 * The per-migration configs carry a hand-obtained `subgraph-schema.graphql`.
 * That is fine for one subgraph; it does not scale to a merged validation that
 * needs four helper subgraphs whose schemas differ from each other by chain
 * (the ve/points types exist on some deployments and not others, and one
 * answers `Type 'Query' has no field 'blocks'`). Transcribing those by hand is
 * how you end up comparing an entity that is not there.
 *
 * Emits SDL the parser reads as a SUBGRAPH schema:
 *   - every entity type carries `@entity`, which is what selects subgraph mode;
 *   - relations stay OBJECT-typed (`token: Token!`) so the matcher maps them
 *     onto the hyperindex `token_id` column;
 *   - list-of-entity fields are emitted as-is rather than dropped. They are
 *     almost always `@derivedFrom` and have no stored counterpart, so they end
 *     up in the run's UNCOMPARED list — visible, rather than silently absent.
 *
 * Usage:
 *   SUBGRAPH_URL=... OUT=./pumex-helper/subgraph-schema.59144.graphql \
 *     pnpm tsx introspect-subgraph.ts
 */
import { writeFileSync } from 'fs';
import 'dotenv/config';

const URL_ = process.env.SUBGRAPH_URL || '';
const OUT = process.env.OUT || './subgraph-schema.graphql';

// Goldsky answers 403 to a request with no User-Agent, which reads as a dead
// subgraph rather than a rejected one.
const USER_AGENT = 'indexer-migration-validator/1.0 (+parity-check)';

if (!URL_) {
  console.error('SUBGRAPH_URL is not set');
  process.exit(1);
}

type TypeRef = { name: string | null; kind: string; ofType?: TypeRef | null };

const TYPE_REF = `{ kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function gql<T>(query: string): Promise<T> {
  // Hosted subgraphs rate-limit a burst of introspection queries, so back off
  // and retry rather than aborting a schema fetch on a 429.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({ query }),
    });
    if (res.status === 429 || res.status === 503) {
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`  HTTP ${res.status}, backing off ${wait / 1000}s (${attempt}/6)`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${URL_}`);
    const json: any = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
    return json.data;
  }
  throw new Error(`gave up after repeated rate limits from ${URL_}`);
}

function unwrap(t: TypeRef | null | undefined): TypeRef | null {
  let cur: any = t;
  while (cur && !cur.name && cur.ofType) cur = cur.ofType;
  return cur ?? null;
}

function render(t: TypeRef): string {
  if (t.kind === 'NON_NULL') return `${render(t.ofType as TypeRef)}!`;
  if (t.kind === 'LIST') return `[${render(t.ofType as TypeRef)}]`;
  return t.name ?? 'String';
}

/**
 * Entity types, taken from the PLURAL list-returning query fields.
 *
 * A subgraph exposes both `token(id:)` and `tokens(where:)` for each entity;
 * keying off the list form avoids picking up `_meta` and the singular lookups.
 */
async function entityTypeNames(): Promise<string[]> {
  const data = await gql<any>(`{
    __schema { queryType { fields { name type ${TYPE_REF} } } }
  }`);
  const names = new Set<string>();
  for (const f of data.__schema.queryType.fields) {
    if (f.name === '_meta') continue;
    // Only the list-returning field, so each entity is collected once.
    const outer = f.type.kind === 'NON_NULL' ? f.type.ofType : f.type;
    if (outer?.kind !== 'LIST') continue;
    const base = unwrap(f.type);
    if (!base?.name || base.kind !== 'OBJECT') continue;
    if (base.name.startsWith('_')) continue;
    names.add(base.name);
  }
  return [...names].sort();
}

const typeNames = await entityTypeNames();
console.log(`Found ${typeNames.length} entity types at ${URL_}`);

const blocks: string[] = [
  '# GENERATED from the live subgraph by `introspect-subgraph.ts`.',
  '# Do not hand-edit — regenerate instead.',
  `# Source: ${URL_}`,
  '#',
  '# Relations stay object-typed so the matcher can map them onto the',
  '# hyperindex `<name>_id` column. List-of-entity fields are kept so they show',
  '# up as UNCOMPARED rather than vanishing from the report.',
  '',
];

// One request for every type, rather than one request per type. Twenty rapid
// `__type` lookups is enough to trip a hosted subgraph's rate limit.
const all = await gql<any>(`{
  __schema { types { name kind fields { name type ${TYPE_REF} } enumValues { name } } }
}`);

const wanted = new Set(typeNames);
const enumNames = new Set<string>();
const enumValues = new Map<string, string[]>();
const objectFields = new Map<string, Array<{ name: string; type: string }>>();

for (const t of all.__schema.types) {
  if (t.kind === 'ENUM' && t.enumValues) {
    enumValues.set(t.name, t.enumValues.map((v: any) => v.name));
  }
  if (!wanted.has(t.name) || !t.fields) continue;
  const out: Array<{ name: string; type: string }> = [];
  for (const f of t.fields) {
    const base = unwrap(f.type);
    if (!base?.name) continue;
    if (base.kind === 'ENUM') enumNames.add(base.name);
    out.push({ name: f.name, type: render(f.type) });
  }
  objectFields.set(t.name, out);
}

// Only the enums actually referenced — `parse()` needs them declared, and the
// rest of a subgraph's introspection enums (_SubgraphErrorPolicy_, orderBy
// enums) are API machinery, not schema.
for (const enumName of [...enumNames].sort()) {
  const values = enumValues.get(enumName) ?? [];
  blocks.push(`enum ${enumName} {`, ...values.map(v => `  ${v}`), '}', '');
}

let totalFields = 0;
for (const name of typeNames) {
  const fields = objectFields.get(name) ?? [];
  if (fields.length === 0) continue;
  blocks.push(`type ${name} @entity {`);
  for (const f of fields) {
    blocks.push(`  ${f.name}: ${f.type}`);
    totalFields++;
  }
  blocks.push('}', '');
}

writeFileSync(OUT, blocks.join('\n'));
console.log(`Wrote ${OUT}`);
console.log(`  ${typeNames.length} entities, ${totalFields} fields, ${enumNames.size} enums`);
