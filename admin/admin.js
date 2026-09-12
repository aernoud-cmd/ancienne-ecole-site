// Owner-only pricing/settings admin page. Talks to admin-login, admin-logout,
// admin-pricing, admin-sync-airbnb and admin-bookings (see
// netlify/functions/). Every data call relies on the httpOnly session cookie
// those endpoints check themselves — this file never handles the password
// beyond submitting the login form.
(function () {
  const MONTH_NAMES = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
  const STATUS_LABELS = {
    pending: "Aangevraagd",
    awaiting_payment: "Wacht op betaling",
    confirmed: "Bevestigd (betaald)",
    declined: "Afgewezen",
    cancelled: "Geannuleerd",
    expired_unanswered: "Verlopen (niet beantwoord)",
    expired_unpaid: "Verlopen (niet betaald)",
    payment_expired: "Betaling verlopen",
  };
  const HISTORY_EVENT_LABELS = {
    requested: "Aangevraagd",
    awaiting_payment: "Aangemaakt (wacht op betaling)",
    checkout_session_created: "Betaalsessie aangemaakt",
    checkout_session_error: "Betaalsessie aanmaken mislukt",
    approved: "Goedgekeurd",
    declined: "Afgewezen",
    cancelled: "Geannuleerd",
    paid: "Betaald",
    payment_link_created: "Betaallink aangemaakt",
    payment_link_error: "Betaallink aanmaken mislukt",
    payment_expired: "Betaling verlopen (niet op tijd betaald)",
    expired_unanswered: "Verlopen (niet beantwoord)",
    expired_unpaid: "Verlopen (niet betaald)",
    stale_link_payment_alert: "⚠ Betaling ontvangen op niet-actieve boeking",
    stale_checkout_payment_alert: "⚠ Betaling ontvangen op niet-actieve boeking",
    refund_initiated: "Terugbetaling gestart bij Stripe",
    refund_failed: "Terugbetaling mislukt",
    refund_confirmed: "Terugbetaling bevestigd door Stripe",
  };
  const HISTORY_BY_LABELS = {
    "owner-email-link": "via e-maillink",
    admin: "door jou (beheer)",
    "scheduled-sweep": "automatisch",
  };
  let bookingsById = {};
  let openBookingId = null;
  // null = unknown (no key set yet), true = Stripe test key, false = live
  // key — set from admin-bookings.mjs's own read of STRIPE_SECRET_KEY, never
  // guessed client-side. Used only to word the cancel+refund confirmations
  // honestly (see handleCancelAndRefund) — never to change any behavior.
  let stripeTestMode = null;

  let settings = null;
  let rates = {};
  let nightSources = {};
  let viewYear, viewMonth; // 0-indexed month
  let selStart = null, selEnd = null;
  // true right after a click sets selStart but before the range is completed
  // by a second click — this is what makes click 1 = "first night" and
  // click 2 = "last night, inclusive" distinct from every click afterwards
  // restarting a brand new selection (the old bug: every click restarted).
  let awaitingSecondClick = false;
  let formDirty = false; // true once the user has touched the price/min/blocked form since the last save
  let saving = false; // double-submit guard

  function iso(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function todayISO() {
    const t = new Date();
    return iso(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function datesInclusive(startISO, endISO) {
    const out = [];
    let cur = new Date(startISO + "T00:00:00Z");
    const end = new Date(endISO + "T00:00:00Z");
    while (cur <= end) {
      out.push(cur.toISOString().slice(0, 10));
      cur = new Date(cur.getTime() + 86400000);
    }
    return out;
  }
  function fmtEuro(cents) {
    return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
  }
  function fmtDateNL(iso) {
    const [y, m, d] = iso.split("-");
    return `${d}-${m}-${y}`;
  }
  function fmtRelative(hoursAgo) {
    if (hoursAgo == null) return "onbekend";
    if (hoursAgo < 1) return `${Math.round(hoursAgo * 60)} min. geleden`;
    return `${hoursAgo} uur geleden`;
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/.netlify/functions/${path}`, {
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      ...opts,
    });
    if (res.status === 401) {
      showLogin();
      throw new Error("not-authenticated");
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  function showLogin() {
    document.getElementById("ae-login-screen").hidden = false;
    document.getElementById("ae-app-screen").hidden = true;
  }
  function showApp() {
    document.getElementById("ae-login-screen").hidden = true;
    document.getElementById("ae-app-screen").hidden = false;
  }

  // ---- Unsaved-changes guard --------------------------------------------
  // Two layers: (1) leaving/reloading the whole page while the form is dirty
  // (native beforeunload prompt); (2) discarding the current selection (new
  // range, cleared selection, or a stale admin tab silently reloading data)
  // while dirty — a plain confirm() so it stays a deliberate choice, not a
  // silent loss of typed-but-unsaved values.
  window.addEventListener("beforeunload", (e) => {
    if (!formDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
  function confirmDiscardIfDirty() {
    if (!formDirty) return true;
    return confirm("Je hebt niet-opgeslagen wijzigingen in het prijzenformulier. Toch doorgaan en deze wijzigingen verwerpen?");
  }
  function setDirty(v) {
    formDirty = v;
  }

  // ---- Login / logout ----------------------------------------------

  document.getElementById("ae-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("ae-login-user").value;
    const password = document.getElementById("ae-login-pass").value;
    const errEl = document.getElementById("ae-login-error");
    errEl.textContent = "";
    const { ok, data } = await api("admin-login", { method: "POST", body: JSON.stringify({ username, password }) }).catch((e) => ({ ok: false, data: { error: e.message } }));
    if (!ok) {
      errEl.textContent = data.error || "Inloggen mislukt.";
      return;
    }
    await boot();
  });

  document.getElementById("ae-logout-btn").addEventListener("click", async () => {
    if (!confirmDiscardIfDirty()) return;
    await api("admin-logout", { method: "POST" }).catch(() => {});
    setDirty(false);
    showLogin();
  });

  // ---- Tabs -----------------------------------------------------------

  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("active")) return;
      if (!confirmDiscardIfDirty()) return;
      document.querySelectorAll(".admin-tab").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.querySelectorAll(".admin-tab-panel").forEach((p) => (p.hidden = true));
      document.getElementById(`ae-tab-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === "bookings") loadBookings();
    });
  });

  // ---- Load data --------------------------------------------------------

  async function loadPricing() {
    const { ok, data } = await api("admin-pricing");
    if (!ok) return;
    settings = data.settings;
    rates = data.rates;
    nightSources = data.nightSources;
    renderSyncBanner(data.airbnbSync);
    renderBuildBadge(data.buildInfo);
    renderCalendar();
    renderSettingsForm();
    lastLoadedAt = Date.now();
  }

  async function loadBookings() {
    const el = document.getElementById("ae-bookings-list");
    el.innerHTML = "Laden…";
    const { ok, data } = await api("admin-bookings");
    if (!ok) { el.innerHTML = "Kon aanvragen niet laden."; return; }
    stripeTestMode = typeof data.stripeTestMode === "boolean" ? data.stripeTestMode : null;
    if (!data.bookings.length) { el.innerHTML = "<p class=\"admin-dim\">Nog geen aanvragen.</p>"; bookingsById = {}; return; }
    bookingsById = Object.fromEntries(data.bookings.map((b) => [b.id, b]));
    renderBookingsTable();
  }

  function renderBookingsTable() {
    const el = document.getElementById("ae-bookings-list");
    const bookings = Object.values(bookingsById).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const rows = bookings.map((b) => {
      const pill = `<span class="status-pill status-${b.status}">${STATUS_LABELS[b.status] || b.status}</span>`;
      const paid = b.paid ? `<span class="status-paid-badge">Betaald ✓</span>` : (b.status === "confirmed" ? "Nog niet betaald" : "—");
      const isOpen = openBookingId === b.id;
      const row = `<tr class="admin-booking-row${isOpen ? " is-open" : ""}" data-id="${b.id}">
        <td><strong>${escapeHtml(b.reference || "")}</strong><br>${fmtDateNL(b.checkin)} → ${fmtDateNL(b.checkout)} (${b.nights}n)</td>
        <td>${escapeHtml(b.name)}<br><span class="admin-dim admin-small">${escapeHtml(b.email)}</span></td>
        <td>${b.adults} volw.${b.children ? `, ${b.children} kind(eren)` : ""}</td>
        <td>${pill}</td>
        <td>${paid}</td>
        <td>${b.totalCents != null ? fmtEuro(b.totalCents) : "—"}</td>
      </tr>`;
      const detailRow = isOpen
        ? `<tr class="admin-booking-detail-row" data-detail-for="${b.id}"><td colspan="6">${renderBookingDetail(b)}</td></tr>`
        : "";
      return row + detailRow;
    }).join("");
    el.innerHTML = `<table class="admin-table">
      <thead><tr><th>Data</th><th>Gast</th><th>Gasten</th><th>Status</th><th>Betaling</th><th>Totaal (incl. borg)</th></tr></thead>
      <tbody id="ae-bookings-tbody">${rows}</tbody>
    </table>`;
    bindBookingRowHandlers();
  }

  function renderBookingDetail(b) {
    const q = b.quote;
    const quoteRows = q ? [
      [`Kale huur (${q.nights} nachten)`, fmtEuro(q.rentalSubtotalCents)],
      ...(q.discountKind ? [[`Korting (${q.discountKind}, -${q.discountPercent}%)`, `-${fmtEuro(q.discountAmountCents)}`]] : []),
      ["Linnengoed", fmtEuro(q.linenFeeCents)],
      ["Schoonmaak", fmtEuro(q.cleaningFeeCents)],
      ["Toeristenbelasting", fmtEuro(q.touristTaxCents)],
      ["Subtotaal verblijf", fmtEuro(q.totalCents)],
      ["Waarborgsom", fmtEuro(q.depositCents)],
      ["Totaal (incl. borg)", fmtEuro(q.totalWithDepositCents)],
    ] : [];

    const history = (b.history || []).slice().sort((a, h) => new Date(a.at) - new Date(h.at));
    const historyItems = history.length
      ? history.map((h) => {
          const label = HISTORY_EVENT_LABELS[h.event] || h.event;
          const by = h.by ? ` — ${HISTORY_BY_LABELS[h.by] || h.by}` : "";
          const reason = h.reason ? ` (reden: ${escapeHtml(h.reason)})` : "";
          return `<li><span class="hist-event">${fmtDateTimeNL(h.at)}</span> — ${label}${by}${reason}</li>`;
        }).join("")
      : `<li class="admin-dim">Geen historie beschikbaar (aangemaakt vóór deze functie).</li>`;

    const staleWarning = b.staleLinkPayment
      ? `<div class="admin-stale-payment-warning">⚠ Er is op ${fmtDateTimeNL(b.staleLinkPayment.detectedAt)} een betaling van
         ${b.staleLinkPayment.amountTotalCents != null ? fmtEuro(b.staleLinkPayment.amountTotalCents) : "?"} binnengekomen
         terwijl deze boeking al "${STATUS_LABELS[b.staleLinkPayment.bookingStatusAtPayment] || b.staleLinkPayment.bookingStatusAtPayment}" was.
         Dit bedrag is <b>niet</b> aan deze boeking toegevoegd — regel dit handmatig terug via het Stripe-dashboard
         (checkout session <code>${b.staleLinkPayment.stripeCheckoutSessionId}</code>).</div>`
      : "";
    const staleCheckoutWarning = b.staleCheckoutPayment
      ? `<div class="admin-stale-payment-warning">⚠ Er is op ${fmtDateTimeNL(b.staleCheckoutPayment.detectedAt)} een betaling van
         ${b.staleCheckoutPayment.amountTotalCents != null ? fmtEuro(b.staleCheckoutPayment.amountTotalCents) : "?"} binnengekomen
         terwijl deze boeking al "${STATUS_LABELS[b.staleCheckoutPayment.bookingStatusAtPayment] || b.staleCheckoutPayment.bookingStatusAtPayment}" was.
         Dit bedrag is <b>niet</b> aan deze boeking toegevoegd — regel dit handmatig terug via het Stripe-dashboard
         (checkout session <code>${b.staleCheckoutPayment.stripeCheckoutSessionId}</code>).</div>`
      : "";

    let refundInfo = "";
    if (b.refundStatus === "pending") {
      refundInfo = `<div class="admin-refund-warning">Terugbetaling van ${fmtEuro(b.refundPendingAmountCents)} is gestart bij Stripe en wacht nog op bevestiging.</div>`;
    } else if (b.refundStatus === "failed") {
      refundInfo = `<div class="admin-stale-payment-warning">⚠ Terugbetaling mislukt: ${escapeHtml(b.refundError || "onbekende fout")}. Gebruik de knop hieronder om het opnieuw te proberen, of regel het handmatig via het Stripe-dashboard.</div>`;
    } else if (b.refundStatus === "fully_refunded" || b.refundStatus === "partially_refunded") {
      refundInfo = `<div class="admin-refund-warning">✓ ${fmtEuro(b.refundConfirmedTotalCents)} teruggestort, bevestigd door Stripe${b.refundStatus === "partially_refunded" ? " (gedeeltelijk)" : ""}.</div>`;
    }

    const actions = [];
    if (b.canDecline) actions.push(`<button type="button" class="btn-danger" data-action="decline" data-id="${b.id}">Aanvraag afwijzen</button>`);
    if (b.canCancel) actions.push(`<button type="button" class="btn-danger" data-action="cancel" data-id="${b.id}">Boeking annuleren</button>`);
    if (b.canCancelAndRefund) actions.push(`<button type="button" class="btn-danger" data-action="cancel_and_refund" data-id="${b.id}" data-amount="${b.amountToRefundCents}">Annuleren &amp; terugbetalen (${fmtEuro(b.amountToRefundCents)})</button>`);
    if (b.canRetryRefund) actions.push(`<button type="button" class="btn-danger" data-action="cancel_and_refund" data-id="${b.id}" data-amount="${b.amountToRefundCents}">Terugbetaling opnieuw proberen (${fmtEuro(b.amountToRefundCents)})</button>`);
    const actionsHtml = actions.length
      ? `<div class="field" style="max-width:360px;"><label for="ae-cancel-reason-${b.id}">Reden (optioneel, alleen intern)</label>
           <input class="input" type="text" id="ae-cancel-reason-${b.id}" maxlength="300"></div>
         <div class="admin-detail-actions">${actions.join("")}</div>
         <div class="admin-detail-result admin-dim" id="ae-detail-result-${b.id}"></div>`
      : "";

    return `<div class="admin-booking-detail">
      ${staleWarning}
      ${staleCheckoutWarning}
      <div class="admin-booking-detail-grid">
        <div>
          <h4>Gast</h4>
          <p class="admin-small">${escapeHtml(b.name)} — ${escapeHtml(b.email)}${b.phone ? ` — ${escapeHtml(b.phone)}` : ""}</p>
          ${b.message ? `<p class="admin-small admin-dim">"${escapeHtml(b.message)}"</p>` : ""}
          ${
            b.address
              ? `<p class="admin-small admin-dim">${escapeHtml(b.address.line1)}${b.address.line2 ? `, ${escapeHtml(b.address.line2)}` : ""}<br>${b.address.postalCode ? `${escapeHtml(b.address.postalCode)} ` : ""}${escapeHtml(b.address.city)}, ${escapeHtml(b.address.countryDisplayName || b.address.country || "")}</p>`
              : `<p class="admin-small admin-dim">Geen adres bekend (boeking van vóór de adresverplichting).</p>`
          }
          ${b.termsVersion ? `<p class="admin-small admin-dim">Voorwaarden geaccepteerd: versie ${escapeHtml(b.termsVersion)}</p>` : ""}
          <h4 style="margin-top:14px;">Betaling</h4>
          <p class="admin-small">
            ${b.paid ? `<span class="status-paid-badge">Betaald${b.paidAt ? ` op ${fmtDateTimeNL(b.paidAt)}` : ""}</span>` : "Nog niet betaald"}
            ${b.stripeCheckoutSessionExpiresAt && !b.paid ? `<br><span class="admin-dim">Betaalsessie verloopt: ${fmtDateTimeNL(b.stripeCheckoutSessionExpiresAt)}</span>` : ""}
            ${b.stripePaymentLinkUrl ? `<br><a href="${b.stripePaymentLinkUrl}" target="_blank" rel="noopener">Betaallink</a>` : ""}
            ${b.stripePaymentLinkDeactivateError ? `<br><span class="admin-dim">Let op: betaallink deactiveren mislukt (${escapeHtml(b.stripePaymentLinkDeactivateError)}) — zet 'm handmatig uit in Stripe.</span>` : ""}
          </p>
          ${refundInfo}
          ${b.cancelledAt ? `<p class="admin-small admin-dim">Geannuleerd op ${fmtDateTimeNL(b.cancelledAt)}${b.cancelReason ? ` — reden: ${escapeHtml(b.cancelReason)}` : ""}</p>` : ""}
        </div>
        <div>
          <h4>Prijsopbouw</h4>
          ${q ? `<table class="admin-quote-table">${quoteRows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("")}</table>` : `<p class="admin-dim admin-small">Geen prijsopbouw beschikbaar.</p>`}
        </div>
      </div>
      <h4>Historie</h4>
      <ul class="admin-history-list">${historyItems}</ul>
      ${actionsHtml}
    </div>`;
  }

  function bindBookingRowHandlers() {
    const tbody = document.getElementById("ae-bookings-tbody");
    if (!tbody) return;
    tbody.querySelectorAll(".admin-booking-row").forEach((tr) => {
      tr.addEventListener("click", () => {
        const id = tr.dataset.id;
        openBookingId = openBookingId === id ? null : id;
        renderBookingsTable();
      });
    });
    tbody.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.dataset.action === "cancel_and_refund") {
          handleCancelAndRefund(btn.dataset.id, Number(btn.dataset.amount));
        } else {
          handleBookingAction(btn.dataset.id, btn.dataset.action);
        }
      });
    });
  }

  function handleBookingAction(id, action) {
    const b = bookingsById[id];
    if (!b) return;
    const reasonInput = document.getElementById(`ae-cancel-reason-${id}`);
    const reason = reasonInput ? reasonInput.value.trim() : "";
    const confirmText = action === "cancel"
      ? `Boeking van ${escapeHtml(b.name)} (${fmtDateNL(b.checkin)} → ${fmtDateNL(b.checkout)}) annuleren? De data komen weer vrij voor andere aanvragen.`
      : `Aanvraag van ${escapeHtml(b.name)} (${fmtDateNL(b.checkin)} → ${fmtDateNL(b.checkout)}) afwijzen? De gast krijgt hier een e-mail over.`;
    showBookingConfirm(confirmText, async () => {
      const resultEl = document.getElementById(`ae-detail-result-${id}`);
      const { ok, data } = await api("admin-booking-action", { method: "POST", body: JSON.stringify({ id, action, reason: reason || undefined }) });
      if (!ok) {
        if (resultEl) { resultEl.style.color = "#d98c8c"; resultEl.textContent = data.error || "Actie mislukt."; }
        return;
      }
      await loadBookings();
      openBookingId = id;
      renderBookingsTable();
      // The Kalender & prijzen tab's nightSources aren't reloaded just by
      // switching tabs — without this, a cancelled/declined booking's dates
      // would keep showing as busy there until the next full page load or
      // stale-tab refresh, even though the server already freed them (see
      // the empty-actions branch below: those nights ARE actually free —
      // this is only about the calendar view catching up to that).
      if (!formDirty) loadPricing().catch(() => {});
      const freshResultEl = document.getElementById(`ae-detail-result-${id}`);
      if (freshResultEl) {
        freshResultEl.style.color = "#c9a769";
        freshResultEl.innerHTML = action === "cancel" ? "✓ Boeking geannuleerd." : "✓ Aanvraag afgewezen.";
      }
      // else: canCancel/canDecline are both false now that the action
      // succeeded, so renderBookingDetail() no longer renders the
      // actions/result block at all — the status pill (now "Geannuleerd"/
      // "Afgewezen") and the fresh history entry are the confirmation.
    });
  }

  // "cancel_and_refund" gets its own flow, deliberately separate from
  // handleBookingAction() above: this is real money, so it needs TWO
  // explicit confirmation steps (see README/spec section 9) rather than the
  // single Ja/Nee dialog every other action uses. Step 1 states the guest,
  // dates and euro amount and asks whether to proceed at all; step 2 makes
  // the admin explicitly confirm THAT SAME amount a second time, right
  // before the real Stripe refund fires. The `amountToRefundCents` used
  // here always comes fresh from the last admin-bookings load (via
  // bookingsById), never from the stale value on an already-open detail
  // panel, so both confirmations show the actual current figure — and the
  // server independently re-checks this same amount before refunding
  // anything (see admin-booking-action.mjs's REFUND_AMOUNT_MISMATCH check).
  function handleCancelAndRefund(id, amountCentsAtClick) {
    const b = bookingsById[id];
    if (!b) return;
    const amountCents = b.amountToRefundCents ?? amountCentsAtClick;
    const isRetry = b.status === "cancelled";
    const reasonInput = document.getElementById(`ae-cancel-reason-${id}`);
    const reason = reasonInput ? reasonInput.value.trim() : "";
    const guestLine = `${escapeHtml(b.name)} (${escapeHtml(b.email)}), ${fmtDateNL(b.checkin)} → ${fmtDateNL(b.checkout)}`;
    // Only ever asserts "test mode" when the server-reported key is
    // definitely sk_test_ (stripeTestMode === true) — never claimed on a
    // guess, and never omitted once known, so a real refund is never
    // wrongly softened either. See loadBookings()/admin-bookings.mjs.
    const testBadge = stripeTestMode === true ? "🧪 Stripe TESTMODUS (geen echt geld). " : "";

    const step1 = isRetry
      ? `${testBadge}Stap 1/2 — Terugbetaling van ${fmtEuro(amountCents)} aan ${guestLine} opnieuw proberen bij Stripe?`
      : `${testBadge}Stap 1/2 — Boeking van ${guestLine} annuleren én ${fmtEuro(amountCents)} terugbetalen via Stripe? De data komen weer vrij. Dit kan niet ongedaan worden gemaakt.`;

    showBookingConfirm(step1, () => {
      const step2 = isRetry
        ? `${testBadge}Stap 2/2 (laatste bevestiging) — hiermee wordt de terugbetaling van ${fmtEuro(amountCents)} aan ${guestLine} nu opnieuw ingediend bij Stripe${stripeTestMode === true ? " (testmodus)" : ""}. Weet je dit zeker?`
        : `${testBadge}Stap 2/2 (laatste bevestiging) — hiermee wordt de Stripe-terugbetaling van ${fmtEuro(amountCents)} aan ${guestLine} nu daadwerkelijk gestart${stripeTestMode === true ? " (testmodus)" : ""}. Weet je dit zeker?`;
      // Deliberately distinct button text per step (see review: the two
      // near-identical dialogs read as if the first click "didn't do
      // anything") — step 1's button just moves to the second, real
      // confirmation; step 2's button names the actual action about to fire.
      showBookingConfirm(step2, async () => {
        const resultEl = document.getElementById(`ae-detail-result-${id}`);
        const { ok, data } = await api("admin-booking-action", {
          method: "POST",
          body: JSON.stringify({ id, action: "cancel_and_refund", reason: reason || undefined, confirmAmountCents: amountCents }),
        });
        if (!ok) {
          if (resultEl) {
            resultEl.style.color = "#d98c8c";
            resultEl.textContent = data.code === "REFUND_AMOUNT_MISMATCH"
              ? `Het bedrag is intussen gewijzigd (nu ${fmtEuro(data.amountToRefundCents)}) — ververs en probeer opnieuw.`
              : (data.error || "Actie mislukt.");
          }
          await loadBookings();
          openBookingId = id;
          renderBookingsTable();
          return;
        }
        await loadBookings();
        openBookingId = id;
        renderBookingsTable();
        if (!formDirty) loadPricing().catch(() => {});
        const freshResultEl = document.getElementById(`ae-detail-result-${id}`);
        if (freshResultEl) {
          if (data.refund?.status === "failed") {
            freshResultEl.style.color = "#d98c8c";
            freshResultEl.innerHTML = `✓ Boeking geannuleerd, maar de terugbetaling is <b>mislukt</b>: ${escapeHtml(data.refund.error || "onbekende fout")}. De eigenaar is hierover per e-mail gewaarschuwd.`;
          } else {
            freshResultEl.style.color = "#c9a769";
            freshResultEl.innerHTML = `✓ Boeking geannuleerd. Terugbetaling van ${fmtEuro(data.refund?.amountToRefundCents ?? amountCents)} is gestart bij Stripe (wacht nog op bevestiging).`;
          }
        }
      }, { yesLabel: isRetry ? "Ja, opnieuw proberen" : "Ja, nu terugbetalen" });
    }, { yesLabel: "Ja, doorgaan naar bevestiging" });
  }

  // opts.yesLabel overrides the "Yes" button's text for this one dialog
  // (default "Ja, doorgaan") — used so a chain of two confirmations (see
  // handleCancelAndRefund) reads as two distinct steps rather than the same
  // button seemingly doing nothing the first time it's clicked.
  function showBookingConfirm(text, onYes, opts = {}) {
    const box = document.getElementById("ae-bookings-confirm-box");
    document.getElementById("ae-bookings-confirm-text").textContent = text;
    box.hidden = false;
    const yes = document.getElementById("ae-bookings-confirm-yes");
    const no = document.getElementById("ae-bookings-confirm-no");
    yes.textContent = opts.yesLabel || "Ja, doorgaan";
    const cleanup = () => { box.hidden = true; yes.onclick = null; no.onclick = null; };
    yes.onclick = async () => { cleanup(); await onYes(); };
    no.onclick = cleanup;
  }

  function fmtDateTimeNL(iso) {
    if (!iso) return "onbekend";
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderBuildBadge(buildInfo) {
    const el = document.getElementById("ae-build-badge");
    if (!el) return;
    if (!buildInfo || (!buildInfo.commit && !buildInfo.deployId)) {
      el.textContent = "";
      return;
    }
    const shortCommit = buildInfo.commit ? buildInfo.commit.slice(0, 7) : "?";
    el.textContent = `build ${shortCommit}${buildInfo.deployId ? " · deploy " + buildInfo.deployId.slice(0, 8) : ""}`;
    el.title = `Commit ${buildInfo.commit || "onbekend"} — deploy ${buildInfo.deployId || "onbekend"}. Als je hier een oude commit ziet na een nieuwe deploy, is de pagina nog niet ververst.`;
  }

  function renderSyncBanner(sync) {
    const el = document.getElementById("ae-sync-banner");
    const btn = document.getElementById("ae-sync-now-btn");
    if (!sync) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const attempt = `Laatste synchronisatiepoging: ${fmtRelative(sync.attemptHoursAgo)}.`;
    if (sync.lastError) {
      el.className = "admin-banner warn";
      el.innerHTML = `Airbnb-synchronisatie mislukt${sync.lastErrorAt ? " (" + fmtDateNL(sync.lastErrorAt.slice(0,10)) + ")" : ""}: ${escapeHtml(sync.lastError)}.<br>Laatst bekende, nog gebruikte Airbnb-data: ${sync.nightCount} nachten, succesvol gesynchroniseerd ${fmtRelative(sync.hoursAgo)}. ${attempt}`;
    } else if (sync.hoursAgo != null && sync.hoursAgo > 6) {
      el.className = "admin-banner warn";
      el.textContent = `Airbnb-kalender is ${fmtRelative(sync.hoursAgo)} niet ververst — mogelijk verouderd. Normaal elke 3 uur. ${attempt}`;
    } else if (sync.hoursAgo != null) {
      el.className = "admin-banner ok";
      el.textContent = `Airbnb-kalender laatst gesynchroniseerd: ${fmtRelative(sync.hoursAgo)} (${sync.nightCount} nachten bezet). ${attempt}`;
    } else {
      el.hidden = true;
    }
  }

  document.getElementById("ae-sync-now-btn").addEventListener("click", async () => {
    const btn = document.getElementById("ae-sync-now-btn");
    const status = document.getElementById("ae-sync-now-status");
    btn.disabled = true;
    status.textContent = "Bezig met synchroniseren…";
    try {
      const { ok, data } = await api("admin-sync-airbnb", { method: "POST" });
      if (!ok || !data.ok) {
        status.textContent = `Synchronisatie mislukt: ${data.error || "onbekende fout"}.`;
      } else {
        status.textContent = `✓ Gesynchroniseerd: ${data.nightCount} nachten bezet gevonden.`;
        await loadPricing();
      }
    } catch (e) {
      if (e.message !== "not-authenticated") status.textContent = "Synchronisatie mislukt door een netwerkfout.";
    } finally {
      btn.disabled = false;
      setTimeout(() => { status.textContent = ""; }, 8000);
    }
  });

  // ---- Calendar -----------------------------------------------------

  const SOURCE_LABELS = { direct: "eigen boeking", requested: "aanvraag", airbnb: "Airbnb", blocked: "eigen blokkade" };

  // A date is "occupied" — not available to guests — for any of four
  // reasons (see nightSources in admin-pricing.mjs): a real Airbnb/direct/
  // requested booking, OR the owner's own manual block. Used both to style
  // the calendar cell and to warn when the current period selection
  // includes such a date (selecting/pricing it here is an admin action —
  // it never makes the date bookable by guests; see the note above the
  // calendar and the warning in updateSelectionPanel()).
  function isDateOccupied(dateISO) {
    const rate = rates[dateISO];
    if (rate && rate.blocked) return true;
    return !!nightSources[dateISO];
  }

  function renderCalendar() {
    const label = document.getElementById("ae-cal-month-label");
    const grid = document.getElementById("ae-cal-grid");
    label.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const jsDay = firstOfMonth.getUTCDay();
    const leadingBlanks = (jsDay + 6) % 7;
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const today = todayISO();

    let html = "";
    for (let i = 0; i < leadingBlanks; i++) html += `<div class="admin-day blank"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateISO = iso(viewYear, viewMonth, d);
      const isPast = dateISO < today;
      const rate = rates[dateISO];
      const hasPrice = rate && rate.priceCents;
      const isBlocked = !!(rate && rate.blocked);
      const isSaturdayTurnover = !!(rate && rate.saturdayTurnover);
      const source = nightSources[dateISO];
      const occupied = isDateOccupied(dateISO);
      const inRange = selStart && selEnd && dateISO >= selStart && dateISO <= selEnd;
      const isEdge = dateISO === selStart || dateISO === selEnd;
      const isPendingStart = selStart && !selEnd && awaitingSecondClick && dateISO === selStart;
      const classes = ["admin-day"];
      if (isPast) classes.push("past");
      if (!hasPrice) classes.push("no-price");
      if (occupied) classes.push("occupied");
      if (isBlocked) classes.push("blocked");
      if (isSaturdayTurnover) classes.push("sat-turnover");
      if (inRange) classes.push("in-range");
      if (isEdge || isPendingStart) classes.push("range-edge");
      const ariaBits = [
        fmtDateNL(dateISO),
        hasPrice ? fmtEuro(rate.priceCents) : "geen prijs",
        rate && rate.minNights ? `minimum ${rate.minNights} nachten` : "",
        isBlocked ? "eigen blokkade" : "",
        isSaturdayTurnover ? "zaterdag-wisseldag (hoogseizoen)" : "",
        source ? SOURCE_LABELS[source] : "",
        occupied ? "niet beschikbaar voor gasten" : "",
      ].filter(Boolean).join(", ");
      html += `<div class="${classes.join(" ")}" data-date="${dateISO}" role="gridcell" tabindex="${isPast ? -1 : 0}" aria-label="${ariaBits}" aria-pressed="${inRange || isPendingStart}">
        ${source ? `<span class="d-source ${source}" aria-hidden="true"></span>` : ""}
        <span class="d-num">${d}</span>
        ${hasPrice ? `<span class="d-price">${fmtEuro(rate.priceCents)}</span>` : ""}
        ${rate && rate.minNights ? `<span class="d-min">min ${rate.minNights}n</span>` : ""}
        ${isBlocked ? `<span class="d-blocked-mark" aria-hidden="true">✕</span>` : ""}
        ${isSaturdayTurnover ? `<span class="d-sat-mark" aria-hidden="true">Za</span>` : ""}
      </div>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll(".admin-day:not(.blank):not(.past)").forEach((cell) => {
      cell.addEventListener("click", () => onDayClick(cell.dataset.date));
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDayClick(cell.dataset.date); }
      });
    });

    updateSelectionPanel();
  }

  // The actual fix: click 1 sets the first night. Click 2 sets the last
  // night (inclusive) — earlier or later than the first, either is fine, we
  // just sort them. Once a range is complete, the NEXT click starts a
  // genuinely new selection (this is what "just restarts" used to do on
  // every click, collapsing any 2+ night selection back to 1 night). This is
  // deliberately a different action from the explicit "Selectie wissen"
  // button below, which clears without picking a new date at all.
  function onDayClick(dateISO) {
    if (selStart && formDirty && !confirmDiscardIfDirty()) return;
    if (!selStart || !awaitingSecondClick) {
      // Starting a brand new selection (first-ever click, or the first click
      // after a previous range was already completed).
      selStart = dateISO;
      selEnd = null;
      awaitingSecondClick = true;
    } else {
      // Completing the range started by the previous click.
      if (dateISO >= selStart) {
        selEnd = dateISO;
      } else {
        selEnd = selStart;
        selStart = dateISO;
      }
      awaitingSecondClick = false;
    }
    setDirty(false);
    renderCalendar();
  }

  document.getElementById("ae-clear-selection-btn").addEventListener("click", () => {
    if (!confirmDiscardIfDirty()) return;
    selStart = null;
    selEnd = null;
    awaitingSecondClick = false;
    setDirty(false);
    renderCalendar();
  });

  document.getElementById("ae-date-range-apply-btn").addEventListener("click", () => {
    const startVal = document.getElementById("ae-date-start-input").value;
    const endVal = document.getElementById("ae-date-end-input").value;
    const errEl = document.getElementById("ae-date-range-error");
    errEl.textContent = "";
    if (!startVal) { errEl.textContent = "Vul minstens de eerste nacht in."; return; }
    const end = endVal || startVal;
    if (end < startVal) { errEl.textContent = "De laatste nacht kan niet vóór de eerste nacht liggen."; return; }
    if (!confirmDiscardIfDirty()) return;
    selStart = startVal;
    selEnd = end;
    awaitingSecondClick = false;
    setDirty(false);
    viewYear = Number(startVal.slice(0, 4));
    viewMonth = Number(startVal.slice(5, 7)) - 1;
    renderCalendar();
  });

  function updateSelectionPanel() {
    const summary = document.getElementById("ae-selection-summary");
    const occupancyNote = document.getElementById("ae-selection-occupancy-note");
    const form = document.getElementById("ae-period-form");
    const dateStartInput = document.getElementById("ae-date-start-input");
    const dateEndInput = document.getElementById("ae-date-end-input");

    if (!selStart) {
      summary.textContent = "Nog geen datums geselecteerd.";
      occupancyNote.hidden = true;
      form.hidden = true;
      dateStartInput.value = "";
      dateEndInput.value = "";
      return;
    }

    dateStartInput.value = selStart;
    dateEndInput.value = selEnd || selStart;

    if (!selEnd) {
      // Mid-selection: first night chosen, waiting for the second click.
      summary.innerHTML = `<b>Eerste nacht:</b> ${fmtDateNL(selStart)} — klik nu de <b>laatste nacht</b> (of dezelfde datum nogmaals voor één nacht).`;
      occupancyNote.hidden = true;
      form.hidden = true;
      return;
    }

    const dates = datesInclusive(selStart, selEnd);
    form.hidden = false;
    if (dates.length === 1) {
      summary.innerHTML = `<b>1 nacht:</b> ${fmtDateNL(selStart)}`;
    } else {
      summary.innerHTML = `<b>${dates.length} nachten:</b> <span class="admin-dim">Eerste nacht</span> ${fmtDateNL(selStart)} t/m <span class="admin-dim">laatste nacht, inbegrepen</span> ${fmtDateNL(selEnd)} <span class="admin-dim">(de vertrekdag zelf, ${fmtDateNL(nextDay(selEnd))}, telt hier niet mee)</span>`;
    }

    // Selecting/pricing a date here is purely an admin action on this
    // period's own settings — it never makes an occupied date bookable by
    // guests (that's decided solely by actual occupancy, see
    // isDateOccupied()). Warn explicitly whenever the current selection
    // overlaps one or more such dates, so this is never mistaken for "these
    // dates are now available".
    const occupiedDates = dates.filter(isDateOccupied);
    if (occupiedDates.length) {
      occupancyNote.hidden = false;
      const plural = occupiedDates.length === 1 ? "nacht is" : "nachten zijn";
      const list = occupiedDates.length <= 6
        ? occupiedDates.map(fmtDateNL).join(", ")
        : `${occupiedDates.slice(0, 6).map(fmtDateNL).join(", ")}, …`;
      occupancyNote.innerHTML = `⚠ ${occupiedDates.length} van de ${dates.length} geselecteerde ${plural} <b>niet beschikbaar voor gasten</b> (bezet of geblokkeerd): ${list}. Hier iets opslaan wijzigt alleen prijs/instellingen — het maakt deze data niet boekbaar. Pas de bezetting zelf (Airbnb-sync, boekingen, eigen blokkade) wijzigt dat.`;
    } else {
      occupancyNote.hidden = true;
    }

    populatePeriodForm(dates);
  }

  function nextDay(dateISO) {
    const d = new Date(dateISO + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // ---- Combined price / min-stay / blocked save ------------------------
  // One form, one "Wijzigingen opslaan" button, one POST — either all of the
  // touched fields save together or nothing changes. Blank price/min-stay =
  // "leave as-is"; the explicit checkboxes are the only way to actually
  // clear a value, so a blank field can never be silently misread as "clear".

  const WEEKDAY_NAMES = ["Ma","Di","Wo","Do","Vr","Za","Zo"];
  let arrivalDaysChecksBuilt = false;
  function ensureArrivalDaysCheckboxes() {
    if (arrivalDaysChecksBuilt) return;
    const el = document.getElementById("ae-arrival-days-checks");
    if (!el) return;
    el.innerHTML = WEEKDAY_NAMES.map((d, i) => `<label style="display:flex;align-items:center;gap:4px;font-size:13px;"><input type="checkbox" class="ae-arrival-day-cb" value="${i+1}">${d}</label>`).join("");
    arrivalDaysChecksBuilt = true;
  }
  document.getElementById("ae-arrival-days-select").addEventListener("change", (e) => {
    document.getElementById("ae-arrival-days-checks").hidden = e.target.value !== "custom";
    setDirty(true);
    updateSaveButtonState();
  });

  function currentFieldState(dates) {
    const priceValues = dates.map((d) => rates[d]?.priceCents ?? null);
    const minValues = dates.map((d) => rates[d]?.minNights ?? null);
    const blockedValues = dates.map((d) => !!rates[d]?.blocked);
    const saturdayTurnoverValues = dates.map((d) => !!rates[d]?.saturdayTurnover);
    const arrivalValues = dates.map((d) => JSON.stringify(rates[d]?.allowedArrivalWeekdays ?? null));
    const uniform = (arr) => arr.every((v) => v === arr[0]);
    return {
      price: { uniform: uniform(priceValues), value: priceValues[0] },
      minNights: { uniform: uniform(minValues), value: minValues[0] },
      blocked: { uniform: uniform(blockedValues), value: blockedValues[0] },
      saturdayTurnover: { uniform: uniform(saturdayTurnoverValues), value: saturdayTurnoverValues[0] },
      allowedArrivalWeekdays: { uniform: uniform(arrivalValues), value: dates[0] ? (rates[dates[0]]?.allowedArrivalWeekdays ?? null) : null },
    };
  }

  function populatePeriodForm(dates) {
    ensureArrivalDaysCheckboxes();
    const state = currentFieldState(dates);
    const priceInput = document.getElementById("ae-price-input");
    const priceClear = document.getElementById("ae-price-clear-cb");
    const minInput = document.getElementById("ae-min-nights-input");
    const minClear = document.getElementById("ae-min-clear-cb");
    const blockedSelect = document.getElementById("ae-blocked-select");
    const saturdayTurnoverSelect = document.getElementById("ae-saturday-turnover-select");
    const arrivalSelect = document.getElementById("ae-arrival-days-select");
    const arrivalChecks = document.getElementById("ae-arrival-days-checks");
    const statusLine = document.getElementById("ae-period-current-status");

    arrivalSelect.value = "";
    arrivalChecks.hidden = true;
    document.querySelectorAll(".ae-arrival-day-cb").forEach((cb) => (cb.checked = false));

    priceInput.value = state.price.uniform && state.price.value != null ? (state.price.value / 100).toFixed(2) : "";
    priceInput.placeholder = state.price.uniform ? (state.price.value == null ? "Geen prijs ingesteld" : "") : "Gemengd — leeg laten = ongewijzigd";
    priceClear.checked = false;

    minInput.value = state.minNights.uniform && state.minNights.value != null ? state.minNights.value : "";
    minInput.placeholder = state.minNights.uniform ? (state.minNights.value == null ? `Standaard (${settings.defaultMinNights})` : "") : "Gemengd — leeg laten = ongewijzigd";
    minClear.checked = false;

    blockedSelect.value = ""; // always default to "ongewijzigd laten" — see below for why
    saturdayTurnoverSelect.value = ""; // same: never presumed, always an explicit choice

    const priceText = !state.price.uniform ? "Gemengd" : state.price.value != null ? fmtEuro(state.price.value) : "geen prijs ingesteld";
    const minText = !state.minNights.uniform ? "Gemengd" : state.minNights.value != null ? `${state.minNights.value} nachten` : `standaard (${settings.defaultMinNights})`;
    const blockedText = !state.blocked.uniform ? "Gemengd" : state.blocked.value ? "geblokkeerd" : "niet geblokkeerd";
    const saturdayTurnoverText = !state.saturdayTurnover.uniform ? "Gemengd" : state.saturdayTurnover.value ? "aan (zaterdag-zaterdag verplicht)" : "uit";
    const arrivalText = !state.allowedArrivalWeekdays.uniform
      ? "Gemengd"
      : state.allowedArrivalWeekdays.value
        ? state.allowedArrivalWeekdays.value.map((n) => WEEKDAY_NAMES[n - 1]).join("/")
        : "site-brede instelling";
    statusLine.innerHTML = `<b>Huidige waarden:</b> prijs ${priceText} · minimumverblijf ${minText} · ${blockedText} · zaterdag-wisseldag: ${saturdayTurnoverText} · aankomstdagen: ${arrivalText}`;

    setDirty(false);
    updateSaveButtonState();
  }

  [
    ["ae-price-input", "input"],
    ["ae-price-clear-cb", "change"],
    ["ae-min-nights-input", "input"],
    ["ae-min-clear-cb", "change"],
    ["ae-blocked-select", "change"],
    ["ae-saturday-turnover-select", "change"],
  ].forEach(([id, evt]) => {
    document.getElementById(id).addEventListener(evt, () => {
      setDirty(true);
      updateSaveButtonState();
    });
  });

  document.getElementById("ae-price-clear-cb").addEventListener("change", (e) => {
    document.getElementById("ae-price-input").disabled = e.target.checked;
  });
  document.getElementById("ae-min-clear-cb").addEventListener("change", (e) => {
    document.getElementById("ae-min-nights-input").disabled = e.target.checked;
  });
  document.getElementById("ae-arrival-days-checks").addEventListener("change", (e) => {
    if (!e.target.classList.contains("ae-arrival-day-cb")) return;
    setDirty(true);
    updateSaveButtonState();
  });

  function buildPeriodPatch() {
    const priceVal = document.getElementById("ae-price-input").value;
    const priceClear = document.getElementById("ae-price-clear-cb").checked;
    const minVal = document.getElementById("ae-min-nights-input").value;
    const minClear = document.getElementById("ae-min-clear-cb").checked;
    const blockedChoice = document.getElementById("ae-blocked-select").value; // "" | "block" | "unblock"
    const saturdayTurnoverChoice = document.getElementById("ae-saturday-turnover-select").value; // "" | "on" | "off"

    const fields = {};
    const errors = [];

    if (priceClear) {
      fields.priceCents = null;
    } else if (priceVal !== "") {
      const euros = Number(String(priceVal).replace(",", "."));
      if (!Number.isFinite(euros) || euros <= 0) errors.push("Vul een prijs groter dan €0 in, of laat het veld leeg.");
      else fields.priceCents = Math.round(euros * 100);
    }

    if (minClear) {
      fields.minNights = null;
    } else if (minVal !== "") {
      const n = Number(minVal);
      if (!Number.isInteger(n) || n < 1) errors.push("Vul een geheel aantal nachten (≥ 1) in voor het minimumverblijf, of laat het veld leeg.");
      else fields.minNights = n;
    }

    if (blockedChoice === "block") fields.blocked = true;
    else if (blockedChoice === "unblock") fields.blocked = false;

    if (saturdayTurnoverChoice === "on") fields.saturdayTurnover = true;
    else if (saturdayTurnoverChoice === "off") fields.saturdayTurnover = false;

    const arrivalChoice = document.getElementById("ae-arrival-days-select").value; // "" | "custom" | "clear"
    if (arrivalChoice === "clear") {
      fields.allowedArrivalWeekdays = null;
    } else if (arrivalChoice === "custom") {
      const days = Array.from(document.querySelectorAll(".ae-arrival-day-cb:checked")).map((c) => Number(c.value));
      if (!days.length) errors.push("Vink minstens één aankomstdag aan, of kies \"Ongewijzigd laten\"/\"Terugzetten\".");
      else fields.allowedArrivalWeekdays = days;
    }

    return { fields, errors };
  }

  function updateSaveButtonState() {
    const btn = document.getElementById("ae-save-period-btn");
    const { fields, errors } = buildPeriodPatch();
    btn.disabled = saving || errors.length > 0 || Object.keys(fields).length === 0;
  }

  function describePatch(fields, nNights) {
    const parts = [];
    if ("priceCents" in fields) parts.push(fields.priceCents === null ? "prijs verwijderen (niet boekbaar maken)" : `nachtprijs instellen op ${fmtEuro(fields.priceCents)}`);
    if ("minNights" in fields) parts.push(fields.minNights === null ? `minimumverblijf terugzetten naar standaard (${settings.defaultMinNights})` : `minimumverblijf instellen op ${fields.minNights} nacht(en)`);
    if ("blocked" in fields) parts.push(fields.blocked ? "deze data blokkeren (niet boekbaar, eigen gebruik)" : "blokkade opheffen");
    if ("saturdayTurnover" in fields) parts.push(fields.saturdayTurnover ? "zaterdag-wisseldag AAN zetten (aankomst én vertrek verplicht op zaterdag voor elk verblijf dat deze nachten raakt)" : "zaterdag-wisseldag UIT zetten");
    if ("allowedArrivalWeekdays" in fields) parts.push(fields.allowedArrivalWeekdays === null ? "aankomstdagen terugzetten naar de site-brede instelling" : `aankomst alleen toestaan op: ${fields.allowedArrivalWeekdays.map((n) => WEEKDAY_NAMES[n - 1]).join("/")}`);
    return `Dit gaat voor ${nNights} nacht(en) (${fmtDateNL(selStart)} t/m ${fmtDateNL(selEnd)}): ${parts.join("; ")}. Alles wordt in één keer opgeslagen — of alles lukt, of er verandert niets. Doorgaan?`;
  }

  document.getElementById("ae-save-period-btn").addEventListener("click", () => {
    const dates = datesInclusive(selStart, selEnd);
    const { fields, errors } = buildPeriodPatch();
    if (errors.length) { alert(errors.join("\n")); return; }
    if (!Object.keys(fields).length) return;
    showConfirm(describePatch(fields, dates.length), async () => {
      if (saving) return;
      saving = true;
      updateSaveButtonState();
      await savePatch(
        { ratesPatch: Object.fromEntries(dates.map((d) => [d, fields])) },
        (n) => `✓ ${n} datum(s) bijgewerkt.`
      );
      saving = false;
      setDirty(false);
      updateSaveButtonState();
    });
  });

  function showConfirm(text, onYes) {
    const box = document.getElementById("ae-confirm-box");
    document.getElementById("ae-confirm-text").textContent = text;
    box.hidden = false;
    const yes = document.getElementById("ae-confirm-yes");
    const no = document.getElementById("ae-confirm-no");
    const cleanup = () => { box.hidden = true; yes.onclick = null; no.onclick = null; };
    yes.onclick = async () => { cleanup(); await onYes(); };
    no.onclick = cleanup;
  }

  async function savePatch(patch, successMessage) {
    const { ok, data } = await api("admin-pricing", { method: "POST", body: JSON.stringify(patch) });
    const resultEl = document.getElementById("ae-save-result");
    if (!ok) {
      resultEl.style.color = "#d98c8c";
      resultEl.textContent = (data.error || "Opslaan mislukt.") + (data.details ? " " + data.details.join(" ") : "");
      return;
    }
    rates = data.rates;
    if (data.settings) settings = data.settings;
    if (data.rejected && data.rejected.length) {
      resultEl.style.color = "#d98c8c";
      resultEl.textContent = `${data.changedDates.length} datum(s) bijgewerkt, ${data.rejected.length} geweigerd: ${data.rejected.map((r) => `${r.date} (${r.reason})`).join(", ")}`;
    } else {
      resultEl.style.color = "#c9a769";
      resultEl.textContent = successMessage(data.changedDates.length);
    }
    renderCalendar();
  }

  document.getElementById("ae-cal-prev").addEventListener("click", () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } renderCalendar(); });
  document.getElementById("ae-cal-next").addEventListener("click", () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } renderCalendar(); });

  // ---- Settings form ----------------------------------------------------

  function renderSettingsForm() {
    const el = document.getElementById("ae-settings-form");
    const s = settings;
    el.innerHTML = `
      <div class="admin-settings-section">
        <h3>Kortingen</h3>
        <div class="admin-settings-grid">
          <div>
            <div class="admin-checkbox-row"><input type="checkbox" id="s-week-enabled" ${s.weekDiscount.enabled ? "checked" : ""}><label for="s-week-enabled">Weekkorting actief</label></div>
            <div class="field"><label>Vanaf aantal nachten</label><input class="input" type="number" min="1" id="s-week-min" value="${s.weekDiscount.minNights}"></div>
            <div class="field"><label>Percentage</label><input class="input" type="number" min="0" max="100" step="0.1" id="s-week-pct" value="${s.weekDiscount.percent}"></div>
          </div>
          <div>
            <div class="admin-checkbox-row"><input type="checkbox" id="s-month-enabled" ${s.monthDiscount.enabled ? "checked" : ""}><label for="s-month-enabled">Maandkorting actief</label></div>
            <div class="field"><label>Vanaf aantal nachten</label><input class="input" type="number" min="1" id="s-month-min" value="${s.monthDiscount.minNights}"></div>
            <div class="field"><label>Percentage</label><input class="input" type="number" min="0" max="100" step="0.1" id="s-month-pct" value="${s.monthDiscount.percent}"></div>
          </div>
        </div>
        <p class="admin-note">Maand- en weekkorting worden nooit opgeteld — bij een verblijf dat aan beide voorwaarden voldoet geldt de maandkorting.</p>
      </div>

      <div class="admin-settings-section">
        <h3>Linnengoed &amp; schoonmaak</h3>
        <div class="admin-settings-grid">
          <div class="field"><label>Linnengoed per persoon (&euro;)</label><input class="input" type="number" min="0" step="0.01" id="s-linen-amount" value="${(s.linenFeePerPersonCents/100).toFixed(2)}"></div>
          <div class="field"><label>Berekeningswijze</label>
            <select class="input" id="s-linen-mode">
              <option value="per_booking" ${s.linenFeeMode === "per_booking" ? "selected" : ""}>Eenmalig per persoon per boeking</option>
              <option value="per_week" ${s.linenFeeMode === "per_week" ? "selected" : ""}>Per persoon per (deel van een) week</option>
            </select>
          </div>
          <div class="field"><label>Eindschoonmaak (&euro;, eenmalig)</label><input class="input" type="number" min="0" step="0.01" id="s-cleaning" value="${(s.cleaningFeeCents/100).toFixed(2)}"></div>
        </div>
        <p class="admin-note">Bij "per week" telt een begonnen week volledig mee (bijv. 9 nachten = 2 weken).</p>
      </div>

      <div class="admin-settings-section">
        <h3>Toeristenbelasting</h3>
        <div class="admin-warn-box">
          Let op: voor een <b>geclassificeerd</b> meublé de tourisme (zoals dit huis) hanteert de Franse wet meestal een <b>vast bedrag per volwassene per nacht</b> per sterrencategorie — geen percentage. Het percentage hieronder geldt volgens je gemeente/intercommunalité alleen voor <b>niet-geclassificeerde</b> verhuur. Controleer het actuele tarief voor jouw sterrenclassificatie bij de Communauté de communes du Pays de Lubersac-Pompadour (of Terres de Corrèze) voordat je hierop vertrouwt, en kies eventueel "vast bedrag" hieronder.
        </div>
        <div class="admin-settings-grid">
          <div class="field"><label>Methode</label>
            <select class="input" id="s-tax-mode">
              <option value="percentage" ${s.touristTax.mode === "percentage" ? "selected" : ""}>Percentage van de prijs (na korting)</option>
              <option value="fixed_per_person_per_night" ${s.touristTax.mode === "fixed_per_person_per_night" ? "selected" : ""}>Vast bedrag per volwassene per nacht</option>
            </select>
          </div>
          <div class="field"><label>Percentage</label><input class="input" type="number" min="0" max="100" step="0.1" id="s-tax-pct" value="${s.touristTax.ratePercent}"></div>
          <div class="field"><label>Plafond per nacht per volwassene (&euro;, optioneel)</label><input class="input" type="number" min="0" step="0.01" id="s-tax-cap" value="${s.touristTax.capCentsPerNight != null ? (s.touristTax.capCentsPerNight/100).toFixed(2) : ""}"></div>
          <div class="field"><label>Vast bedrag per volwassene per nacht (&euro;)</label><input class="input" type="number" min="0" step="0.01" id="s-tax-fixed" value="${(s.touristTax.fixedAmountCents/100).toFixed(2)}"></div>
          <div class="field"><label>Leeftijdsgrens (belastingplichtig vanaf)</label><input class="input" type="number" min="0" id="s-tax-minage" value="${s.touristTax.minAge}"></div>
          <div class="field"><label>Departementale opslag (%, indien van toepassing)</label><input class="input" type="number" min="0" max="100" step="0.1" id="s-tax-dept" value="${s.touristTax.departmentalSurchargePercent}"></div>
        </div>
      </div>

      <div class="admin-settings-section">
        <h3>Borg</h3>
        <div class="field" style="max-width:220px;"><label>Terugbetaalbare borg (&euro;)</label><input class="input" type="number" min="0" step="0.01" id="s-deposit" value="${(s.depositCents/100).toFixed(2)}"></div>
        <p class="admin-note">De borg wordt vooraf mee geïnd via de betaallink (Stripe ondersteunt geen automatische hold-and-release via een Payment Link) en moet je na een schadevrij verblijf zelf terugbetalen via je Stripe-dashboard.</p>
      </div>

      <div class="admin-settings-section">
        <h3>Bezetting</h3>
        <div class="admin-settings-grid">
          <div class="field"><label>Max. volwassenen</label><input class="input" type="number" min="1" id="s-cap-adults" value="${s.capacity.maxAdults}"></div>
          <div class="field"><label>Max. kinderen</label><input class="input" type="number" min="0" id="s-cap-children" value="${s.capacity.maxChildren}"></div>
          <div class="field"><label>Max. totaal aantal gasten</label><input class="input" type="number" min="1" id="s-cap-total" value="${s.capacity.maxTotalGuests}"></div>
          <div class="field"><label>Kind tot en met leeftijd</label><input class="input" type="number" min="0" id="s-cap-childage" value="${s.capacity.childMaxAge}"></div>
        </div>
        <p class="admin-note">Geldige combinaties zijn er zolang volwassenen ≤ max. volwassenen, kinderen ≤ max. kinderen, én het totaal ≤ max. totaal aantal gasten. Dit geldt overal: beheer, boekingsformulier, prijsberekening en aanvraag.</p>
      </div>

      <div class="admin-settings-section">
        <h3>Verblijfsregels &amp; vervaltermijnen</h3>
        <div class="admin-settings-grid">
          <div class="field"><label>Standaard minimumverblijf (nachten, als er geen datum-specifieke waarde is)</label><input class="input" type="number" min="1" id="s-default-min" value="${s.defaultMinNights}"></div>
          <div class="field"><label>Aanvraag vervalt na (uren, onbeantwoord)</label><input class="input" type="number" min="1" id="s-expiry-pending" value="${s.pendingRequestExpiryHours}"></div>
          <div class="field"><label>Goedgekeurd maar onbetaald vervalt na (uren)</label><input class="input" type="number" min="1" id="s-expiry-unpaid" value="${s.unpaidApprovedExpiryHours}"></div>
        </div>
        <div class="field" style="margin-top:12px;max-width:420px;">
          <label>Toegestane aankomstdagen (leeg = alle dagen toegestaan)</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">
            ${["Ma","Di","Wo","Do","Vr","Za","Zo"].map((d, i) => `<label style="display:flex;align-items:center;gap:4px;font-size:13px;"><input type="checkbox" class="s-arrival-day" value="${i+1}" ${(!s.allowedArrivalWeekdays || s.allowedArrivalWeekdays.includes(i+1)) ? "checked" : ""}>${d}</label>`).join("")}
          </div>
          <p class="admin-note">Dit geldt voor de hele site (nog niet per periode instelbaar — zie de opmerking hieronder). Een minimumverblijf van bijv. 7 nachten betekent hier NIET automatisch dat aankomst alleen op zaterdag mag — vink dat hierboven expliciet aan als je dat wilt. Minimumverblijf wordt bepaald door de AANKOMSTdatum: de nacht waarop een boeking begint bepaalt welk minimum geldt voor de hele boeking (zie de kalender hierboven voor datum-specifieke minima).</p>
        </div>
      </div>

      <button class="btn-primary" id="ae-save-settings-btn" type="button">Instellingen opslaan</button>
      <div id="ae-settings-result" class="admin-save-result" role="status" aria-live="polite"></div>
    `;

    document.getElementById("ae-save-settings-btn").addEventListener("click", saveSettingsForm);
  }

  function euros(id) {
    return Math.round(Number(String(document.getElementById(id).value).replace(",", ".")) * 100);
  }
  function intVal(id) {
    return Number(document.getElementById(id).value);
  }

  async function saveSettingsForm() {
    const arrivalDays = Array.from(document.querySelectorAll(".s-arrival-day:checked")).map((c) => Number(c.value));
    const allAllowed = arrivalDays.length === 7 || arrivalDays.length === 0;

    const patch = {
      weekDiscount: { enabled: document.getElementById("s-week-enabled").checked, minNights: intVal("s-week-min"), percent: Number(document.getElementById("s-week-pct").value) },
      monthDiscount: { enabled: document.getElementById("s-month-enabled").checked, minNights: intVal("s-month-min"), percent: Number(document.getElementById("s-month-pct").value) },
      linenFeeMode: document.getElementById("s-linen-mode").value,
      linenFeePerPersonCents: euros("s-linen-amount"),
      cleaningFeeCents: euros("s-cleaning"),
      touristTax: {
        mode: document.getElementById("s-tax-mode").value,
        ratePercent: Number(document.getElementById("s-tax-pct").value),
        capCentsPerNight: document.getElementById("s-tax-cap").value ? euros("s-tax-cap") : null,
        fixedAmountCents: euros("s-tax-fixed"),
        minAge: intVal("s-tax-minage"),
        departmentalSurchargePercent: Number(document.getElementById("s-tax-dept").value),
      },
      depositCents: euros("s-deposit"),
      capacity: {
        maxAdults: intVal("s-cap-adults"),
        maxChildren: intVal("s-cap-children"),
        maxTotalGuests: intVal("s-cap-total"),
        childMaxAge: intVal("s-cap-childage"),
      },
      defaultMinNights: intVal("s-default-min"),
      allowedArrivalWeekdays: allAllowed ? null : arrivalDays,
      pendingRequestExpiryHours: intVal("s-expiry-pending"),
      unpaidApprovedExpiryHours: intVal("s-expiry-unpaid"),
    };

    const { ok, data } = await api("admin-pricing", { method: "POST", body: JSON.stringify({ settingsPatch: patch }) });
    const el = document.getElementById("ae-settings-result");
    if (!ok) {
      el.style.color = "#d98c8c";
      el.textContent = (data.error || "Opslaan mislukt.") + (data.details ? " " + data.details.join(" ") : "");
      return;
    }
    settings = data.settings;
    el.style.color = "#c9a769";
    el.textContent = "✓ Instellingen opgeslagen — geldt meteen voor nieuwe offertes.";
  }

  // ---- Boot -------------------------------------------------------------

  // A browser tab left open for a while can otherwise silently show hours-old
  // prices/rates and let a save based on that stale view clobber a change
  // made from another tab or another day. Refetching on focus/visibility —
  // but ONLY when nothing is unsaved — keeps a long-lived tab honest without
  // ever discarding in-progress edits behind the owner's back.
  let lastLoadedAt = 0;
  const STALE_AFTER_MS = 2 * 60 * 1000;
  async function refreshIfStale() {
    if (document.getElementById("ae-app-screen").hidden) return; // not logged in / not shown yet
    if (formDirty) return; // never silently discard an in-progress edit
    if (Date.now() - lastLoadedAt < STALE_AFTER_MS) return;
    try {
      await loadPricing();
    } catch (e) {
      if (e.message !== "not-authenticated") console.error(e);
    }
  }
  window.addEventListener("focus", refreshIfStale);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshIfStale(); });

  async function boot() {
    const t = new Date();
    viewYear = t.getFullYear();
    viewMonth = t.getMonth();
    try {
      await loadPricing();
      showApp();
    } catch (e) {
      if (e.message !== "not-authenticated") console.error(e);
    }
  }

  boot();
})();
