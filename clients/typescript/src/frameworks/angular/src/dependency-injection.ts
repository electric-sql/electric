// import { InjectionToken, Signal, inject } from "@angular/core"
// import { ElectricClient } from 'electric-sql';

// interface ElectricDependencyInjection<S extends ElectricClient<DbSchema<any>>> {
//   provideElectric: (
//     electric: Signal<S | undefined> | (S | undefined)
//   ) => void
//   injectElectric: () => S | undefined
// }

// const ElectricKey = new InjectionToken<string>('ELECTRIC_KEY');

// /**
//  * Call this function to get an Electric provider and injector for your Vue application.
//  * We can't provide a predefined provider and injector because that would lose type information
//  * as the types depend on the type of the database `S` that's provided as a type argument.
//  *
//  * @example
//  * This example loses information about the concrete DB tables:
//  * ```
//  * provide<ElectricClient>(ElectricKey, electric)
//  *
//  * // generic DB type, no type-safe client
//  * const { db } = inject(ElectricKey)
//  * ```
//  *
//  * @returns An object with two functions: `provideElectric` and `injectElectric`.
//  *
//  */
// export function makeElectricDependencyInjector<
//   S extends ElectricClient<DbSchema<any>>
// >(): ElectricDependencyInjection<S> {
//   const provideElectric = (
//     electric: ShallowRef<S | undefined> | (S | undefined)
//   ): void => provide(ElectricKey, electric)

//   const injectElectric = (): S | undefined => {
//     const electric = inject(ElectricKey)
//     return unref(electric)
//   }

//   return {
//     provideElectric,
//     injectElectric,
//   }
// }

// /**
//  * This "static" injector is used internally by our reactive methods
//  * to get access to the {@link ElectricClient}.
//  * It loses information about the actual types of the DB tables,
//  * but we don't need that information in our methods.
//  * However, users preferably don't lose this type information,
//  * therefore, they can use {@link makeElectricDependencyInjector}.
//  */
// const { injectElectric: injectElectricUntyped } =
//   makeElectricDependencyInjector()

// export { injectElectricUntyped }
