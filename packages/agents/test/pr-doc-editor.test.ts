import { describe, expect, it } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrDocEditor } from '../src/agents/pr-doc-editor'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe(`pr-doc-editor`, () => {
  it(`registers entity and identifies the doc-editor role`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrDocEditor(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
    })
    expect(registry.get(`pr-doc-editor`)).toBeDefined()
    expect(registry.get(`pr-doc-editor`)!.definition.description).toMatch(
      /doc-editor/
    )
  })
})
