import { SubschemaConfigTransform } from 'packages/graphql-tools/src';
import { computedDirectiveTransformer } from './computedDirectiveTransformer';

export { computedDirectiveTransformer } from './computedDirectiveTransformer';
export { isolateComputedFieldsTransformer } from './isolateComputedFieldsTransformer';
export { splitMergedTypeEntryPointsTransformer } from './splitMergedTypeEntryPointsTransformer';

export const defaultSubschemaConfigTransforms: Array<SubschemaConfigTransform<any>> = [
  computedDirectiveTransformer('computed'),
];
