import base64 from 'react-native-base64'

import { TokenClaims } from 'electric-sql/auth'

// This is just a demo. In a real app, the user ID would
// usually come from somewhere else :)
export const dummyUserId = "40609783-9943-4035-8db0-fce39798e64e"

// Generate an insecure authentication JWT.
// See https://electric-sql.com/docs/usage/auth for more details.
export const authToken = () => {
  const claims = {'user_id': dummyUserId}

  return insecureAuthToken(claims)
}

function insecureAuthToken(claims: TokenClaims): string {
  const header = {
    alg: 'none',
  }

  return `${encode(header)}.${encode(claims)}.`
}

function encode(data: object): string {
  const str = JSON.stringify(data)
  const bytes = new TextEncoder().encode(str)

  const binArray = Array.from(bytes, (x) => String.fromCodePoint(x))
  const binString = binArray.join('')
  const encoded = base64.encode(binString)

  return encoded.replace(/\+/g, '-').replace(/\//, '_').replace(/=+$/, '')
}