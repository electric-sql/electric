export function getJoinUrl(threadId: string): string {
  return `${window.location.origin}/join/${threadId}`
}

export function copyInviteLink(threadId: string): void {
  const joinUrl = getJoinUrl(threadId)
  navigator.clipboard.writeText(joinUrl)
}
