import { describe, expect, it } from 'vitest'
import {
  applyElectricUrlQueryParams,
  electricUrlWithPath,
} from '../src/electric-url'

describe(`Electric URL helpers`, () => {
  it(`carries configured query params onto derived Electric paths`, () => {
    const url = electricUrlWithPath(
      `https://electric.example?source_id=source-1&region=eu`,
      `/v1/shape`
    )

    expect(url.toString()).toBe(
      `https://electric.example/v1/shape?source_id=source-1&region=eu`
    )
  })

  it(`lets configured query params override request params`, () => {
    const url = new URL(
      `https://electric.example/v1/shape?source_id=client-source&table=entities`
    )

    applyElectricUrlQueryParams(
      url,
      `https://electric.example?source_id=server-source`
    )

    expect(url.searchParams.get(`source_id`)).toBe(`server-source`)
    expect(url.searchParams.get(`table`)).toBe(`entities`)
  })
})
