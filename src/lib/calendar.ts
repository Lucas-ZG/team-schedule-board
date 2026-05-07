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

export function dateToISO(date: Date) {
  const { year, month, day } = getKoreanDateParts(date);
  return `${year}-${month}-${day}`;
}

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
