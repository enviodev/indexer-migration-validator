// GraphQL Schema Parser for comparison tool
import { readFileSync } from 'fs';
import {
  parse,
  DocumentNode,
  DefinitionNode,
  ObjectTypeDefinitionNode,
  InterfaceTypeDefinitionNode,
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
  TypeNode,
  DirectiveNode,
} from 'graphql';
import { ParsedSchema, ParsedEntity, ParsedField } from './types.js';

/**
 * Parse a GraphQL schema file and extract entities, fields, and relationships
 */
export function parseSchemaFile(filePath: string): ParsedSchema {
  const content = readFileSync(filePath, 'utf-8');
  return parseSchemaContent(content);
}

/**
 * Parse GraphQL schema content string
 */
export function parseSchemaContent(content: string): ParsedSchema {
  const document = parse(content);
  return extractFromDocument(document);
}

/**
 * Extract schema information from parsed GraphQL document
 */
function extractFromDocument(doc: DocumentNode): ParsedSchema {
  const entities = new Map<string, ParsedEntity>();
  const enums = new Map<string, string[]>();
  const interfaces = new Map<string, ParsedEntity>();

  // First pass: collect all type names to identify relations
  const allTypeNames = new Set<string>();
  const entityTypeNames = new Set<string>();

  for (const def of doc.definitions) {
    if (def.kind === 'ObjectTypeDefinition' || def.kind === 'InterfaceTypeDefinition') {
      const name = (def as ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode).name.value;
      allTypeNames.add(name);

      // Check if it's an entity (has @entity directive)
      const directives = (def as ObjectTypeDefinitionNode).directives || [];
      if (directives.some(d => d.name.value === 'entity')) {
        entityTypeNames.add(name);
      }
    }
    if (def.kind === 'EnumTypeDefinition') {
      allTypeNames.add((def as EnumTypeDefinitionNode).name.value);
    }
  }

  // Determine schema type based on presence of @entity directives
  const hasEntityDirectives = entityTypeNames.size > 0;
  const schemaType: 'subgraph' | 'hyperindex' = hasEntityDirectives ? 'subgraph' : 'hyperindex';

  // Second pass: parse definitions
  for (const def of doc.definitions) {
    if (def.kind === 'ObjectTypeDefinition') {
      const entity = parseObjectType(def as ObjectTypeDefinitionNode, allTypeNames, schemaType);
      entities.set(entity.name, entity);
    } else if (def.kind === 'EnumTypeDefinition') {
      const enumDef = def as EnumTypeDefinitionNode;
      const values = enumDef.values?.map(v => v.name.value) || [];
      enums.set(enumDef.name.value, values);
    } else if (def.kind === 'InterfaceTypeDefinition') {
      const iface = parseInterfaceType(def as InterfaceTypeDefinitionNode, allTypeNames);
      interfaces.set(iface.name, iface);
    }
  }

  return { entities, enums, interfaces, schemaType };
}

/**
 * Parse an object type definition into ParsedEntity
 */
function parseObjectType(
  node: ObjectTypeDefinitionNode,
  allTypes: Set<string>,
  schemaType: 'subgraph' | 'hyperindex'
): ParsedEntity {
  const directives = node.directives || [];
  const entityDirective = directives.find(d => d.name.value === 'entity');

  // Check for immutability
  const isImmutable = entityDirective?.arguments?.some(
    a => a.name.value === 'immutable' &&
         a.value.kind === 'BooleanValue' &&
         a.value.value === true
  ) ?? false;

  const implementsInterfaces = node.interfaces?.map(i => i.name.value) || [];

  return {
    name: node.name.value,
    isEntity: schemaType === 'subgraph' ? !!entityDirective : true, // All types in hyperindex are entities
    isImmutable,
    implementsInterfaces,
    fields: node.fields?.map(f => parseField(f, allTypes)) ?? []
  };
}

/**
 * Parse an interface type definition
 */
function parseInterfaceType(
  node: InterfaceTypeDefinitionNode,
  allTypes: Set<string>
): ParsedEntity {
  return {
    name: node.name.value,
    isEntity: false,
    isImmutable: false,
    implementsInterfaces: [],
    fields: node.fields?.map(f => parseField(f, allTypes)) ?? []
  };
}

/**
 * Parse a field definition
 */
function parseField(field: FieldDefinitionNode, allTypes: Set<string>): ParsedField {
  const typeInfo = extractTypeInfo(field.type);

  // Check if this field references another entity type
  const isRelation = allTypes.has(typeInfo.baseType) &&
    !isScalarType(typeInfo.baseType) &&
    !isBuiltInType(typeInfo.baseType);

  // Check for @derivedFrom directive
  const derivedDirective = field.directives?.find(d => d.name.value === 'derivedFrom');
  const isDerived = !!derivedDirective;
  let derivedFromField: string | undefined;

  if (derivedDirective) {
    const fieldArg = derivedDirective.arguments?.find(a => a.name.value === 'field');
    if (fieldArg?.value.kind === 'StringValue') {
      derivedFromField = fieldArg.value.value;
    }
  }

  return {
    name: field.name.value,
    type: typeInfo.fullType,
    baseType: typeInfo.baseType,
    isRequired: typeInfo.isRequired,
    isArray: typeInfo.isArray,
    isRelation,
    relatedEntity: isRelation ? typeInfo.baseType : undefined,
    isDerived,
    derivedFromField
  };
}

/**
 * Extract type information from a GraphQL type node
 */
function extractTypeInfo(typeNode: TypeNode): {
  fullType: string;
  baseType: string;
  isRequired: boolean;
  isArray: boolean;
} {
  let isRequired = false;
  let isArray = false;
  let innerRequired = false;
  let current: TypeNode = typeNode;

  // Unwrap NonNullType (outer)
  if (current.kind === 'NonNullType') {
    isRequired = true;
    current = current.type;
  }

  // Check for ListType
  if (current.kind === 'ListType') {
    isArray = true;
    current = current.type;

    // Unwrap inner NonNullType if present
    if (current.kind === 'NonNullType') {
      innerRequired = true;
      current = current.type;
    }
  }

  // Now current should be a NamedType
  const baseType = current.kind === 'NamedType' ? current.name.value : 'Unknown';

  // Build full type string
  let fullType = baseType;
  if (isArray) {
    fullType = `[${baseType}${innerRequired ? '!' : ''}]`;
  }
  if (isRequired) {
    fullType += '!';
  }

  return { fullType, baseType, isRequired, isArray };
}

/**
 * Check if a type is a GraphQL scalar
 */
function isScalarType(typeName: string): boolean {
  const scalars = [
    'String', 'Int', 'Float', 'Boolean', 'ID',
    'BigInt', 'BigDecimal', 'Bytes', 'DateTime'
  ];
  return scalars.includes(typeName);
}

/**
 * Check if a type is a built-in GraphQL type
 */
function isBuiltInType(typeName: string): boolean {
  return isScalarType(typeName);
}

/**
 * Get comparable fields from an entity (excludes derived fields)
 */
export function getComparableFields(entity: ParsedEntity): ParsedField[] {
  return entity.fields.filter(f => !f.isDerived);
}

/**
 * Get scalar fields from an entity (non-relation, non-derived)
 */
export function getScalarFields(entity: ParsedEntity): ParsedField[] {
  return entity.fields.filter(f => !f.isDerived && !f.isRelation);
}

/**
 * Get relation fields from an entity (non-derived relations)
 */
export function getRelationFields(entity: ParsedEntity): ParsedField[] {
  return entity.fields.filter(f => !f.isDerived && f.isRelation);
}
