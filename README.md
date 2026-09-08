# L'Ancienne École — website + direct booking module

Trilingual (EN / FR / NL) static site plus a serverless booking engine built
on Netlify Functions, Netlify Blobs, and a two-way iCal sync with Airbnb.

## What's in here

- `index.html`, `fr/index.html`, `nl/index.html` — the homepage in three languages.
- `reserve.html`, `fr/reserve.html`, `nl/reserve.html` — the booking page: a live
  calendar plus a request form. Wired to `assets/booking.js`.
- `embed/`, `embed/fr/`, `embed/nl/` — the same calendar/price/form, stripped
  of header and footer, meant to sit in an `<iframe>` on another page.
- `admin/` — **your prices, minimum stays, discounts, and settings live here
  now**, not in a file in the repo. See "The admin page" below. Login-only,
  not linked from anywhere on the public site.
- `assets/` — shared CSS, JS, and images.
- `netlify/functions/` — the backend:
  - `availability.mjs` — public endpoint the calendar reads (Airbnb + pending/confirmed direct bookings, plus which nights have no price set yet and any per-date minimum-stay override).
  - `quote.mjs` — public endpoint the reserve page calls to show the live, itemized price as a guest picks dates.
  - `book.mjs` — receives a booking request, re-validates it and the price server-side, stores it as "aangevraagd" (requested), notifies you.
  - `respond.mjs` — the one-click approve/decline link you get in the notification. Re-checks availability before confirming (see "Double-booking protection" below), and on approval creates the Stripe payment link.
  - `admin-login.mjs` / `admin-logout.mjs` — the admin page's authentication.
  - `admin-pricing.mjs` — reads and writes nightly prices, minimum stays, and all settings. Only usable with a valid admin session.
  - `admin-bookings.mjs` — read-only list of all requests for the admin page's "Aanvragen" tab.
  - `expire-bookings.mjs` — scheduled job (hourly) that marks old unanswered/unpaid requests as expired and frees their nights.
  - `sync-airbnb.mjs` — scheduled job, reads your Airbnb iCal export every 3 hours.
  - `calendar-export.mjs` — publishes your approved/paid direct bookings as an iCal feed, for Airbnb to import.
  - `stripe-webhook.mjs` — hears back from Stripe when a guest actually pays (or a payment link expires), marks the booking accordingly.
  - `_lib/` — shared helpers: `pricing.mjs` (the one and only price calculator — see below), `money.mjs` (cents-only arithmetic), `store.mjs` (Netlify Blobs access), `availability.mjs`, `adminAuth.mjs`, `dates.mjs`, `notify.mjs`, `stripe.mjs`.
- `netlify.toml` — build + redirect config (also blocks search engines from indexing `/admin/`).
- `robots.txt` — disallows `/admin/`.
- `package.json` — the small set of dependencies the functions need.

No database to run — everything (bookings, prices, settings) is stored in
Netlify Blobs, which comes free with your Netlify site.

## The three booking states — used consistently everywhere

Every request is always in exactly one of these, and the site, the admin
page, and every email say which one, explicitly:

1. **Aangevraagd / Requested** — a guest sent a request. Nothing is
   promised. The dates are held (so nobody else can request the same
   nights) while you decide.
2. **Goedgekeurd / Approved** — you clicked Approve. The guest has been
   sent a secure Stripe payment link. **Approved is not paid** — the
   dates stay held, but the stay isn't real until the payment actually
   clears.
3. **Betaald / Paid** — Stripe has confirmed the payment (via a signed
   webhook, not just the guest landing back on a "thank you" page). This
   is the only state that means the booking is fully secured.

A request can also become:

- **Declined** — you clicked Decline. Nights are released immediately.
- **Expired (unanswered)** — you didn't respond within
  `pendingRequestExpiryHours` (default 48h, set in the admin page's
  Settings tab). Nights are released.
- **Expired (unpaid)** — you approved it, but the guest never paid within
  `unpaidApprovedExpiryHours` (default 72h). Nights are released.

Expiry is computed live on every read, and also swept hourly by
`expire-bookings.mjs` so it's durable even if nobody happens to load a page
at the exact moment something expires.

