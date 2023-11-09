import { TokenClaims } from './index.js'

export function insecureAuthToken(claims: TokenClaims): string {
  const header = {
    alg: 'none',
  }

  return `${encode(header)}.${encode(claims)}.`
}

function encode(data: object): string {
  const str = JSON.stringify(data)
  const encoded = base64(str)

  return encoded.replace(/\+/g, '-').replace(/\//, '_').replace(/=+$/, '')
}

function base64(s: string): string {
  const bytes = new TextEncoder().encode(s)

  const binArray = Array.from(bytes, (x) => String.fromCodePoint(x))
  const binString = binArray.join('')

  return btoa(binString)
}
