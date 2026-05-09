import { registerPrWorker, type PrWorkerDeps } from './pr-reviewer'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

export function registerPrBuildDoctor(
  registry: EntityRegistry,
  deps: PrWorkerDeps
): void {
  registerPrWorker(registry, `pr-build-doctor`, `build-doctor`, deps)
}
