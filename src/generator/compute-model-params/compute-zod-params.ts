import path from 'node:path';
import slash from 'slash';
import {
  DTO_CREATE_HIDDEN,
  DTO_CREATE_OPTIONAL,
  DTO_CREATE_REQUIRED,
  DTO_ENTITY_HIDDEN,
  DTO_CONNECT_HIDDEN,
  DTO_UPDATE_HIDDEN,
  DTO_UPDATE_REQUIRED,
  DTO_RELATION_INCLUDE_ID,
  DTO_RELATION_REQUIRED,
  DTO_OVERRIDE_TYPE,
  DTO_CAST_TYPE,
} from '../annotations';
import {
  isAnnotatedWith,
  isId,
  isIdWithDefaultValue,
  isReadOnly,
  isRelation,
  isRequiredWithDefaultValue,
  isType,
  isUnique,
  isUpdatedAt,
} from '../field-classifiers';
import {
  getRelationScalars,
  getRelativePath,
  mapDMMFToParsedField,
  zipImportStatementParams,
} from '../helpers';
import { makeImportsFromZod } from '../zod-schema';
import type {
  Model,
  ZodSchemaParams,
  ImportStatementParams,
  ParsedField,
} from '../types';
import type { TemplateHelpers } from '../template-helpers';

/**
 * Check if a field has a custom type override annotation.
 * Fields with @DtoOverrideType or @DtoCastType use z.any() and don't need schema imports.
 */
function hasCustomTypeOverride(field: { documentation?: string }): boolean {
  return (
    isAnnotatedWith(field, DTO_OVERRIDE_TYPE) ||
    isAnnotatedWith(field, DTO_CAST_TYPE)
  );
}

/**
 * Collect enum imports from fields.
 */
function collectEnumImports(
  fields: ParsedField[],
  prismaClientImportPath: string,
): ImportStatementParams[] {
  const enumTypes = new Set<string>();

  fields.forEach((field) => {
    if (field.kind === 'enum') {
      enumTypes.add(field.type);
    }
  });

  if (enumTypes.size === 0) return [];

  return [
    {
      from: prismaClientImportPath,
      destruct: Array.from(enumTypes),
    },
  ];
}

interface ComputeZodParamsParam {
  model: Model;
  allModels: Model[];
  templateHelpers: TemplateHelpers;
}

/**
 * Compute Zod schema params for Entity (full model representation).
 */
