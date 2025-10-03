import { describe, expect, it } from 'vitest'
import { isChangeMessage, isControlMessage, Message } from '../src'
import {
  isUpToDateMessage,
  generateShardId,
  isLocalhostUrl,
  applySubdomainSharding,
} from '../src/helpers'

describe(`helpers`, () => {
  const changeMsg = {
    headers: {
      operation: `insert`,
    },
    offset: `-1`,
    key: `key`,
    value: { key: `value` },
  } as Message

  const upToDateMsg = {
    headers: {
      control: `up-to-date`,
    },
  } as Message

  const mustRefetchMsg = {
    headers: {
      control: `must-refetch`,
    },
  } as Message

  it(`should correctly detect ChangeMessages`, () => {
    expect(isChangeMessage(changeMsg)).toBe(true)
    expect(isControlMessage(changeMsg)).toBe(false)
  })

  it(`should correctly detect ControlMessages`, () => {
    expect(isControlMessage(upToDateMsg)).toBe(true)
    expect(isControlMessage(mustRefetchMsg)).toBe(true)
    expect(isChangeMessage(upToDateMsg)).toBe(false)
    expect(isChangeMessage(mustRefetchMsg)).toBe(false)
  })

  it(`should correctly detect up-to-date message`, () => {
    expect(isUpToDateMessage(upToDateMsg)).toBe(true)
    expect(isUpToDateMessage(mustRefetchMsg)).toBe(false)
    expect(isUpToDateMessage(changeMsg)).toBe(false)
  })
})

describe(`generateShardId`, () => {
  it(`should generate 5-character hex strings`, () => {
    const id = generateShardId()
    expect(id).toMatch(/^[0-9a-f]{5}$/)
  })

  it(`should generate unique values`, () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShardId()))
    expect(ids.size).toBeGreaterThan(90)
  })
})

describe(`isLocalhostUrl`, () => {
  it(`should return true for localhost`, () => {
    expect(isLocalhostUrl(new URL(`http://localhost:3000`))).toBe(true)
    expect(isLocalhostUrl(new URL(`https://localhost`))).toBe(true)
  })

  it(`should return true for *.localhost subdomains`, () => {
    expect(isLocalhostUrl(new URL(`http://dev.localhost:3000`))).toBe(true)
    expect(isLocalhostUrl(new URL(`http://api.localhost`))).toBe(true)
    expect(isLocalhostUrl(new URL(`http://a.b.c.localhost:8080`))).toBe(true)
  })

  it(`should return false for non-localhost domains`, () => {
    expect(isLocalhostUrl(new URL(`http://example.com`))).toBe(false)
    expect(isLocalhostUrl(new URL(`http://api.example.com`))).toBe(false)
    expect(isLocalhostUrl(new URL(`http://localhost.com`))).toBe(false)
  })

  it(`should return false for IP addresses`, () => {
    expect(isLocalhostUrl(new URL(`http://127.0.0.1:3000`))).toBe(false)
    expect(isLocalhostUrl(new URL(`http://0.0.0.0:3000`))).toBe(false)
  })

  it(`should be case insensitive`, () => {
    expect(isLocalhostUrl(new URL(`http://LOCALHOST:3000`))).toBe(true)
    expect(isLocalhostUrl(new URL(`http://dev.LOCALHOST:3000`))).toBe(true)
  })
})

