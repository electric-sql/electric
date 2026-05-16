import { describe, expect, it } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrBuildDoctor } from '../src/agents/pr-build-doctor'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe(`pr-build-doctor`, () => {
  it(`registers entity and uses build-doctor role in description`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrBuildDoctor(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
    })
    expect(registry.get(`pr-build-doctor`)).toBeDefined()
    expect(registry.get(`pr-build-doctor`)!.definition.description).toMatch(
      /build-doctor/
    )
  })
})
