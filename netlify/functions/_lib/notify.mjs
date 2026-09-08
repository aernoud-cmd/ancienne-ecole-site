// Sends the owner-facing and guest-facing notifications.
// All credentials (RESEND_API_KEY, TWILIO_*, OWNER_EMAIL, OWNER_WHATSAPP_TO)
// are read from environment variables the owner sets in Netlify's dashboard —
// this file never hardcodes or stores a secret.

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
        subject: `New booking request — ${booking.checkin} to ${booking.checkout}`,
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
            <p>
              <a href="${approveUrl}" style="background:#c9a769;color:#1a1408;padding:12px 22px;text-decoration:none;border-radius:3px;font-weight:600;margin-right:12px;">Confirm booking</a>
              <a href="${declineUrl}" style="color:#a44;text-decoration:underline;">Decline</a>
            </p>
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
          `New booking request for L'Ancienne École\n` +
          `${booking.checkin} → ${booking.checkout} (${booking.nights} nights)\n` +
          `${booking.adults} adults, ${booking.children} children\n` +
          `${booking.name} — ${booking.email}\n` +
          `Confirm: ${approveUrl}\n` +
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
        `<p>Thank you, ${b.name} — we've received your request for <b>${b.checkin} to ${b.checkout}</b> (${b.nights} nights, ${b.adults} adults${b.children ? ` + ${b.children} children` : ""}).</p>
         <p>Aernoud checks every request against the calendar personally and confirms within 24 hours. You'll get a follow-up email as soon as he does.</p>`,
    },
    confirmed: {
      subject: "Confirmed! Your stay at L'Ancienne École",
      body: (b) =>
        `<p>Good news, ${b.name} — your stay from <b>${b.checkin} to ${b.checkout}</b> is confirmed.</p>
         <p>Aernoud will be in touch shortly with a secure payment link. Thank you for booking directly with us!</p>`,
    },
    declined: {
      subject: "About your request — L'Ancienne École",
      body: (b) =>
        `<p>Hello ${b.name} — unfortunately we can't accommodate <b>${b.checkin} to ${b.checkout}</b> after all. We're sorry for the inconvenience, and happy to help you find other dates.</p>`,
    },
  },
  fr: {
    received: {
      subject: "Nous avons bien reçu votre demande — L'Ancienne École",
      body: (b) =>
        `<p>Merci, ${b.name} — nous avons bien reçu votre demande du <b>${b.checkin} au ${b.checkout}</b> (${b.nights} nuits, ${b.adults} adultes${b.children ? ` + ${b.children} enfants` : ""}).</p>
         <p>Aernoud vérifie chaque demande personnellement et confirme sous 24h. Vous recevrez un e-mail dès que ce sera fait.</p>`,
    },
    confirmed: {
      subject: "Confirmé ! Votre séjour à L'Ancienne École",
      body: (b) =>
        `<p>Bonne nouvelle, ${b.name} — votre séjour du <b>${b.checkin} au ${b.checkout}</b> est confirmé.</p>
         <p>Aernoud vous contactera bientôt avec un lien de paiement sécurisé. Merci d'avoir réservé directement !</p>`,
    },
    declined: {
      subject: "Concernant votre demande — L'Ancienne École",
      body: (b) =>
        `<p>Bonjour ${b.name} — malheureusement nous ne pouvons pas vous accueillir du <b>${b.checkin} au ${b.checkout}</b>. Toutes nos excuses, et n'hésitez pas si vous souhaitez essayer d'autres dates.</p>`,
    },
  },
  nl: {
    received: {
      subject: "We hebben je aanvraag ontvangen — L'Ancienne École",
      body: (b) =>
        `<p>Dank je, ${b.name} — we hebben je aanvraag ontvangen voor <b>${b.checkin} t/m ${b.checkout}</b> (${b.nights} nachten, ${b.adults} volwassenen${b.children ? ` + ${b.children} kinderen` : ""}).</p>
         <p>Aernoud controleert elke aanvraag persoonlijk en bevestigt binnen 24 uur. Je krijgt een e-mail zodra hij dat gedaan heeft.</p>`,
    },
    confirmed: {
      subject: "Bevestigd! Je verblijf bij L'Ancienne École",
      body: (b) =>
        `<p>Goed nieuws, ${b.name} — je verblijf van <b>${b.checkin} t/m ${b.checkout}</b> is bevestigd.</p>
         <p>Aernoud neemt snel contact op met een veilige betaallink. Bedankt voor het rechtstreeks boeken!</p>`,
    },
    declined: {
      subject: "Over je aanvraag — L'Ancienne École",
      body: (b) =>
        `<p>Hallo ${b.name} — helaas kunnen we je toch niet ontvangen van <b>${b.checkin} t/m ${b.checkout}</b>. Onze excuses, en laat het gerust weten als je andere data wilt proberen.</p>`,
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
