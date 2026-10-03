'use strict';
// A tiny JSON-file database. This app is for one person, so a single file is
// simpler and more reliable than running a database server.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');

const FILE = path.join(cfg.dataDir, 'db.json');

const defaultHours = () => ({
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
  sat: [],
  sun: [],
});

const defaults = () => ({
  settings: {
    hostName: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    slotIncrement: 30,
    defaultHours: defaultHours(),
  },
  accounts: [],      // connected Google accounts, each with its calendars
  destination: null, // { accountId, calendarId } where new bookings are written
  links: [],         // booking links
  bookings: [],      // bookings made through this app
});

let db = null;

function load() {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  if (fs.existsSync(FILE)) {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = Object.assign(defaults(), raw);
    db.settings = Object.assign(defaults().settings, raw.settings || {});
    db.settings.defaultHours = Object.assign(defaultHours(), (raw.settings || {}).defaultHours || {});
  } else {
    db = defaults();
    save();
  }
  return db;
}

function save() {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

function get() {
  return db || load();
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { get, save, newId, FILE, defaultHours };
