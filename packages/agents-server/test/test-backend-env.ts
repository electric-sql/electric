import {
  getElectricAgentsComposeProject,
  getElectricAgentsDevPorts,
} from './electric-agents-compose-utils'

export function configureElectricAgentsTestBackendEnv(
  namespace: string,
  portOffset: number
): void {
  const { postgresPort, electricPort } = getElectricAgentsDevPorts()
  const scopedPostgresPort = postgresPort + portOffset
  const scopedElectricPort = electricPort + portOffset

  process.env.ELECTRIC_AGENTS_COMPOSE_PROJECT ??= `${getElectricAgentsComposeProject()}-${namespace}`
  process.env.PG_HOST_PORT ??= String(scopedPostgresPort)
  process.env.ELECTRIC_HOST_PORT ??= String(scopedElectricPort)
  process.env.JAEGER_UI_PORT ??= `0`
  process.env.JAEGER_OTLP_HTTP_PORT ??= `0`
  process.env.JAEGER_OTLP_GRPC_PORT ??= `0`
  process.env.DATABASE_URL ??= `postgres://electric_agents:electric_agents@localhost:${scopedPostgresPort}/electric_agents`
  process.env.ELECTRIC_URL ??= `http://localhost:${scopedElectricPort}`
  process.env.ELECTRIC_AGENTS_TEST_BACKEND_MANAGED ??= `1`
}
