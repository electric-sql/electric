import { APP_INITIALIZER, makeEnvironmentProviders } from '@angular/core'
import type { EnvironmentProviders } from '@angular/core'
import { provideElectricClient } from './inject-electric'
import { ElectricClient, DbSchema } from 'electric-sql/client/model'


export function provideElectric<S extends ElectricClient<DbSchema<any>>>(
  electricClient: S,
  electricInitializer: () => Promise<S>
): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideElectricClient(electricClient),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: electricInitializer,
    },
  ])
}
