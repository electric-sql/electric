/**
 * Docker sandbox provider as a separate subpath export so callers that
 * only need the in-process `unrestrictedSandbox` (e.g. desktop renderers
 * bundled by Vite) don't pull `dockerode` and its native dependencies
 * (`cpufeatures.node`, etc.) into their bundle. Import from
 * `@electric-ax/agents-runtime/sandbox/docker` only when actually using
 * the docker provider.
 */

export { dockerSandbox } from './sandbox/docker'
export type { DockerSandboxOpts } from './sandbox/docker'
export { isDockerAvailable } from './sandbox/docker/loader'
