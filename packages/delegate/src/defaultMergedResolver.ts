import {
  FieldNode,
  GraphQLObjectType,
  GraphQLResolveInfo,
  Kind,
  SelectionNode,
  SelectionSetNode,
  defaultFieldResolver,
  responsePathAsArray,
  getNamedType,
  GraphQLSchema,
  print,
  GraphQLFieldMap,
} from 'graphql';

import isPromise from 'is-promise';

import DataLoader from 'dataloader';

import { collectFields, getResponseKeyFromInfo, GraphQLExecutionContext } from '@graphql-tools/utils';

import { ExternalObject, MergedTypeInfo, StitchingInfo } from './types';

import { resolveExternalValue } from './resolveExternalValue';
import { getInfo, getReceiver, getSubschema, getUnpathedErrors, isExternalObject , mergeExternalObjects } from './externalObjects';

import { memoize4, memoize3, memoize2 } from './memoize';

import { Subschema } from './Subschema';
import { isSubschemaConfig } from './subschemaConfig';

const loaders: WeakMap<any, DataLoader<GraphQLResolveInfo, Promise<ExternalObject>>> = new WeakMap();

async function getFields(
  parent: ExternalObject,
  schema: GraphQLSchema,
  subschema: Subschema,
  typeSelectionSet: SelectionSetNode,
  fieldSelectionSets: Record<string, SelectionSetNode>,
  mergedTypeInfo: MergedTypeInfo,
  typeName: string,
  sourceSubschemaFields: GraphQLFieldMap<any, any>,
  targetSubschemas: Array<Subschema>,
  context: Record<string, any>,
  infos: ReadonlyArray<GraphQLResolveInfo>
): Promise<Array<Promise<ExternalObject>>> {
  let fieldNodes: Array<FieldNode> = [].concat(...infos.map(info => info.fieldNodes));

  const keyFieldNodes: Map<string, FieldNode> = new Map();

  const type = schema.getType(typeName) as GraphQLObjectType;

  if (typeSelectionSet !== undefined) {
    addSelectionSetToMap(keyFieldNodes, schema, type, sourceSubschemaFields, typeSelectionSet);
  }

  infos.forEach(info => {
    const fieldName = info.fieldName;
    const fieldSelectionSet = fieldSelectionSets[fieldName];
    if (fieldSelectionSet !== undefined) {
      addSelectionSetToMap(keyFieldNodes, schema, type, sourceSubschemaFields, fieldSelectionSet);
    }
  });

  fieldNodes = fieldNodes.concat(...Array.from(keyFieldNodes.values()));

  const parentInfo = getInfo(parent);

  const mergedParents = getMergedParents(
    mergedTypeInfo,
    parent,
    fieldNodes,
    subschema,
    targetSubschemas,
    context,
    parentInfo
  );

  return infos.map(info => {
    const responseKey = getResponseKeyFromInfo(info);
    return mergedParents[responseKey].then(mergedParent => resolveField(mergedParent, responseKey, context, info));
  });
}

function resolveField(
  parent: ExternalObject,
  responseKey: string,
  context: Record<string, any>,
  info: GraphQLResolveInfo
): any {
  const data = parent[responseKey];
  const fieldSubschema = getSubschema(parent, responseKey);
  const receiver = getReceiver(parent, fieldSubschema);

  if (data !== undefined) {
    const unpathedErrors = getUnpathedErrors(parent);
    return resolveExternalValue(data, unpathedErrors, fieldSubschema, context, info, receiver);
  }

  if (receiver !== undefined) {
    return receiver.request(info);
  }

  // throw error?
  
}

function getLoader(
  parent: ExternalObject,
  schema: GraphQLSchema,
  subschema: Subschema,
  typeSelectionSet: SelectionSetNode,
  fieldSelectionSets: Record<string, SelectionSetNode>,
  mergedTypeInfo: MergedTypeInfo,
  typeName: string,
  sourceSubschemaFields: GraphQLFieldMap<any, any>,
  targetSubschemas: Array<Subschema>,
  context: Record<string, any>
): DataLoader<GraphQLResolveInfo, any> {
  let loader = loaders.get(parent);
  if (loader === undefined) {
    loader = new DataLoader(infos =>
      getFields(
        parent,
        schema,
        subschema,
        typeSelectionSet,
        fieldSelectionSets,
        mergedTypeInfo,
        typeName,
        sourceSubschemaFields,
        targetSubschemas,
        context,
        infos
      )
    );
    loaders.set(parent, loader);
  }
  return loader;
}