export const computeEntityZodParams = ({
  model,
  allModels,
  templateHelpers,
}: ComputeZodParamsParam): ZodSchemaParams => {
  const imports: ImportStatementParams[] = [];
  const lazyRelations: string[] = [];

  const relationScalarFields = getRelationScalars(model.fields);
  const relationScalarFieldNames = Object.keys(relationScalarFields);

  const fields = model.fields.reduce((result, field) => {
    const overrides: Partial<ParsedField> = {
      isRequired: true,
      isNullable: !field.isRequired,
    };

    if (isAnnotatedWith(field, DTO_ENTITY_HIDDEN)) return result;

    if (isType(field)) {
      // Only add import if field doesn't have custom type override
      if (field.type !== model.name && !hasCustomTypeOverride(field)) {
        const modelToImportFrom = allModels.find(
          ({ name }) => name === field.type,
        );

        if (modelToImportFrom) {
          const schemaName = templateHelpers.plainZodSchemaName(field.type);
          const importFrom = slash(
            `${getRelativePath(
              model.output.entity,
              modelToImportFrom.output.dto,
            )}${path.sep}${templateHelpers.plainZodSchemaFilename(field.type)}`,
          );

          imports.push({
            destruct: [schemaName],
            from: importFrom,
          });
          lazyRelations.push(field.type);
        }
      }
    }

    if (isRelation(field)) {
      const isRelationRequired = isAnnotatedWith(field, DTO_RELATION_REQUIRED);
      overrides.isRequired = isRelationRequired;
      overrides.isNullable = field.isList
        ? false
        : field.isRequired
          ? false
          : !isRelationRequired;

      // Only add import if field doesn't have custom type override
      if (field.type !== model.name && !hasCustomTypeOverride(field)) {
        const modelToImportFrom = allModels.find(
          ({ name }) => name === field.type,
        );

        if (modelToImportFrom) {
          const schemaName = templateHelpers.entityZodSchemaName(field.type);
          const importFrom = slash(
            `${getRelativePath(
              model.output.entity,
              modelToImportFrom.output.entity,
            )}${path.sep}${templateHelpers.entityZodSchemaFilename(field.type)}`,
          );

          imports.push({
            destruct: [schemaName],
            from: importFrom,
          });
        }
      }
      if (!hasCustomTypeOverride(field)) {
        lazyRelations.push(field.type);
      }
    }

    if (relationScalarFieldNames.includes(field.name)) {
      const { [field.name]: relationNames } = relationScalarFields;
      const isAnyRelationRequired = relationNames.some((relationFieldName) => {
        const relationField = model.fields.find(
          (anyField) => anyField.name === relationFieldName,
        );
        if (!relationField) return false;

        return (
          relationField.isRequired ||
          isAnnotatedWith(relationField, DTO_RELATION_REQUIRED)
        );
      });

      overrides.isRequired = true;
      overrides.isNullable = !isAnyRelationRequired;
    }

    return [
      ...result,
      mapDMMFToParsedField(field, { ...overrides, modelName: model.name }, {}),
    ];
  }, [] as ParsedField[]);

  const zodImports = makeImportsFromZod();
  const enumImports = collectEnumImports(
    fields,
    templateHelpers.config.prismaClientImportPath,
  );

  return {
    model,
    fields,
    imports: zipImportStatementParams([
      ...zodImports,
      ...enumImports,
      ...imports,
    ]),
    lazyRelations,
  };
};

/**
 * Compute Zod schema params for PlainDTO (scalar fields only).
 */
export const computePlainZodParams = ({
  model,
  allModels,
  templateHelpers,
}: ComputeZodParamsParam): ZodSchemaParams => {
  const imports: ImportStatementParams[] = [];
  const lazyRelations: string[] = [];

  const relationScalarFields = getRelationScalars(model.fields);
  const relationScalarFieldNames = Object.keys(relationScalarFields);

  const fields = model.fields.reduce((result, field) => {
    const overrides: Partial<ParsedField> = {
      isRequired: true,
      isNullable: !field.isRequired,
    };

    // Skip relations in plain DTO
    if (isRelation(field)) return result;

    // Skip relation scalar fields unless annotated
    if (
      !isAnnotatedWith(field, DTO_RELATION_INCLUDE_ID) &&
      relationScalarFieldNames.includes(field.name)
    ) {
      return result;
    }

    if (isType(field)) {
      if (field.type !== model.name) {
        const modelToImportFrom = allModels.find(
          ({ name }) => name === field.type,
        );

        if (modelToImportFrom) {
          const schemaName = templateHelpers.plainZodSchemaName(field.type);
          const importFrom = slash(
            `${getRelativePath(
              model.output.dto,
              modelToImportFrom.output.dto,
            )}${path.sep}${templateHelpers.plainZodSchemaFilename(field.type)}`,
          );

          imports.push({
            destruct: [schemaName],
            from: importFrom,
          });
          lazyRelations.push(field.type);
        }
      }
    }

    return [
      ...result,
      mapDMMFToParsedField(field, { ...overrides, modelName: model.name }, {}),
    ];
  }, [] as ParsedField[]);

  const zodImports = makeImportsFromZod();
  const enumImports = collectEnumImports(
    fields,
    templateHelpers.config.prismaClientImportPath,
  );

  return {
    model,
    fields,
    imports: zipImportStatementParams([
      ...zodImports,
      ...enumImports,
      ...imports,
    ]),
    lazyRelations,
  };
};

/**
 * Compute Zod schema params for CreateDTO.
 */
