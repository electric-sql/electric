import {
  assertInInjectionContext,
  inject,
  Injector,
  runInInjectionContext,
} from '@angular/core'

/**
 * Function assertInjector
 * Source: ngxtension (https://github.com/nartc/ngxtension-platform)
 * The following function is used under the MIT License.
 */
export function assertInjector<F extends (...args: unknown[]) => unknown, R>(
  fn: F,
  injector?: Injector,
  runner?: () => R
): Injector | R {
  if (!injector) {
    assertInInjectionContext(fn)
  }
  const assertedInjector = injector ?? inject(Injector)

  if (!runner) {
    return assertedInjector
  }
  return runInInjectionContext(assertedInjector, runner)
}