## The admin page — where you manage everything now

Go to `https://<your-site>/admin/` and log in with the username/password you
set in Netlify (see the environment variables table below). No public link
points here; the URL itself is also not a security boundary on its own —
every page load and every price/settings change is checked server-side
against your logged-in session, which expires automatically after about 12
hours or when you log out.

**Kalender & prijzen tab** — an Airbnb-style calendar:
- Click one date to select just that night, or click a first date then a
  later date to select a whole period.
- Enter a price and click "Prijs instellen" to set that price for every
  night in the selection at once. To fix a single night within a period
  you've already priced, just select that one night on its own and set its
  price — it overrides only that night.
- Set a minimum stay for the selection the same way. Minimum stay always
  means "if a guest's **check-in** falls here, they must book at least this
  many nights" — it's about the arrival date, the same convention Airbnb
  and every other booking site use. (What happens when a stay's check-in is
  in one minimum-stay period but the stay runs into the next period with a
  different minimum is intentionally **not** auto-resolved — the code only
  ever looks at the check-in date's rule. If you want stricter behaviour
  for stays that cross a boundary, say so and it can be tightened.)
- Before anything is saved, you're shown exactly which dates will change —
  old price/minimum-stay → new — and asked to confirm.
- A date with no price set at all is shown dashed and is simply **not
  bookable** — never treated as free or €0. Guests see it the same way on
  the public calendar ("not yet open for booking").
- Small colored dots show whether a booked night comes from a direct
  approved/paid booking, a pending request, or Airbnb.

**Instellingen tab** — everything else that used to be hardcoded or in
`pricing.json`:
- Default minimum stay, and which weekdays a stay is allowed to start on
  (leave empty to allow any day).
- Week and month long-stay discounts — each has its own on/off switch,
  minimum nights, and percentage. **They never stack**: if a stay qualifies
  for both, the month discount wins and that's what the guest sees.
- Linen fee: per person, either once per booking or per person per (part
  of a) week — a booking of 9 nights in per-week mode counts as 2 weeks
  (`Math.ceil(nights / 7)`), so a few days into a second week still costs a
  full extra week's linen for everyone.
- Cleaning fee — one flat fee per stay, always. There's deliberately no
  separate "cleaning included" toggle plus an extra fee on top, since that
  would double-charge.
- Tourist tax — see the dedicated section below, it needs your input.
- Refundable deposit amount (default €250).
- Maximum occupancy: adults, children, total, and the age under which
  someone counts as a "child" for pricing/occupancy purposes.
- The two expiry windows described above.

**Aanvragen tab** — read-only list of every request with its current
effective status (aangevraagd / goedgekeurd / betaald / declined / expired),
so you always have a full picture without digging through email.

### Tourist tax — please double-check this before going live

Two flagged issues from the previous version, both fixed here, but the
second one needs a decision from you:

1. **Was calculated on the pre-discount price.** Your own example (7
   nights × €180 = €1,260, minus a €126 week discount, tax computed as if
   the rate were still €180/night) was correct to be suspicious of — that's
   a real bug. It now taxes the price the guest actually pays, after any
   discount.
2. **The 4% you mentioned is very likely the wrong rate for your specific
   property.** Under French law, a **classified** "Meublé de Tourisme"
   (a star-rated listing, which is what your Airbnb photos and premium
   positioning suggest yours is) is taxed at a **fixed € amount per adult
   per night**, set by the star category, not a percentage. A flat
   percentage of the price ("au réel") applies to **un**classified
   accommodations — and 4% specifically is what your intercommunality
   (Communauté de communes du Pays de Lubersac-Pompadour, which Troche/19270
   belongs to) charges for the unclassified case. I could not confirm your
   exact classification star rating or the exact € figure that applies to
   it from here (the commune's own tariff document blocked automated
   fetching) — **you'll need to check your classification certificate (or
   the commune/tourist office) and tell me the star rating and/or the
   published € rate**, so the admin page's tax settings can be set
   correctly. Until then, both calculation modes are built and available in
   Settings (percentage-of-price, or fixed-amount-per-adult-per-night) so
   you can switch the moment you have the right number — the admin page
   shows a warning box explaining exactly this. There's also an optional
   "departmental surcharge" percentage field, in case Corrèze applies one
   on top (worth confirming with the tourist office at the same time).