export const computeCreateZodParams = ({
  model,
  allModels,
  templateHelpers,
}: ComputeZodParamsParam): ZodSchemaParams => {
  const imports: ImportStatementParams[] = [];
  const lazyRelations: string[] = [];

  const relationScalarFields = getRelationScalars(model.fields);
  const relationScalarFieldNames = Object.keys(relationScalarFields);

  const fields = model.fields.reduce((result, field) => {
    const overrides: Partial<ParsedField> = {};

    if (
      isAnnotatedWith(field, DTO_RELATION_INCLUDE_ID) &&
      relationScalarFieldNames.includes(field.name)
    ) {
      field.isReadOnly = false;
    }

    if (isReadOnly(field)) return result;
    if (isAnnotatedWith(field, DTO_CREATE_HIDDEN)) return result;

    // Skip relations in Zod schemas (they're handled differently)
    if (isRelation(field)) return result;

    // Skip relation scalar fields unless annotated
    if (
      !isAnnotatedWith(field, DTO_RELATION_INCLUDE_ID) &&
      relationScalarFieldNames.includes(field.name)
    ) {
      return result;
    }

    const isDtoOptional =
      isAnnotatedWith(field, DTO_CREATE_OPTIONAL) ||
      isAnnotatedWith(field, DTO_CREATE_REQUIRED);

    if (!isDtoOptional) {
      if (isIdWithDefaultValue(field)) return result;
      if (isUpdatedAt(field)) return result;
      if (isRequiredWithDefaultValue(field)) {
        if (templateHelpers.config.showDefaultValues) {
          overrides.isRequired = false;
        } else {
          return result;
        }
      }
    }

    if (isAnnotatedWith(field, DTO_CREATE_OPTIONAL)) {
      overrides.isRequired = false;
    }

    if (isAnnotatedWith(field, DTO_CREATE_REQUIRED)) {
      overrides.isRequired = true;
    }

    overrides.isNullable =
      overrides.isNullable ?? !(field.isRequired || overrides.isRequired);

    if (isType(field)) {
      if (field.type !== model.name) {
        const modelToImportFrom = allModels.find(
          ({ name }) => name === field.type,
        );

        if (modelToImportFrom) {
          const schemaName = templateHelpers.createZodSchemaName(field.type);
          const importFrom = slash(
            `${getRelativePath(
              model.output.dto,
              modelToImportFrom.output.dto,
            )}${path.sep}${templateHelpers.createZodSchemaFilename(field.type)}`,
          );

          imports.push({
            destruct: [schemaName],
            from: importFrom,
          });
          lazyRelations.push(field.type);
        }
      }
    }

    return [
      ...result,
      mapDMMFToParsedField(field, { ...overrides, modelName: model.name }, {}),
    ];
  }, [] as ParsedField[]);

  const zodImports = makeImportsFromZod();
  const enumImports = collectEnumImports(
    fields,
    templateHelpers.config.prismaClientImportPath,
  );

  return {
    model,
    fields,
    imports: zipImportStatementParams([
      ...zodImports,
      ...enumImports,
      ...imports,
    ]),
    lazyRelations,
  };
};

/**
 * Compute Zod schema params for UpdateDTO.
 * All fields are optional (using .nullish()).
 */
