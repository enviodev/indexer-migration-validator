// Schema parser types for generalized comparison tool

export interface ParsedField {
  name: string;
  type: string;           // Full type string, e.g., "String!", "[User!]!"
  baseType: string;       // Without modifiers, e.g., "String", "User"
  isRequired: boolean;    // Has "!"
  isArray: boolean;       // Is "[Type]"
  isRelation: boolean;    // References another entity
  relatedEntity?: string; // If relation, the target entity name
  isDerived: boolean;     // Has @derivedFrom directive
  derivedFromField?: string;
}

export interface ParsedEntity {
  name: string;
  fields: ParsedField[];
  isEntity: boolean;          // Has @entity directive (subgraph only)
  isImmutable: boolean;       // Has @entity(immutable: true)
  implementsInterfaces: string[];
}

export interface ParsedSchema {
  entities: Map<string, ParsedEntity>;
  enums: Map<string, string[]>;
  interfaces: Map<string, ParsedEntity>;
  schemaType: 'subgraph' | 'hyperindex';
}

export interface FieldMapping {
  subgraphField: string;
  hyperindexField: string;
  mappingType: 'direct' | 'nested_to_flat' | 'renamed' | 'type_converted';
}

export interface EntityMatch {
  subgraphEntity: ParsedEntity;
  hyperindexEntity: ParsedEntity;
  confidence: number;
  fieldMappings: FieldMapping[];
  unmappedSubgraphFields: string[];
  unmappedHyperindexFields: string[];
}

export interface MatchResult {
  matches: EntityMatch[];
  unmatchedSubgraph: string[];
  unmatchedHyperindex: string[];
}

export interface GeneratedEntityConfig {
  subgraphName: string;
  hyperindexName: string;
  fields: string[];
  nestedFields: Record<string, string>;
  fieldMapping: Record<string, string>;
  knownIdMismatch: boolean;
}

export interface ConfigWarning {
  entityName: string;
  type: 'low_confidence' | 'missing_fields' | 'id_type_diff' | 'interface_entity' | 'field_rename';
  message: string;
}

export interface GeneratorResult {
  configs: Record<string, GeneratedEntityConfig>;
  warnings: ConfigWarning[];
  unmatchedSubgraphEntities: string[];
  unmatchedHyperindexEntities: string[];
}

export interface Overrides {
  fieldMappings?: Record<string, Record<string, string>>; // Entity -> { subgraphField: hyperindexField }
  knownIdMismatch?: string[];
  /**
   * Entities whose IDs are KNOWN to match, overriding the `detectIdMismatch`
   * name heuristic in configGenerator.ts. That heuristic flags any entity whose
   * name contains e.g. "Swap" or "Delta", and a flagged entity is SILENTLY
   * SKIPPED in --deep mode (reported as 0/0, which reads like a pass). Without
   * this escape hatch a migration whose Swap IDs are byte-identical cannot be
   * deep-verified at all, because `knownIdMismatch` can only ever add to the
   * heuristic, never clear it.
   */
  idMatchConfirmed?: string[];
  /**
   * Per-entity list of SUBGRAPH field names to exclude from comparison.
   * Use when a field cannot be selected from one side at all — e.g. a subgraph
   * relation typed non-null whose target row does not exist, which makes the
   * entire GraphQL response error and silently return zero records.
   */
  skipFields?: Record<string, string[]>;
  skipEntities?: string[];
}
