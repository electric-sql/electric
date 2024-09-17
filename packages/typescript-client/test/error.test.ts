import { describe, it, expect, vi } from 'vitest'
import { FetchError } from '../src/error'

describe(`FetchError`, () => {
  it(`should create a FetchError with the correct properties`, () => {
    const status = 404
    const text = `Not Found`
    const json = undefined
    const headers = { 'content-type': `text/plain` }
    const url = `https://example.com/notfound`

    const error = new FetchError(status, text, json, headers, url)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe(`FetchError`)
    expect(error.status).toBe(status)
    expect(error.text).toBe(text)
    expect(error.json).toBe(json)
    expect(error.headers).toEqual(headers)
    expect(error.url).toBe(url)
    expect(error.message).toBe(
      `HTTP Error 404 at https://example.com/notfound: Not Found`
    )
  })

  it(`should create a FetchError with a JSON response and use the JSON in the message`, () => {
    const status = 500
    const text = undefined
    const json = { error: `Internal Server Error` }
    const headers = { 'content-type': `application/json` }
    const url = `https://example.com/servererror`

    const error = new FetchError(status, text, json, headers, url)

    expect(error.status).toBe(status)
    expect(error.text).toBeUndefined()
    expect(error.json).toEqual(json)
    expect(error.headers).toEqual(headers)
    expect(error.message).toBe(
      `HTTP Error 500 at https://example.com/servererror: {"error":"Internal Server Error"}`
    )
  })

  it(`should create a FetchError with a custom message if provided`, () => {
    const status = 403
    const text = `Forbidden`
    const json = undefined
    const headers = { 'content-type': `text/plain` }
    const url = `https://example.com/forbidden`
    const customMessage = `Custom Error Message`

    const error = new FetchError(
      status,
      text,
      json,
      headers,
      url,
      customMessage
    )

    expect(error.message).toBe(customMessage)
  })

  describe(`fromResponse`, () => {
    it(`should create a FetchError from a text-based response`, async () => {
      const mockResponse = {
        status: 404,
        headers: new Headers({ 'content-type': `text/plain` }),
        text: vi.fn().mockResolvedValue(`Not Found`),
      } as unknown as Response

      const url = `https://example.com/notfound`
      const error = await FetchError.fromResponse(mockResponse, url)

      expect(mockResponse.text).toHaveBeenCalled()
      expect(error).toBeInstanceOf(FetchError)
      expect(error.status).toBe(404)
      expect(error.text).toBe(`Not Found`)
      expect(error.json).toBeUndefined()
      expect(error.headers).toEqual({ 'content-type': `text/plain` })
      expect(error.message).toBe(
        `HTTP Error 404 at https://example.com/notfound: Not Found`
      )
    })

    it(`should create a FetchError from a JSON-based response`, async () => {
      const mockResponse = {
        status: 500,
        headers: new Headers({ 'content-type': `application/json` }),
        json: vi.fn().mockResolvedValue({ error: `Internal Server Error` }),
      } as unknown as Response

      const url = `https://example.com/servererror`
      const error = await FetchError.fromResponse(mockResponse, url)

      expect(mockResponse.json).toHaveBeenCalled()
      expect(error).toBeInstanceOf(FetchError)
      expect(error.status).toBe(500)
      expect(error.text).toBeUndefined()
      expect(error.json).toEqual({ error: `Internal Server Error` })
      expect(error.headers).toEqual({ 'content-type': `application/json` })
      expect(error.message).toBe(
        `HTTP Error 500 at https://example.com/servererror: {"error":"Internal Server Error"}`
      )
    })

    it(`should handle content-type not set in response headers`, async () => {
      const mockResponse = {
        status: 500,
        headers: new Headers(),
        text: vi.fn().mockResolvedValue(`Server error with no content-type`),
      } as unknown as Response

      const url = `https://example.com/no-content-type`
      const error = await FetchError.fromResponse(mockResponse, url)

      expect(mockResponse.text).toHaveBeenCalled()
      expect(error).toBeInstanceOf(FetchError)
      expect(error.status).toBe(500)
      expect(error.text).toBe(`Server error with no content-type`)
      expect(error.json).toBeUndefined()
      expect(error.headers).toEqual({})
      expect(error.message).toBe(
        `HTTP Error 500 at https://example.com/no-content-type: Server error with no content-type`
      )
    })
  })
})
