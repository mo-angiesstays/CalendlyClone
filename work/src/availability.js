'use strict';
// Turns "hours" + "busy times" into bookable time slots.
const T = require('./time');

// Validate and tidy a weekly-hours object: { mon: [{start,end}], ... }
function cleanHours(input) {
  const out = {};
  for (const day of T.DAY_KEYS) {
    const list = Array.isArray(input && input[day]) ? input[day] : [];
    out[day] = list
      .filter((w) => w && T.isHM(w.start) && T.isHM(w.end) && T.hmToMinutes(w.end) > T.hmToMinutes(w.start))
      .map((w) => ({ start: w.start, end: w.end }))
      .sort((a, b) => T.hmToMinutes(a.start) - T.hmToMinutes(b.start));
  }
  return out;
}

// Validate date-specific rules: [{ date: 'YYYY-MM-DD', windows: [{start,end}] }]
function cleanDateRules(input) {
  if (!Array.isArray(input)) return [];
  const byDate = new Map();
  for (const r of input) {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) continue;
    const windows = (Array.isArray(r.windows) ? r.windows : [])
      .filter((w) => w && T.isHM(w.start) && T.isHM(w.end) && T.hmToMinutes(w.end) > T.hmToMinutes(w.start))
      .map((w) => ({ start: w.start, end: w.end }));
    byDate.set(r.date, { date: r.date, windows: [...(byDate.get(r.date)?.windows || []), ...windows] });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Which hour windows apply to a link on a given date?
//   default       -> your regular hours only
//   default_plus  -> your regular hours + this link's extra hours (+ its specific dates)
//   custom        -> only this link's hours; a specific-date rule replaces the weekly hours for that date
function windowsForDate(link, settings, ds) {
  const day = T.weekdayOf(ds);
  const base = (settings.defaultHours || {})[day] || [];
  const weekly = (link.hours || {})[day] || [];
  const rule = (link.dateRules || []).find((r) => r.date === ds);
  let windows;
  if (link.mode === 'default') windows = base;
  else if (link.mode === 'default_plus') windows = [...base, ...weekly, ...(rule ? rule.windows : [])];
  else windows = rule ? rule.windows : weekly;
  return windows.filter((w) => w && T.isHM(w.start) && T.isHM(w.end) && T.hmToMinutes(w.end) > T.hmToMinutes(w.start));
}

function mergeIntervals(list) {
  const sorted = list.filter((i) => i[1] > i[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function overlaps(s, e, intervals) {
  for (const [bs, be] of intervals) {
    if (bs >= e) break; // intervals are sorted
    if (bs < e && be > s) return true;
  }
  return false;
}

/**
 * Compute bookable slot start times (ms since epoch), sorted.
 * @param {object} o
 * @param {object} o.link       booking link
 * @param {object} o.settings   global settings (timezone, defaultHours, slotIncrement)
 * @param {Array<[number,number]>} o.busy  busy intervals [startMs, endMs]
 * @param {Date} o.rangeStart   earliest instant to consider
 * @param {Date} o.rangeEnd     latest instant to consider
 * @param {Date} [o.now]
 */
function computeSlots({ link, settings, busy, rangeStart, rangeEnd, now = new Date() }) {
  const tz = settings.timezone;
  const durationMs = (link.duration || 30) * 60000;
  const stepMs = (link.slotIncrement || settings.slotIncrement || link.duration || 30) * 60000;
  const minStart = now.getTime() + (link.minNoticeMinutes || 0) * 60000;
  const maxStart = now.getTime() + (link.maxDaysAhead || 60) * 86400000;
  const padBefore = (link.bufferBefore || 0) * 60000; // gap needed before a new meeting
  const padAfter = (link.bufferAfter || 0) * 60000;   // gap needed after a new meeting

  // Expand every busy block so the buffers are respected on both sides.
  const blocked = mergeIntervals(busy.map(([s, e]) => [s - padAfter, e + padBefore]));

  const slots = new Set();
  let day = T.dateStr(rangeStart, tz);
  const lastDay = T.dateStr(rangeEnd, tz);
  while (day <= lastDay) {
    const windows = windowsForDate(link, settings, day)
      .map((w) => [T.zonedToUtc(day, w.start, tz).getTime(), T.zonedToUtc(day, w.end, tz).getTime()]);
    for (const [ws, we] of mergeIntervals(windows)) {
      for (let s = ws; s + durationMs <= we; s += stepMs) {
        if (s < minStart || s > maxStart) continue;
        if (s < rangeStart.getTime() || s > rangeEnd.getTime()) continue;
        if (overlaps(s, s + durationMs, blocked)) continue;
        slots.add(s);
      }
    }
    day = T.addDays(day, 1);
  }
  return [...slots].sort((a, b) => a - b);
}

module.exports = { cleanHours, cleanDateRules, windowsForDate, mergeIntervals, computeSlots };
