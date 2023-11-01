import dayjs from 'dayjs'

export function formatDate(date?: string): string {
  if (!date) return ''
  return dayjs(new Date(date)).format('D MMM')
}
