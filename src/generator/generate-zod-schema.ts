import type { TemplateHelpers } from './template-helpers';
import type { ZodSchemaParams } from './types';
import { fieldsToZodProps } from './zod-schema';

interface GenerateZodSchemaParam extends ZodSchemaParams {
  templateHelpers: TemplateHelpers;
}

/**
 * Generate Entity Zod schema (full model representation).
 */
export const generateEntityZodSchema = ({
  model,
  fields,
  imports,
  // lazyRelations is included in ZodSchemaParams but not used in template
  templateHelpers: t,
}: GenerateZodSchemaParam) => `
${t.importStatements(imports)}

export const ${t.entityZodSchemaName(model.name)} = z.object({
${fieldsToZodProps(fields, {
  schemaName: t.entityZodSchemaName,
  isUpdateSchema: false,
})}
});

export type ${t.entityName(model.name)} = z.infer<typeof ${t.entityZodSchemaName(model.name)}>;
`;

/**
 * Generate Plain Zod schema (scalar fields only).
 */
export const generatePlainZodSchema = ({
  model,
  fields,
  imports,
  templateHelpers: t,
}: GenerateZodSchemaParam) => `
${t.importStatements(imports)}

export const ${t.plainZodSchemaName(model.name)} = z.object({
${fieldsToZodProps(fields, {
  schemaName: t.plainZodSchemaName,
  isUpdateSchema: false,
})}
});

export type ${t.plainDtoName(model.name)} = z.infer<typeof ${t.plainZodSchemaName(model.name)}>;
`;

/**
 * Generate Create Zod schema.
 */
export const generateCreateZodSchema = ({
  model,
  fields,
  imports,
  templateHelpers: t,
}: GenerateZodSchemaParam) => `
${t.importStatements(imports)}

export const ${t.createZodSchemaName(model.name)} = z.object({
${fieldsToZodProps(fields, {
  schemaName: t.createZodSchemaName,
  isUpdateSchema: false,
})}
});

export type ${t.createDtoName(model.name)} = z.infer<typeof ${t.createZodSchemaName(model.name)}>;
`;

/**
 * Generate Update Zod schema (all fields optional with .nullish()).
 */
export const generateUpdateZodSchema = ({
  model,
  fields,
  imports,
  templateHelpers: t,
}: GenerateZodSchemaParam) => `
${t.importStatements(imports)}

export const ${t.updateZodSchemaName(model.name)} = z.object({
${fieldsToZodProps(fields, {
  schemaName: t.updateZodSchemaName,
  isUpdateSchema: true,
})}
});

export type ${t.updateDtoName(model.name)} = z.infer<typeof ${t.updateZodSchemaName(model.name)}>;
`;

/**
 * Generate Connect Zod schema (ID and unique fields only).
 */
export const generateConnectZodSchema = ({
  model,
  fields,
  imports,
  templateHelpers: t,
}: GenerateZodSchemaParam) => `
${t.importStatements(imports)}

export const ${t.connectZodSchemaName(model.name)} = z.object({
${fieldsToZodProps(fields, {
  schemaName: t.connectZodSchemaName,
  isUpdateSchema: false,
})}
});

export type ${t.connectDtoName(model.name)} = z.infer<typeof ${t.connectZodSchemaName(model.name)}>;
`;
