'use strict';
// Everything that talks to Google Calendar lives here.
const crypto = require('crypto');
const { google } = require('googleapis');
const cfg = require('./config');
const store = require('./store');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',   // list calendars + read free/busy
  'https://www.googleapis.com/auth/calendar.events',     // create / cancel the booked events
  'https://www.googleapis.com/auth/userinfo.email',      // know which account was connected
];

function oauthClient() {
  return new google.auth.OAuth2(cfg.googleClientId, cfg.googleClientSecret, `${cfg.publicUrl}/auth/google/callback`);
}

function authUrl(state) {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',     // gives us a refresh token so sync keeps working forever
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

async function exchangeCode(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const me = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
  return { tokens, email: me.data.email };
}

// An authenticated client for a stored account. Refreshed tokens are saved automatically.
function clientFor(account) {
  const client = oauthClient();
  client.setCredentials(account.tokens);
  client.on('tokens', (t) => {
    account.tokens = Object.assign({}, account.tokens, t);
    store.save();
  });
  return client;
}

function calendarApi(account) {
  return google.calendar({ version: 'v3', auth: clientFor(account) });
}

async function listCalendars(account) {
  const res = await calendarApi(account).calendarList.list({ minAccessRole: 'freeBusyReader', maxResults: 250 });
  return (res.data.items || []).map((c) => ({
    id: c.id,
    name: c.primary ? 'Main calendar' : (c.summaryOverride || c.summary || c.id),
    color: c.backgroundColor || '#8aa08a',
    primary: !!c.primary,
    canWrite: ['owner', 'writer'].includes(c.accessRole),
  }));
}

// Busy intervals ([startMs, endMs]) across many calendars of one account.
async function freeBusy(account, calendarIds, timeMin, timeMax) {
  if (!calendarIds.length) return [];
  const api = calendarApi(account);
  const out = [];
  // Google accepts up to 50 calendars per call.
  for (let i = 0; i < calendarIds.length; i += 50) {
    const chunk = calendarIds.slice(i, i + 50);
    const res = await api.freebusy.query({
      requestBody: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: chunk.map((id) => ({ id })) },
    });
    const cals = res.data.calendars || {};
    for (const id of Object.keys(cals)) {
      for (const b of cals[id].busy || []) out.push([Date.parse(b.start), Date.parse(b.end)]);
    }
  }
  return out;
}

async function createEvent(account, calendarId, ev) {
  const api = calendarApi(account);
  const requestBody = {
    summary: ev.summary,
    description: ev.description,
    start: { dateTime: ev.start.toISOString(), timeZone: ev.timeZone },
    end: { dateTime: ev.end.toISOString(), timeZone: ev.timeZone },
    attendees: [{ email: ev.attendeeEmail, displayName: ev.attendeeName, responseStatus: 'accepted' }],
    reminders: { useDefault: true },
    guestsCanInviteOthers: false,
  };
  if (ev.location) requestBody.location = ev.location;
  if (ev.meet) {
    requestBody.conferenceData = {
      createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    };
  }
  const res = await api.events.insert({
    calendarId,
    sendUpdates: 'all',                 // Google emails the invitation to the guest
    conferenceDataVersion: ev.meet ? 1 : 0,
    requestBody,
  });
  return res.data;
}

async function deleteEvent(account, calendarId, eventId) {
  await calendarApi(account).events.delete({ calendarId, eventId, sendUpdates: 'all' });
}

module.exports = { SCOPES, authUrl, exchangeCode, listCalendars, freeBusy, createEvent, deleteEvent };
