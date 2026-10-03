'use strict';
// Time-zone helpers built only on the Intl API (no extra libraries).

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const WEEK_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

// Calendar fields of an instant, as seen in a time zone.
function parts(date, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(date)) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute, s: +p.second };
}

// Minutes the zone is ahead of UTC at the given instant.
function offsetMinutes(tz, date) {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// "2026-03-14" + "09:30" in a zone -> the exact instant (Date).
function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off1 = offsetMinutes(tz, new Date(guess));
  let result = guess - off1 * 60000;
  const off2 = offsetMinutes(tz, new Date(result));
  if (off2 !== off1) result = guess - off2 * 60000; // DST transition days
  return new Date(result);
}

const pad = (n) => String(n).padStart(2, '0');

// The calendar date ("2026-03-14") of an instant in a zone.
function dateStr(date, tz) {
  const p = parts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

function addDays(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// 'mon', 'tue', ... for a calendar date string.
function weekdayOf(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function allTimeZones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; }
}

function isHM(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function hmToMinutes(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

// Human-friendly formatting used on server-rendered pages.
function formatInstant(date, tz, opts = {}) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', ...opts,
  }).format(date);
}

function formatTime(date, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date);
}

module.exports = {
  DAY_KEYS, DAY_LABELS, WEEK_ORDER, parts, offsetMinutes, zonedToUtc, dateStr, addDays,
  weekdayOf, isValidTimeZone, allTimeZones, isHM, hmToMinutes, formatInstant, formatTime, pad,
};
