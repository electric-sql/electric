import { SignJWT } from 'jose'

type Claims = {
  [key: string]: any
}

export function secureAuthToken(
  claims: Claims,
  iss: string,
  key: string,
  alg?: string,
  exp?: string
): Promise<string> {
  const algorithm = alg ?? 'HS256'
  const expiration = exp ?? '2h'

  const nowInSecs = Math.floor(Date.now() / 1000)
  // Subtract 1 second to account for clock precision when validating the token
  const iat = nowInSecs - 1

  const encodedKey = new TextEncoder().encode(key)

  return new SignJWT({ ...claims, type: 'access' })
    .setIssuedAt(iat)
    .setProtectedHeader({ alg: algorithm })
    .setExpirationTime(expiration)
    .setIssuer(iss)
    .sign(encodedKey)
}

export function insecureAuthToken(claims: Claims): string {
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
