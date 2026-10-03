'use strict';
require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const port = parseInt(process.env.PORT || '3000', 10);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Generate once and keep it in the data folder so sign-ins survive restarts.
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, '.session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const cfg = {
  port,
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  dataDir,
  sessionSecret: sessionSecret(),
  appName: process.env.APP_NAME || 'Meadow',
};

cfg.isSecure = cfg.publicUrl.startsWith('https://');

// Which required settings are still missing from .env
cfg.missing = function missing() {
  const m = [];
  if (!cfg.googleClientId) m.push('GOOGLE_CLIENT_ID');
  if (!cfg.googleClientSecret) m.push('GOOGLE_CLIENT_SECRET');
  if (!cfg.adminPassword) m.push('ADMIN_PASSWORD');
  return m;
};

module.exports = cfg;
