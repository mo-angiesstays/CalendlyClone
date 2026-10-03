'use strict';
const express = require('express');
const crypto = require('crypto');
const cfg = require('../config');
const store = require('../store');
const google = require('../google');
const T = require('../time');
const { liveSlots, resolveDestination, describeLocation } = require('../booking');

const router = express.Router();

function findLink(slug) {
  return store.get().links.find((l) => l.slug === slug && l.active);
}

function cancelToken(id) {
  return crypto.createHmac('sha256', cfg.sessionSecret).update(`cancel.${id}`).digest('base64url').slice(0, 24);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}

// The public booking page
router.get('/book/:slug', (req, res) => {
  const link = findLink(req.params.slug);
  if (!link) return res.status(404).render('error', { title: 'Link not found', message: 'This booking link isn\'t available right now.' });
  const db = store.get();
  res.render('book', { link, settings: db.settings, location: describeLocation(link), T });
});

// Live availability for a date range (asks Google at request time)
router.get('/api/book/:slug/slots', async (req, res, next) => {
  try {
    const link = findLink(req.params.slug);
    if (!link) throw httpError(404, 'This booking link isn\'t available.');
    const now = new Date();
    let from = new Date(req.query.from || now);
    let to = new Date(req.query.to || now);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw httpError(400, 'Bad date range.');
    if (from < now) from = now;
    const horizon = new Date(now.getTime() + (link.maxDaysAhead || 60) * 86400000);
    if (to > horizon) to = horizon;
    if (to.getTime() - from.getTime() > 70 * 86400000) to = new Date(from.getTime() + 70 * 86400000);
    if (to <= from) return res.json({ slots: [], timezone: store.get().settings.timezone });
    const slots = await liveSlots(link, from, to, now);
    res.set('Cache-Control', 'no-store');
    res.json({ slots, timezone: store.get().settings.timezone, duration: link.duration });
  } catch (e) {
    if (!e.status) {
      console.error('Availability lookup failed:', e.message);
      return res.status(502).json({ error: 'We couldn\'t reach the calendar just now. Please refresh in a moment.' });
    }
    next(e);
  }
});

// Make a booking
router.post('/api/book/:slug', async (req, res, next) => {
  try {
    const link = findLink(req.params.slug);
    if (!link) throw httpError(404, 'This booking link isn\'t available.');
    const db = store.get();
    const body = req.body || {};
    const start = new Date(body.start);
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().slice(0, 200);
    const notes = String(body.notes || '').trim().slice(0, 2000);
    const guestTz = T.isValidTimeZone(body.timezone) ? body.timezone : db.settings.timezone;
    if (Number.isNaN(start.getTime())) throw httpError(400, 'Please choose a time.');
    if (!name) throw httpError(400, 'Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Please enter a valid email address.');

    const destination = resolveDestination(db);
    if (!destination) throw httpError(503, 'The host hasn\'t connected a calendar yet.');

    // Check the slot is still free at this very moment (someone else may have grabbed it).
    const end = new Date(start.getTime() + link.duration * 60000);
    const slots = await liveSlots(link, new Date(start.getTime() - 86400000), new Date(end.getTime() + 86400000));
    if (!slots.includes(start.getTime())) throw httpError(409, 'Sorry, that time was just taken. Please pick another one.');

    const hostName = db.settings.hostName || 'the host';
    const descriptionLines = [
      `${link.name} booked through ${cfg.appName}.`,
      '',
      `Guest: ${name} (${email})`,
      notes ? `Notes: ${notes}` : null,
      '',
      `Need to reschedule? Cancel here: ${cfg.publicUrl}/cancel/${'{{id}}'}`,
    ].filter((l) => l !== null);

    const bookingId = store.newId();
    const token = cancelToken(bookingId);
    const event = await google.createEvent(destination.account, destination.calendar.id, {
      summary: `${link.name}: ${name} & ${hostName}`,
      description: descriptionLines.join('\n').replace('{{id}}', `${bookingId}/${token}`),
      start, end,
      timeZone: db.settings.timezone,
      attendeeEmail: email,
      attendeeName: name,
      meet: link.locationType === 'meet',
      location: link.locationType === 'in_person' || link.locationType === 'custom' ? link.locationDetail : (link.locationType === 'phone' && link.locationDetail ? `Phone: ${link.locationDetail}` : undefined),
    });

    const booking = {
      id: bookingId,
      linkId: link.id,
      linkName: link.name,
      start: start.toISOString(),
      end: end.toISOString(),
      name, email, notes,
      timezone: guestTz,
      accountId: destination.account.id,
      calendarId: destination.calendar.id,
      eventId: event.id,
      htmlLink: event.htmlLink || '',
      meetLink: event.hangoutLink || '',
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };
    db.bookings.push(booking);
    store.save();
    res.json({ ok: true, redirect: `/book/${link.slug}/confirmed/${booking.id}?tz=${encodeURIComponent(guestTz)}` });
  } catch (e) {
    if (!e.status) {
      console.error('Booking failed:', e.message);
      return res.status(502).json({ error: 'We couldn\'t save the booking to the calendar. Please try again.' });
    }
    next(e);
  }
});

router.get('/book/:slug/confirmed/:id', (req, res) => {
  const db = store.get();
  const booking = db.bookings.find((b) => b.id === req.params.id);
  const link = db.links.find((l) => l.slug === req.params.slug);
  if (!booking || !link) return res.status(404).render('error', { title: 'Not found', message: 'We couldn\'t find that booking.' });
  const tz = T.isValidTimeZone(req.query.tz) ? req.query.tz : booking.timezone;
  res.render('confirmed', { booking, link, tz, settings: db.settings, location: describeLocation(link), T, cancelUrl: `/cancel/${booking.id}/${cancelToken(booking.id)}` });
});

// Guest self-cancel (the link is in their calendar invitation)
router.get('/cancel/:id/:token', (req, res) => {
  const db = store.get();
  const booking = db.bookings.find((b) => b.id === req.params.id);
  if (!booking || req.params.token !== cancelToken(booking.id)) {
    return res.status(404).render('error', { title: 'Not found', message: 'This cancellation link isn\'t valid.' });
  }
  res.render('cancel', { booking, settings: db.settings, T, token: req.params.token, done: false });
});

router.post('/cancel/:id/:token', async (req, res) => {
  const db = store.get();
  const booking = db.bookings.find((b) => b.id === req.params.id);
  if (!booking || req.params.token !== cancelToken(booking.id)) {
    return res.status(404).render('error', { title: 'Not found', message: 'This cancellation link isn\'t valid.' });
  }
  if (booking.status === 'confirmed') {
    const account = db.accounts.find((a) => a.id === booking.accountId);
    try {
      if (account && booking.eventId) await google.deleteEvent(account, booking.calendarId, booking.eventId);
    } catch (e) {
      if (!(e.code === 404 || e.code === 410)) {
        return res.status(502).render('error', { title: 'Please try again', message: 'We couldn\'t reach the calendar to cancel. Please try again in a moment.' });
      }
    }
    booking.status = 'cancelled';
    booking.cancelledAt = new Date().toISOString();
    booking.cancelledBy = 'guest';
    store.save();
  }
  res.render('cancel', { booking, settings: db.settings, T, token: req.params.token, done: true });
});

module.exports = router;
