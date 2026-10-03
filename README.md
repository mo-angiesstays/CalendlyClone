# Meadow

A calm, self-hosted scheduling page (think Calendly, but yours) that stays in sync with **all** of your Google Calendars.

- **Many calendars, one availability.** Connect any number of Google accounts and tick which calendars count as "busy". Work, personal, a shared family calendar: all of them are checked.
- **Always current.** Meadow asks Google for your busy times at the moment a guest opens your page, and again right before a booking is saved. There is nothing to sync and nothing to get stale. The booking page also quietly refreshes itself every minute.
- **Booking links with their own rules.** Each link can use your regular hours, your regular hours *plus* extra time set aside just for that link, or completely custom hours that only that link sees. Specific dates can be added or blocked per link.
- **Bookings land in Google Calendar.** The event is created in the calendar you choose, the guest gets a real Google Calendar invitation by email, and a Google Meet link is generated automatically if you want one.
- **Guests can cancel** from a link in their invitation. You can cancel from the admin area. Either way, Google notifies the other side.

No database server, no build step. One small Node.js app and a `data/db.json` file.

---

## 1. What you need

- A computer (or a small server) that is on whenever people might book. For trying it out, your laptop is fine.
- [Node.js](https://nodejs.org) version 20 or newer. Download the "LTS" installer and run it.
- A Google account. If you use Google Workspace (an email on your own domain), that's even better; see the note in step 3.

Setup takes about 15 minutes. Most of it is clicking through Google's settings once.

## 2. Install the app

Open a terminal (on Mac: *Terminal*; on Windows: *PowerShell*), go to this folder, and run:

```bash
npm install
```

Then make your settings file by copying the example:

```bash
cp .env.example .env        # Mac / Linux
copy .env.example .env      # Windows
```

Open `.env` in any text editor. You'll fill it in during the next step.

## 3. Create your Google "app" (one time)

Meadow talks to Google Calendar on your behalf. Google requires every such tool to be registered, which is free and takes a few minutes.

1. Go to <https://console.cloud.google.com/> and sign in.
2. At the top, click the project dropdown and choose **New project**. Name it anything (e.g. "Meadow"). Create it and make sure it's selected.
3. **Enable the Calendar API.** In the left menu choose **APIs & Services → Library**, search for **Google Calendar API**, open it and click **Enable**.
4. **Consent screen.** Go to **APIs & Services → OAuth consent screen** (Google sometimes calls this "Google Auth Platform → Branding").
   - App name: `Meadow`. Support email: your email. Developer contact: your email.
   - **User type:**
     - If you have **Google Workspace** (your email is on your own domain), choose **Internal**. This is the easiest option: no verification, no warnings, and your connection never expires.
     - Otherwise choose **External**. Then, under **Audience / Test users**, add every Google account you plan to connect. While the app is in "Testing" mode Google disconnects it every 7 days; to avoid that, click **Publish app** once you've confirmed it works. You'll see an "unverified app" warning when connecting (click *Advanced → Go to Meadow*). That's expected for a personal tool.
   - Scopes: you can skip this screen; Meadow asks for what it needs when you connect.
5. **Create credentials.** Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**. Name: `Meadow`.
   - Under **Authorised redirect URIs**, click *Add URI* and enter exactly:
     ```
     http://localhost:3000/auth/google/callback
     ```
     (When you later put Meadow online, come back and add `https://your-address/auth/google/callback` too.)
   - Click **Create**. Copy the **Client ID** and **Client secret** into your `.env` file:
     ```
     GOOGLE_CLIENT_ID=paste-the-client-id-here
     GOOGLE_CLIENT_SECRET=paste-the-client-secret-here
     ADMIN_PASSWORD=choose-any-password
     PUBLIC_URL=http://localhost:3000
     ```
6. Save `.env`.

## 4. Run it

```bash
npm start
```

Open <http://localhost:3000>, sign in with the password you chose, and follow the checklist on the Overview page:

1. **Calendars →** *Connect a Google account*. Repeat for each account. Tick which calendars count as busy and which one new bookings should be added to.
2. **Regular hours →** your name, time zone, and default weekly hours.
3. **Booking links →** *New booking link*. Pick a duration, a location (Google Meet is automatic), and how availability should work:
   - *My regular hours*
   - *My regular hours, plus extra time just for this link* (e.g. also Saturdays 10–2 for this link only)
   - *Custom hours for this link only* (ignore regular hours; use only what you set here)
4. Share the link's address. Guests pick a time in their own time zone, enter their name and email, and the event appears in your calendar instantly.

Stop the app with `Ctrl+C`. Start it again with `npm start`. Your settings and bookings live in the `data/` folder; back that folder up and you've backed up everything.

## 5. Putting it online (so people can book while your laptop is closed)

Running on `localhost` only works on your own machine. To share links with others, the app has to run somewhere that's always on, with a public `https://` address. Three easy routes:

**a) A small hosting service (Railway, Render, Fly.io).** Each has a free or very cheap tier for Node apps.
1. Push this folder to a GitHub repository (or connect the host to this one).
2. Create a new web service from the repo. Root directory: `work`. Start command: `npm start`.
3. Add the same four `.env` values as environment variables, but set `PUBLIC_URL` to the address the host gives you (e.g. `https://meadow-production.up.railway.app`).
4. **Important:** attach a persistent disk/volume and set `DATA_DIR` to a folder on it (e.g. `/data`). Without one, the host may wipe `data/db.json` on every deploy, and you'd lose your settings and booking history. (Bookings already in Google Calendar are never lost.)
5. In Google Cloud → Credentials → your OAuth client, add `https://your-address/auth/google/callback` to the redirect URIs.
6. Optional: point a custom domain like `book.yourdomain.com` at it in the host's settings and use that as `PUBLIC_URL`.

