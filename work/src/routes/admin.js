'use strict';
const express = require('express');
const store = require('../store');
const google = require('../google');
const T = require('../time');
const { cleanHours, cleanDateRules } = require('../availability');
const { MODE_LABELS, LOCATION_LABELS, resolveDestination } = require('../booking');

const router = express.Router();

const COLORS = ['#8aa08a', '#5f7a63', '#c9a87c', '#c98b6b', '#9a8fb8', '#7f9bb3', '#b3836f', '#6f8f8a'];

function back(res, to, ok, err) {
  const q = ok ? `?ok=${encodeURIComponent(ok)}` : err ? `?err=${encodeURIComponent(err)}` : '';
  res.redirect(`${to}${q}`);
}

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function toInt(v, fallback, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseJson(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

// --- Overview --------------------------------------------------------------

router.get('/', (req, res) => {
  const db = store.get();
  const now = Date.now();
  const upcoming = db.bookings
    .filter((b) => b.status === 'confirmed' && Date.parse(b.start) >= now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 5);
  const busyCalendars = db.accounts.reduce((n, a) => n + (a.calendars || []).filter((c) => c.checkBusy).length, 0);
  const destination = resolveDestination(db);
  res.render('dashboard', {
    db, upcoming, busyCalendars, destination, T,
    todo: {
      connect: db.accounts.length === 0,
      name: !db.settings.hostName,
      link: db.links.filter((l) => l.active).length === 0,
    },
  });
});

// --- Calendars -------------------------------------------------------------

router.get('/calendars', (req, res) => {
  const db = store.get();
  res.render('calendars', { db, destination: resolveDestination(db) });
});

router.post('/calendars', (req, res) => {
  const db = store.get();
  const busy = new Set([].concat(req.body.busy || []));
  for (const account of db.accounts) {
    for (const cal of account.calendars || []) cal.checkBusy = busy.has(`${account.id}|${cal.id}`);
  }
  if (typeof req.body.destination === 'string' && req.body.destination.includes('|')) {
    const [accountId, calendarId] = req.body.destination.split('|');
    const account = db.accounts.find((a) => a.id === accountId);
    const cal = account && account.calendars.find((c) => c.id === calendarId && c.canWrite);
    if (cal) db.destination = { accountId, calendarId };
  }
  store.save();
  back(res, '/admin/calendars', 'Calendar settings saved.');
});

router.post('/calendars/:accountId/refresh', async (req, res, next) => {
  try {
    const db = store.get();
    const account = db.accounts.find((a) => a.id === req.params.accountId);
    if (!account) return back(res, '/admin/calendars', null, 'Account not found.');
    const found = await google.listCalendars(account);
    const previous = new Map(account.calendars.map((c) => [c.id, c]));
    account.calendars = found.map((c) => ({ ...c, checkBusy: previous.has(c.id) ? previous.get(c.id).checkBusy : true }));
    store.save();
    back(res, '/admin/calendars', `Refreshed calendars for ${account.email}.`);
  } catch (e) {
    back(res, '/admin/calendars', null, `Could not reach Google for that account. Try reconnecting it. (${e.message})`);
  }
});

router.post('/calendars/:accountId/disconnect', (req, res) => {
  const db = store.get();
  const account = db.accounts.find((a) => a.id === req.params.accountId);
  db.accounts = db.accounts.filter((a) => a.id !== req.params.accountId);
  if (db.destination && db.destination.accountId === req.params.accountId) db.destination = null;
  store.save();
  back(res, '/admin/calendars', account ? `Disconnected ${account.email}.` : 'Disconnected.');
});

// --- Regular hours & profile ----------------------------------------------

router.get('/hours', (req, res) => {
  const db = store.get();
  res.render('hours', { db, T, timeZones: T.allTimeZones() });
});

router.post('/hours', (req, res) => {
  const db = store.get();
  db.settings.hostName = String(req.body.hostName || '').trim().slice(0, 80);
  if (T.isValidTimeZone(req.body.timezone)) db.settings.timezone = req.body.timezone;
  db.settings.slotIncrement = toInt(req.body.slotIncrement, 30, 5, 240);
  db.settings.defaultHours = cleanHours(parseJson(req.body.hoursJson, {}));
  store.save();
  back(res, '/admin/hours', 'Your regular hours were saved.');
});

// --- Booking links ---------------------------------------------------------

router.get('/links', (req, res) => {
  const db = store.get();
  res.render('links', { db, MODE_LABELS, LOCATION_LABELS });
});

function blankLink() {
  return {
    id: '', name: '', slug: '', description: '', duration: 30, locationType: 'meet', locationDetail: '',
    color: COLORS[0], mode: 'default', hours: store.defaultHours(), dateRules: [], checkConflicts: true,
    bufferBefore: 0, bufferAfter: 0, minNoticeMinutes: 240, maxDaysAhead: 60, slotIncrement: 0, active: true,
  };
}

router.get('/links/new', (req, res) => {
  const db = store.get();
  res.render('link-form', { db, link: blankLink(), COLORS, T, isNew: true });
});

router.get('/links/:id/edit', (req, res) => {
  const db = store.get();
  const link = db.links.find((l) => l.id === req.params.id);
  if (!link) return back(res, '/admin/links', null, 'That link no longer exists.');
  res.render('link-form', { db, link: { ...blankLink(), ...link }, COLORS, T, isNew: false });
});

router.post('/links/save', (req, res) => {
  const db = store.get();
  const b = req.body;
  const existing = db.links.find((l) => l.id === b.id);
  const link = existing || { id: store.newId(), createdAt: new Date().toISOString() };

  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) return back(res, existing ? `/admin/links/${existing.id}/edit` : '/admin/links/new', null, 'Please give the link a name.');
  let slug = slugify(b.slug) || slugify(name);
  if (!slug) slug = store.newId().slice(0, 8);
  if (db.links.some((l) => l.slug === slug && l.id !== link.id)) {
    return back(res, existing ? `/admin/links/${existing.id}/edit` : '/admin/links/new', null, `The address "/book/${slug}" is already used by another link.`);
  }

  Object.assign(link, {
    name,
    slug,
    description: String(b.description || '').trim().slice(0, 1000),
    duration: toInt(b.duration === 'custom' ? b.durationCustom : b.duration, 30, 5, 600),
    locationType: Object.keys(LOCATION_LABELS).includes(b.locationType) ? b.locationType : 'meet',
    locationDetail: String(b.locationDetail || '').trim().slice(0, 300),
    color: COLORS.includes(b.color) ? b.color : COLORS[0],
    mode: Object.keys(MODE_LABELS).includes(b.mode) ? b.mode : 'default',
    hours: cleanHours(parseJson(b.hoursJson, {})),
    dateRules: cleanDateRules(parseJson(b.dateRulesJson, [])),
    checkConflicts: b.checkConflicts === 'on',
    bufferBefore: toInt(b.bufferBefore, 0, 0, 240),
    bufferAfter: toInt(b.bufferAfter, 0, 0, 240),
    minNoticeMinutes: toInt(b.minNoticeHours, 4, 0, 24 * 60) * 60,
    maxDaysAhead: toInt(b.maxDaysAhead, 60, 1, 365),
    slotIncrement: toInt(b.slotIncrement, 0, 0, 240),
    active: b.active === 'on',
  });
  if (!existing) db.links.push(link);
  store.save();
  back(res, '/admin/links', existing ? `"${name}" was updated.` : `"${name}" is ready to share.`);
});

router.post('/links/:id/toggle', (req, res) => {
  const db = store.get();
  const link = db.links.find((l) => l.id === req.params.id);
  if (link) { link.active = !link.active; store.save(); }
  back(res, '/admin/links', link ? `"${link.name}" is now ${link.active ? 'on' : 'paused'}.` : null);
});

router.post('/links/:id/delete', (req, res) => {
  const db = store.get();
  const link = db.links.find((l) => l.id === req.params.id);
  db.links = db.links.filter((l) => l.id !== req.params.id);
  store.save();
  back(res, '/admin/links', link ? `"${link.name}" was deleted.` : null);
});

// --- Bookings --------------------------------------------------------------

router.get('/bookings', (req, res) => {
  const db = store.get();
  const now = Date.now();
  const sorted = [...db.bookings].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const upcoming = sorted.filter((b) => b.status === 'confirmed' && Date.parse(b.start) >= now);
  const past = sorted.filter((b) => b.status !== 'confirmed' || Date.parse(b.start) < now).reverse().slice(0, 100);
  res.render('bookings', { db, upcoming, past, T });
});

router.post('/bookings/:id/cancel', async (req, res) => {
  const db = store.get();
  const booking = db.bookings.find((b) => b.id === req.params.id);
  if (!booking) return back(res, '/admin/bookings', null, 'Booking not found.');
  const account = db.accounts.find((a) => a.id === booking.accountId);
  try {
    if (account && booking.eventId) await google.deleteEvent(account, booking.calendarId, booking.eventId);
  } catch (e) {
    if (!(e.code === 404 || e.code === 410)) {
      return back(res, '/admin/bookings', null, `Could not remove the event from Google Calendar (${e.message}).`);
    }
  }
  booking.status = 'cancelled';
  booking.cancelledAt = new Date().toISOString();
  booking.cancelledBy = 'host';
  store.save();
  back(res, '/admin/bookings', `Cancelled the booking with ${booking.name}. They've been notified by Google Calendar.`);
});

module.exports = router;
