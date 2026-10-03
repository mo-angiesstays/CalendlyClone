'use strict';
// Shared helpers for computing availability against the connected calendars.
const store = require('./store');
const google = require('./google');
const { computeSlots } = require('./availability');

// All busy intervals that matter for a link in a time range.
async function collectBusy(db, link, from, to) {
  const busy = [];
  if (link.checkConflicts !== false) {
    for (const account of db.accounts) {
      const ids = (account.calendars || []).filter((c) => c.checkBusy).map((c) => c.id);
      if (!ids.length) continue;
      busy.push(...(await google.freeBusy(account, ids, from, to)));
    }
  }
  // Bookings made through this app always block, even if their calendar isn't checked.
  for (const b of db.bookings) {
    if (b.status !== 'confirmed') continue;
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (e > from.getTime() && s < to.getTime()) busy.push([s, e]);
  }
  return busy;
}

// Live availability: asks Google right now, so it's always current.
async function liveSlots(link, from, to, now = new Date()) {
  const db = store.get();
  const busy = await collectBusy(db, link, from, to);
  return computeSlots({ link, settings: db.settings, busy, rangeStart: from, rangeEnd: to, now });
}

function resolveDestination(db) {
  const pick = (accountId, calendarId) => {
    const account = db.accounts.find((a) => a.id === accountId);
    const calendar = account && (account.calendars || []).find((c) => c.id === calendarId);
    return account && calendar ? { account, calendar } : null;
  };
  if (db.destination) {
    const d = pick(db.destination.accountId, db.destination.calendarId);
    if (d) return d;
  }
  for (const account of db.accounts) {
    const cal = (account.calendars || []).find((c) => c.primary && c.canWrite) || (account.calendars || []).find((c) => c.canWrite);
    if (cal) return { account, calendar: cal };
  }
  return null;
}

const MODE_LABELS = {
  default: 'Regular hours',
  default_plus: 'Regular hours + extra hours',
  custom: 'Custom hours for this link only',
};

const LOCATION_LABELS = {
  meet: 'Google Meet',
  phone: 'Phone call',
  in_person: 'In person',
  custom: 'Other',
};

function describeLocation(link) {
  if (link.locationType === 'meet') return 'Google Meet (link sent with the invitation)';
  if (link.locationType === 'phone') return link.locationDetail ? `Phone call: ${link.locationDetail}` : 'Phone call';
  if (link.locationType === 'in_person') return link.locationDetail || 'In person';
  return link.locationDetail || '';
}

module.exports = { collectBusy, liveSlots, resolveDestination, MODE_LABELS, LOCATION_LABELS, describeLocation };
