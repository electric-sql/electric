import { insecureAuthToken } from 'electric-sql/auth'
import { uuid } from 'electric-sql/util'

// This is just a demo. In a real app, the user ID would
// usually come from somewhere else :)
const dummyUserId = uuid()

// Generate an insecure authentication JWT.
// See https://electric-sql.com/docs/usage/auth for more details.
export const authToken = () => {
  const claims = {'user_id': dummyUserId}

  return insecureAuthToken(claims)
}
