type TestBackendEnvModule = {
  configureElectricAgentsTestBackendEnv: (
    scope: string,
    workerId: number
  ) => void
}

export {}

const agentServerTestBackendEnvModulePath = `../../agents-server/test/test-backend-env`

const { configureElectricAgentsTestBackendEnv } = (await import(
  agentServerTestBackendEnvModulePath
)) as TestBackendEnvModule

configureElectricAgentsTestBackendEnv(`electric-agents-runtime`, 1)
