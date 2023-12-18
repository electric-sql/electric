import {
  Injector,
  assertInInjectionContext,
  inject,
  runInInjectionContext,
} from '@angular/core'

/**
 * `assertInjector` extends `assertInInjectionContext` with an optional `Injector`
 * After assertion, `assertInjector` returns a guaranteed `Injector` whether it is the default `Injector`
 * within the current **Injection Context** or the custom `Injector` that was passed in.
 * Adapted it from ngxtension/assert-injector but with stronger typing.
 *
 * @param {Function} fn - the Function to pass in `assertInInjectionContext`
 * @param {Injector | undefined | null} injector - the optional "custom" Injector
 * @returns Injector
 * 
 */
  export function assertInjector<F extends (...args: unknown[]) => unknown, R>(
	fn: F,
	injector: Injector,
	runner?: () => R
  ): Injector | R {
	!injector && assertInInjectionContext(fn);
	const assertedInjector = injector ?? inject(Injector);
  
	if (!runner) return assertedInjector;
	return runInInjectionContext(assertedInjector, runner);
  }