export const computeUpdateZodParams = ({
  model,
  allModels,
  templateHelpers,
}: ComputeZodParamsParam): ZodSchemaParams => {
  const imports: ImportStatementParams[] = [];
  const lazyRelations: string[] = [];

  const relationScalarFields = getRelationScalars(model.fields);
  const relationScalarFieldNames = Object.keys(relationScalarFields);

  const fields = model.fields.reduce((result, field) => {
    // In update, all fields default to optional
    const overrides: Partial<ParsedField> = {
      isRequired: false,
      isNullable: true,
    };

    if (
      isAnnotatedWith(field, DTO_RELATION_INCLUDE_ID) &&
      relationScalarFieldNames.includes(field.name)
    ) {
      field.isReadOnly = false;
    }

    if (isReadOnly(field)) return result;
    if (isAnnotatedWith(field, DTO_UPDATE_HIDDEN)) return result;
    if (isId(field)) return result; // IDs are not updatable

    // Skip relations in Zod schemas
    if (isRelation(field)) return result;

    // Skip relation scalar fields unless annotated
    if (
      !isAnnotatedWith(field, DTO_RELATION_INCLUDE_ID) &&
      relationScalarFieldNames.includes(field.name)
    ) {
      return result;
    }

    if (isAnnotatedWith(field, DTO_UPDATE_REQUIRED)) {
      overrides.isRequired = true;
      overrides.isNullable = false;
    }

    if (isType(field)) {
      if (field.type !== model.name) {
        const modelToImportFrom = allModels.find(
          ({ name }) => name === field.type,
        );

        if (modelToImportFrom) {
          const schemaName = templateHelpers.updateZodSchemaName(field.type);
          const importFrom = slash(
            `${getRelativePath(
              model.output.dto,
              modelToImportFrom.output.dto,
            )}${path.sep}${templateHelpers.updateZodSchemaFilename(field.type)}`,
          );

          imports.push({
            destruct: [schemaName],
            from: importFrom,
          });
          lazyRelations.push(field.type);
        }
      }
    }

    return [
      ...result,
      mapDMMFToParsedField(field, { ...overrides, modelName: model.name }, {}),
    ];
  }, [] as ParsedField[]);

  const zodImports = makeImportsFromZod();
  const enumImports = collectEnumImports(
    fields,
    templateHelpers.config.prismaClientImportPath,
  );

  return {
    model,
    fields,
    imports: zipImportStatementParams([
      ...zodImports,
      ...enumImports,
      ...imports,
    ]),
    lazyRelations,
  };
};

/**
 * Compute Zod schema params for ConnectDTO (ID and unique fields only).
 */
export const computeConnectZodParams = ({
  model,
  templateHelpers,
}: Omit<ComputeZodParamsParam, 'allModels'>): ZodSchemaParams => {
  const imports: ImportStatementParams[] = [];
  const lazyRelations: string[] = [];

  const idFields = model.fields.filter(
    (field) => !isAnnotatedWith(field, DTO_CONNECT_HIDDEN) && isId(field),
  );
  const uniqueFields = model.fields.filter(
    (field) => !isAnnotatedWith(field, DTO_CONNECT_HIDDEN) && isUnique(field),
  );

  // Combine id and unique fields
  const allUniqueFields = [...idFields];
  uniqueFields.forEach((field) => {
    if (!allUniqueFields.find((f) => f.name === field.name)) {
      allUniqueFields.push(field);
    }
  });

  // If multiple unique fields, they should all be optional
  const overrides =
    allUniqueFields.length > 1 ? { isRequired: false, isNullable: false } : {};

  const fields = allUniqueFields.map((field) =>
    mapDMMFToParsedField(field, { ...overrides, modelName: model.name }, {}),
  );

  const zodImports = makeImportsFromZod();
  const enumImports = collectEnumImports(
    fields,
    templateHelpers.config.prismaClientImportPath,
  );

  return {
    model,
    fields,
    imports: zipImportStatementParams([
      ...zodImports,
      ...enumImports,
      ...imports,
    ]),
    lazyRelations,
  };
};

interface ComputeZodModelParamsParam {
  model: Model;
  allModels: Model[];
  templateHelpers: TemplateHelpers;
}

/**
 * Compute all Zod schema params for a model.
 */
export const computeZodModelParams = ({
  model,
  allModels,
  templateHelpers,
}: ComputeZodModelParamsParam) => ({
  connect: computeConnectZodParams({ model, templateHelpers }),
  create: computeCreateZodParams({ model, allModels, templateHelpers }),
  update: computeUpdateZodParams({ model, allModels, templateHelpers }),
  entity: computeEntityZodParams({ model, allModels, templateHelpers }),
  plain: computePlainZodParams({ model, allModels, templateHelpers }),
});

/**
 * Compute Zod schema params for Type (embedded type).
 */
export const computeZodTypeParams = ({
  model,
  allModels,
  templateHelpers,
}: ComputeZodModelParamsParam) => ({
  create: computeCreateZodParams({ model, allModels, templateHelpers }),
  update: computeUpdateZodParams({ model, allModels, templateHelpers }),
  plain: computePlainZodParams({ model, allModels, templateHelpers }),
});