Children are exempt from tourist tax nationally — that part is settled and
not something you need to configure.

## The price calculation — one function, used everywhere

`_lib/pricing.mjs` exports a single `calculateQuote()` used identically by:
the live price shown while a guest is picking dates, the price locked into
a request when it's submitted, the confirmation page, and the actual Stripe
charge. There is exactly one place a price is computed — nowhere else in
the codebase does its own math, and the browser is never trusted to say
what something costs.

- Base rent is the sum of the admin-entered nightly price for each night of
  the stay (the departure night itself is excluded, same as everywhere in
  the hotel/rental industry). There is **no** automatic "weekly price ÷ 6 or
  ÷ 7" and **no** automatic 14.285714% discount hidden anywhere — every
  night's price is exactly what you entered for that night, full stop.
- All money is handled in integer cents throughout the codebase (never
  floating-point euros) specifically to avoid rounding drift; see
  `_lib/money.mjs` for the (small, documented) set of rounding rules used
  for percentages.
- Whatever quote was calculated and shown to a guest at request time is
  **frozen into that request forever** (`settingsSnapshot` on the stored
  booking) — if you change a price or a discount rule afterwards, every
  request already sent keeps exactly the number it was shown. Only brand
  new quotes use the new settings.
- Minimum stay, allowed arrival days, and capacity are all validated
  server-side twice: once when the guest submits a request, and again when
  you click Approve (in case something changed in between).

## Double-booking protection — what's actually guaranteed, and what isn't

Two different mechanisms, deliberately not oversold as one perfect
guarantee:

- **At request time**: the system claims the requested nights and
  immediately re-reads them back to check nothing else grabbed them in the
  same instant. This is a real, useful mitigation, but Netlify Blobs (the
  storage this site uses) doesn't support atomic compare-and-swap writes at
  the SDK version this site is built on — so this step narrows the risk
  window without being a mathematical guarantee. In practice, two guests
  would have to submit for the exact same nights within a very small window
  for this layer alone to both let them through.
- **At approval time**: this is the one that actually matters, and it *is*
  a real guarantee — `respond.mjs` re-validates the nights against every
  other confirmed booking (with strong, not eventually-consistent, reads)
  before ever marking a booking approved. Two overlapping requests can
  never both reach "approved." If you try to approve a request whose nights
  were taken by something else in the meantime, you'll see a clear conflict
  message instead of a silent double-booking.

**Please don't advertise "double bookings can never happen" anywhere on the
site** — what's true, and what you can say, is that every request is
personally checked against the calendar before anything is promised, and
the system won't let you approve two overlapping stays.

## Environment variables

| Variable | What it's for | Where to get it |
|---|---|---|
| `ADMIN_USERNAME` | Login for `/admin/` | Pick one |
| `ADMIN_PASSWORD` | Login for `/admin/` | Pick a strong one |
| `ADMIN_SESSION_SECRET` | Signs the admin login session cookie | A long random string (e.g. `openssl rand -hex 32`) — changing it logs everyone out |
| `AIRBNB_ICAL_URL` | Reads your Airbnb calendar | Airbnb host dashboard → your listing → **Availability** → **Connect calendars** → **Export calendar** → copy the link |
| `APPROVAL_SECRET` | Secures your approve/decline links | A long random string (e.g. `openssl rand -hex 32`) |
| `OWNER_EMAIL` | Where booking alerts go | Your email address |
| `NOTIFY_FROM_EMAIL` | The "from" address for guest emails | An address at a domain you verify with Resend, e.g. `bookings@ancienne-ecole.rent` |
| `RESEND_API_KEY` | Sends emails | Free account at resend.com → API Keys (or their test domain while testing) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | Optional WhatsApp alerts | Twilio console |
| `OWNER_WHATSAPP_TO` | Your WhatsApp number, `whatsapp:+33...` format | — |
| `STRIPE_SECRET_KEY` | Creates the payment link on approval | Stripe dashboard → **Developers → API keys** (`sk_test_...` while testing, `sk_live_...` once verified) |
| `STRIPE_WEBHOOK_SECRET` | Verifies payment/expiry notifications are really from Stripe | Stripe dashboard → **Developers → Webhooks** → endpoint at `.../.netlify/functions/stripe-webhook`, events `checkout.session.completed` and `checkout.session.expired` |

