import dayjs from 'dayjs';

export function formatDate(date?: Date | undefined): string {
  return dayjs(date).format('MMM DD');
}
