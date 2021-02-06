import { ExecutionPatchResult, ExecutionResult, GraphQLResolveInfo, responsePathAsArray } from 'graphql';

import { AsyncExecutionResult } from '@graphql-tools/utils';
import { InMemoryPubSub } from '@graphql-tools/pubsub';

import { DelegationContext, ExternalObject } from './types';
import { getReceiver, getSubschema, getUnpathedErrors } from './externalObjects';
import { resolveExternalValue } from './resolveExternalValue';
import { externalValueFromResult, externalValueFromPatchResult } from './externalValues';
import DataLoader from 'dataloader';

export class Receiver {
  private readonly asyncIterable: AsyncIterable<AsyncExecutionResult>;
  private readonly delegationContext: DelegationContext;
  private readonly fieldName: string;
  private readonly context: Record<string, any>;
  private readonly resultTransformer: (originalResult: ExecutionResult) => any;
  private readonly initialResultDepth: number;
  private readonly pubsub: InMemoryPubSub<ExternalObject>;
  private externalValues: Record<string, Array<any>>;
  private loaders: Record<string, DataLoader<GraphQLResolveInfo, any>>;
  private infos: Record<string, Record<string, GraphQLResolveInfo>>;
  private iterating: boolean;
  private numRequests: number;

  constructor(
    asyncIterable: AsyncIterable<AsyncExecutionResult>,
    delegationContext: DelegationContext,
    resultTransformer: (originalResult: ExecutionResult) => any
  ) {
    this.asyncIterable = asyncIterable;

    this.delegationContext = delegationContext;
    const { fieldName, context, info } = delegationContext;

    this.fieldName = fieldName;
    this.context = context;

    this.resultTransformer = resultTransformer;
    this.initialResultDepth = info ? responsePathAsArray(info.path).length - 1 : 0;
    this.pubsub = new InMemoryPubSub();

    this.externalValues = Object.create(null);
    this.loaders = Object.create(null);
    this.infos = Object.create(null);
    this.iterating = false;
    this.numRequests = 0;
  }

  public async getInitialResult(): Promise<ExecutionResult> {
    const asyncIterator = this.asyncIterable[Symbol.asyncIterator]();
    const payload = await asyncIterator.next();
    const initialResult = externalValueFromResult(this.resultTransformer(payload.value), this.delegationContext, this);
    this.externalValues[this.fieldName] = [initialResult];
    return initialResult;
  }

  public request(info: GraphQLResolveInfo): Promise<any> {
    const path = responsePathAsArray(info.path).slice(this.initialResultDepth);
    const pathKey = path.join('.');
    let loader = this.loaders[pathKey];

    if (loader === undefined) {
      loader = this.loaders[pathKey] = new DataLoader(infos => this._request(path, pathKey, infos));
    }

    return loader.load(info);
  }

  private async _request(
    path: Array<string | number>,
    pathKey: string,
    infos: ReadonlyArray<GraphQLResolveInfo>
  ): Promise<any> {
    const parentPath = path.slice();
    const responseKey = parentPath.pop() as string;
    const parentKey = parentPath.join('.');

    const combinedInfo: GraphQLResolveInfo = {
      ...infos[0],
      fieldNodes: [].concat(...infos.map(info => info.fieldNodes)),
    };

    let infosByParentKey = this.infos[parentKey];
    if (infosByParentKey === undefined) {
      infosByParentKey = this.infos[parentKey] = Object.create(null);
    }
    infosByParentKey[responseKey] = combinedInfo;

    const parents = this.externalValues[parentKey];
    if (parents !== undefined) {
      parents.forEach(parent => {
        const data = parent[responseKey];
        if (data !== undefined) {
          const unpathedErrors = getUnpathedErrors(parent);
          const subschema = getSubschema(parent, responseKey);
          const receiver = getReceiver(parent, subschema);
          this.onNewExternalValue(
            pathKey,
            resolveExternalValue(data, unpathedErrors, subschema, this.context, combinedInfo, receiver)
          );
        }
      });
    }

    const newExternalValue = this.externalValues[pathKey];
    if (newExternalValue !== undefined) {
      return newExternalValue;
    }

    const asyncIterable = this.pubsub.subscribe(pathKey);

    this.numRequests++;
    if (!this.iterating) {
      this._iterate();
    }

    const payload = await asyncIterable.next();
    this.numRequests--;

    return new Array(infos.length).fill(payload.value);
  }

  private async _iterate(): Promise<void> {
    this.iterating = true;
    const iterator = this.asyncIterable[Symbol.asyncIterator]();

    let hasNext = true;
    while (hasNext && this.numRequests) {
      const payload = (await iterator.next()) as IteratorResult<ExecutionPatchResult, ExecutionPatchResult>;

      hasNext = !payload.done;
      const asyncResult = payload.value;

      if (asyncResult != null && asyncResult.path?.[0] === this.fieldName) {
        const transformedResult = this.resultTransformer(asyncResult);
        const newExternalValue = externalValueFromPatchResult(transformedResult, this.delegationContext, this);

        const pathKey = asyncResult.path.join('.');

        this.onNewExternalValue(pathKey, newExternalValue);
      }
    }
    this.iterating = false;

    if (!hasNext) {
      this.pubsub.close();
    }
  }

  private onNewExternalValue(pathKey: string, newExternalValue: any): void {
    const externalValues = this.externalValues[pathKey];
    if (externalValues === undefined) {
      this.externalValues[pathKey] = [newExternalValue];
    } else {
      externalValues.push(newExternalValue);
    }

    const infosByParentKey = this.infos[pathKey];
    if (infosByParentKey !== undefined) {
      const unpathedErrors = getUnpathedErrors(newExternalValue);
      Object.keys(infosByParentKey).forEach(responseKey => {
        const info = infosByParentKey[responseKey];
        const data = newExternalValue[responseKey];
        if (data !== undefined) {
          const subschema = getSubschema(newExternalValue, responseKey);
          const receiver = getReceiver(newExternalValue, subschema);
          const subExternalValue = resolveExternalValue(data, unpathedErrors, subschema, this.context, info, receiver);
          const subPathKey = `${pathKey}.${responseKey}`;
          this.onNewExternalValue(subPathKey, subExternalValue);
        }
      });
    }

    this.pubsub.publish(pathKey, newExternalValue);
  }
}
