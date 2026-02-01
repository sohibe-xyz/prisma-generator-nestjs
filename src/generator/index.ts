import path from 'node:path';
import { camel, pascal, kebab, snake } from 'case';
import { DMMF } from '@prisma/generator-helper';
import { WritableDeep } from 'type-fest';
import { logger } from '../utils';
import { makeHelpers } from './template-helpers';
import { computeModelParams } from './compute-model-params';
import { computeTypeParams } from './compute-type-params';
import { generateConnectDto } from './generate-connect-dto';
import { generateCreateDto } from './generate-create-dto';
import { generateUpdateDto } from './generate-update-dto';
import { generateEntity } from './generate-entity';
import { generatePlainDto } from './generate-plain-dto';
import { generateEnums } from './generate-enums';
import {
  generateEntityZodSchema,
  generatePlainZodSchema,
  generateCreateZodSchema,
  generateUpdateZodSchema,
  generateConnectZodSchema,
} from './generate-zod-schema';
import {
  computeZodModelParams,
  computeZodTypeParams,
} from './compute-model-params/compute-zod-params';
import { DTO_IGNORE_MODEL } from './annotations';
import { isAnnotatedWith } from './field-classifiers';
import { NamingStyle, Model, WriteableFileSpecs } from './types';

interface RunParam {
  output: string;
  dmmf: WritableDeep<DMMF.Document>;
  exportRelationModifierClasses: boolean;
  outputToNestJsResourceStructure: boolean;
  flatResourceStructure: boolean;
  connectDtoPrefix: string;
  createDtoPrefix: string;
  updateDtoPrefix: string;
  dtoSuffix: string;
  entityPrefix: string;
  entitySuffix: string;
  fileNamingStyle: NamingStyle;
  classValidation: boolean;
  outputType: string;
  noDependencies: boolean;
  definiteAssignmentAssertion: boolean;
  requiredResponseApiProperty: boolean;
  prismaClientImportPath: string;
  outputApiPropertyType: boolean;
  generateFileTypes: string;
  wrapRelationsAsType: boolean;
  showDefaultValues: boolean;
  generateZodSchemas: boolean;
}

