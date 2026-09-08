# L'Ancienne École — website + direct booking module

Trilingual (EN / FR / NL) static site plus a serverless booking engine built
on Netlify Functions, Netlify Blobs, and a two-way iCal sync with Airbnb.

## What's in here

- `index.html`, `fr/index.html`, `nl/index.html` — the homepage in three languages.
- `reserve.html`, `fr/reserve.html`, `nl/reserve.html` — the booking page: a live
  calendar plus a request form. Wired to `assets/booking.js`.
- `assets/` — shared CSS, JS, and images.
- `pricing.json` — **your prices.** Nightly rate, seasonal overrides, week/month
  discounts, linen and cleaning fees, tourist tax rate, deposit. Edit this
  file directly and push — no code changes needed to change a price.
- `netlify/functions/` — the backend:
  - `availability.mjs` — public endpoint the calendar reads (Airbnb + pending/confirmed direct bookings).
  - `quote.mjs` — public endpoint the reserve page calls to show the live, itemized price as a guest picks dates.
  - `book.mjs` — receives a booking request, re-validates it and the price server-side, stores it as "pending", notifies you.
  - `respond.mjs` — the one-click approve/decline link you get in the notification. On approval, creates the Stripe payment link.
  - `sync-airbnb.mjs` — scheduled job, reads your Airbnb iCal export every 3 hours.
  - `calendar-export.mjs` — publishes your confirmed direct bookings as an iCal feed, for Airbnb to import.
  - `stripe-webhook.mjs` — hears back from Stripe when a guest actually pays, marks the booking paid.
  - `_lib/` — shared helpers (dates, pricing calculator, storage, notifications, signed links, Stripe).
- `netlify.toml` — build + redirect config.
- `package.json` — the small set of dependencies the functions need.

No database to run — bookings are stored in Netlify Blobs, which comes free
with your Netlify site.

## How a booking works, end to end

1. A guest picks dates on `reserve.html`. The calendar is live — it's already
   checked both your Airbnb calendar and any other pending/confirmed direct
   requests, so nothing double-books. As they pick dates and adjust party
   size, an itemized price appears (rent, any week/month discount, linen,
   cleaning, tourist tax, and the deposit shown separately) — the same
   calculation used everywhere else, so the number never changes later.
2. They submit the form. Nothing is confirmed yet — you get an email and a
   WhatsApp message with the details, the price breakdown, and two links:
   **Approve** and **Decline**.
3. You click **Approve**. That's it — no login, no dashboard. A unique,
   single-use Stripe payment link is generated for the exact amount
   (rent + linen + cleaning + tourist tax, plus the security deposit as a
   separate line) and emailed straight to the guest, along with the booking
   confirmation. Those nights are immediately blocked on the site.
4. Once the guest pays, Stripe tells your site automatically (via a
   webhook) and the booking is marked paid — you get a short email saying so.
5. Your own confirmed direct bookings also get published as an iCal feed
   (see "Two-way sync" below), so Airbnb picks them up too — a request made
   through the site blocks the dates on Airbnb as well.

## Updating the site (this delivery)

I still can't push to your GitHub repo myself in this environment — same
limitation as before. This zip is the full, current state of the site,
so getting it live is: replace your local working copy's contents with
this zip's contents (everything except the hidden `.git` folder — keep
that), then:

```
cd ancienne-ecole-site
git add -A
git commit -m "Pricing engine + Stripe payment links"
git push
```

Netlify picks it up automatically from there. Before you push, open
`pricing.json` and put in your real numbers — it currently ships with
placeholder prices so the code has something sensible to run with.

## One-time setup

### 1. Put this code on GitHub and link it to Netlify

Already done — this section is here for reference. If you're setting this
up fresh: create an empty GitHub repo, `git init && git add -A && git commit`,
push it, then in Netlify go to **Site configuration → Build & deploy →
Continuous deployment** and link that repository. From then on, every
`git push` deploys automatically — including the scheduled function and all
the booking endpoints, which only run properly once the site is built this
way (not from a drag-and-drop zip).

### 2. Set your prices

Open `pricing.json` at the repo root. Every field has a `_..._comment` line
above it explaining what it does. In short:

- `basePricePerNight` — your default nightly rate.
- `dateOverrides` — add a line per period that should cost something
  different (high season, a holiday week, etc.) — as many as you like.
- `weekDiscountMinNights` / `weekDiscountPercent` and the `month...`
  equivalents — long-stay discounts on the rent itself.
- `cleaningFee` — flat, once per booking.
- `linenFeePerPerson` and `linenFeeMode` (`per_booking` or `per_week`).
- `touristTaxRatePercent` — charged per adult per night, as a percentage of
  that night's per-person share of the rent (children don't owe it).
