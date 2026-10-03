'use strict';
// Simple single-user sign-in using a signed cookie.
const crypto = require('crypto');
const cfg = require('./config');

const COOKIE = 'meadow_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sign(value) {
  return crypto.createHmac('sha256', cfg.sessionSecret).update(value).digest('base64url');
}

function makeToken() {
  const payload = `admin.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const issued = Number(payload.split('.')[1]);
  return Number.isFinite(issued) && Date.now() - issued < MAX_AGE_MS;
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token) {
  const flags = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MAX_AGE_MS / 1000}`];
  if (cfg.isSecure) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function isSignedIn(req) {
  return verifyToken(parseCookies(req)[COOKIE]);
}

function checkPassword(given) {
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(cfg.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (isSignedIn(req)) return next();
  const next_ = encodeURIComponent(req.originalUrl || '/admin');
  return res.redirect(`/login?next=${next_}`);
}

module.exports = { makeToken, verifyToken, setSessionCookie, clearSessionCookie, isSignedIn, checkPassword, requireAdmin, parseCookies };
