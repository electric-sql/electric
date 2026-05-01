import type {
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../types'

export class HostProvider implements SandboxProvider {
  readonly name = `host`

  async start(spec: SandboxSpec): Promise<SandboxInstance> {
    if (spec.workspace.type !== `bindMount`) {
      throw new Error(`HostProvider requires a bindMount workspace`)
    }
    throw new Error(`not implemented`)
  }

  async stop(_instanceId: string): Promise<void> {
    throw new Error(`not implemented`)
  }

  async destroy(_agentId: string): Promise<void> {
    throw new Error(`not implemented`)
  }

  async status(_agentId: string): Promise<`running` | `stopped` | `unknown`> {
    throw new Error(`not implemented`)
  }

  async recover(): Promise<Array<RecoveredSandbox>> {
    return []
  }
}
