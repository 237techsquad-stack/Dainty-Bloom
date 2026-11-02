const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
  year: 'numeric',
});

export function formatDate(value: string | Date): string {
  return dateFormatter.format(new Date(value));
}
