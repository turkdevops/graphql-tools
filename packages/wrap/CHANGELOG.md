# @graphql-tools/wrap

## 7.0.8

### Patch Changes

- 22a9f3da: fix(deps): follow package conventions on when to pin
- Updated dependencies [22a9f3da]
  - @graphql-tools/delegate@7.1.5
  - @graphql-tools/schema@7.1.5

## 7.0.7

### Patch Changes

- 36f19ddb: fix(TransformQuery): pass delegation context to query and result transformers for required flexibility
- Updated dependencies [dbdb78e0]
  - @graphql-tools/utils@7.8.1

## 7.0.6

### Patch Changes

- 61da3e82: use value-or-promise to streamline working with sync values or async promises
- Updated dependencies [61da3e82]
  - @graphql-tools/delegate@7.1.4
  - @graphql-tools/schema@7.1.4

## 7.0.5

### Patch Changes

- 270046a1: fix(TransformInputObjectFields): transform variables #2353
- Updated dependencies [270046a1]
  - @graphql-tools/utils@7.2.1

## 7.0.4

### Patch Changes

- 4240a959: enhance(wrap): use introspectSchema for both sync and async executors
- Updated dependencies [4240a959]
  - @graphql-tools/utils@7.1.4

## 7.0.3

### Patch Changes

- 21da6904: fix release
- Updated dependencies [21da6904]
  - @graphql-tools/schema@7.1.2
  - @graphql-tools/utils@7.1.2

## 7.0.2

### Patch Changes

- 9f60cad6: fix(transforms): don't add \_\_typename to subscriptions

  see:
  https://github.com/ardatan/graphql-tools/issues/2282
  https://github.com/graphql/graphql-js/pull/2861
  https://github.com/graphql/graphql-spec/pull/776

- Updated dependencies [1b730f80]
- Updated dependencies [29ead57c]
  - @graphql-tools/delegate@7.0.7

## 7.0.1

### Patch Changes

- 51e387c3: transformedSchema argument within transformSchema method of transforms should be optional. The HoistField transform incorrectly set it to non-optional, breaking Typescript builds -- presumably when used with strict compilation.

## 7.0.0

### Major Changes

