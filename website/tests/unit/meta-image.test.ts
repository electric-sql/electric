import { describe, it, expect } from 'vitest'
import {
  isAbsoluteUrl,
  buildFullImageUrl,
  buildMetaImageUrl,
} from '../../src/lib/meta-image'

const SITE_ORIGIN = `https://electric-sql.com`

describe(`isAbsoluteUrl`, () => {
  describe(`absolute URLs - should return true`, () => {
    const absoluteUrls = [
      { url: `https://example.com/image.jpg`, name: `https URL` },
      { url: `http://example.com/image.jpg`, name: `http URL` },
      { url: `//example.com/image.jpg`, name: `protocol-relative URL` },
      {
        url: `https://cdn.example.com/path/to/image.png`,
        name: `https with path`,
      },
    ]

    it.each(absoluteUrls)(`$name`, ({ url }) => {
      expect(isAbsoluteUrl(url)).toBe(true)
    })
  })

  describe(`relative URLs - should return false`, () => {
    const relativeUrls = [
      { url: `/img/meta/image.jpg`, name: `root-relative path` },
      { url: `img/meta/image.jpg`, name: `relative path` },
      { url: `./img/meta/image.jpg`, name: `dot-relative path` },
      { url: `../img/meta/image.jpg`, name: `parent-relative path` },
    ]

    it.each(relativeUrls)(`$name`, ({ url }) => {
      expect(isAbsoluteUrl(url)).toBe(false)
    })
  })

  describe(`edge cases`, () => {
    it(`empty string`, () => {
      expect(isAbsoluteUrl(``)).toBe(false)
    })

    it(`single slash`, () => {
      expect(isAbsoluteUrl(`/`)).toBe(false)
    })
  })
})

describe(`buildFullImageUrl`, () => {
  it(`uses absolute URL directly`, () => {
    const absoluteUrl = `https://cdn.example.com/image.jpg`
    expect(buildFullImageUrl(absoluteUrl, SITE_ORIGIN)).toBe(absoluteUrl)
  })

  it(`uses protocol-relative URL directly`, () => {
    const protocolRelativeUrl = `//cdn.example.com/image.jpg`
    expect(buildFullImageUrl(protocolRelativeUrl, SITE_ORIGIN)).toBe(
      protocolRelativeUrl
    )
  })

  it(`prefixes site origin to relative path`, () => {
    const relativePath = `/img/meta/image.jpg`
    expect(buildFullImageUrl(relativePath, SITE_ORIGIN)).toBe(
      `${SITE_ORIGIN}/img/meta/image.jpg`
    )
  })

  it(`normalizes relative path without leading slash`, () => {
    const relativePath = `img/meta/image.jpg`
    expect(buildFullImageUrl(relativePath, SITE_ORIGIN)).toBe(
      `${SITE_ORIGIN}/img/meta/image.jpg`
    )
  })
})

describe(`buildMetaImageUrl`, () => {
  it(`builds Netlify proxy URL for relative image path`, () => {
    const result = buildMetaImageUrl(`/img/meta/image.jpg`, SITE_ORIGIN)
    expect(result).toBe(
      `${SITE_ORIGIN}/.netlify/images?url=${encodeURIComponent(`${SITE_ORIGIN}/img/meta/image.jpg`)}&w=1200&h=630&fit=cover&fm=jpg&q=80`
    )
  })

  it(`builds Netlify proxy URL for absolute image URL`, () => {
    const absoluteUrl = `https://cdn.example.com/image.jpg`
    const result = buildMetaImageUrl(absoluteUrl, SITE_ORIGIN)
    expect(result).toBe(
      `${SITE_ORIGIN}/.netlify/images?url=${encodeURIComponent(absoluteUrl)}&w=1200&h=630&fit=cover&fm=jpg&q=80`
    )
  })

  it(`properly encodes special characters in URL`, () => {
    const pathWithSpecialChars = `/img/my image (1).jpg`
    const result = buildMetaImageUrl(pathWithSpecialChars, SITE_ORIGIN)
    expect(result).toContain(
      encodeURIComponent(`${SITE_ORIGIN}/img/my image (1).jpg`)
    )
  })
})