/**
 * Resolver that knows how to:
 * a) handle aliases for proxied schemas
 * b) handle errors from proxied schemas
 * c) handle external to internal enum/scalar conversion
 * d) handle type merging
 * e) handle deferred values
 */
export function defaultMergedResolver(
  parent: ExternalObject,
  args: Record<string, any>,
  context: Record<string, any>,
  info: GraphQLResolveInfo
): any {
  if (!parent) {
    return null;
  }

  const responseKey = getResponseKeyFromInfo(info);

  // check to see if parent is not a proxied result, i.e. if parent resolver was manually overwritten
  // See https://github.com/apollographql/graphql-tools/issues/967
  if (!isExternalObject(parent)) {
    return defaultFieldResolver(parent, args, context, info);
  }

  const subschema = getSubschema(parent);

  const data = parent[responseKey];
  if (data !== undefined) {
    const unpathedErrors = getUnpathedErrors(parent);
    const receiver = getReceiver(parent, subschema);
    return resolveExternalValue(data, unpathedErrors, subschema, context, info, receiver);
  }

  const schema = isSubschemaConfig(subschema)
    ? (subschema as Subschema)?.transformedSchema ?? subschema.schema
    : subschema;
  const parentTypeName = info.parentType.name;
  const parentType = schema.getType(parentTypeName) as GraphQLObjectType;
  const sourceSubschemaFields = parentType.getFields();

  const fieldName = info.fieldNodes[0].name.value;
  if (fieldName in sourceSubschemaFields) {
    const receiver = getReceiver(parent, subschema);
    if (receiver !== undefined) {
      return receiver.request(info);
    }
    // throw error?
    return;
  }

  const stitchingInfo: StitchingInfo = info?.schema.extensions?.stitchingInfo;
  const mergedTypeInfo = info?.schema.extensions?.stitchingInfo.mergedTypes[parentTypeName];
  if (mergedTypeInfo === undefined) {
    // throw error?
    return;
  }

  const targetSubschemas = mergedTypeInfo.targetSubschemas.get(subschema as Subschema);
  if (targetSubschemas === undefined || targetSubschemas.length === 0) {
    // throw error?
    return;
  }

  const loader = getLoader(
    parent,
    info.schema,
    // In the stitching context, all subschemas are compiled Subschema objects rather than SubschemaConfig objects
    subschema as Subschema,
    stitchingInfo?.selectionSetsByType?.[parentTypeName],
    stitchingInfo?.selectionSetsByField?.[parentTypeName],
    mergedTypeInfo,
    parentTypeName,
    sourceSubschemaFields,
    targetSubschemas,
    context
  );
  return loader.load(info);
}

const sortSubschemasByProxiability = memoize4(function (
  mergedTypeInfo: MergedTypeInfo,
  sourceSubschemaOrSourceSubschemas: Subschema | Array<Subschema>,
  targetSubschemas: Array<Subschema>,
  fieldNodes: Array<FieldNode>
): {
  proxiableSubschemas: Array<Subschema>;
  nonProxiableSubschemas: Array<Subschema>;
} {
  // 1.  calculate if possible to delegate to given subschema

  const proxiableSubschemas: Array<Subschema> = [];
  const nonProxiableSubschemas: Array<Subschema> = [];

  targetSubschemas.forEach(t => {
    const selectionSet = mergedTypeInfo.selectionSets.get(t);
    const fieldSelectionSets = mergedTypeInfo.fieldSelectionSets.get(t);
    if (
      selectionSet != null &&
      !subschemaTypesContainSelectionSet(mergedTypeInfo, sourceSubschemaOrSourceSubschemas, selectionSet)
    ) {
      nonProxiableSubschemas.push(t);
    } else {
      if (
        fieldSelectionSets == null ||
        fieldNodes.every(fieldNode => {
          const fieldName = fieldNode.name.value;
          const fieldSelectionSet = fieldSelectionSets[fieldName];
          return (
            fieldSelectionSet == null ||
            subschemaTypesContainSelectionSet(mergedTypeInfo, sourceSubschemaOrSourceSubschemas, fieldSelectionSet)
          );
        })
      ) {
        proxiableSubschemas.push(t);
      } else {
        nonProxiableSubschemas.push(t);
      }
    }
  });

  return {
    proxiableSubschemas,
    nonProxiableSubschemas,
  };
});

