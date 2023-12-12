export function formatDateTime(unixTime: number): string {
  const options: Intl.DateTimeFormatOptions = { 
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }
  const formattedDate = new Date(unixTime).toLocaleDateString(
    navigator.language,
    options
  );
  return formattedDate;
}