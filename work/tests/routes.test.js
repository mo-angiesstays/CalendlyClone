'use strict';
// End-to-end test of the web app with Google Calendar stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meadow-test-'));
process.env.DATA_DIR = tmp;
process.env.GOOGLE_CLIENT_ID = 'test-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'hunter2';
process.env.PUBLIC_URL = 'http://localhost:0';

const google = require('../src/google');
const store = require('../src/store');
const T = require('../src/time');

// --- stub Google ---
let busy = [];
const created = [];
google.freeBusy = async () => busy;
google.createEvent = async (account, calendarId, ev) => { created.push({ calendarId, ev }); return { id: 'evt_1', htmlLink: 'https://calendar.google.com/evt_1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }; };
google.deleteEvent = async () => {};

const app = require('../server');
let base;
let server;
let cookie = '';

async function req(method, url, { body, json, redirect = 'manual' } = {}) {
  const headers = { cookie };
  let payload;
  if (json) { headers['content-type'] = 'application/json'; payload = JSON.stringify(json); }
  else if (body) { headers['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
  const res = await fetch(base + url, { method, headers, body: payload, redirect });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  const db = store.get();
  db.settings.timezone = 'America/New_York';
  db.settings.hostName = 'Monish';
  db.accounts.push({
    id: 'acct1', email: 'me@example.com', tokens: { refresh_token: 'x' },
    calendars: [
      { id: 'primary', name: 'Main', color: '#8aa08a', primary: true, canWrite: true, checkBusy: true },
      { id: 'work@group.calendar.google.com', name: 'Work', color: '#333', primary: false, canWrite: true, checkBusy: true },
    ],
  });
  db.destination = { accountId: 'acct1', calendarId: 'primary' };
  store.save();
});

test('login is required for admin pages', async () => {
  const res = await req('GET', '/admin');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/login/);
});

test('wrong password is rejected, right password signs in', async () => {
  let res = await req('POST', '/login', { body: { password: 'nope', next: '/admin' } });
  assert.equal(res.status, 401);
  res = await req('POST', '/login', { body: { password: 'hunter2', next: '/admin' } });
  assert.equal(res.status, 302);
  assert.ok(cookie.startsWith('meadow_session='));
  res = await req('GET', '/admin');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Good to see you, Monish/);
});

test('saving regular hours', async () => {
  const hours = { mon: [{ start: '09:00', end: '12:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  const res = await req('POST', '/admin/hours', { body: { hostName: 'Monish', timezone: 'America/New_York', slotIncrement: '30', hoursJson: JSON.stringify(hours) } });
  assert.equal(res.status, 302);
  assert.deepEqual(store.get().settings.defaultHours.mon, [{ start: '09:00', end: '12:00' }]);
});

test('creating a booking link with extra hours', async () => {
  const res = await req('POST', '/admin/links/save', {
    body: {
      id: '', name: 'Intro call', slug: '', description: 'Say hi', duration: '30', locationType: 'meet', color: '#8aa08a',
      mode: 'default_plus', hoursJson: JSON.stringify({ sat: [{ start: '10:00', end: '11:00' }] }), dateRulesJson: '[]',
      checkConflicts: 'on', bufferBefore: '0', bufferAfter: '0', minNoticeHours: '0', maxDaysAhead: '365', slotIncrement: '0', active: 'on',
    },
  });
  assert.equal(res.status, 302);
  const link = store.get().links[0];
  assert.equal(link.slug, 'intro-call');
  assert.equal(link.mode, 'default_plus');
  assert.deepEqual(link.hours.sat, [{ start: '10:00', end: '11:00' }]);
});

test('public page renders and live slots respect busy calendars', async () => {
  let res = await fetch(`${base}/book/intro-call`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Intro call/);

  // Find the next Monday and Saturday
  const now = new Date();
  let d = T.dateStr(now, 'America/New_York');
  while (T.weekdayOf(d) !== 'mon') d = T.addDays(d, 1);
  const monday = d;
  const from = T.zonedToUtc(monday, '00:00', 'America/New_York');
  const to = T.zonedToUtc(T.addDays(monday, 6), '23:59', 'America/New_York');

  busy = [[T.zonedToUtc(monday, '10:00', 'America/New_York').getTime(), T.zonedToUtc(monday, '11:00', 'America/New_York').getTime()]];
  res = await fetch(`${base}/api/book/intro-call/slots?from=${from.toISOString()}&to=${to.toISOString()}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  const times = data.slots.map((s) => `${T.dateStr(new Date(s), 'America/New_York')} ${T.formatTime(new Date(s), 'America/New_York')}`);
  const saturday = T.addDays(monday, 5);
  const expected = [`${monday} 9:00 AM`, `${monday} 9:30 AM`, `${monday} 11:00 AM`, `${monday} 11:30 AM`, `${saturday} 10:00 AM`, `${saturday} 10:30 AM`]
    .filter((t) => T.zonedToUtc(t.slice(0, 10), '00:00', 'America/New_York') > now || t.slice(0, 10) !== T.dateStr(now, 'America/New_York'));
  // Slots earlier than "now" are dropped on the current day, so compare as a subset check when testing on a Monday.
  for (const t of times) assert.ok(expected.includes(t), `unexpected slot ${t}`);
  assert.ok(times.length >= 2);
});

test('booking a slot creates a calendar event and blocks the slot afterwards', async () => {
  const now = new Date();
  let d = T.addDays(T.dateStr(now, 'America/New_York'), 7);
  while (T.weekdayOf(d) !== 'mon') d = T.addDays(d, 1);
  busy = [];
  const start = T.zonedToUtc(d, '09:30', 'America/New_York');

  // Bad email is rejected
  let res = await fetch(`${base}/api/book/intro-call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: start.toISOString(), name: 'Sam', email: 'nope' }) });
  assert.equal(res.status, 400);

  res = await fetch(`${base}/api/book/intro-call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: start.toISOString(), name: 'Sam Guest', email: 'sam@example.com', notes: 'Looking forward', timezone: 'Europe/London' }) });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.redirect.startsWith('/book/intro-call/confirmed/'));
  assert.equal(created.length, 1);
  assert.equal(created[0].calendarId, 'primary');
  assert.equal(created[0].ev.summary, 'Intro call: Sam Guest & Monish');
  assert.equal(created[0].ev.attendeeEmail, 'sam@example.com');
  assert.equal(created[0].ev.meet, true);

  // Same slot again -> taken
  res = await fetch(`${base}/api/book/intro-call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: start.toISOString(), name: 'Other', email: 'o@example.com' }) });
  assert.equal(res.status, 409);

  // Confirmation page
  res = await fetch(`${base}${out.redirect}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /You're booked/);
  assert.match(html, /meet\.google\.com/);

  // Guest cancel link works
  const m = html.match(/href="(\/cancel\/[^"]+)"/);
  assert.ok(m, 'cancel link present');
  res = await fetch(`${base}${m[1]}`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(store.get().bookings[0].status, 'cancelled');
});

test('a slot outside the hours cannot be booked', async () => {
  let d = T.addDays(T.dateStr(new Date(), 'America/New_York'), 7);
  while (T.weekdayOf(d) !== 'tue') d = T.addDays(d, 1);
  const start = T.zonedToUtc(d, '09:00', 'America/New_York');
  const res = await fetch(`${base}/api/book/intro-call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start: start.toISOString(), name: 'X', email: 'x@example.com' }) });
  assert.equal(res.status, 409);
});

test('admin pages render', async () => {
  for (const url of ['/admin/calendars', '/admin/hours', '/admin/links', '/admin/links/new', '/admin/bookings', `/admin/links/${store.get().links[0].id}/edit`]) {
    const res = await req('GET', url);
    assert.equal(res.status, 200, url);
  }
});

test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
