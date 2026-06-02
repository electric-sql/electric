import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HealthPanel } from './HealthPanel'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe(`HealthPanel`, () => {
  it(`renders REST health from the Worker API`, async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            app: `living-wiki`,
            env: `test`,
            electricCloudConfigured: true,
            electricAgentsSpaceId: `space_test`,
            seededDemoEnabled: true,
          }),
          { headers: { 'content-type': `application/json` } }
        )
    ) as typeof fetch

    render(<HealthPanel />)

    expect(screen.getByText(`Checking Worker API…`)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(`Worker API: healthy`)).toBeInTheDocument()
    )
    expect(
      screen.getByText(`Electric Agents space: space_test`)
    ).toBeInTheDocument()
  })
})