const buildDelegationPlan = memoize3(function (
  mergedTypeInfo: MergedTypeInfo,
  fieldNodes: Array<FieldNode>,
  proxiableSubschemas: Array<Subschema>
): {
  delegationMap: Map<Subschema, SelectionSetNode>;
  proxiableFieldNodes: Array<FieldNode>;
  unproxiableFieldNodes: Array<FieldNode>;
} {
  const { uniqueFields, nonUniqueFields } = mergedTypeInfo;
  const proxiableFieldNodes: Array<FieldNode> = [];
  const unproxiableFieldNodes: Array<FieldNode> = [];

  // 2. for each selection:

  const delegationMap: Map<Subschema, Array<SelectionNode>> = new Map();
  fieldNodes.forEach(fieldNode => {
    if (fieldNode.name.value === '__typename') {
      return;
    }

    // 2a. use uniqueFields map to assign fields to subschema if one of possible subschemas

    const uniqueSubschema: Subschema = uniqueFields[fieldNode.name.value];
    if (uniqueSubschema != null) {
      if (!proxiableSubschemas.includes(uniqueSubschema)) {
        unproxiableFieldNodes.push(fieldNode);
        return;
      }

      proxiableFieldNodes.push(fieldNode);
      const existingSubschema = delegationMap.get(uniqueSubschema);
      if (existingSubschema != null) {
        existingSubschema.push(fieldNode);
      } else {
        delegationMap.set(uniqueSubschema, [fieldNode]);
      }

      return;
    }

    // 2b. use nonUniqueFields to assign to a possible subschema,
    //     preferring one of the subschemas already targets of delegation

    let nonUniqueSubschemas: Array<Subschema> = nonUniqueFields[fieldNode.name.value];
    if (nonUniqueSubschemas == null) {
      unproxiableFieldNodes.push(fieldNode);
      return;
    }

    nonUniqueSubschemas = nonUniqueSubschemas.filter(s => proxiableSubschemas.includes(s));
    if (!nonUniqueSubschemas.length) {
      unproxiableFieldNodes.push(fieldNode);
      return;
    }

    proxiableFieldNodes.push(fieldNode);
    const existingSubschema = nonUniqueSubschemas.find(s => delegationMap.has(s));
    if (existingSubschema != null) {
      delegationMap.get(existingSubschema).push(fieldNode);
    } else {
      delegationMap.set(nonUniqueSubschemas[0], [fieldNode]);
    }
  });

  const finalDelegationMap: Map<Subschema, SelectionSetNode> = new Map();

  delegationMap.forEach((selections, subschema) => {
    finalDelegationMap.set(subschema, {
      kind: Kind.SELECTION_SET,
      selections,
    });
  });

  return {
    delegationMap: finalDelegationMap,
    proxiableFieldNodes,
    unproxiableFieldNodes,
  };
});

const combineSubschemas = memoize2(function (
  subschemaOrSubschemas: Subschema | Array<Subschema>,
  additionalSubschemas: Array<Subschema>
): Array<Subschema> {
  return Array.isArray(subschemaOrSubschemas)
    ? subschemaOrSubschemas.concat(additionalSubschemas)
    : [subschemaOrSubschemas].concat(additionalSubschemas);
});

