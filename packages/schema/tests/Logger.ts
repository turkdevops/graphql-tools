/*
 * A very simple class for logging errors
 */

import { ILogger } from '@graphql-tools/schema';

export class Logger implements ILogger {
  public errors: Array<Error>;
  public name: string | undefined;
  private readonly callback: undefined | ((...args: any[]) => any);

  constructor(name?: string, callback?: (...args: any[]) => any) {
    this.name = name;
    this.errors = [];
    this.callback = callback;
    // TODO: should assert that callback is a function
  }

  public log(err: Error) {
    this.errors.push(err);
    if (typeof this.callback === 'function') {
      this.callback(err);
    }
  }

  public printOneError(e: Error): string {
    return e.stack ? e.stack : '';
  }

  public printAllErrors() {
    return this.errors.reduce(
      (agg: string, e: Error) => `${agg}\n${this.printOneError(e)}`,
      '',
    );
  }
}
