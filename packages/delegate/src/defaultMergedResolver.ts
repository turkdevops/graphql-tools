import { GraphQLObjectType, GraphQLResolveInfo, defaultFieldResolver } from 'graphql';

import { getResponseKeyFromInfo } from '@graphql-tools/utils';

import { ExternalObject } from './types';

import { resolveExternalValue } from './resolveExternalValue';
import { getReceiver, getSubschema, getUnpathedErrors, isExternalObject } from './externalObjects';

import { Subschema } from './Subschema';
import { isSubschemaConfig } from './subschemaConfig';
import { getMergedParent } from './getMergedParent';

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
  if (!isExternalObject(parent)) {
    return defaultFieldResolver(parent, args, context, info);
  }

  const subschema = getSubschema(parent);

  const responseKey = getResponseKeyFromInfo(info);
  const data = parent[responseKey];
  if (data !== undefined) {
    const unpathedErrors = getUnpathedErrors(parent);
    const receiver = getReceiver(parent, subschema);
    return resolveExternalValue(data, unpathedErrors, subschema, context, info, receiver);
  }

  // TODO: consider instead of formally checking whether the receiver will resolve,
  // we could race the original and merged receivers...
  const sourceSubschema = isSubschemaConfig(subschema)
    ? (subschema as Subschema)?.transformedSchema ?? subschema.schema
    : subschema;
  const parentTypeName = info.parentType.name;
  const parentType = sourceSubschema.getType(parentTypeName) as GraphQLObjectType;
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

  return getMergedParent(parent, context, info).then(mergedParent =>
    resolveField(mergedParent, responseKey, context, info)
  );
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
