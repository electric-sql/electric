/**
 * Default Docker image tags used by the CLI when launching
 * the dev environment via docker compose.
 *
 * For release builds these remain "latest".
 * The canary CI overwrites them to "canary" before building.
 */
const injectedCliVersion: string = `__ELECTRIC_AX_CLI_VERSION__`
export const ELECTRIC_AX_CLI_VERSION = injectedCliVersion.startsWith(
  `__ELECTRIC_AX_`
)
  ? `0.0.0`
  : injectedCliVersion
export const ELECTRIC_IMAGE_TAG = `latest`
export const ELECTRIC_AGENTS_SERVER_IMAGE_TAG = `latest`
