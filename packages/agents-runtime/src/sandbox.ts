export { KNOWN_ADAPTERS } from './sandbox/types'
export type { KnownAdapter } from './sandbox/types'

export { unrestrictedSandbox } from './sandbox/unrestricted'
export type { UnrestrictedSandboxOpts } from './sandbox/unrestricted'
export { remoteSandbox } from './sandbox/remote'
export type { RemoteProvider, RemoteSandboxOpts } from './sandbox/remote'
export type { RemoteSandboxClient } from './sandbox/remote/types'
export { isE2BAvailable } from './sandbox/remote/e2b'
export { chooseDefaultSandbox } from './sandbox/default'
export { ensureSandboxMaterialized, lazySandbox } from './sandbox/lazy'
export type { LazySandboxOpts } from './sandbox/lazy'
export { SandboxError } from './sandbox/types'
export type {
  Sandbox,
  SandboxExecOpts,
  SandboxExecResult,
  SandboxFactory,
  SandboxFactoryParams,
  SandboxProfile,
  DirEntry,
  FileStat,
  NetworkPolicy,
  SandboxErrorKind,
} from './sandbox/types'