- `depositAmount` — shown and charged as a separate line, refundable by you
  manually after check-out (Stripe doesn't support charging a security
  deposit as a hold-and-release through a Payment Link — it's charged
  upfront alongside the rest, and you refund it from your Stripe dashboard
  if there's no damage).

Edit the numbers, commit, push — no code changes needed.

### 3. Set environment variables in Netlify

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
| `STRIPE_SECRET_KEY` | Creates the payment link on approval | Stripe dashboard → **Developers → API keys** → Secret key (starts `sk_live_...`, or `sk_test_...` while testing) |
| `STRIPE_WEBHOOK_SECRET` | Verifies payment notifications are really from Stripe | Stripe dashboard → **Developers → Webhooks** → add an endpoint pointing at `https://ancienne-ecole.rent/.netlify/functions/stripe-webhook`, select the `checkout.session.completed` event, then copy its "Signing secret" (starts `whsec_...`) |

Email and WhatsApp are both optional independently — if the Twilio variables
are missing, you'll just get email alerts; if `RESEND_API_KEY` is missing,
guests won't get automated emails but bookings still work and you'll still
get notified via WhatsApp. Nothing breaks if one channel isn't configured
yet — you can add WhatsApp later without touching any code. Stripe works the
same way: without `STRIPE_SECRET_KEY` set, approving a booking still works,
it just skips the payment link (you'd send one manually) and the
confirmation page will say so.

### 4. Complete the two-way sync in Airbnb

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
booking through the site yourself (use Stripe's test mode — a
`sk_test_...` key and Stripe's test card `4242 4242 4242 4242` — before
switching to your live key), confirm you get both the email and the
WhatsApp message with the right price, click Approve, and check that:
- the guest gets a confirmation email with a working payment link,
- paying with the test card marks the booking "paid" (check the owner
  inbox for the "Payment received" email),
- the dates now show as booked on `reserve.html`,
- `https://ancienne-ecole.rent/ical/confirmed.ics` includes that booking,
- (after Airbnb's next refresh) those dates show blocked in your Airbnb calendar.

Only switch `STRIPE_SECRET_KEY` and the webhook to your live Stripe keys
once that's all working in test mode.

## Embedding the booking module in your existing WordPress site

If you'd rather keep your current ancienne-ecole.rent site as-is and just
drop the new booking module into your existing "Reserveren" page, that
works too — `embed/reserve.html` (and `embed/fr/`, `embed/nl/`) are the same
live calendar, price breakdown, and form, with the header/hero/footer
stripped out, meant to sit inside an `<iframe>` on another page.

1. Deploy this site as usual (it's part of the same Netlify project, so
   nothing extra to set up) — the embed pages will be live at
   `https://ancienne-ecole-troche.netlify.app/embed/nl/reserve.html` (swap
   `nl` for `fr`/nothing for the English one). Once you're happy with it,
   you can point a subdomain of your own at the same Netlify site (e.g.
   `boeken.ancienne-ecole.rent`) so the iframe URL looks fully like yours —
   ask if you want help setting that up.
2. In WordPress, edit the Reserveren page, add a **Custom HTML** block
   (Gutenberg) or an HTML widget, and paste:
   ```html
   <iframe id="ae-booking-iframe"
           src="https://ancienne-ecole-troche.netlify.app/embed/nl/reserve.html"
           style="width:100%; border:0; min-height:1400px;"
           title="Boek je verblijf"></iframe>
   ```
   A generous fixed `min-height` (as above) is the simplest option — the
   module scrolls internally on very small screens if it's ever taller than
   that, and this needs no extra code on the WordPress side.
3. **Optional, nicer fit**: the embed page already posts its real height to
   its parent window as it changes (picking dates, showing the success
   message, etc.). To have the iframe resize itself instead of relying on a
   fixed height, add this small script once, right after the iframe in the
   same Custom HTML block:
   ```html
   <script>
     window.addEventListener("message", function (e) {
       if (e.origin === "https://ancienne-ecole-troche.netlify.app" && e.data && e.data.aeAncienneEcoleEmbedHeight) {
         document.getElementById("ae-booking-iframe").style.height = e.data.aeAncienneEcoleEmbedHeight + "px";
       }
     });
   </script>
   ```
   (Update the `origin` check if you later move the embed to your own
   subdomain.) Use the English or French embed URL on your English/French
   pages the same way — swap `/embed/nl/` for `/embed/` (English) or
   `/embed/fr/`.

Everything else — the price calculator, the Airbnb sync, approvals, Stripe
payment links — behaves identically whether a guest reaches the booking
module through the new trilingual site or through this iframe on your
existing one. You can run both at once, or use the iframe approach only and
never link people to the new site's own pages at all.

## What's intentionally not built yet

- No owner dashboard — approve/decline happens via the emailed links, and
  prices are edited in `pricing.json` rather than a settings screen. A
  simple dashboard could be added later if useful.
- The security deposit is charged upfront with the rest (not held and
  released automatically) — see the note in `pricing.json`'s setup section
  above. Refunding it after a clean check-out is a manual step in Stripe.
