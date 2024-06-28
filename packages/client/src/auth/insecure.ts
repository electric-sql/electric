import { TokenClaims } from './index'
import { base64 } from '../util/encoders'

export function insecureAuthToken(claims: TokenClaims): string {
  const header = {
    alg: 'none',
  }

  return `${encode(header)}.${encode(claims)}.`
}

function encode(data: object): string {
  const str = JSON.stringify(data)
  const encoded = base64.encode(str)

  return encoded.replace(/\+/g, '-').replace(/\//, '_').replace(/=+$/, '')
}