- be1a1575: ## Breaking Changes:

  #### Schema Generation and Decoration API (`@graphql-tools/schema`)

  - Resolver validation options should now be set to `error`, `warn` or `ignore` rather than `true` or `false`. In previous versions, some of the validators caused errors to be thrown, while some issued warnings. This changes brings consistency to validator behavior.

  - The `allowResolversNotInSchema` has been renamed to `requireResolversToMatchSchema`, to harmonize the naming convention of all the validators. The default setting of `requireResolversToMatchSchema` is `error`, matching the previous behavior.

  #### Schema Delegation (`delegateToSchema` & `@graphql-tools/delegate`)

  - The `delegateToSchema` return value has matured and been formalized as an `ExternalObject`, in which all errors are integrated into the GraphQL response, preserving their initial path. Those advanced users accessing the result directly will note the change in error handling. This also allows for the deprecation of unnecessary helper functions including `slicedError`, `getErrors`, `getErrorsByPathSegment` functions. Only external errors with missing or invalid paths must still be preserved by annotating the remote object with special properties. The new `getUnpathedErrors` function is therefore necessary for retrieving only these errors. Note also the new `annotateExternalObject` and `mergeExternalObjects` functions, as well as the renaming of `handleResult` to `resolveExternalValue`.

  - Transform types and the `applySchemaTransforms` are now relocated to the `delegate` package; `applyRequestTransforms`/`applyResultTransforms` functions have been deprecated, however, as this functionality has been replaced since v6 by the `Transformer` abstraction.

  - The `transformRequest`/`transformResult` methods are now provided additional `delegationContext` and `transformationContext` arguments -- these were introduced in v6, but previously optional.

  - The `transformSchema` method may wish to create additional delegating resolvers and so it is now provided the `subschemaConfig` and final (non-executable) `transformedSchema` parameters. As in v6, the `transformSchema` is kicked off once to produce the non-executable version, and then, if a wrapping schema is being generated, proxying resolvers are created with access to the (non-executable) initial result. In v7, the individual `transformSchema` methods also get access to the result of the first run, if necessary, they can create additional wrapping schema proxying resolvers.

  - `applySchemaTransforms` parameters have been updated to match and support the `transformSchema` parameters above.

  #### Remote Schemas & Wrapping (`wrapSchema`, `makeRemoteExecutableSchema`, and `@graphql-tools/wrap`)

  - `wrapSchema` and `generateProxyingResolvers` now only take a single options argument with named properties of type `SubschemaConfig`. The previously possible shorthand version with first argument consisting of a `GraphQLSchema` and second argument representing the transforms should be reworked as a `SubschemaConfig` object.

  - Similarly, the `ICreateProxyingResolverOptions` interface that provides the options for the `createProxyingResolver` property of `SubschemaConfig` options has been adjusted. The `schema` property previously could be set to a `GraphQLSchema` or a `SubschemaConfig` object. This property has been removed in favor of a `subschemaConfig` property that will always be a `SubschemaConfig` object. The `transforms` property has been removed; transforms should be included within the `SubschemaConfig` object.`

  - The format of the wrapping schema has solidified. All non-root fields are expected to use identical resolvers, either `defaultMergedResolver` or a custom equivalent, with root fields doing the hard work of proxying. Support for custom merged resolvers throught `createMergedResolver` has been deprecated, as custom merging resolvers conflicts when using stitching's type merging, where resolvers are expected to be identical across subschemas.

  - The `WrapFields` transform's `wrappingResolver` option has been removed, as this complicates multiple wrapping layers, as well as planned functionality to wrap subscription root fields in potentially multiple layers, as the wrapping resolvers may be different in different layers. Modifying resolvers can still be performed by use of an additional transform such as `TransformRootFields` or `TransformObjectFields`.

  - The `ExtendSchema` transform has been removed, as it is conceptually simpler just to use `stitchSchemas` with one subschema.

  - The `ReplaceFieldsWithFragment`, `AddFragmentsByField`, `AddSelectionSetsByField`, and `AddMergedTypeSelectionSets` transforms has been removed, as they are superseded by the `AddSelectionSets` and `VisitSelectionSets` transforms. The `AddSelectionSets` purposely takes parsed SDL rather than strings, to nudge end users to parse these strings at build time (when possible), rather than at runtime. Parsing of selection set strings can be performed using the `parseSelectionSet` function from `@graphql-tools/utils`.

  #### Schema Stitching (`stitchSchemas` & `@graphql-tools/stitch`)

  - `stitchSchemas`'s `mergeTypes` option is now true by default! This causes the `onTypeConflict` option to be ignored by default. To use `onTypeConflict` to select a specific type instead of simply merging, simply set `mergeTypes` to false.

  - `schemas` argument has been deprecated, use `subschemas`, `typeDefs`, or `types`, depending on what you are stitching.

  - When using batch delegation in type merging, the `argsFromKeys` function is now set only via the `argsFromKeys` property. Previously, if `argsFromKeys` was absent, it could be read from `args`.

  - Support for fragment hints has been removed in favor of selection set hints.

  - `stitchSchemas` now processes all `GraphQLSchema` and `SubschemaConfig` subschema input into new `Subschema` objects, handling schema config directives such aso`@computed` as well as generating the final transformed schema, stored as the `transformedSchema` property, if transforms are used. Signatures of the `onTypeConflict`, `fieldConfigMerger`, and `inputFieldConfigMerger` have been updated to include metadata related to the original and transformed subschemas. Note the property name change for `onTypeConflict` from `schema` to `subschema`.

  #### Mocking (`addMocksToSchema` and `@graphql-tools/mock`)

  - Mocks returning objects with fields set as functions are now operating according to upstream graphql-js convention, i.e. these functions take three arguments, `args`, `context`, and `info` with `parent` available as `this` rather than as the first argument.

  #### Other Utilities (`@graphql-tools/utils`)

  - `filterSchema`'s `fieldFilter` will now filter _all_ fields across Object, Interface, and Input types. For the previous Object-only behavior, switch to the `objectFieldFilter` option.
  - Unused `fieldNodes` utility functions have been removed.
  - Unused `typeContainsSelectionSet` function has been removed, and `typesContainSelectionSet` has been moved to the `stitch` package.
  - Unnecessary `Operation` type has been removed in favor of `OperationTypeNode` from upstream graphql-js.
  - As above, `applySchemaTransforms`/`applyRequestTransforms`/`applyResultTransforms` have been removed from the `utils` package, as they are implemented elsewhere or no longer necessary.

  ## Related Issues

  - proxy all the errors: #1047, #1641
  - better error handling for merges #2016, #2062
  - fix typings #1614
  - disable implicit schema pruning #1817
  - mocks not working for functions #1807

### Patch Changes

- Updated dependencies [be1a1575]
  - @graphql-tools/delegate@7.0.0
  - @graphql-tools/schema@7.0.0
  - @graphql-tools/utils@7.0.0

## 6.2.4

### Patch Changes

- 32c3c4f8: enhance(HoistFields): allow arguments
- 533d6d53: Bump all packages to allow adjustments
- Updated dependencies [32c3c4f8]
- Updated dependencies [32c3c4f8]
- Updated dependencies [533d6d53]
  - @graphql-tools/utils@6.2.4
  - @graphql-tools/delegate@6.2.4
  - @graphql-tools/schema@6.2.4