export const run = ({
  output,
  dmmf,
  ...options
}: RunParam): WriteableFileSpecs[] => {
  const {
    exportRelationModifierClasses,
    outputToNestJsResourceStructure,
    flatResourceStructure,
    fileNamingStyle = 'camel',
    classValidation,
    outputType,
    noDependencies,
    definiteAssignmentAssertion,
    requiredResponseApiProperty,
    prismaClientImportPath,
    outputApiPropertyType,
    generateFileTypes,
    wrapRelationsAsType,
    showDefaultValues,
    generateZodSchemas,
    ...preAndSuffixes
  } = options;

  const transformers: Record<NamingStyle, (str: string) => string> = {
    camel,
    kebab,
    pascal,
    snake,
  };

  const transformFileNameCase = transformers[fileNamingStyle];

  const templateHelpers = makeHelpers({
    transformFileNameCase,
    transformClassNameCase: pascal,
    classValidation,
    outputType,
    noDependencies,
    definiteAssignmentAssertion,
    outputPath: output,
    prismaClientImportPath,
    requiredResponseApiProperty,
    outputApiPropertyType,
    wrapRelationsAsType,
    showDefaultValues,
    ...preAndSuffixes,
  });
  const allModels = dmmf.datamodel.models;

  const filteredTypes: Model[] = dmmf.datamodel.types
    .filter((model) => !isAnnotatedWith(model, DTO_IGNORE_MODEL))
    .map((model) => ({
      ...model,
      output: {
        dto: outputToNestJsResourceStructure
          ? flatResourceStructure
            ? path.join(output, transformFileNameCase(model.name))
            : path.join(output, transformFileNameCase(model.name), 'dto')
          : output,
        entity: '',
      },
    }));

  if (generateFileTypes === 'entity' && filteredTypes.length) {
    throw new Error(
      `Generating only Entity files while having complex types is not possible. Set 'generateFileTypes' to 'all' or 'dto'.`,
    );
  }

  const filteredModels: Model[] = allModels
    .filter((model) => !isAnnotatedWith(model, DTO_IGNORE_MODEL))
    // adds `output` information for each model, so we can compute relative import paths
    // this assumes that NestJS resource modules (more specifically their folders on disk) are named as `transformFileNameCase(model.name)`
    .map((model) => ({
      ...model,
      type: 'model',
      output: {
        dto: outputToNestJsResourceStructure
          ? flatResourceStructure
            ? path.join(output, transformFileNameCase(model.name))
            : path.join(output, transformFileNameCase(model.name), 'dto')
          : output,
        entity: outputToNestJsResourceStructure
          ? flatResourceStructure
            ? path.join(output, transformFileNameCase(model.name))
            : path.join(output, transformFileNameCase(model.name), 'entities')
          : output,
      },
    }));

  const enumFiles: WriteableFileSpecs[] = [];
  if (noDependencies) {
    if (dmmf.datamodel.enums.length) {
      logger('Processing enums');
      enumFiles.push({
        fileName: path.join(output, 'enums.ts'),
        content: generateEnums(dmmf.datamodel.enums),
      });
    }
  }

  const typeFiles = filteredTypes.map((model) => {
    logger(`Processing Type ${model.name}`);

    const typeParams = computeTypeParams({
      model,
      allModels: filteredTypes,
      templateHelpers,
    });

    // generate create-model.dto.ts
    const createDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.createDtoFilename(model.name, true),
      ),
      content: generateCreateDto({
        ...typeParams.create,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };

    // generate update-model.dto.ts
    const updateDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.updateDtoFilename(model.name, true),
      ),
      content: generateUpdateDto({
        ...typeParams.update,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };

    // generate model.dto.ts
    const plainDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.plainDtoFilename(model.name, true),
      ),
      content: generatePlainDto({
        ...typeParams.plain,
        templateHelpers,
      }),
    };

    const files = [createDto, updateDto, plainDto];

    // Generate Zod schemas for types if enabled
    if (generateZodSchemas) {
      const zodTypeParams = computeZodTypeParams({
        model,
        allModels: filteredTypes,
        templateHelpers,
      });

      files.push({
        fileName: path.join(
          model.output.dto,
          templateHelpers.createZodSchemaFilename(model.name, true),
        ),
        content: generateCreateZodSchema({
          ...zodTypeParams.create,
          templateHelpers,
        }),
      });

      files.push({
        fileName: path.join(
          model.output.dto,
          templateHelpers.updateZodSchemaFilename(model.name, true),
        ),
        content: generateUpdateZodSchema({
          ...zodTypeParams.update,
          templateHelpers,
        }),
      });

      files.push({
        fileName: path.join(
          model.output.dto,
          templateHelpers.plainZodSchemaFilename(model.name, true),
        ),
        content: generatePlainZodSchema({
          ...zodTypeParams.plain,
          templateHelpers,
        }),
      });
    }

    return files;
  });

  const modelFiles = filteredModels.map((model) => {
    logger(`Processing Model ${model.name}`);

    const modelParams = computeModelParams({
      model,
      allModels: [...filteredTypes, ...filteredModels],
      templateHelpers,
    });

    // generate connect-model.dto.ts
    const connectDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.connectDtoFilename(model.name, true),
      ),
      content: generateConnectDto({
        ...modelParams.connect,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };

    // generate create-model.dto.ts
    const createDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.createDtoFilename(model.name, true),
      ),
      content: generateCreateDto({
        ...modelParams.create,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };
    // TODO generate create-model.struct.ts

    // generate update-model.dto.ts
    const updateDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.updateDtoFilename(model.name, true),
      ),
      content: generateUpdateDto({
        ...modelParams.update,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };
    // TODO generate update-model.struct.ts

    // generate model.entity.ts
    const entity = {
      fileName: path.join(
        model.output.entity,
        templateHelpers.entityFilename(model.name, true),
      ),
      content: generateEntity({
        ...modelParams.entity,
        templateHelpers,
      }),
    };
    // TODO generate model.struct.ts

    // generate model.dto.ts
    const plainDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.plainDtoFilename(model.name, true),
      ),
      content: generatePlainDto({
        ...modelParams.plain,
        templateHelpers,
      }),
    };

    let files: WriteableFileSpecs[];
    switch (generateFileTypes) {
      case 'all':
        files = [connectDto, createDto, updateDto, entity, plainDto];
        break;
      case 'dto':
        files = [connectDto, createDto, updateDto, plainDto];
        break;
      case 'entity':
        files = [entity];
        break;
      default:
        throw new Error(`Unknown 'generateFileTypes' value.`);
    }

    // Generate Zod schemas for models if enabled
    if (generateZodSchemas) {
      const zodModelParams = computeZodModelParams({
        model,
        allModels: [...filteredTypes, ...filteredModels],
        templateHelpers,
      });

      // Connect schema
      if (generateFileTypes !== 'entity') {
        files.push({
          fileName: path.join(
            model.output.dto,
            templateHelpers.connectZodSchemaFilename(model.name, true),
          ),
          content: generateConnectZodSchema({
            ...zodModelParams.connect,
            templateHelpers,
          }),
        });

        // Create schema
        files.push({
          fileName: path.join(
            model.output.dto,
            templateHelpers.createZodSchemaFilename(model.name, true),
          ),
          content: generateCreateZodSchema({
            ...zodModelParams.create,
            templateHelpers,
          }),
        });

        // Update schema
        files.push({
          fileName: path.join(
            model.output.dto,
            templateHelpers.updateZodSchemaFilename(model.name, true),
          ),
          content: generateUpdateZodSchema({
            ...zodModelParams.update,
            templateHelpers,
          }),
        });

        // Plain schema
        files.push({
          fileName: path.join(
            model.output.dto,
            templateHelpers.plainZodSchemaFilename(model.name, true),
          ),
          content: generatePlainZodSchema({
            ...zodModelParams.plain,
            templateHelpers,
          }),
        });
      }

      // Entity schema (always generate if generateZodSchemas is true)
      if (generateFileTypes === 'all' || generateFileTypes === 'entity') {
        files.push({
          fileName: path.join(
            model.output.entity,
            templateHelpers.entityZodSchemaFilename(model.name, true),
          ),
          content: generateEntityZodSchema({
            ...zodModelParams.entity,
            templateHelpers,
          }),
        });
      }
    }

    return files;
  });

  return [...typeFiles, ...modelFiles, ...enumFiles].flat();
};
