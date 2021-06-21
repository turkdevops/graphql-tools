import {
  DocumentNode,
  GraphQLNamedType,
  getNamedType,
  isNamedType,
  GraphQLDirective,
  SchemaDefinitionNode,
  SchemaExtensionNode,
  isSpecifiedScalarType,
  GraphQLSchema,
} from 'graphql';

import { wrapSchema } from '@graphql-tools/wrap';
import { Subschema, SubschemaConfig, StitchingInfo } from '@graphql-tools/delegate';
import { GraphQLParseOptions, ITypeDefinitions, rewireTypes, TypeMap } from '@graphql-tools/utils';
import { buildDocumentFromTypeDefinitions } from '@graphql-tools/schema';

import typeFromAST from './typeFromAST';
import { MergeTypeCandidate, MergeTypeFilter, OnTypeConflict, TypeMergingOptions } from './types';
import { mergeCandidates } from './mergeCandidates';
import { extractDefinitions } from './definitions';

type CandidateSelector<TContext = Record<string, any>> = (
  candidates: Array<MergeTypeCandidate<TContext>>
) => MergeTypeCandidate<TContext>;

export function buildTypeCandidates<TContext = Record<string, any>>({
  subschemas,
  originalSubschemaMap,
  types,
  typeDefs,
  parseOptions,
  extensions,
  directiveMap,
  schemaDefs,
  operationTypeNames,
  mergeDirectives,
}: {
  subschemas: Array<Subschema<any, any, any, TContext>>;
  originalSubschemaMap: Map<
    Subschema<any, any, any, TContext>,
    GraphQLSchema | SubschemaConfig<any, any, any, TContext>
  >;
  types: Array<GraphQLNamedType>;
  typeDefs: ITypeDefinitions | undefined;
  parseOptions: GraphQLParseOptions;
  extensions: Array<DocumentNode>;
  directiveMap: Record<string, GraphQLDirective>;
  schemaDefs: {
    schemaDef: SchemaDefinitionNode;
    schemaExtensions: Array<SchemaExtensionNode>;
  };
  operationTypeNames: Record<string, any>;
  mergeDirectives?: boolean | undefined;
}): Record<string, Array<MergeTypeCandidate<TContext>>> {
  const typeCandidates: Record<string, Array<MergeTypeCandidate<TContext>>> = Object.create(null);

  let schemaDef: SchemaDefinitionNode | undefined;
  let schemaExtensions: Array<SchemaExtensionNode> = [];

  let document: DocumentNode | undefined;
  let extraction: ReturnType<typeof extractDefinitions> | undefined;
  if ((typeDefs && !Array.isArray(typeDefs)) || (Array.isArray(typeDefs) && typeDefs.length)) {
    document = buildDocumentFromTypeDefinitions(typeDefs, parseOptions);
    extraction = extractDefinitions(document);
    schemaDef = extraction.schemaDefs[0];
    schemaExtensions = schemaExtensions.concat(extraction.schemaExtensions);
  }

  schemaDefs.schemaDef = schemaDef ?? schemaDefs.schemaDef;
  schemaDefs.schemaExtensions = schemaExtensions;

  setOperationTypeNames(schemaDefs, operationTypeNames);

  subschemas.forEach(subschema => {
    const schema = wrapSchema(subschema);

    const operationTypes = {
      query: schema.getQueryType(),
      mutation: schema.getMutationType(),
      subscription: schema.getSubscriptionType(),
    };

    Object.keys(operationTypes).forEach(operationType => {
      if (operationTypes[operationType] != null) {
        addTypeCandidate(typeCandidates, operationTypeNames[operationType], {
          type: operationTypes[operationType],
          subschema: originalSubschemaMap.get(subschema),
          transformedSubschema: subschema,
        });
      }
    });

    if (mergeDirectives === true) {
      schema.getDirectives().forEach(directive => {
        directiveMap[directive.name] = directive;
      });
    }

    const originalTypeMap = schema.getTypeMap();
    Object.keys(originalTypeMap).forEach(typeName => {
      const type: GraphQLNamedType = originalTypeMap[typeName];
      if (
        isNamedType(type) &&
        getNamedType(type).name.slice(0, 2) !== '__' &&
        type !== operationTypes.query &&
        type !== operationTypes.mutation &&
        type !== operationTypes.subscription
      ) {
        addTypeCandidate(typeCandidates, type.name, {
          type,
          subschema: originalSubschemaMap.get(subschema),
          transformedSubschema: subschema,
        });
      }
    });
  });

  if (document != null && extraction != null) {
    extraction.typeDefinitions.forEach(def => {
      const type = typeFromAST(def) as GraphQLNamedType;
      if (type != null) {
        addTypeCandidate(typeCandidates, type.name, { type });
      }
    });

    extraction.directiveDefs.forEach(def => {
      const directive = typeFromAST(def) as GraphQLDirective;
      directiveMap[directive.name] = directive;
    });

    if (extraction.extensionDefs.length > 0) {
      extensions.push({
        ...document,
        definitions: extraction.extensionDefs,
      });
    }
  }

  types.forEach(type => addTypeCandidate(typeCandidates, type.name, { type }));

  return typeCandidates;
}

