import { describe, expect, it } from 'vitest'
import {
  getWebhookStreamPath,
  manifestSourceKey,
  webhook,
  webhookObservationCollections,
} from '../src/observation-sources'

describe(`webhook observation source`, () => {
  it(`computes deterministic root and bucket stream paths`, () => {
    expect(getWebhookStreamPath(`repo`)).toBe(`/_webhooks/repo`)
    expect(getWebhookStreamPath(`repo`, `/prs/123/`)).toBe(
      `/_webhooks/repo/prs/123`
    )
  })

  it(`declares schema, wake condition, ensure-stream metadata, and manifest entry`, () => {
    const source = webhook(`repo`, { bucket: `prs/123` })

    expect(source).toMatchObject({
      sourceType: `webhook`,
      sourceRef: `repo/prs/123`,
      endpointKey: `repo`,
      bucket: `prs/123`,
      streamUrl: `/_webhooks/repo/prs/123`,
      schema: webhookObservationCollections,
      ensureStream: { contentType: `application/json` },
    })
    expect(source.wake?.()).toEqual({
      sourceUrl: `/_webhooks/repo/prs/123`,
      condition: {
        on: `change`,
        collections: [`webhook_event`],
        ops: [`insert`],
      },
    })
    expect(source.toManifestEntry()).toEqual({
      key: manifestSourceKey(`webhook`, `repo/prs/123`),
      kind: `source`,
      sourceType: `webhook`,
      sourceRef: `repo/prs/123`,
      config: {
        endpointKey: `repo`,
        bucket: `prs/123`,
        streamUrl: `/_webhooks/repo/prs/123`,
      },
    })
  })

  it(`rejects unsafe endpoint keys and bucket path segments`, () => {
    expect(() => webhook(`Repo`)).toThrow(/endpointKey/)
    expect(() => webhook(`repo`, { bucket: `../123` })).toThrow(/bucket/)
    expect(() => webhook(`repo`, { bucket: `prs//123` })).toThrow(/bucket/)
  })
})
