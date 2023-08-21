import { getCachedSessionId } from './session'

// We use the sessionId as the userId for this demo.
// This allows us to limit the data that syncs onto
// the device to just the data for the session.
export const userId = () => getCachedSessionId()

export const unsigned = (userId: string) => {
  const header = {
    alg: 'none'
  }

  const claims = {
    user_id: userId
  }

  return `${encode(header)}.${encode(claims)}.`
}

const encode = function (data) {
  const str = JSON.stringify(data)
  const encoded = new Buffer(str).toString('base64')

  return encoded
    .replace(/\+/g, '-')
    .replace(/\//, '_')
    .replace(/=+$/, '')
}
