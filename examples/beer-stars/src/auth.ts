import { insecureAuthToken } from 'electric-sql/auth'
import { uuid } from 'electric-sql/util'

const dummyUserId = uuid()

export const authToken = () => {
  const claims = {
    user_id: dummyUserId
  }

  return insecureAuthToken(claims)
}