**b) A computer at home that stays on** (an old laptop, a Mac mini, a Raspberry Pi) plus a tunnel such as Cloudflare Tunnel or Tailscale Funnel to give it a public https address. Set `PUBLIC_URL` to that address.

**c) Any VPS** (DigitalOcean, Hetzner, etc.) with Node installed, running `npm start` behind a reverse proxy with https.

Whichever you choose, if you ever change `PUBLIC_URL`, reconnect your Google accounts once so the new redirect address is used.

## Everyday use

| I want to… | Where |
|---|---|
| Add another Google account or calendar | Calendars → Connect a Google account / Refresh list |
| Change which calendar bookings are written to | Calendars → "Bookings go here" |
| Change my default hours or time zone | Regular hours |
| Give one link extra evening/weekend slots | Booking links → Edit → "My regular hours, plus extra time" |
| Make a link with completely separate hours | Booking links → Edit → "Custom hours for this link only" |
| Block a single date or open a special date | Booking links → Edit → Specific dates |
| Require notice, add gaps between meetings | Booking links → Edit → Fine print |
| Pause a link without deleting it | Booking links → Pause |
| See or cancel bookings | Bookings |

## How "real time" works

Meadow does not keep a copy of your calendar. Every time someone views a booking page, the server asks Google's free/busy endpoint for the checked calendars and computes the open slots right then. When a guest confirms, it asks again for that day before saving. If two people try the same slot, the second one is told it was just taken and shown fresh times. Google's limits for this are generous (millions of calls per day), so it's fine for personal and small-business use.

## Troubleshooting

- **"Setup needed" page:** one of the required values in `.env` is empty. Fill it in and restart.
- **"redirect_uri_mismatch" from Google:** the redirect URI in Google Cloud doesn't exactly match `PUBLIC_URL` + `/auth/google/callback`. Check for `http` vs `https` and trailing slashes.
- **"Access blocked: app not verified":** click *Advanced → Go to Meadow (unsafe)*. This is Google's standard warning for personal apps that aren't on its marketplace.
- **Connection stops working after a week:** the consent screen is in "Testing" mode. Publish the app (step 3) or use the Internal type if you have Workspace, then reconnect.
- **A calendar is missing from the list:** click *Refresh list* under that account. Calendars shared to you with "see only free/busy" are included; ones you have no access to are not.
- **Guests don't get an email:** the invitation comes from Google Calendar, from the calendar you selected as the destination. Check that calendar in Google Calendar and look for the event; the guest's address will be listed as an attendee.

## For the curious: layout

```
server.js            starts the web server
src/config.js        reads .env
src/store.js         the tiny JSON database (data/db.json)
src/google.js        Google Calendar: connect, list calendars, free/busy, create & delete events
src/time.js          time-zone maths
src/availability.js  turns hours + busy times into bookable slots
src/booking.js       live availability against all connected calendars
src/routes/          web pages and API
views/               page templates (EJS)
public/              styles and the small browser scripts
tests/               run with: npm test
```

Change the name shown in the UI with `APP_NAME=...` in `.env`.
