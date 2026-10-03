'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSlots, cleanHours, mergeIntervals } = require('../src/availability');
const T = require('../src/time');

const settings = {
  timezone: 'America/New_York',
  slotIncrement: 30,
  defaultHours: { mon: [{ start: '09:00', end: '12:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
};
const monday = '2026-10-05'; // a Monday
const now = new Date('2026-09-01T00:00:00Z');

test('zonedToUtc handles Eastern time', () => {
  const d = T.zonedToUtc('2026-10-05', '09:00', 'America/New_York');
  assert.equal(d.toISOString(), '2026-10-05T13:00:00.000Z'); // EDT = UTC-4
  const w = T.zonedToUtc('2026-12-07', '09:00', 'America/New_York');
  assert.equal(w.toISOString(), '2026-12-07T14:00:00.000Z'); // EST = UTC-5
});

test('default mode uses regular hours only', () => {
  const link = { mode: 'default', duration: 60, maxDaysAhead: 365 };
  const slots = computeSlots({
    link, settings, busy: [], now,
    rangeStart: T.zonedToUtc(monday, '00:00', settings.timezone),
    rangeEnd: T.zonedToUtc(monday, '23:59', settings.timezone),
  });
  const times = slots.map((s) => T.formatTime(new Date(s), settings.timezone));
  assert.deepEqual(times, ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM']);
});

test('default_plus adds the link\'s extra hours and busy times are removed with buffers', () => {
  const link = {
    mode: 'default_plus', duration: 30, maxDaysAhead: 365, bufferBefore: 15, bufferAfter: 15,
    hours: { mon: [{ start: '14:00', end: '15:00' }] },
  };
  const busy = [[T.zonedToUtc(monday, '10:00', settings.timezone).getTime(), T.zonedToUtc(monday, '10:30', settings.timezone).getTime()]];
  const slots = computeSlots({
    link, settings, busy, now,
    rangeStart: T.zonedToUtc(monday, '00:00', settings.timezone),
    rangeEnd: T.zonedToUtc(monday, '23:59', settings.timezone),
  });
  const times = slots.map((s) => T.formatTime(new Date(s), settings.timezone));
  // 9:30 would end at 10:00, but needs a 15 min gap before the 10:00 meeting -> removed.
  // 10:30 starts right when busy ends but needs 15 min gap -> removed. 11:00 fine.
  assert.deepEqual(times, ['9:00 AM', '11:00 AM', '11:30 AM', '2:00 PM', '2:30 PM']);
});

test('custom mode: a specific-date rule replaces the weekly hours for that date', () => {
  const link = {
    mode: 'custom', duration: 30, maxDaysAhead: 365,
    hours: { mon: [{ start: '08:00', end: '09:00' }] },
    dateRules: [{ date: monday, windows: [{ start: '16:00', end: '17:00' }] }],
  };
  const slots = computeSlots({
    link, settings, busy: [], now,
    rangeStart: T.zonedToUtc(monday, '00:00', settings.timezone),
    rangeEnd: T.zonedToUtc(monday, '23:59', settings.timezone),
  });
  const times = slots.map((s) => T.formatTime(new Date(s), settings.timezone));
  assert.deepEqual(times, ['4:00 PM', '4:30 PM']);
});

test('minimum notice hides slots that are too soon', () => {
  const link = { mode: 'default', duration: 30, maxDaysAhead: 365, minNoticeMinutes: 120 };
  const soon = T.zonedToUtc(monday, '09:15', settings.timezone);
  const slots = computeSlots({
    link, settings, busy: [], now: soon,
    rangeStart: T.zonedToUtc(monday, '00:00', settings.timezone),
    rangeEnd: T.zonedToUtc(monday, '23:59', settings.timezone),
  });
  const times = slots.map((s) => T.formatTime(new Date(s), settings.timezone));
  assert.deepEqual(times, ['11:30 AM']);
});

test('cleanHours drops invalid ranges and sorts', () => {
  const h = cleanHours({ mon: [{ start: '13:00', end: '14:00' }, { start: '09:00', end: '10:00' }, { start: '10:00', end: '09:00' }, { start: 'x' }] });
  assert.deepEqual(h.mon, [{ start: '09:00', end: '10:00' }, { start: '13:00', end: '14:00' }]);
  assert.deepEqual(h.sun, []);
});

test('mergeIntervals merges overlaps', () => {
  assert.deepEqual(mergeIntervals([[1, 5], [4, 8], [10, 12]]), [[1, 8], [10, 12]]);
});
