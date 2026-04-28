/**
 * Default Docker image tags used by the CLI when launching
 * the dev environment via docker compose.
 *
 * For release builds these remain "latest".
 * The canary CI overwrites them to "canary" before building.
 */
export const ELECTRIC_IMAGE_TAG = `latest`
export const ELECTRIC_AGENTS_SERVER_IMAGE_TAG = `latest`
