import { insecureAuthToken } from 'electric-sql/auth'
import { genUUID } from 'electric-sql/util'

const dummyUserId = genUUID()

export const authToken = () => {
  const claims = {
    user_id: dummyUserId
  }

  return insecureAuthToken(claims)
}
