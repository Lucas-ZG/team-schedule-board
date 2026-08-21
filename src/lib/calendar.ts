import {
  getKoreanDateParts,
  getKoreanHolidayName,
  isKoreanHoliday,
} from "@/lib/koreaHolidays";

export type CalendarDay = {
  date: Date;
  isoDate: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  isSunday: boolean;
  isSaturday: boolean;
  isKoreanHoliday: boolean;
  koreanHolidayName: string | null;
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// How many days back from today a user may self-edit their own daily_status
// records. Mirrored by the RLS policies in
// supabase/migration_20260821_remove_entered_by_lock.sql.
export const SELF_EDIT_WINDOW_DAYS = 7;

export function dateToISO(date: Date) {
  const { year, month, day } = getKoreanDateParts(date);
  return `${year}-${month}-${day}`;
}

function shiftIsoDateByDays(isoDate: string, amount: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return dateToISO(shifted);
}

export function isWithinSelfEditWindow(
  isoDate: string,
  referenceDate: Date = new Date(),
): boolean {
  const cutoff = shiftIsoDateByDays(
    dateToISO(referenceDate),
    -SELF_EDIT_WINDOW_DAYS,
  );
  return isoDate >= cutoff;
}

// Shared read-only lock copy for non-admin users, used by both the
// single-day StatusModal and the multi-day batch apply flow so the
// wording (and the day count) never drifts between the two.
export const WINDOW_LOCK_MESSAGE = `你只能新增或修改最近 ${SELF_EDIT_WINDOW_DAYS} 天內的紀錄，較舊的紀錄請聯絡管理員協助修改。`;

export function addMonths(date: Date, amount: number) {
  const { year, monthNumber } = getKoreanDateParts(date);
  return new Date(Date.UTC(year, monthNumber - 1 + amount, 1, 12));
}

export function getMonthTitle(date: Date) {
  const { year, month } = getKoreanDateParts(date);
  return `${year}/${month}`;
}

function getWeekdayInKorea(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
}

export function buildMonthGrid(monthDate: Date): CalendarDay[] {
  const { year, monthNumber } = getKoreanDateParts(monthDate);
  const month = monthNumber - 1;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstDayOfWeek = getWeekdayInKorea(year, month, 1);
  const lastDayOfWeek = getWeekdayInKorea(year, month, lastDayOfMonth);
  const startDay = 1 - firstDayOfWeek;
  const endDay = lastDayOfMonth + (6 - lastDayOfWeek);

  const todayIso = dateToISO(new Date());
  const days: CalendarDay[] = [];

  for (let dayIndex = startDay; dayIndex <= endDay; dayIndex += 1) {
    const day = new Date(Date.UTC(year, month, dayIndex, 12));
    const parts = getKoreanDateParts(day);
    const weekDay = getWeekdayInKorea(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
    );
    const isoDate = dateToISO(day);
    const koreanHolidayName = getKoreanHolidayName(day);

    days.push({
      date: day,
      isoDate,
      dayNumber: Number(parts.day),
      isCurrentMonth: Number(parts.month) === monthNumber,
      isToday: isoDate === todayIso,
      isWeekend: weekDay === 0 || weekDay === 6,
      isSunday: weekDay === 0,
      isSaturday: weekDay === 6,
      isKoreanHoliday: isKoreanHoliday(day),
      koreanHolidayName,
    });
  }

  return days;
}
