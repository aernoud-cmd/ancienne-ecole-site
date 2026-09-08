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

function siteBaseUrl() {
  // Netlify sets URL to the site's primary production URL at runtime.
  return process.env.URL || process.env.DEPLOY_PRIME_URL || "https://ancienne-ecole.rent";
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
        from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
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

const GUEST_COPY = {
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
        `<p>Thank you, ${b.name} — we've received your payment for <b>${b.checkin} to ${b.checkout}</b>. Your stay is fully booked and paid.</p>
         <p>We look forward to welcoming you!</p>`,
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
        `<p>Merci, ${b.name} — nous avons bien reçu votre paiement pour le séjour du <b>${b.checkin} au ${b.checkout}</b>. Votre réservation est confirmée et payée.</p>
         <p>Nous avons hâte de vous accueillir !</p>`,
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
        `<p>Dank je, ${b.name} — we hebben je betaling ontvangen voor <b>${b.checkin} t/m ${b.checkout}</b>. Je boeking is volledig bevestigd en betaald.</p>
         <p>We kijken ernaar uit je te verwelkomen!</p>`,
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
  },
};

export async function sendGuestEmail(booking, kind) {
  const resend = resendClient();
  if (!resend) return "skipped (RESEND_API_KEY not set)";
  const lang = GUEST_COPY[booking.lang] ? booking.lang : "en";
  const copy = GUEST_COPY[lang][kind];
  try {
    await resend.emails.send({
      from: process.env.NOTIFY_FROM_EMAIL || "L'Ancienne École <bookings@ancienne-ecole.rent>",
      to: booking.email,
      subject: copy.subject,
      html: `<div style="font-family: sans-serif; max-width: 520px;">${copy.body(booking)}</div>`,
    });
    return "sent";
  } catch (e) {
    return `error: ${e.message}`;
  }
}
