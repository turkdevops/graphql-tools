import { Transform, StitchingInfo, DelegationContext } from './types';

import AddSelectionSets from './transforms/AddSelectionSets';
import ExpandAbstractTypes from './transforms/ExpandAbstractTypes';
import WrapConcreteTypes from './transforms/WrapConcreteTypes';
import FilterToSchema from './transforms/FilterToSchema';
import AddTypename from './transforms/AddTypename';
import AddArgumentsAsVariables from './transforms/AddArgumentsAsVariables';

export function defaultDelegationBinding(delegationContext: DelegationContext): Array<Transform> {
  const delegationTransforms: Array<Transform> = [];

  const info = delegationContext.info;
  const stitchingInfo: StitchingInfo = info?.schema.extensions?.stitchingInfo;

  if (stitchingInfo != null) {
    delegationTransforms.push(
      new ExpandAbstractTypes(),
      new AddSelectionSets(
        stitchingInfo.selectionSetsByType,
        stitchingInfo.selectionSetsByField,
        stitchingInfo.dynamicSelectionSetsByField
      )
    );
  } else if (info != null) {
    delegationTransforms.push(new ExpandAbstractTypes());
  }

  delegationTransforms.push(new WrapConcreteTypes());

  const transforms = delegationContext.transforms;
  if (transforms != null) {
    delegationTransforms.push(...transforms.slice().reverse());
  }

  const args = delegationContext.args;
  if (args != null) {
    delegationTransforms.push(new AddArgumentsAsVariables(args));
  }

  delegationTransforms.push(new AddTypename(), new FilterToSchema());

  return delegationTransforms;
}
