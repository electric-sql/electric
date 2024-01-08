import { createNoopInjectionToken } from 'ngxtension/create-injection-token'
import { ElectricClient, DbSchema } from 'electric-sql/client/model'

const [injectElectricClient, provideElectricClient, ELECTRIC_CLIENT] =
  createNoopInjectionToken<ElectricClient<DbSchema<any>>>('ElectricClientToken')

export { injectElectricClient, provideElectricClient, ELECTRIC_CLIENT }
