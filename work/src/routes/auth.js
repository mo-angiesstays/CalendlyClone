'use strict';
const express = require('express');
const crypto = require('crypto');
const auth = require('../auth');
const store = require('../store');
const google = require('../google');

const router = express.Router();
const pendingStates = new Map(); // state -> expiry, protects the OAuth callback

router.get('/', (req, res) => res.redirect(auth.isSignedIn(req) ? '/admin' : '/login'));

router.get('/login', (req, res) => {
  if (auth.isSignedIn(req)) return res.redirect('/admin');
  res.render('login', { next: typeof req.query.next === 'string' ? req.query.next : '/admin', failed: false });
});

router.post('/login', (req, res) => {
  const next = typeof req.body.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/admin';
  if (!auth.checkPassword(req.body.password)) {
    return res.status(401).render('login', { next, failed: true });
  }
  auth.setSessionCookie(res, auth.makeToken());
  res.redirect(next);
});

router.post('/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.redirect('/login');
});

// --- Google account connection -------------------------------------------

router.get('/auth/google', auth.requireAdmin, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  res.redirect(google.authUrl(state));
});

router.get('/auth/google/callback', auth.requireAdmin, async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    const expiry = pendingStates.get(state);
    pendingStates.delete(state);
    if (error) return res.redirect(`/admin/calendars?err=${encodeURIComponent('Google sign-in was cancelled.')}`);
    if (!expiry || expiry < Date.now() || typeof code !== 'string') {
      return res.redirect(`/admin/calendars?err=${encodeURIComponent('That sign-in link expired. Please try again.')}`);
    }
    const { tokens, email } = await google.exchangeCode(code);
    const db = store.get();
    let account = db.accounts.find((a) => a.email === email);
    if (account) {
      // Re-connecting: keep the old refresh token if Google didn't send a new one.
      account.tokens = Object.assign({}, account.tokens, tokens);
    } else {
      account = { id: store.newId(), email, tokens, calendars: [], connectedAt: new Date().toISOString() };
      db.accounts.push(account);
    }
    if (!account.tokens.refresh_token) {
      console.warn('No refresh token received for', email);
    }
    const found = await google.listCalendars(account);
    const previous = new Map(account.calendars.map((c) => [c.id, c]));
    account.calendars = found.map((c) => ({ ...c, checkBusy: previous.has(c.id) ? previous.get(c.id).checkBusy : true }));
    if (!db.destination) {
      const primary = account.calendars.find((c) => c.primary && c.canWrite) || account.calendars.find((c) => c.canWrite);
      if (primary) db.destination = { accountId: account.id, calendarId: primary.id };
    }
    store.save();
    res.redirect(`/admin/calendars?ok=${encodeURIComponent(`Connected ${email}`)}`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
