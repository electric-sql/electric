import { insecureAuthToken } from "electric-sql/auth"
import { genUUID } from "electric-sql/util"

// This is just a demo. In a real app, the user ID would
// usually come from somewhere else :)
export const dummyUserId = genUUID() //`d4f54ff3-5c5c-4898-ae30-4f3ee630e5c9`

// Generate an insecure authentication JWT.
// See https://electric-sql.com/docs/usage/auth for more details.
export const authToken = () => {
  const claims = { user_id: dummyUserId }

  return insecureAuthToken(claims)
}
