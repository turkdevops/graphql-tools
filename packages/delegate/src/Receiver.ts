import {
  ExecutionPatchResult,
  ExecutionResult,
  GraphQLResolveInfo,
  GraphQLSchema,
  SelectionSetNode,
  responsePathAsArray,
} from 'graphql';

import { AsyncExecutionResult } from '@graphql-tools/utils';
import { InMemoryPubSub } from '@graphql-tools/pubsub';

import { DelegationContext, ExternalObject, SubschemaConfig } from './types';
import { getUnpathedErrors, mergeExternalObjects } from './externalObjects';
import { resolveExternalValue } from './resolveExternalValue';
import { externalValueFromResult } from './externalValueFromResult';

export class Receiver {
  private readonly asyncIterable: AsyncIterable<AsyncExecutionResult>;
  private readonly delegationContext: DelegationContext;
  private readonly fieldName: string;
  private readonly subschema: GraphQLSchema | SubschemaConfig;
  private readonly context: Record<string, any>;
  private readonly info: GraphQLResolveInfo;
  private readonly deferredSelectionSets: Record<string, SelectionSetNode>;
  private readonly resultTransformer: (originalResult: ExecutionResult) => any;
  private readonly initialResultDepth: number;
  private readonly pubsub: InMemoryPubSub<ExternalObject>;
  private externalValues: Record<string, any>;
  private iterating: boolean;
  private numRequests: number;

  constructor(
    asyncIterable: AsyncIterable<AsyncExecutionResult>,
    delegationContext: DelegationContext,
    resultTransformer: (originalResult: ExecutionResult) => any
  ) {
    this.asyncIterable = asyncIterable;

    this.delegationContext = delegationContext;
    const { fieldName, subschema, context, info, deferredSelectionSets } = delegationContext;

    this.fieldName = fieldName;
    this.subschema = subschema;
    this.context = context;
    this.info = info;
    this.deferredSelectionSets = deferredSelectionSets;

    this.resultTransformer = resultTransformer;
    this.initialResultDepth = info ? responsePathAsArray(info.path).length - 1 : 0;
    this.externalValues = Object.create(null);
    this.pubsub = new InMemoryPubSub();

    this.iterating = false;
    this.numRequests = 0;
  }

  public async getInitialResult(): Promise<ExecutionResult> {
    const asyncIterator = this.asyncIterable[Symbol.asyncIterator]();
    const payload = await asyncIterator.next();
    // TODO:
    // initial result probably also needs to be saved to external values
    return externalValueFromResult(this.resultTransformer(payload.value), this.delegationContext, this);
  }

  public async request(info: GraphQLResolveInfo): Promise<any> {
    const pathArray = responsePathAsArray(info.path).slice(this.initialResultDepth);
    const responseKey = pathArray.pop() as string;
    const pathKey = pathArray.join('.');

    const externalValue = this.externalValues[pathKey];
    if (externalValue != null) {
      const object = getValue(externalValue, pathArray);
      if (object !== undefined) {
        const data = object[responseKey];
        if (data !== undefined) {
          const unpathedErrors = getUnpathedErrors(object);
          return resolveExternalValue(data, unpathedErrors, this.subschema, this.context, info, this);
        }
      }
    }

    const asyncIterable = this.pubsub.subscribe(pathKey);

    this.numRequests++;
    if (!this.iterating) {
      this._iterate();
    }

    return this._reduce(asyncIterable, responseKey, info);
  }

  private async _reduce(
    asyncIterable: AsyncIterableIterator<ExternalObject>,
    responseKey: string,
    info: GraphQLResolveInfo
  ): Promise<any> {
    for await (const parent of asyncIterable) {
      const data = parent[responseKey];
      if (data !== undefined) {
        const unpathedErrors = getUnpathedErrors(parent);
        return resolveExternalValue(data, unpathedErrors, this.subschema, this.context, info, this);
      }
    }
  }

  private async _iterate(): Promise<void> {
    const iterator = this.asyncIterable[Symbol.asyncIterator]();

    let hasNext = true;
    while (hasNext && this.numRequests) {
      const payload = (await iterator.next()) as IteratorResult<ExecutionPatchResult, ExecutionPatchResult>;

      hasNext = !payload.done;
      const asyncResult = payload.value;

      // TODO:
      // if a payload arrives and contains a path that has already been requested,
      // that path must be shadow-requested and saved to external values
      if (asyncResult != null && asyncResult.label !== undefined && asyncResult.path?.[0] === this.fieldName) {
        const transformedResult = this.resultTransformer(asyncResult);
        const newExternalValue = externalValueFromResult(transformedResult, {
          ...this.delegationContext,
          skipTypeMerging: true,
        });

        const pathKey = asyncResult.path.join('.');
        this.pubsub.publish(pathKey, newExternalValue);

        const externalValue = this.externalValues[pathKey];
        if (externalValue != null) {
          this.externalValues[pathKey] = mergeExternalObjects(
            this.info.schema,
            asyncResult.path,
            externalValue.__typename,
            newExternalValue,
            [newExternalValue],
            [this.deferredSelectionSets[asyncResult.label]]
          );
        } else {
          this.externalValues[pathKey] = newExternalValue;
        }
      }
    }
  }
}

function getValue(object: any, path: ReadonlyArray<string | number>): any {
  const pathSegment = path[0];
  const data = object[pathSegment];
  if (path.length === 1 || data == null) {
    return data;
  } else {
    getValue(data, path.slice(1));
  }
}
