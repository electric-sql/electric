/**
 * Stable list of bundled adapter names. The conformance test suite
 * asserts the set of providers it exercises equals this list, so adding
 * a new adapter without registering it in the conformance suite fails CI.
 */
export const KNOWN_ADAPTERS = [`unrestricted`, `remote`, `docker`] as const
export type KnownAdapter = (typeof KNOWN_ADAPTERS)[number]

export { unrestrictedSandbox } from './sandbox/unrestricted'
export type { UnrestrictedSandboxOpts } from './sandbox/unrestricted'
export { remoteSandbox } from './sandbox/remote'
export type { RemoteProvider, RemoteSandboxOpts } from './sandbox/remote'
export type { RemoteSandboxClient } from './sandbox/remote/types'
export { dockerSandbox } from './sandbox/docker'
export type { DockerSandboxOpts } from './sandbox/docker'
export { isDockerAvailable } from './sandbox/docker/loader'
export { chooseDefaultSandbox } from './sandbox/default'
export { SandboxError } from './sandbox/types'
export type {
  Sandbox,
  SandboxExecOpts,
  SandboxExecResult,
  DirEntry,
  FileStat,
  NetworkPolicy,
  SandboxErrorKind,
} from './sandbox/types'
