export function getDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function formatDateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year.slice(2)}`;
}
