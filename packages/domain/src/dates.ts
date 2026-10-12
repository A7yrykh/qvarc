// Даты проживания хранятся строками 'YYYY-MM-DD' без часового пояса.
// Вся арифметика идёт в UTC, чтобы переход на летнее время не сдвигал ночи.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: string): Date {
  if (!ISO_DATE.test(value)) throw new Error(`Некорректная дата: ${value}`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || formatDate(d) !== value) throw new Error(`Некорректная дата: ${value}`);
  return d;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const d = parseDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

/** Ночи проживания: от заезда включительно до выезда не включительно. */
export function nightsBetween(arrival: string, departure: string): string[] {
  const n = diffDays(arrival, departure);
  if (n <= 0) throw new Error('Дата выезда должна быть позже даты заезда');
  return Array.from({ length: n }, (_, i) => addDays(arrival, i));
}

/** ISO-день недели: 1 = понедельник, 7 = воскресенье. */
export function isoWeekday(value: string): number {
  const day = parseDate(value).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Сегодняшняя дата в часовом поясе объекта. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Диапазон PostgreSQL daterange в виде '[a,b)' и обратно. */
export function toDateRange(from: string, to: string): string {
  return `[${from},${to})`;
}

export function parseDateRange(range: string): { from: string; to: string } {
  const m = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/.exec(range);
  if (!m) throw new Error(`Неподдерживаемый диапазон дат: ${range}`);
  return { from: m[1], to: m[2] };
}
