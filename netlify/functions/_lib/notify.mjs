// Sends the owner-facing and guest-facing notifications.
// All credentials (RESEND_API_KEY, TWILIO_*, OWNER_EMAIL, OWNER_WHATSAPP_TO)
// are read from environment variables the owner sets in Netlify's dashboard —
// this file never hardcodes or stores a secret.
//
// Every message here is careful to say "requested" / "approved" / "paid" —
// never "confirmed" on its own — because those are three different, clearly
// distinct states in this booking flow (see README "Booking states").

import { Resend } from "resend";
import twilio from "twilio";
import { countryName } from "./countries.mjs";

export function siteBaseUrl() {
  // Netlify sets URL to the site's primary production URL at runtime.
  return process.env.URL || process.env.DEPLOY_PRIME_URL || "https://ancienne-ecole.rent";
}

function senderAddress() {
  const address = process.env.NOTIFY_FROM_EMAIL || "onboarding@resend.dev";
  return address.includes("<") ? address : `Aernoud Florijn (L’Ancienne École) <${address}>`;
}

function resendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function fmtMoneyCents(cents, currency = "EUR") {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format((cents || 0) / 100);
}

const DISCOUNT_LABELS = {
  en: { week: "Weekly discount", month: "Monthly discount" },
  fr: { week: "Réduction hebdomadaire", month: "Réduction mensuelle" },
  nl: { week: "Weekkorting", month: "Maandkorting" },
};

// Renders the price breakdown as a small HTML table — used in the owner's
// review email (always English) and the guest's confirmation email (in
// their own language), so the same numbers are visible in both places.
const QUOTE_LABELS = {
  en: {
    rent: (n) => `${n} night(s) rent`,
    linen: "Linen",
    cleaning: "Cleaning",
    tax: "Tourist tax",
    total: "Total (stay)",
    deposit: "Refundable deposit (separate)",
  },
  fr: {
    rent: (n) => `Location (${n} nuits)`,
    linen: "Linge de maison",
    cleaning: "Ménage",
    tax: "Taxe de séjour",
    total: "Total (séjour)",
    deposit: "Caution remboursable (séparée)",
  },
  nl: {
    rent: (n) => `Huur (${n} nachten)`,
    linen: "Linnengoed",
    cleaning: "Eindschoonmaak",
    tax: "Toeristenbelasting",
    total: "Totaal (verblijf)",
    deposit: "Terugbetaalbare borg (apart)",
  },
};

function quoteTable(q, lang = "en") {
  if (!q) return "";
  const t = QUOTE_LABELS[lang] || QUOTE_LABELS.en;
  const dl = DISCOUNT_LABELS[lang] || DISCOUNT_LABELS.en;
  const rows = [[t.rent(q.nights), fmtMoneyCents(q.rentalSubtotalCents, q.currency)]];
  if (q.discountKind) {
    rows.push([`${dl[q.discountKind]} (-${q.discountPercent}%)`, `-${fmtMoneyCents(q.discountAmountCents, q.currency)}`]);
  }
  rows.push([t.linen, fmtMoneyCents(q.linenFeeCents, q.currency)]);
  rows.push([t.cleaning, fmtMoneyCents(q.cleaningFeeCents, q.currency)]);
  rows.push([t.tax, fmtMoneyCents(q.touristTaxCents, q.currency)]);
  rows.push([`<b>${t.total}</b>`, `<b>${fmtMoneyCents(q.totalCents, q.currency)}</b>`]);
  rows.push([t.deposit, fmtMoneyCents(q.depositCents, q.currency)]);
  return `
    <table style="border-collapse:collapse; margin: 4px 0 16px; font-size: 13.5px;">
      ${rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:2px 16px 2px 0;color:#888;">${label}</td><td style="text-align:right;">${value}</td></tr>`
        )
        .join("")}
    </table>`;
}

const SUMMARY_LABELS = {
  en: {
    name: "Booked by",
    reference: "Booking reference",
    checkin: "Check-in",
    checkinTime: "from 16:00",
    checkout: "Check-out",
    checkoutTime: "by 10:00 (French local time)",
    nights: "Nights",
    nightsValue: (n) => `${n} night${n === 1 ? "" : "s"}`,
    guests: "Guests",
    address: "Address",
  },
  fr: {
    name: "Réservé par",
    reference: "Référence de réservation",
    checkin: "Arrivée",
    checkinTime: "à partir de 16h00",
    checkout: "Départ",
    checkoutTime: "au plus tard à 10h00 (heure locale française)",
    nights: "Nombre de nuits",
    nightsValue: (n) => `${n} nuit${n === 1 ? "" : "s"}`,
    guests: "Voyageurs",
    address: "Adresse",
  },
  nl: {
    name: "Naam hoofdboeker",
    reference: "Boekingsreferentie",
    checkin: "Aankomst",
    checkinTime: "vanaf 16.00 uur",
    checkout: "Vertrek",
    checkoutTime: "uiterlijk 10.00 uur (lokale tijd Frankrijk)",
    nights: "Aantal nachten",
    nightsValue: (n) => `${n} nacht${n === 1 ? "" : "en"}`,
    guests: "Gasten",
    address: "Adres",
  },
};

// Full weekday/month names, verbatim from assets/booking.js's own
// formatLongDate() (same guest-facing wording as the reserve pages
// themselves) — duplicated here rather than imported since that file is a
// browser IIFE, not an ES module. Keep in sync if that wording ever changes.
const WEEKDAY_FULL = {
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  fr: ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
  nl: ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"],
};
const MONTH_FULL = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  nl: ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"],
};

function formatLongDate(dateISO, lang) {
  if (!dateISO) return "";
  const d = new Date(`${dateISO}T00:00:00Z`);
  const weekday = WEEKDAY_FULL[lang][(d.getUTCDay() + 6) % 7];
  const day = d.getUTCDate();
  const month = MONTH_FULL[lang][d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${weekday} ${day} ${month} ${year}`;
}

