/**
 * Default Docker image tags used by the CLI when launching
 * the dev environment via docker compose.
 *
 * For release builds the agents-server image is pinned to the matching
 * @electric-ax/agents-server version by the tsdown build.
 * The canary CI overwrites them to "canary" before building.
 */
const injectedCliVersion: string = `__ELECTRIC_AX_CLI_VERSION__`
const injectedAgentsServerImageTag: string = `__ELECTRIC_AGENTS_SERVER_IMAGE_TAG__`
export const ELECTRIC_AX_CLI_VERSION = injectedCliVersion.startsWith(
  `__ELECTRIC_AX_`
)
  ? `0.0.0`
  : injectedCliVersion
export const ELECTRIC_IMAGE_TAG = `latest`
export const ELECTRIC_AGENTS_SERVER_IMAGE_TAG =
  injectedAgentsServerImageTag.startsWith(`__ELECTRIC_`)
    ? `latest`
    : injectedAgentsServerImageTag
