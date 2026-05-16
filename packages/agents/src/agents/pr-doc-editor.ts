import { registerPrWorker, type PrWorkerDeps } from './pr-reviewer'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

export function registerPrDocEditor(
  registry: EntityRegistry,
  deps: PrWorkerDeps
): void {
  registerPrWorker(registry, `pr-doc-editor`, `doc-editor`, deps)
}