function guestsLabel(b, lang) {
  const adultsWord = { en: "adult(s)", fr: "adulte(s)", nl: "volwassene(n)" }[lang] || "adult(s)";
  const childrenWord = { en: "child(ren)", fr: "enfant(s)", nl: "kind(eren)" }[lang] || "child(ren)";
  return `${b.adults} ${adultsWord}${b.children ? ` + ${b.children} ${childrenWord}` : ""}`;
}

// Renders the main renter's address as a single HTML fragment (used inside
// its own table row), in the given language. Returns "" when the booking
// has no address at all — every booking made before this field existed —
// so bookingSummaryTable() below simply omits the row rather than showing
// an empty/broken one.
function addressLines(b, lang) {
  const a = b.address;
  if (!a || !a.line1) return "";
  const parts = [a.line1];
  if (a.line2) parts.push(a.line2);
  const cityLine = [a.postalCode, a.city].filter(Boolean).join(" ");
  if (cityLine) parts.push(cityLine);
  if (a.country) parts.push(countryName(a.country, lang));
  return parts.map((p) => escapeHtml(p)).join("<br>");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Booking-summary table shown above the price breakdown in the
// paid-confirmation email — a compact, mobile-readable label/value table
// using only confirmed booking data (booking.js's own booking record, the
// same object stripe-webhook.mjs already has once payment is verified):
// main booker name, the booking's own id as its reference, fully-written
// check-in/check-out dates with the standard arrival/departure times, the
// number of nights, the guest count, and (when present — older bookings
// made before this field existed simply don't have one) the main renter's
// address. Nothing here is invented or derived beyond formatting — no new
// fields, no changed amounts.
export function bookingSummaryTable(b, lang = "en") {
  const t = SUMMARY_LABELS[lang] || SUMMARY_LABELS.en;
  const row = (label, value) =>
    `<tr><td style="padding:3px 16px 3px 0;color:#888;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:3px 0;word-break:break-word;">${value}</td></tr>`;
  const address = addressLines(b, lang);
  return `
    <table style="border-collapse:collapse; margin: 8px 0 4px; font-size: 13.5px; width:100%; max-width:420px;">
      ${row(t.name, escapeHtml(b.name))}
      ${row(t.reference, `<span style="font-family:monospace; font-size:12px;">${escapeHtml(b.reference || b.id)}</span>`)}
      ${address ? row(t.address, address) : ""}
      ${row(t.checkin, `<b>${formatLongDate(b.checkin, lang)}</b><br><span style="color:#888; font-size:12.5px;">${t.checkinTime}</span>`)}
      ${row(t.checkout, `<b>${formatLongDate(b.checkout, lang)}</b><br><span style="color:#888; font-size:12.5px;">${t.checkoutTime}</span>`)}
      ${row(t.nights, t.nightsValue(b.nights))}
      ${row(t.guests, guestsLabel(b, lang))}
    </table>`;
}

// "De kleine lettertjes" / "The small print" / "Les petites lignes" — the
// three WordPress pages Codex built, one per guest language. The
// paid-confirmation email below links to the guest's own language, rather
// than attaching anything: no PDF is fetched, stored, or shipped by this
// codebase. Keep this the single place these three URLs are edited.
export const TERMS_PAGE_URL = {
  nl: "https://ancienne-ecole.rent/de-kleine-lettertjes/",
  en: "https://ancienne-ecole.rent/en/the-small-print/",
  fr: "https://ancienne-ecole.rent/fr/les-petites-lignes/",
};
const TERMS_LINK_TEXT = { nl: "De kleine lettertjes", en: "The small print", fr: "Les petites lignes" };

function termsLink(lang) {
  const url = TERMS_PAGE_URL[lang] || TERMS_PAGE_URL.en;
  const text = TERMS_LINK_TEXT[lang] || TERMS_LINK_TEXT.en;
  return `<a href="${url}">${text}</a>`;
}

export async function sendOwnerBookingAlert(booking) {
  const results = { email: null, whatsapp: null };
  const base = siteBaseUrl();
  const approveUrl = `${base}/.netlify/functions/respond?id=${booking.id}&action=approve&sig=${booking.approveSig}`;
  const declineUrl = `${base}/.netlify/functions/respond?id=${booking.id}&action=decline&sig=${booking.declineSig}`;

  const resend = resendClient();
  const ownerEmail = process.env.OWNER_EMAIL;
  if (resend && ownerEmail) {
    try {
      await resend.emails.send({
        from: senderAddress(),
        to: ownerEmail,
        subject: `New booking REQUEST — ${booking.checkin} to ${booking.checkout}`,
        html: `
          <div style="font-family: sans-serif; max-width: 520px;">
            <h2 style="margin-bottom:4px;">New direct booking request</h2>
            <p style="color:#555;">${booking.nights} night(s) &middot; ${booking.adults} adult(s), ${booking.children} child(ren)</p>
            <table style="border-collapse:collapse; margin: 16px 0;">
              <tr><td style="padding:4px 12px 4px 0;color:#888;">Check-in</td><td><b>${booking.checkin}</b></td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#888;">Check-out</td><td><b>${booking.checkout}</b></td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#888;">Guest</td><td>${booking.name}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#888;">Email</td><td>${booking.email}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#888;">Phone</td><td>${booking.phone || "—"}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#888;">Language</td><td>${booking.lang}</td></tr>
              ${booking.message ? `<tr><td style="padding:4px 12px 4px 0;color:#888;">Note</td><td>${booking.message}</td></tr>` : ""}
            </table>
            ${quoteTable(booking.quote)}
            <p>
              <a href="${approveUrl}" style="background:#c9a769;color:#1a1408;padding:12px 22px;text-decoration:none;border-radius:3px;font-weight:600;margin-right:12px;">Approve booking</a>
              <a href="${declineUrl}" style="color:#a44;text-decoration:underline;">Decline</a>
            </p>
            <p style="font-size:12px;color:#999;">Approving does not mean paid — the guest still has to pay the link that gets sent. You'll get a separate email when Stripe confirms payment.</p>
          </div>
        `,
      });
      results.email = "sent";
    } catch (e) {
      results.email = `error: ${e.message}`;
    }
  } else {
    results.email = "skipped (RESEND_API_KEY or OWNER_EMAIL not set)";
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
  const to = process.env.OWNER_WHATSAPP_TO; // e.g. "whatsapp:+31612345678"
  if (sid && token && from && to) {
    try {
      const client = twilio(sid, token);
      await client.messages.create({
        from,
        to,
        body:
          `New booking REQUEST for L'Ancienne École\n` +
          `${booking.checkin} → ${booking.checkout} (${booking.nights} nights)\n` +
          `${booking.adults} adults, ${booking.children} children\n` +
          `${booking.name} — ${booking.email}\n` +
          (booking.quote
            ? `Total: ${fmtMoneyCents(booking.quote.totalCents, booking.quote.currency)} + ${fmtMoneyCents(booking.quote.depositCents, booking.quote.currency)} deposit\n`
            : "") +
          `Approve: ${approveUrl}\n` +
          `Decline: ${declineUrl}`,
      });
      results.whatsapp = "sent";
    } catch (e) {
      results.whatsapp = `error: ${e.message}`;
    }
  } else {
    results.whatsapp = "skipped (Twilio env vars not set)";
  }

  return results;
}

export function guestClosing(lang) {
  const copy = {
    nl: ['We kijken ernaar uit je te verwelkomen! Twee weken voor aankomst ontvang je de laatste informatie, inclusief het handboek en uitleg over zelf inchecken.', 'Heb je vragen? Bel of mail me gerust.', 'Met vriendelijke groet'],
    en: ['We look forward to welcoming you! Two weeks before arrival, you will receive the final information, including the house handbook and self check-in instructions.', 'Any questions? Please call or email me.', 'Kind regards'],
    fr: ['Nous avons hâte de vous accueillir ! Deux semaines avant votre arrivée, vous recevrez les dernières informations, notamment le guide de la maison et les instructions pour votre arrivée autonome.', 'Des questions ? Appelez-moi ou écrivez-moi.', 'Bien cordialement'],
  }[lang];
  return `<p>${copy[0]}</p><p>${copy[1]}</p><p>${copy[2]},<br><strong>Aernoud Florijn</strong><br>L’Ancienne École<br><a href="tel:+31654244444">+31 6 5424 4444</a><br><a href="mailto:aernoud@florijn.com">aernoud@florijn.com</a></p><img src="https://ancienne-ecole-troche.netlify.app/assets/logo-lockup.png" alt="L’Ancienne École" width="150" style="display:block;width:150px;height:auto;background:#111;padding:12px;">`;
}

export const GUEST_COPY = {
  en: {
    received: {
      subject: "We've received your booking request — L'Ancienne École",
      body: (b) =>
        `<p>Thank you, ${b.name} — we've received your <b>request</b> for <b>${b.checkin} to ${b.checkout}</b> (${b.nights} nights, ${b.adults} adults${b.children ? ` + ${b.children} children` : ""}).</p>
         <p>This is not yet a confirmed booking. Aernoud checks every request against the calendar personally and approves or declines it within 24 hours. You'll get a follow-up email either way.</p>`,
    },
    confirmed: {
      subject: "Your request has been approved — L'Ancienne École",
      body: (b) =>
        `<p>Good news, ${b.name} — your request for <b>${b.checkin} to ${b.checkout}</b> has been <b>approved</b> and the dates are held for you.</p>
         ${quoteTable(b.quote, "en")}
         ${
           b.stripePaymentLinkUrl
             ? `<p><a href="${b.stripePaymentLinkUrl}" style="background:#c9a769;color:#1a1408;padding:12px 22px;text-decoration:none;border-radius:3px;font-weight:600;">Pay now, securely</a></p>
                <p style="font-size:13px;color:#888;">Your booking is fully confirmed once this is paid. Includes a ${fmtMoneyCents(b.quote?.depositCents, b.quote?.currency)} refundable security deposit, returned after your stay if there's no damage.</p>`
             : `<p>Aernoud will be in touch shortly with a secure payment link.</p>`
         }
         <p>Thank you for booking directly with us!</p>`,
    },
    paid: {
      subject: "Payment received — you're all set! L'Ancienne École",
      body: (b) =>
        `<p>Thank you for your booking, ${b.name}.</p>
         <p>Below you'll find a summary of your booking. Our terms and conditions are available via the link ${termsLink("en")}.</p>
         ${bookingSummaryTable(b, "en")}
         ${quoteTable(b.quote, "en")}
         ${guestClosing("en")}`,
    },
    declined: {
      subject: "About your request — L'Ancienne École",
      body: (b) =>
        `<p>Hello ${b.name} — unfortunately we can't accommodate <b>${b.checkin} to ${b.checkout}</b> after all. We're sorry for the inconvenience, and happy to help you find other dates.</p>`,
    },
    cancelled: {
      subject: "Your booking has been cancelled — L'Ancienne École",
      body: (b) =>
        `<p>Hello ${b.name} — your previously approved stay for <b>${b.checkin} to ${b.checkout}</b> has been cancelled. We're sorry for the inconvenience.</p>
         ${
           b.paid
             ? `<p>Our records show this booking was already paid. Your refund is being handled separately by Aernoud and is <b>not</b> automatic from this email — please get in touch if you don't hear from us shortly.</p>`
             : ""
         }
         <p>Please don't hesitate to reach out with any questions.</p>`,
    },
    paymentExpired: {
      subject: "Your payment window has expired — L'Ancienne École",
      body: (b) =>
        `<p>Hello ${b.name} — the payment window for your stay request (<b>${b.checkin} to ${b.checkout}</b>) has expired without a completed payment, so those dates have been released again.</p>
         <p>No charge was made. If you'd still like to book, please visit the site again to check availability and complete a new booking.</p>`,
    },
    refundPending: {
      subject: "Your cancellation and refund are being processed — L'Ancienne École",
      body: (b) =>
        `<p>Hello ${b.name} — your booking for <b>${b.checkin} to ${b.checkout}</b> has been cancelled and a refund of <b>${fmtMoneyCents(b.pendingRefundAmountCents, b.quote?.currency)}</b> has been started.</p>
         <p>Refunds can take a few business days to appear on your statement, depending on your bank or card provider. We'll let you know once Stripe confirms it's complete.</p>`,
    },
    refundSuccess: {
      subject: "Your refund is complete — L'Ancienne École",
      body: (b) =>
        `<p>Hello ${b.name} — the refund of <b>${fmtMoneyCents(b.lastRefundAmountCents, b.quote?.currency)}</b> for your cancelled stay (<b>${b.checkin} to ${b.checkout}</b>) has been completed by Stripe.</p>
         <p>Please allow a few business days for it to appear on your statement. We're sorry things didn't work out this time, and hope to welcome you another time.</p>`,
    },
  },
  fr: {
    received: {
      subject: "Nous avons bien reçu votre demande — L'Ancienne École",
      body: (b) =>
        `<p>Merci, ${b.name} — nous avons bien reçu votre <b>demande</b> du <b>${b.checkin} au ${b.checkout}</b> (${b.nights} nuits, ${b.adults} adultes${b.children ? ` + ${b.children} enfants` : ""}).</p>
         <p>Ce n'est pas encore une réservation confirmée. Aernoud vérifie chaque demande personnellement et l'approuve ou la refuse sous 24h. Vous recevrez un e-mail dans les deux cas.</p>`,
    },
    confirmed: {
      subject: "Votre demande a été approuvée — L'Ancienne École",
      body: (b) =>
        `<p>Bonne nouvelle, ${b.name} — votre demande du <b>${b.checkin} au ${b.checkout}</b> a été <b>approuvée</b> et les dates sont réservées pour vous.</p>
         ${quoteTable(b.quote, "fr")}
         ${
           b.stripePaymentLinkUrl
             ? `<p><a href="${b.stripePaymentLinkUrl}" style="background:#c9a769;color:#1a1408;padding:12px 22px;text-decoration:none;border-radius:3px;font-weight:600;">Payer en ligne, en sécurité</a></p>
                <p style="font-size:13px;color:#888;">Votre réservation est définitivement confirmée une fois payée. Inclut une caution remboursable de ${fmtMoneyCents(b.quote?.depositCents, b.quote?.currency)}, restituée après votre séjour en l'absence de dégâts.</p>`
             : `<p>Aernoud vous contactera bientôt avec un lien de paiement sécurisé.</p>`
         }
         <p>Merci d'avoir réservé directement !</p>`,
    },
    paid: {
      subject: "Paiement reçu — c'est confirmé ! L'Ancienne École",
      body: (b) =>
        `<p>Merci pour votre réservation, ${b.name}.</p>
         <p>Vous trouverez ci-dessous le récapitulatif de votre réservation. Vous trouverez nos conditions générales via le lien ${termsLink("fr")}.</p>
         ${bookingSummaryTable(b, "fr")}
         ${quoteTable(b.quote, "fr")}
         ${guestClosing("fr")}`,
    },
    declined: {
      subject: "Concernant votre demande — L'Ancienne École",
      body: (b) =>
        `<p>Bonjour ${b.name} — malheureusement nous ne pouvons pas vous accueillir du <b>${b.checkin} au ${b.checkout}</b>. Toutes nos excuses, et n'hésitez pas si vous souhaitez essayer d'autres dates.</p>`,
    },
    cancelled: {
      subject: "Votre réservation a été annulée — L'Ancienne École",
      body: (b) =>
        `<p>Bonjour ${b.name} — votre séjour précédemment approuvé du <b>${b.checkin} au ${b.checkout}</b> a été annulé. Toutes nos excuses pour la gêne occasionnée.</p>
         ${
           b.paid
             ? `<p>Nos registres indiquent que cette réservation était déjà payée. Votre remboursement est traité séparément par Aernoud et n'est <b>pas</b> automatique suite à cet e-mail — contactez-nous si vous restez sans nouvelles.</p>`
             : ""
         }
         <p>N'hésitez pas à nous contacter pour toute question.</p>`,
    },
    paymentExpired: {
      subject: "Votre délai de paiement a expiré — L'Ancienne École",
      body: (b) =>
        `<p>Bonjour ${b.name} — le délai de paiement pour votre demande de séjour (<b>${b.checkin} au ${b.checkout}</b>) a expiré sans paiement complété, ces dates ont donc été libérées.</p>
         <p>Aucun montant n'a été débité. Si vous souhaitez toujours réserver, merci de revenir sur le site pour vérifier les disponibilités et effectuer une nouvelle réservation.</p>`,
    },
    refundPending: {
      subject: "Votre annulation et remboursement sont en cours — L'Ancienne École",
      body: (b) =>
        `<p>Bonjour ${b.name} — votre réservation du <b>${b.checkin} au ${b.checkout}</b> a été annulée et un remboursement de <b>${fmtMoneyCents(b.pendingRefundAmountCents, b.quote?.currency)}</b> a été lancé.</p>
         <p>Les remboursements peuvent prendre quelques jours ouvrés avant d'apparaître sur votre relevé, selon votre banque. Nous vous confirmerons dès que Stripe l'aura finalisé.</p>`,
    },
    refundSuccess: {
      subject: "Votre remboursement est terminé — L'Ancienne École",
      body: (b) =>
        `<p>Bonjour ${b.name} — le remboursement de <b>${fmtMoneyCents(b.lastRefundAmountCents, b.quote?.currency)}</b> pour votre séjour annulé (<b>${b.checkin} au ${b.checkout}</b>) a été finalisé par Stripe.</p>
         <p>Merci de patienter quelques jours ouvrés pour qu'il apparaisse sur votre relevé. Nous sommes désolés que cela n'ait pas fonctionné cette fois-ci et espérons vous accueillir une prochaine fois.</p>`,
    },
  },
  nl: {
    received: {
      subject: "We hebben je aanvraag ontvangen — L'Ancienne École",
      body: (b) =>
        `<p>Dank je, ${b.name} — we hebben je <b>aanvraag</b> ontvangen voor <b>${b.checkin} t/m ${b.checkout}</b> (${b.nights} nachten, ${b.adults} volwassenen${b.children ? ` + ${b.children} kinderen` : ""}).</p>
         <p>Dit is nog geen bevestigde boeking. Aernoud controleert elke aanvraag persoonlijk en keurt 'm binnen 24 uur goed of af. Je krijgt in beide gevallen een e-mail.</p>`,
    },
    confirmed: {
      subject: "Je aanvraag is goedgekeurd — L'Ancienne École",
      body: (b) =>
        `<p>Goed nieuws, ${b.name} — je aanvraag voor <b>${b.checkin} t/m ${b.checkout}</b> is <b>goedgekeurd</b> en de data zijn voor je vastgehouden.</p>
         ${quoteTable(b.quote, "nl")}
         ${
           b.stripePaymentLinkUrl
             ? `<p><a href="${b.stripePaymentLinkUrl}" style="background:#c9a769;color:#1a1408;padding:12px 22px;text-decoration:none;border-radius:3px;font-weight:600;">Veilig betalen</a></p>
                <p style="font-size:13px;color:#888;">Je boeking is pas definitief bevestigd zodra dit betaald is. Inclusief een terugbetaalbare borg van ${fmtMoneyCents(b.quote?.depositCents, b.quote?.currency)}, die je na je verblijf terugkrijgt als er geen schade is.</p>`
             : `<p>Aernoud neemt snel contact op met een veilige betaallink.</p>`
         }
         <p>Bedankt voor het rechtstreeks boeken!</p>`,
    },
    paid: {
      subject: "Betaling ontvangen — je zit goed! L'Ancienne École",
      body: (b) =>
        `<p>Dank u wel voor uw boeking.</p>
         <p>Hieronder treft u de samenvatting van uw boeking aan. Onze algemene voorwaarden vindt u via de link ${termsLink("nl")}.</p>
         ${bookingSummaryTable(b, "nl")}
         ${quoteTable(b.quote, "nl")}
         ${guestClosing("nl")}`,
    },
    declined: {
      subject: "Over je aanvraag — L'Ancienne École",
      body: (b) =>
        `<p>Hallo ${b.name} — helaas kunnen we je toch niet ontvangen van <b>${b.checkin} t/m ${b.checkout}</b>. Onze excuses, en laat het gerust weten als je andere data wilt proberen.</p>`,
    },
    cancelled: {
      subject: "Je boeking is geannuleerd — L'Ancienne École",
      body: (b) =>
        `<p>Hallo ${b.name} — je eerder goedgekeurde verblijf van <b>${b.checkin} t/m ${b.checkout}</b> is geannuleerd. Onze excuses voor het ongemak.</p>
         ${
           b.paid
             ? `<p>Volgens onze gegevens was deze boeking al betaald. Je terugbetaling wordt apart door Aernoud geregeld en gebeurt <b>niet</b> automatisch via deze e-mail — neem contact op als je hier niets over hoort.</p>`
             : ""
         }
         <p>Neem gerust contact op als je vragen hebt.</p>`,
    },
    paymentExpired: {
      subject: "Je betaaltermijn is verlopen — L'Ancienne École",
      body: (b) =>
        `<p>Hallo ${b.name} — de betaaltermijn voor je verblijfsaanvraag (<b>${b.checkin} t/m ${b.checkout}</b>) is verlopen zonder voltooide betaling, dus die data zijn weer vrijgegeven.</p>
         <p>Er is niets afgeschreven. Wil je alsnog boeken, ga dan terug naar de site om de beschikbaarheid te checken en een nieuwe boeking te plaatsen.</p>`,
    },
    refundPending: {
      subject: "Je annulering en terugbetaling worden verwerkt — L'Ancienne École",
      body: (b) =>
        `<p>Hallo ${b.name} — je boeking voor <b>${b.checkin} t/m ${b.checkout}</b> is geannuleerd en er is een terugbetaling van <b>${fmtMoneyCents(b.pendingRefundAmountCents, b.quote?.currency)}</b> gestart.</p>
         <p>Terugbetalingen kunnen een paar werkdagen duren voordat ze op je afschrift verschijnen, afhankelijk van je bank. We laten je weten zodra Stripe bevestigt dat het voltooid is.</p>`,
    },
    refundSuccess: {
      subject: "Je terugbetaling is voltooid — L'Ancienne École",
      body: (b) =>
        `<p>Hallo ${b.name} — de terugbetaling van <b>${fmtMoneyCents(b.lastRefundAmountCents, b.quote?.currency)}</b> voor je geannuleerde verblijf (<b>${b.checkin} t/m ${b.checkout}</b>) is door Stripe voltooid.</p>
         <p>Het kan nog een paar werkdagen duren voordat het op je afschrift verschijnt. Onze excuses dat het deze keer niet is gelukt — we hopen je een andere keer te mogen verwelkomen.</p>`,
    },
  },
};

export async function sendGuestEmail(booking, kind) {
  const resend = resendClient();
  if (!resend) return "skipped (RESEND_API_KEY not set)";
  const lang = GUEST_COPY[booking.lang] ? booking.lang : "en";
  const copy = GUEST_COPY[lang][kind];

  try {
    await resend.emails.send({
      from: senderAddress(),
      to: booking.email,
      replyTo: "aernoud@florijn.com",
      subject: `${copy.subject}${booking.reference ? " · " + booking.reference : ""}`,
      html: `<div style="font-family: sans-serif; max-width: 520px;">${copy.body(booking)}</div>`,
    });
    return "sent";
  } catch (e) {
    return `error: ${e.message}`;
  }
}
