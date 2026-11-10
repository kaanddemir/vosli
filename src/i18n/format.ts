const numbers = new Intl.NumberFormat('tr-TR');
const dates = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const days = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });

/** 1284 becomes 1.284, the way Turkish readers expect. */
export const formatCount = (value: number): string => numbers.format(value);
const plainDates = new Intl.DateTimeFormat('tr', { day: 'numeric', month: 'short', year: 'numeric' });
export const formatDate = (ms: number): string => plainDates.format(ms);
export const formatDateTime = (ms: number): string => dates.format(ms);
/** 4 Kasım Çarşamba */
export const formatDay = (ms: number): string => days.format(ms);
const percents = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 });
/** 0.75 becomes %75, the way Turkish readers write it. */
export const formatPercent = (ratio: number): string => percents.format(ratio);
