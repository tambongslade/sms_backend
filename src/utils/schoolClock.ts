// src/utils/schoolClock.ts
//
// Wall-clock "now" in the school's timezone. The server runs in Europe/Berlin
// (CET/CEST) while the school is in Africa/Douala (UTC+1, no DST), so
// `new Date().getHours()` / `getDay()` are off by up to 2 hours and the date
// flips at the wrong midnight. Use these helpers for "today", "current day of
// week" and "minutes since midnight" comparisons against Period.start_time.

export const SCHOOL_TZ = process.env.SCHOOL_TZ || 'Africa/Douala';

export interface SchoolNow {
    /** YYYY-MM-DD in the school timezone. */
    dateStr: string;
    /** UTC-midnight Date of the school-local date (matches @db.Date / setUTCHours(0) storage). */
    dateOnly: Date;
    /** MONDAY..SUNDAY */
    dayOfWeek: string;
    /** Minutes since school-local midnight. */
    minutes: number;
}

export function schoolNow(now: Date = new Date()): SchoolNow {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: SCHOOL_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'long',
        hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
    const hour = parseInt(get('hour'), 10) % 24; // some ICU builds emit "24" at midnight
    return {
        dateStr,
        dateOnly: new Date(`${dateStr}T00:00:00.000Z`),
        dayOfWeek: get('weekday').toUpperCase(),
        minutes: hour * 60 + (parseInt(get('minute'), 10) || 0),
    };
}

export function timeToMinutes(hhmm: string): number {
    const [h, m] = String(hhmm || '').split(':').map((x) => parseInt(x, 10));
    return (h || 0) * 60 + (m || 0);
}
