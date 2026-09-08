# L'Ancienne École — website + direct booking module

Trilingual (EN / FR / NL) static site plus a serverless booking engine built
on Netlify Functions, Netlify Blobs, and a two-way iCal sync with Airbnb.

## What's in here

- `index.html`, `fr/index.html`, `nl/index.html` — the homepage in three languages.
- `reserve.html`, `fr/reserve.html`, `nl/reserve.html` — the booking page: a live
  calendar plus a request form. Wired to `assets/booking.js`.
- `assets/` — shared CSS, JS, and images.
- `netlify/functions/` — the backend:
  - `availability.mjs` — public endpoint the calendar reads (Airbnb + pending/confirmed direct bookings).
  - `book.mjs` — receives a booking request, re-validates it server-side, stores it as "pending", notifies you.
  - `respond.mjs` — the one-click approve/decline link you get in the notification.
  - `sync-airbnb.mjs` — scheduled job, reads your Airbnb iCal export every 3 hours.
  - `calendar-export.mjs` — publishes your confirmed direct bookings as an iCal feed, for Airbnb to import.
  - `_lib/` — shared helpers (dates, storage, notifications, signed links).
- `netlify.toml` — build + redirect config.
- `package.json` — the four small dependencies the functions need.

No database to run — bookings are stored in Netlify Blobs, which comes free
with your Netlify site.

## How a booking works, end to end

1. A guest picks dates on `reserve.html`. The calendar is live — it's already
   checked both your Airbnb calendar and any other pending/confirmed direct
   requests, so nothing double-books.
2. They submit the form. Nothing is confirmed yet — you get an email and a
   WhatsApp message with the details and two links: **Approve** and **Decline**.
3. You click one. That's it — no login, no dashboard. The guest is emailed
   automatically with the outcome, and if approved, those nights are
   immediately blocked on the site.
4. Your own confirmed direct bookings also get published as an iCal feed
   (see "Two-way sync" below), so Airbnb picks them up too — a request made
   through the site blocks the dates on Airbnb as well.

## One-time setup

### 1. Put this code on GitHub and link it to Netlify

I wasn't able to create the GitHub repository myself in this session — the
GitHub connection available to me here doesn't have working credentials, so
this one step needs you (it's five minutes, one time only):

```
cd ancienne-ecole-site
git init                                   # skip if already a git repo
git add -A
git commit -m "L'Ancienne École — site + booking module"
```

Then on github.com: create a new **empty** repository (no README, no
.gitignore — this project already has one), and push:

```
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

Then in Netlify: open your site (`ancienne-ecole` project) → **Site
configuration → Build & deploy → Continuous deployment**, and link it to
that GitHub repository. From then on, every `git push` deploys automatically
— including the scheduled function and all the booking endpoints, which
only run properly once the site is built this way (not from a drag-and-drop
zip).

### 2. Set environment variables in Netlify

In Netlify: **Site configuration → Environment variables**. Add these —
none of them ever pass through me; you get them directly from each
service and paste them straight into Netlify:

| Variable | What it's for | Where to get it |
|---|---|---|
| `AIRBNB_ICAL_URL` | Reads your Airbnb calendar | Airbnb host dashboard → your listing → **Availability** → **Connect calendars** → **Export calendar** → copy the link |
| `APPROVAL_SECRET` | Secures your approve/decline links | Any long random string you make up (e.g. run `openssl rand -hex 32`) |
| `OWNER_EMAIL` | Where booking alerts go | Your email address |
| `NOTIFY_FROM_EMAIL` | The "from" address for guest emails | An address at a domain you verify with Resend (see below), e.g. `bookings@ancienne-ecole.rent` |
| `RESEND_API_KEY` | Sends emails | Free account at resend.com → API Keys. You'll also need to verify your domain there (or use their test domain while testing) |
| `TWILIO_ACCOUNT_SID` | Sends WhatsApp alerts | Twilio console → Account |
| `TWILIO_AUTH_TOKEN` | Sends WhatsApp alerts | Twilio console → Account |
| `TWILIO_WHATSAPP_FROM` | Twilio's WhatsApp sender number | Twilio console → Messaging → Try WhatsApp (their sandbox number works for testing) |
| `OWNER_WHATSAPP_TO` | Your WhatsApp number | Your number, in the `whatsapp:+33...` format Twilio expects |

Email and WhatsApp are both optional independently — if the Twilio variables
are missing, you'll just get email alerts; if `RESEND_API_KEY` is missing,
guests won't get automated emails but bookings still work and you'll still
get notified via WhatsApp. Nothing breaks if one channel isn't configured
yet — you can add WhatsApp later without touching any code.

### 3. Complete the two-way sync in Airbnb

Once the site is deployed, your confirmed-bookings feed is live at:

```
https://ancienne-ecole.rent/ical/confirmed.ics
```

Add that URL in Airbnb as an **imported calendar**: host dashboard → your
listing → **Availability** → **Connect calendars** → **Import calendar**.

That's the two directions:
- **Airbnb → site**: `sync-airbnb.mjs` reads your Airbnb export every 3 hours.
- **Site → Airbnb**: Airbnb reads `confirmed.ics` on its own schedule (a few
  times a day — Airbnb doesn't offer instant push for imported calendars, so
  there's a small delay in both directions, typically under a few hours).

This is why a request never auto-confirms: the small sync delay means a
human check before anything is promised is what actually prevents a double
booking, not just the calendar colors.

## Testing before you rely on it

Once deployed with the environment variables set, make one real test
booking through the site yourself, confirm you get both the email and the
WhatsApp message, click Approve, and check that:
- the guest gets a confirmation email,
- the dates now show as booked on `reserve.html`,
- `https://ancienne-ecole.rent/ical/confirmed.ics` includes that booking,
- (after Airbnb's next refresh) those dates show blocked in your Airbnb calendar.

## What's intentionally not built yet

- No payment collection — every booking is a request Aernoud approves by
  hand, as agreed. A payment link can be added to the approval email later
  without changing this architecture.
- No owner dashboard — approve/decline happens via the emailed links. A
  simple dashboard listing all bookings could be added later if useful.
