import {
  getElectricAgentsComposeProject,
  getElectricAgentsDevPorts,
} from './electric-agents-compose-utils'

export function configureElectricAgentsTestBackendEnv(
  namespace: string,
  portOffset: number,
  opts: { force?: boolean } = {}
): void {
  const { postgresPort, electricPort } = getElectricAgentsDevPorts()
  const scopedPostgresPort = postgresPort + portOffset
  const scopedElectricPort = electricPort + portOffset

  const setEnv = (key: string, value: string): void => {
    if (opts.force || process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  setEnv(
    `ELECTRIC_AGENTS_COMPOSE_PROJECT`,
    `${getElectricAgentsComposeProject()}-${namespace}`
  )
  setEnv(`PG_HOST_PORT`, String(scopedPostgresPort))
  setEnv(`ELECTRIC_HOST_PORT`, String(scopedElectricPort))
  setEnv(`JAEGER_UI_PORT`, `0`)
  setEnv(`JAEGER_OTLP_HTTP_PORT`, `0`)
  setEnv(`JAEGER_OTLP_GRPC_PORT`, `0`)
  setEnv(
    `DATABASE_URL`,
    `postgres://electric_agents:electric_agents@localhost:${scopedPostgresPort}/electric_agents`
  )
  setEnv(`ELECTRIC_URL`, `http://localhost:${scopedElectricPort}`)
  setEnv(`ELECTRIC_AGENTS_TEST_BACKEND_MANAGED`, `1`)
}
