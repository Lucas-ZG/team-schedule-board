import {
  y2018,
  y2019,
  y2020,
  y2021,
  y2022,
  y2023,
  y2024,
  y2025,
  y2026,
} from "@hyunbinseo/holidays-kr";
import { getKoreanDateParts, toKoreanISODate } from "@/lib/timezone";

export { getKoreanDateParts, toKoreanISODate };

type HolidayMap = Record<string, readonly string[]>;

const holidayMaps: Record<string, HolidayMap> = {
  "2018": y2018,
  "2019": y2019,
  "2020": y2020,
  "2021": y2021,
  "2022": y2022,
  "2023": y2023,
  "2024": y2024,
  "2025": y2025,
  "2026": y2026,
};

export function getKoreanHolidayName(date: Date): string | null {
  const isoDate = toKoreanISODate(date);
  const year = isoDate.slice(0, 4);
  const names = holidayMaps[year]?.[isoDate];

  return names?.join(", ") || null;
}

export function isKoreanHoliday(date: Date): boolean {
  return getKoreanHolidayName(date) !== null;
}
