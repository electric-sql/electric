import { ENVIRONMENT_INITIALIZER, makeEnvironmentProviders } from '@angular/core'
import type { EnvironmentProviders } from '@angular/core'
import { createNoopInjectionToken } from './util';

// Work in progress implementation

export function makeElectricContext<S>() {
  const [injectElectric, provideElectricClient, ELECTRIC_CLIENT] =
  createNoopInjectionToken<S>('ElectricClientToken')
  console.log(provideElectricClient, 'provideElectricClient');
  return {
    injectElectric,
    provideElectric: (electricClient: S) => {
      return provideElectric(provideElectricClient, electricClient);
    },
    ELECTRIC_CLIENT,
  }
}

export function provideElectric<S>(
  provider: any,
  electricClient: S,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...provider(electricClient),
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => electricClient,
    },
  ])
}