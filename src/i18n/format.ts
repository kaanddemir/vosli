import { currentLocale, INTL_LOCALE, type Locale } from './locale';

interface Formats {
  numbers: Intl.NumberFormat;
  percents: Intl.NumberFormat;
  dates: Intl.DateTimeFormat;
  dateTimes: Intl.DateTimeFormat;
  days: Intl.DateTimeFormat;
}

const cache = new Map<string, Formats>();

/**
 * Made once per language, on first use, so an unused language costs nothing. Dates and times are always in the
 * device's own time zone: timestamps are stored as UTC milliseconds and only the display is local. A formatter
 * keeps the zone it was made in, so they are kept per zone too, and a device that changes zone shows the new one.
 */
function formatsFor(locale: Locale): Formats {
  const key = `${locale} ${new Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  let formats = cache.get(key);
  if (!formats) {
    const tag = INTL_LOCALE[locale];
    formats = {
      numbers: new Intl.NumberFormat(tag),
      percents: new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 }),
      dates: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' }),
      dateTimes: new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }),
      days: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', weekday: 'long' }),
    };
    cache.set(key, formats);
  }
  return formats;
}

/** For the strings of one language, which format their own counts whatever language is showing. */
export const formatCountIn = (locale: Locale, value: number): string => formatsFor(locale).numbers.format(value);

/** 1284 becomes 1.284 in Turkish and 1,284 in English. */
export const formatCount = (value: number): string => formatCountIn(currentLocale(), value);
export const formatDate = (ms: number): string => formatsFor(currentLocale()).dates.format(ms);
export const formatDateTime = (ms: number): string => formatsFor(currentLocale()).dateTimes.format(ms);
/** 4 Kasım Çarşamba, or Wednesday, November 4. */
export const formatDay = (ms: number): string => formatsFor(currentLocale()).days.format(ms);
/** 0.75 becomes %75 in Turkish and 75% in English. */
export const formatPercent = (ratio: number): string => formatsFor(currentLocale()).percents.format(ratio);

const pad = (value: number) => String(value).padStart(2, '0');
/** A file name's date and time, 2026-11-25-10-30, in the device's own time zone like every date the app shows. */
export const formatFileStamp = (ms: number): string => {
  const at = new Date(ms);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}-${pad(at.getMinutes())}`;
};
