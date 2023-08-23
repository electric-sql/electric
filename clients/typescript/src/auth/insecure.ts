import { TokenClaims } from './index'

export function insecureAuthToken(claims: TokenClaims): string {
  const header = {
    alg: 'none',
  }

  return `${encode(header)}.${encode(claims)}.`
}

function encode(data: object): string {
  const str = JSON.stringify(data)
  const encoded = new Buffer(str).toString('base64')

  return encoded.replace(/\+/g, '-').replace(/\//, '_').replace(/=+$/, '')
}