Email/WhatsApp/Stripe are each independently optional — the booking flow
degrades gracefully (e.g. approving without Stripe configured just skips
the payment link and tells you so) rather than breaking.

## Testing before you rely on it — in Stripe test mode first

`STRIPE_SECRET_KEY` is not set yet as of this delivery. Before switching to
a live key, set a **test** key (`sk_test_...`) and Stripe's test webhook
secret, then actually run through, with fake data only:

- A full request → approve → pay (test card `4242 4242 4242 4242`) → check
  the booking shows "betaald" in the admin page and you get the "payment
  received" email.
- **Send Stripe a duplicate `checkout.session.completed` webhook** (Stripe's
  dashboard has a "resend" button for this) and confirm the booking doesn't
  get double-processed or send a second "paid" email — the idempotency
  guard in `stripe-webhook.mjs` should silently no-op.
- Let a payment link expire (or use Stripe's dashboard to expire it) and
  confirm you get the "link expired" notice and the nights are released.
- A decline, and confirm the nights are released immediately.
- **A return to the "thank you" page is never treated as proof of
  payment** — only the signed webhook does that. This is already how the
  code works; worth remembering if something ever looks "paid" too early.

Only move to `sk_live_...` and the matching live webhook secret once all of
the above behaves correctly.

## Two-way Airbnb sync

Once deployed, your confirmed-bookings feed is live at:

```
https://ancienne-ecole.rent/ical/confirmed.ics
```

Add that URL in Airbnb as an **imported calendar** (host dashboard → your
listing → Availability → Connect calendars → Import calendar). Only
approved/paid bookings are published — a pending request doesn't show on
this feed, but it does still block the dates on your own site (so two
direct guests can't request the same nights) until it's answered or
expires.

- **Airbnb → site**: `sync-airbnb.mjs` reads your Airbnb export every 3
  hours. If a read ever fails, the site keeps using the last-known-good
  data (never wipes it to empty) and the admin page's calendar shows a
  banner saying the sync is stale and since when.
- **Site → Airbnb**: Airbnb reads `confirmed.ics` on its own schedule (a
  few times a day). Because your own exported bookings will show up
  reflected back through Airbnb's import, the site tags every busy night
  with where it came from (direct / requested / Airbnb) and simply takes
  the union — seeing your own booking twice, from two sources, doesn't
  create any duplicate or extra blocking, so there's nothing to actively
  prevent there.
- This delay (typically under a few hours in both directions) is exactly
  why a request never auto-confirms — a human check before anything is
  promised is what actually prevents a double booking, not the calendar
  colors alone.

## Embedding the booking module in your existing WordPress site

Unchanged from before — `embed/reserve.html` (and `embed/fr/`, `embed/nl/`)
are the same live calendar, price breakdown, and form, stripped for
`<iframe>` use. See the previous delivery notes or ask for the exact
WordPress snippet again if needed; nothing about the embed mechanism itself
changed in this update, only what's inside it (dynamic capacity, minimum
stay, accessibility, translated discount labels, etc.)

## What's still open / needs you

- **Real contact details.** The footer on every page still shows
  `[Phone / WhatsApp]` and `[Email]` placeholders — I didn't want to invent
  real-looking contact information for a live business site. Tell me the
  actual number and email you want published and they'll go in everywhere
  at once.
- **The tourist tax star-rating/€ figure** — see above.
- **Whether Corrèze's departmental tourist-tax surcharge applies to you** —
  worth a quick check alongside the star-rating question.
- **Multi-period minimum-stay precedence** — currently only the check-in
  date's minimum-stay rule is enforced; say if you want stricter handling
  for a stay whose nights span two different minimum-stay periods.
- **Whether the site-wide "allowed arrival weekdays" setting should instead
  be settable per period** rather than one global rule — flag if the
  simple global version isn't enough (e.g. only some seasons need
  Saturday-only changeovers).