function getMergedParents(
  mergedTypeInfo: MergedTypeInfo,
  object: any,
  fieldNodes: Array<FieldNode>,
  sourceSubschemaOrSourceSubschemas: Subschema | Array<Subschema>,
  targetSubschemas: Array<Subschema>,
  context: Record<string, any>,
  info: GraphQLResolveInfo
): Record<string, Promise<ExternalObject>> {
  if (!fieldNodes.length) {
    return undefined;
  }

  const { proxiableSubschemas, nonProxiableSubschemas } = sortSubschemasByProxiability(
    mergedTypeInfo,
    sourceSubschemaOrSourceSubschemas,
    targetSubschemas,
    fieldNodes
  );

  const { delegationMap, proxiableFieldNodes, unproxiableFieldNodes } = buildDelegationPlan(
    mergedTypeInfo,
    fieldNodes,
    proxiableSubschemas
  );

  if (!delegationMap.size) {
    return object;
  }

  const resultMap: Map<Promise<any> | any, SelectionSetNode> = new Map();
  delegationMap.forEach((selectionSet: SelectionSetNode, s: Subschema) => {
    const resolver = mergedTypeInfo.resolvers.get(s);
    let maybePromise = resolver(object, context, info, s, selectionSet);
    if (isPromise(maybePromise)) {
      maybePromise = maybePromise.then(undefined, error => error);
    }
    resultMap.set(maybePromise, selectionSet);
  });

  const promise = Promise.all(resultMap.keys()).then(results =>
    mergeExternalObjects(
      info.schema,
      responsePathAsArray(info.path),
      object.__typename,
      object,
      results,
      Array.from(resultMap.values())
    )
  );

  const result = Object.create(null);
  proxiableFieldNodes.forEach(fieldNode => {
    const responseKey = fieldNode.alias?.value ?? fieldNode.name.value;
    result[responseKey] = promise;
  });

  const nextPromise = promise.then(mergedParent =>
    getMergedParents(
      mergedTypeInfo,
      mergedParent,
      unproxiableFieldNodes,
      combineSubschemas(sourceSubschemaOrSourceSubschemas, proxiableSubschemas),
      nonProxiableSubschemas,
      context,
      info
    )
  );

  unproxiableFieldNodes.forEach(fieldNode => {
    const responseKey = fieldNode.alias?.value ?? fieldNode.name.value;
    result[responseKey] = nextPromise.then(nextParent => nextParent?.[responseKey]);
  });

  return result;
}

const subschemaTypesContainSelectionSet = memoize3(function (
  mergedTypeInfo: MergedTypeInfo,
  sourceSubschemaOrSourceSubschemas: Subschema | Array<Subschema>,
  selectionSet: SelectionSetNode
) {
  if (Array.isArray(sourceSubschemaOrSourceSubschemas)) {
    return typesContainSelectionSet(
      sourceSubschemaOrSourceSubschemas.map(
        sourceSubschema => sourceSubschema.transformedSchema.getType(mergedTypeInfo.typeName) as GraphQLObjectType
      ),
      selectionSet
    );
  }

  return typesContainSelectionSet(
    [sourceSubschemaOrSourceSubschemas.transformedSchema.getType(mergedTypeInfo.typeName) as GraphQLObjectType],
    selectionSet
  );
});

function typesContainSelectionSet(types: Array<GraphQLObjectType>, selectionSet: SelectionSetNode): boolean {
  const fieldMaps = types.map(type => type.getFields());

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const fields = fieldMaps.map(fieldMap => fieldMap[selection.name.value]).filter(field => field != null);
      if (!fields.length) {
        return false;
      }

      if (selection.selectionSet != null) {
        return typesContainSelectionSet(
          fields.map(field => getNamedType(field.type)) as Array<GraphQLObjectType>,
          selection.selectionSet
        );
      }
    } else if (selection.kind === Kind.INLINE_FRAGMENT && selection.typeCondition.name.value === types[0].name) {
      return typesContainSelectionSet(types, selection.selectionSet);
    }
  }

  return true;
}

function addSelectionSetToMap(
  map: Map<string, FieldNode>,
  schema: GraphQLSchema,
  type: GraphQLObjectType,
  fields: GraphQLFieldMap<any, any>,
  selectionSet: SelectionSetNode
): void {
  const partialExecutionContext = ({
    schema,
    variableValues: Object.create(null),
    fragments: Object.create(null),
  } as unknown) as GraphQLExecutionContext;
  const responseKeys = collectFields(
    partialExecutionContext,
    type,
    selectionSet,
    Object.create(null),
    Object.create(null)
  );

  Object.values(responseKeys).forEach(fieldNodes => {
    const fieldName = fieldNodes[0].name.value;
    if (!(fieldName in fields)) {
      fieldNodes.forEach(fieldNode => {
        const key = print(fieldNode);
        if (!map.has(key)) {
          map.set(key, fieldNode);
        }
      });
    }
  });
}
