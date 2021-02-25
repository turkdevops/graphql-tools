import { graphql } from 'graphql';

import { makeExecutableSchema } from '@graphql-tools/schema';
import { stitchSchemas } from '@graphql-tools/stitch';
import { isAsyncIterable } from '@graphql-tools/utils';

describe('stream support', () => {
  test('should work for root fields', async () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Query {
          test: [String]
        }
      `,
      resolvers: {
        Query: {
          test: () => ['test1', 'test2'],
        }
      },
    });

    const stitchedSchema = stitchSchemas({
      subschemas: [schema]
    });

    const result = await graphql(
      stitchedSchema,
      `
        query {
          test @stream(initialCount: 0)
        }
      `,
    );

    const results = [];
    if (isAsyncIterable(result)) {
      for await (const patch of result) {
        results.push(patch);
      }
    }

    expect(results[0]).toEqual({
      data: {
        test: [],
      },
      hasNext: true,
    });
    expect(results[1]).toEqual({
      data: 'test1',
      hasNext: true,
      path: ['test', 0],
    });
    expect(results[2]).toEqual({
      data: 'test2',
      hasNext: false,
      path: ['test', 1],
    });
  });

  test('should work for proxied fields', async () => {
    const schema = makeExecutableSchema({
      typeDefs: `
        type Object {
          test: [String]
        }
        type Query {
          object: Object
        }
      `,
      resolvers: {
        Object: {
          test: () => ['test1', 'test2'],
        },
        Query: {
          object: () => ({}),
        }
      },
    });

    const stitchedSchema = stitchSchemas({
      subschemas: [schema]
    });

    const result = await graphql(
      stitchedSchema,
      `
        query {
          object {
            test @stream(initialCount: 0)
          }
        }
      `,
    );

    const results = [];
    if (isAsyncIterable(result)) {
      for await (const patch of result) {
        results.push(patch);
      }
    }

    expect(results[0]).toEqual({
      data: { object: { test: [] } },
      hasNext: true,
    });
    expect(results[1]).toEqual({
      data: 'test1',
      hasNext: true,
      path: ['object', 'test', 0],
    });
    expect(results[2]).toEqual({
      data: 'test2',
      hasNext: false,
      path: ['object', 'test', 1],
    });
  });
});
