import { ImportStatementParams, ParsedField } from './types';
import { isAnnotatedWith, isRelation, isType } from './field-classifiers';
import { DTO_OVERRIDE_TYPE, DTO_CAST_TYPE } from './annotations';

/**
 * Mapping from Prisma scalar types to Zod 4 validators.
 */
const PrismaScalarToZod: Record<string, string> = {
  String: 'z.string()',
  Boolean: 'z.boolean()',
  Int: 'z.int()',
  BigInt: 'z.bigint()',
  Float: 'z.number()',
  Decimal: 'z.number()',
  DateTime: 'z.date()',
  Json: 'z.record(z.any())',
  Bytes: 'z.instanceof(Buffer)',
};

/**
 * Convert a Prisma scalar type to Zod validator.
 */
export function scalarToZod(scalar: string): string {
  return PrismaScalarToZod[scalar] || 'z.any()';
}

/**
 * Check if field is a UUID field (id with uuid default).
 */
function isUuidField(field: ParsedField): boolean {
  if (!field.isId) return false;
  if (field.type !== 'String') return false;
  // Check default value for uuid()
  if (
    field.default &&
    typeof field.default === 'object' &&
    field.default.name === 'uuid'
  ) {
    return true;
  }
  return false;
}

/**
 * Check if field is a DateTime with @default(now()).
 */
function isAutoTimestamp(field: ParsedField): boolean {
  if (field.type !== 'DateTime') return false;
  if (field.isUpdatedAt) return true;
  if (
    field.default &&
    typeof field.default === 'object' &&
    field.default.name === 'now'
  ) {
    return true;
  }
  return false;
}

interface FieldToZodOptions {
  schemaName?: (name: string) => string;
  isUpdateSchema?: boolean;
}

/**
 * Convert a ParsedField to a Zod validator string.
 */
export function fieldToZodValidator(
  field: ParsedField,
  options: FieldToZodOptions = {},
): string {
  const { schemaName, isUpdateSchema = false } = options;

  // Check for override type annotation
  // Note: @DtoCastType/@DtoOverrideType are for TypeScript types, not Zod schemas
  // We use z.any() for custom types as a safe fallback
  const hasCustomType = [DTO_OVERRIDE_TYPE, DTO_CAST_TYPE].some((annotation) =>
    isAnnotatedWith(field, annotation),
  );

  let validator: string;

  if (hasCustomType) {
    // Custom type override - use z.any() since we can't infer Zod schema
    validator = 'z.any()';
  } else if (isRelation(field) || isType(field)) {
    // Handle relations and embedded types with z.lazy()
    const targetSchema = schemaName
      ? schemaName(field.type)
      : `${field.type}Schema`;
    validator = `z.lazy(() => ${targetSchema})`;
  } else if (field.kind === 'enum') {
    // Use z.nativeEnum() with the imported enum type
    validator = `z.nativeEnum(${field.type})`;
  } else if (isUuidField(field)) {
    // UUID fields use z.uuidv7()
    validator = 'z.uuidv7()';
  } else if (isAutoTimestamp(field)) {
    // Auto-generated timestamps use ISO transform
    validator = 'z.iso.datetime().pipe(z.transform((v) => new Date(v)))';
  } else {
    // Scalar types
    validator = scalarToZod(field.type);
  }

  // Handle arrays
  if (field.isList) {
    validator = `${validator}.array()`;
  }

  // Handle optionality
  // For update schemas, everything is optional via .nullish()
  if (isUpdateSchema && !field.isId) {
    validator = `${validator}.nullish()`;
  } else if (field.isNullable && !field.isRequired) {
    // Both nullable and optional
    validator = `${validator}.nullish()`;
  } else if (field.isNullable) {
    // Required but can be null
    validator = `${validator}.nullable()`;
  } else if (!field.isRequired) {
    // Optional but not nullable (use nullish for consistency with user's preference)
    validator = `${validator}.nullish()`;
  }

  return validator;
}

/**
 * Render fields as Zod object properties.
 */
export function fieldsToZodProps(
  fields: ParsedField[],
  options: FieldToZodOptions = {},
): string {
  return fields
    .map((field) => `  ${field.name}: ${fieldToZodValidator(field, options)},`)
    .join('\n');
}

/**
 * Generate imports for Zod schemas.
 */
export function makeImportsFromZod(): ImportStatementParams[] {
  return [
    {
      from: 'zod',
      destruct: ['z'],
    },
  ];
}
