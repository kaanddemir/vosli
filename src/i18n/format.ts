import { currentLocale, INTL_LOCALE, type Locale } from './locale';

interface Formats {
  numbers: Intl.NumberFormat;
  percents: Intl.NumberFormat;
  dates: Intl.DateTimeFormat;
  dateTimes: Intl.DateTimeFormat;
  days: Intl.DateTimeFormat;
}

const cache = new Map<Locale, Formats>();

/** Made once per language, on first use, so an unused language costs nothing. */
function formatsFor(locale: Locale): Formats {
  let formats = cache.get(locale);
  if (!formats) {
    const tag = INTL_LOCALE[locale];
    formats = {
      numbers: new Intl.NumberFormat(tag),
      percents: new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 }),
      dates: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' }),
      dateTimes: new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }),
      days: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', weekday: 'long' }),
    };
    cache.set(locale, formats);
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
