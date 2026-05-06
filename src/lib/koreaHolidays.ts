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

const koreanDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getKoreanDateParts(date: Date) {
  const parts = koreanDateFormatter.formatToParts(date);
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

export function toKoreanISODate(date: Date) {
  const { year, month, day } = getKoreanDateParts(date);
  return `${year}-${month}-${day}`;
}

export function getKoreanHolidayName(date: Date): string | null {
  const isoDate = toKoreanISODate(date);
  const year = isoDate.slice(0, 4);
  const names = holidayMaps[year]?.[isoDate];

  return names?.join(", ") || null;
}

export function isKoreanHoliday(date: Date): boolean {
  return getKoreanHolidayName(date) !== null;
}
