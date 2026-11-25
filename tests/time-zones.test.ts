import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime, formatFileStamp } from '../src/i18n/format';
import { applyLocale, DEFAULT_LOCALE } from '../src/i18n/locale';
import { en } from '../src/i18n/en';

/**
 * Backup times are stored as UTC milliseconds and shown in the device's own time zone, in the interface language.
 * The zone is changed while the module is loaded, as it is when a laptop travels.
 */
const ORIGINAL_ZONE = process.env.TZ;
const inZone = (zone: string) => {
  process.env.TZ = zone;
};
// One space for the narrow and no-break spaces Intl puts around times.
const plain = (text: string) => text.replace(/[  ]/gu, ' ');

afterEach(() => {
  if (ORIGINAL_ZONE === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_ZONE;
  applyLocale(DEFAULT_LOCALE);
});

// 21:30 UTC on 25 November 2026: already 26 November in Istanbul.
const BACKUP = Date.UTC(2026, 10, 25, 21, 30);

describe('backup times follow the device clock', () => {
  it('shows the stored moment in Istanbul, UTC and New York, in each interface language', () => {
    inZone('Europe/Istanbul');
    applyLocale('en');
    expect(plain(formatDateTime(BACKUP))).toBe('Nov 26, 2026, 12:30 AM');
    applyLocale('tr');
    expect(plain(formatDateTime(BACKUP))).toBe('26 Kas 2026 00:30');
    applyLocale('de');
    expect(plain(formatDateTime(BACKUP))).toBe('26.11.2026, 00:30');

    // The same stored value, read on a device that has moved: the display follows without a reload.
    inZone('UTC');
    expect(plain(formatDateTime(BACKUP))).toBe('25.11.2026, 21:30');
    inZone('America/New_York');
    applyLocale('en');
    expect(plain(formatDateTime(BACKUP))).toBe('Nov 25, 2026, 4:30 PM');
  });

  it('names the backup file with the local date and time, not UTC', () => {
    inZone('Europe/Istanbul');
    expect(formatFileStamp(BACKUP)).toBe('2026-11-26-00-30');
    expect(en.settings.backupFileName(formatFileStamp(BACKUP))).toBe('vosli-backup-2026-11-26-00-30.json');
    inZone('UTC');
    expect(formatFileStamp(BACKUP)).toBe('2026-11-25-21-30');
    inZone('America/New_York');
    expect(formatFileStamp(BACKUP)).toBe('2026-11-25-16-30');
    inZone('Asia/Kolkata');
    expect(formatFileStamp(BACKUP)).toBe('2026-11-26-03-00');
  });

  it('crosses daylight saving time by the clock on the wall', () => {
    inZone('Europe/Berlin');
    applyLocale('de');
    // 29 March 2026: 02:00 CET becomes 03:00 CEST. Half an hour either side of the jump.
    expect(formatFileStamp(Date.UTC(2026, 2, 29, 0, 30))).toBe('2026-03-29-01-30');
    expect(formatFileStamp(Date.UTC(2026, 2, 29, 1, 30))).toBe('2026-03-29-03-30');
    // 25 October 2026: 03:00 CEST goes back to 02:00 CET, so 02:30 happens twice, an hour apart.
    expect(plain(formatDateTime(Date.UTC(2026, 9, 25, 0, 30)))).toBe('25.10.2026, 02:30');
    expect(plain(formatDateTime(Date.UTC(2026, 9, 25, 1, 30)))).toBe('25.10.2026, 02:30');
    // Istanbul keeps UTC+3 all year.
    inZone('Europe/Istanbul');
    expect(formatFileStamp(Date.UTC(2026, 6, 1, 12, 0))).toBe('2026-07-01-15-00');
    expect(formatFileStamp(Date.UTC(2026, 0, 1, 12, 0))).toBe('2026-01-01-15-00');
  });
});
