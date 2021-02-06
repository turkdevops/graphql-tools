import { defaultFieldResolver, GraphQLResolveInfo } from 'graphql';

import { getResponseKeyFromInfo } from '@graphql-tools/utils';

import { resolveExternalValue } from './resolveExternalValue';
import { getReceiver, getSubschema, getUnpathedErrors, isExternalObject } from './externalObjects';
import { ExternalObject } from './types';

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

  const subschema = getSubschema(parent, responseKey);
  const receiver = getReceiver(parent, subschema);

  const data = parent[responseKey];
  if (data !== undefined) {
    const unpathedErrors = getUnpathedErrors(parent);
    return resolveExternalValue(data, unpathedErrors, subschema, context, info, receiver);
  }

  if (receiver !== undefined) {
    return receiver.request(info);
  }
}
