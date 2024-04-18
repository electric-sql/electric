// import { inject, signal, DestroyRef } from '@angular/core';
// import { assertInjector } from './utils';
// import { hash } from 'ohash';
// import type { Injector, Signal } from '@angular/core';
// import { injectElectricClient } from './inject-electric';

// export function injectLiveQuery<Res>(
//   runQuery: () => Promise<Res>,
//   injector?: Injector
// ): Signal<ResultData<Res>> {

//   return assertInjector(injectLiveQuery, injector, () => {
//     const electric = injectElectricClient();
//     const destroyRef = inject(DestroyRef);

//     const resultData = signal<ResultData<Res>>({});


//     if (deps) {
//       return useLiveQueryWithDependencies(
//         runQueryOrFn as () => LiveResultContext<Res>,
//         deps
//       )
//     } else {
//       return useLiveQueryWithQueryHash(runQueryOrFn as LiveResultContext<Res>)
//     }

//     const executeQuery = async () => {
//       try {
//         const res = await runQuery();
//         resultData.set(successResult(res));
//       } catch (err) {
//         resultData.set(errorResult(err));
//       }
//     };

//     const queryHash = hash(runQuery);
//     executeQuery(); // Initial execution

//     // Subscribe to changes
//     const unsubscribe = electric.subscribeToDataChanges(() => {
//       if (hash(runQuery) === queryHash) {
//         executeQuery();
//       }
//     });

//     destroyRef.onDestroy(unsubscribe);

//     return resultData;
//   });
// }

// // Helper functions
// function successResult<T>(results: T): ResultData<T> {
//   return {
//     error: undefined,
//     results: results,
//     updatedAt: new Date(),
//   };
// }

// function errorResult<T>(error: unknown): ResultData<T> {
//  return {
//     error: error,
//     results: undefined,
//     updatedAt: new Date(),
//   };
// }

// export interface ResultData<T> {
//   error?: unknown;
//   results?: T;
//   updatedAt?: Date;
// }

export {}