function setOperationTypeNames(
  {
    schemaDef,
    schemaExtensions,
  }: {
    schemaDef: SchemaDefinitionNode;
    schemaExtensions: Array<SchemaExtensionNode>;
  },
  operationTypeNames: Record<string, any>
): void {
  const allNodes: Array<SchemaDefinitionNode | SchemaExtensionNode> = schemaExtensions.slice();
  if (schemaDef != null) {
    allNodes.unshift(schemaDef);
  }

  allNodes.forEach(node => {
    if (node.operationTypes != null) {
      node.operationTypes.forEach(operationType => {
        operationTypeNames[operationType.operation] = operationType.type.name.value;
      });
    }
  });
}

function addTypeCandidate<TContext = Record<string, any>>(
  typeCandidates: Record<string, Array<MergeTypeCandidate<TContext>>>,
  name: string,
  typeCandidate: MergeTypeCandidate<TContext>
) {
  if (!(name in typeCandidates)) {
    typeCandidates[name] = [];
  }
  typeCandidates[name].push(typeCandidate);
}

export function buildTypes<TContext = Record<string, any>>({
  typeCandidates,
  directives,
  stitchingInfo,
  operationTypeNames,
  onTypeConflict,
  mergeTypes,
  typeMergingOptions,
}: {
  typeCandidates: Record<string, Array<MergeTypeCandidate<TContext>>>;
  directives: Array<GraphQLDirective>;
  stitchingInfo: StitchingInfo<TContext>;
  operationTypeNames: Record<string, any>;
  onTypeConflict?: OnTypeConflict<TContext>;
  mergeTypes: boolean | Array<string> | MergeTypeFilter<TContext>;
  typeMergingOptions?: TypeMergingOptions<TContext>;
}): { typeMap: TypeMap; directives: Array<GraphQLDirective> } {
  const typeMap: TypeMap = Object.create(null);

  Object.keys(typeCandidates).forEach(typeName => {
    if (
      typeName === operationTypeNames['query'] ||
      typeName === operationTypeNames['mutation'] ||
      typeName === operationTypeNames['subscription'] ||
      (mergeTypes === true && !typeCandidates[typeName].some(candidate => isSpecifiedScalarType(candidate.type))) ||
      (typeof mergeTypes === 'function' && mergeTypes(typeCandidates[typeName], typeName)) ||
      (Array.isArray(mergeTypes) && mergeTypes.includes(typeName)) ||
      (stitchingInfo != null && typeName in stitchingInfo.mergedTypes)
    ) {
      typeMap[typeName] = mergeCandidates(typeName, typeCandidates[typeName], typeMergingOptions);
    } else {
      const candidateSelector =
        onTypeConflict != null
          ? onTypeConflictToCandidateSelector(onTypeConflict)
          : (cands: Array<MergeTypeCandidate<TContext>>) => cands[cands.length - 1];
      typeMap[typeName] = candidateSelector(typeCandidates[typeName]).type;
    }
  });

  return rewireTypes(typeMap, directives);
}

function onTypeConflictToCandidateSelector<TContext = Record<string, any>>(
  onTypeConflict: OnTypeConflict<TContext>
): CandidateSelector<TContext> {
  return cands =>
    cands.reduce((prev, next) => {
      const type = onTypeConflict(prev.type, next.type, {
        left: {
          subschema: prev.subschema,
          transformedSubschema: prev.transformedSubschema,
        },
        right: {
          subschema: prev.subschema,
          transformedSubschema: prev.transformedSubschema,
        },
      });
      if (prev.type === type) {
        return prev;
      } else if (next.type === type) {
        return next;
      }
      return {
        schemaName: 'unknown',
        type,
      };
    });
}
