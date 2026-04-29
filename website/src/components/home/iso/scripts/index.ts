/**
 * Re-exports for the v2 ambient + per-crop focus scripts.
 *
 * The actual `CropName → CropScripts` mapping lives in `crops.ts`
 * (see `SCRIPTS`) so the script files stay decoupled from camera
 * configuration.
 */

export { AMBIENT_SCRIPT } from './ambient'
export { AGENTS_FOCUS_SCRIPT } from './agents-focus'
export { STREAMS_FOCUS_SCRIPT } from './streams-focus'
export { SYNC_FOCUS_SCRIPT } from './sync-focus'