describe(`applySubdomainSharding`, () => {
  describe(`with 'never' or false`, () => {
    it(`should not modify URL when option is 'never'`, () => {
      const url = `http://localhost:3000/v1/shape`
      expect(applySubdomainSharding(url, `never`)).toBe(url)
    })

    it(`should not modify URL when option is false`, () => {
      const url = `http://localhost:3000/v1/shape`
      expect(applySubdomainSharding(url, false)).toBe(url)
    })
  })

  describe(`with 'always' or true`, () => {
    it(`should add subdomain when option is 'always'`, () => {
      const url = `http://localhost:3000/v1/shape`
      const result = applySubdomainSharding(url, `always`)
      expect(result).toMatch(
        /^http:\/\/[0-9a-f]{5}\.localhost:3000\/v1\/shape$/
      )
    })

    it(`should add subdomain when option is true`, () => {
      const url = `http://localhost:3000/v1/shape`
      const result = applySubdomainSharding(url, true)
      expect(result).toMatch(
        /^http:\/\/[0-9a-f]{5}\.localhost:3000\/v1\/shape$/
      )
    })

    it(`should shard any domain with 'always'`, () => {
      const url = `http://api.example.com/v1/shape`
      const result = applySubdomainSharding(url, `always`)
      expect(result).toMatch(
        /^http:\/\/[0-9a-f]{5}\.api\.example\.com\/v1\/shape$/
      )
    })

    it(`should preserve existing subdomains`, () => {
      const url = `http://api.example.com/v1/shape`
      const result = applySubdomainSharding(url, `always`)
      expect(result).toMatch(/^http:\/\/[0-9a-f]{5}\.api\.example\.com/)
    })
  })

  describe(`with 'localhost' or undefined`, () => {
    it(`should shard localhost URLs`, () => {
      const url = `http://localhost:3000/v1/shape`
      const result = applySubdomainSharding(url, `localhost`)
      expect(result).toMatch(
        /^http:\/\/[0-9a-f]{5}\.localhost:3000\/v1\/shape$/
      )
    })

    it(`should shard localhost URLs when option is undefined`, () => {
      const url = `http://localhost:3000/v1/shape`
      const result = applySubdomainSharding(url, undefined)
      expect(result).toMatch(
        /^http:\/\/[0-9a-f]{5}\.localhost:3000\/v1\/shape$/
      )
    })

    it(`should shard *.localhost URLs`, () => {
      const url = `http://dev.localhost:3000/v1/shape`
      const result = applySubdomainSharding(url, `localhost`)
      expect(result).toMatch(
        /^http:\/\/[0-9a-f]{5}\.dev\.localhost:3000\/v1\/shape$/
      )
    })

    it(`should not shard non-localhost URLs`, () => {
      const url = `http://api.example.com/v1/shape`
      const result = applySubdomainSharding(url, `localhost`)
      expect(result).toBe(url)
    })

    it(`should not shard non-localhost URLs when option is undefined`, () => {
      const url = `http://api.example.com/v1/shape`
      const result = applySubdomainSharding(url, undefined)
      expect(result).toBe(url)
    })

    it(`should not shard IP addresses`, () => {
      const url = `http://127.0.0.1:3000/v1/shape`
      const result = applySubdomainSharding(url, `localhost`)
      expect(result).toBe(url)
    })
  })

  describe(`URL preservation`, () => {
    it(`should preserve ports`, () => {
      const url = `http://localhost:8080/v1/shape`
      const result = applySubdomainSharding(url, `always`)
      expect(result).toMatch(
        /^http:\/\/[0-9a-f]{5}\.localhost:8080\/v1\/shape$/
      )
    })

    it(`should preserve paths`, () => {
      const url = `http://localhost:3000/api/v1/shape/table`
      const result = applySubdomainSharding(url, `always`)
      expect(result).toMatch(/\/api\/v1\/shape\/table$/)
    })

    it(`should preserve query parameters`, () => {
      const url = `http://localhost:3000/v1/shape?table=foo&where=bar`
      const result = applySubdomainSharding(url, `always`)
      expect(result).toMatch(/\?table=foo&where=bar$/)
    })

    it(`should preserve hash fragments`, () => {
      const url = `http://localhost:3000/v1/shape#section`
      const result = applySubdomainSharding(url, `always`)
      expect(result).toMatch(/#section$/)
    })

    it(`should preserve HTTPS protocol`, () => {
      const url = `https://localhost:3000/v1/shape`
      const result = applySubdomainSharding(url, `always`)
      expect(result).toMatch(
        /^https:\/\/[0-9a-f]{5}\.localhost:3000\/v1\/shape$/
      )
    })
  })
})
