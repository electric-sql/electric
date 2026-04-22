type TestBackendEnvModule = {
  configureElectricAgentsTestBackendEnv: (
    scope: string,
    workerId: number
  ) => void
}

export {}

const agentServerTestBackendEnvModulePath = `../../agent-server/test/test-backend-env`

const { configureElectricAgentsTestBackendEnv } = (await import(
  agentServerTestBackendEnvModulePath
)) as TestBackendEnvModule

configureElectricAgentsTestBackendEnv(`electric-agents-runtime`, 1)
