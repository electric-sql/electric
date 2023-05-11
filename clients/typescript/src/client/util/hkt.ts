/*
 * Implementation of Higher Kinded Types (HKT)
 * based on: https://dev.to/effect-ts/encoding-of-hkts-in-typescript-5c3
 */

// Higher kinded type with 1 type parameter
// e.g. interface ArrayHKT extends HKT {
//        readonly type: Array<this["_A"]>
//      }
export interface HKT {
  // will reference the A type
  readonly _A?: unknown

  // will represent the computed type
  readonly type?: Record<string, any>
}

export type Kind<F extends HKT, A> = F extends {
  readonly type: unknown
}
  ? // F has a type specified, it is concrete (like F = ArrayHKT)
    (F & {
      readonly _A: A
    })['type']
  : // F is generic, we need to mention all of the type parameters
    // to guarantee that they are never excluded from type checking
    {
      readonly _F: F
      readonly _A: () => A
    } & Record<string, any>
