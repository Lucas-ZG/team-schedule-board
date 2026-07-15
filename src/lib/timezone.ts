/**
 * Single source of truth for Asia/Seoul (KST) date handling.
 *
 * "Today", OT period boundaries, and export date ranges must all be derived
 * through this module instead of `Date`'s local getters (`getFullYear`,
 * `getMonth`, `getDate`, `toDateString`, ...), which resolve against the
 * machine's (server or browser) local timezone and silently drift by a day
 * whenever that machine isn't set to KST.
 */

export const SEOUL_TIME_ZONE = "Asia/Seoul";

const seoulDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type SeoulDateParts = {
  year: number;
  month: string; // zero-padded, e.g. "07"
  monthNumber: number; // 1-12
  day: string; // zero-padded, e.g. "05"
  dayNumber: number;
};

// Converts any instant into its Asia/Seoul calendar-date parts.
export function getKoreanDateParts(date: Date): SeoulDateParts {
  const parts = seoulDateFormatter.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.year),
    month: values.month,
    monthNumber: Number(values.month),
    day: values.day,
    dayNumber: Number(values.day),
  };
}

export function toKoreanISODate(date: Date): string {
  const { year, month, day } = getKoreanDateParts(date);
  return `${year}-${month}-${day}`;
}

// "Today" in Asia/Seoul, regardless of the machine's local timezone.
export function todaySeoulIsoDate(): string {
  return toKoreanISODate(new Date());
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

// First day (YYYY-MM-01) of the Asia/Seoul calendar month containing `date`.
export function firstOfSeoulMonth(date: Date): string {
  const { year, monthNumber } = getKoreanDateParts(date);
  return `${year}-${pad2(monthNumber)}-01`;
}

// Last day of the Asia/Seoul calendar month containing `date`.
export function lastOfSeoulMonth(date: Date): string {
  const { year, monthNumber } = getKoreanDateParts(date);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${year}-${pad2(monthNumber)}-${pad2(lastDay)}`;
}
