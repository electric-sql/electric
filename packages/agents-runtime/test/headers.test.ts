import { describe, expect, it } from 'vitest'
import {
  ELECTRIC_PRINCIPAL_HEADER,
  mergeElectricPrincipalHeader,
} from '../src/headers'

describe(`mergeElectricPrincipalHeader`, () => {
  it(`returns undefined without headers or a principal`, () => {
    expect(mergeElectricPrincipalHeader(undefined, undefined)).toBeUndefined()
  })

  it(`preserves existing headers when the principal is blank`, () => {
    expect(
      mergeElectricPrincipalHeader({ Authorization: `Bearer token` }, `  `)
    ).toEqual({
      authorization: `Bearer token`,
    })
  })

  it(`adds the Electric principal header`, () => {
    expect(
      mergeElectricPrincipalHeader(
        { Authorization: `Bearer token` },
        `service:svc-test`
      )
    ).toEqual({
      authorization: `Bearer token`,
      [ELECTRIC_PRINCIPAL_HEADER]: `service:svc-test`,
    })
  })
})
