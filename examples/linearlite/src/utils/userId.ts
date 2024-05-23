const USER_ID_KEY = '__electric_user_id'
export function getUserId(): string {
  return sessionStorage.getItem(USER_ID_KEY) || 'testuser'
}

export function setUserId(userId: string) {
  sessionStorage.setItem(USER_ID_KEY, userId)
}
