// Owner-only pricing/settings admin page. Talks to admin-login, admin-logout,
// admin-pricing and admin-bookings (see netlify/functions/). Every data call
// relies on the httpOnly session cookie those endpoints check themselves —
// this file never handles the password beyond submitting the login form.
(function () {
  const MONTH_NAMES = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
  const STATUS_LABELS = {
    pending: "Aangevraagd",
    confirmed: "Goedgekeurd",
    declined: "Afgewezen",
    expired_unanswered: "Verlopen (niet beantwoord)",
    expired_unpaid: "Verlopen (niet betaald)",
  };

  let settings = null;
  let rates = {};
  let nightSources = {};
  let viewYear, viewMonth; // 0-indexed month
  let selStart = null, selEnd = null;

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
    await api("admin-logout", { method: "POST" }).catch(() => {});
    showLogin();
  });

  // ---- Tabs -----------------------------------------------------------

  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
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
    renderCalendar();
    renderSettingsForm();
  }

  async function loadBookings() {
    const el = document.getElementById("ae-bookings-list");
    el.innerHTML = "Laden…";
    const { ok, data } = await api("admin-bookings");
    if (!ok) { el.innerHTML = "Kon aanvragen niet laden."; return; }
    if (!data.bookings.length) { el.innerHTML = "<p class=\"admin-dim\">Nog geen aanvragen.</p>"; return; }
    const rows = data.bookings.map((b) => {
      const pill = `<span class="status-pill status-${b.status}">${STATUS_LABELS[b.status] || b.status}</span>`;
      const paid = b.paid ? `<span class="status-paid-badge">Betaald ✓</span>` : (b.status === "confirmed" ? "Nog niet betaald" : "—");
      return `<tr>
        <td>${fmtDateNL(b.checkin)} → ${fmtDateNL(b.checkout)} (${b.nights}n)</td>
        <td>${escapeHtml(b.name)}<br><span class="admin-dim admin-small">${escapeHtml(b.email)}</span></td>
        <td>${b.adults} volw.${b.children ? `, ${b.children} kind(eren)` : ""}</td>
        <td>${pill}</td>
        <td>${paid}</td>
        <td>${b.totalCents != null ? fmtEuro(b.totalCents) : "—"}</td>
      </tr>`;
    }).join("");
    el.innerHTML = `<table class="admin-table">
      <thead><tr><th>Data</th><th>Gast</th><th>Gasten</th><th>Status</th><th>Betaling</th><th>Totaal (incl. borg)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderSyncBanner(sync) {
    const el = document.getElementById("ae-sync-banner");
    if (!sync) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (sync.lastError) {
      el.className = "admin-banner warn";
      el.textContent = `Airbnb-synchronisatie mislukt (${sync.lastErrorAt ? fmtDateNL(sync.lastErrorAt.slice(0,10)) : "onbekend"}): ${sync.lastError}. De laatst bekende Airbnb-data (${sync.nightCount} nachten) wordt intussen nog gebruikt.`;
    } else if (sync.hoursAgo != null && sync.hoursAgo > 6) {
      el.className = "admin-banner warn";
      el.textContent = `Airbnb-kalender is ${sync.hoursAgo} uur niet ververst — mogelijk verouderd. Normaal elke 3 uur.`;
    } else if (sync.hoursAgo != null) {
      el.className = "admin-banner ok";
      el.textContent = `Airbnb-kalender laatst gesynchroniseerd: ${sync.hoursAgo} uur geleden (${sync.nightCount} nachten bezet).`;
    } else {
      el.hidden = true;
    }
  }

  // ---- Calendar -----------------------------------------------------

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
      const source = nightSources[dateISO];
      const inRange = selStart && selEnd && dateISO >= selStart && dateISO <= selEnd;
      const isEdge = dateISO === selStart || dateISO === selEnd;
      const classes = ["admin-day"];
      if (isPast) classes.push("past");
      if (!hasPrice) classes.push("no-price");
      if (inRange) classes.push("in-range");
      if (isEdge) classes.push("range-edge");
      html += `<div class="${classes.join(" ")}" data-date="${dateISO}" role="gridcell" tabindex="${isPast ? -1 : 0}" aria-label="${fmtDateNL(dateISO)}${hasPrice ? ", " + fmtEuro(rate.priceCents) : ", geen prijs"}${rate && rate.minNights ? ", minimum " + rate.minNights + " nachten" : ""}">
        ${source ? `<span class="d-source ${source}"></span>` : ""}
        <span class="d-num">${d}</span>
        ${hasPrice ? `<span class="d-price">${fmtEuro(rate.priceCents)}</span>` : ""}
        ${rate && rate.minNights ? `<span class="d-min">min ${rate.minNights}n</span>` : ""}
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

  function onDayClick(dateISO) {
    if (!selStart || (selStart && selEnd) || dateISO < selStart) {
      selStart = dateISO;
      selEnd = dateISO; // single-day selection by default
    } else if (dateISO === selStart) {
      selEnd = dateISO;
    } else {
      selEnd = dateISO;
    }
    renderCalendar();
  }

  function updateSelectionPanel() {
    const summary = document.getElementById("ae-selection-summary");
    const priceBtn = document.getElementById("ae-set-price-btn");
    const clearPriceBtn = document.getElementById("ae-clear-price-btn");
    const minBtn = document.getElementById("ae-set-min-nights-btn");
    const clearMinBtn = document.getElementById("ae-clear-min-nights-btn");

    if (!selStart) {
      summary.textContent = "Nog geen datums geselecteerd.";
      [priceBtn, clearPriceBtn, minBtn, clearMinBtn].forEach((b) => (b.disabled = true));
      return;
    }
    const dates = datesInclusive(selStart, selEnd);
    if (dates.length === 1) {
      summary.innerHTML = `<b>1 nacht:</b> ${fmtDateNL(selStart)}`;
    } else {
      summary.innerHTML = `<b>${dates.length} nachten:</b> ${fmtDateNL(selStart)} t/m ${fmtDateNL(selEnd)} <span class="admin-dim">(laatste nacht: ${fmtDateNL(selEnd)} — de vertrekdag zelf, ${fmtDateNL(nextDay(selEnd))}, telt hier niet mee)</span>`;
    }
    [priceBtn, clearPriceBtn, minBtn, clearMinBtn].forEach((b) => (b.disabled = false));
  }

  function nextDay(dateISO) {
    const d = new Date(dateISO + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // ---- Price / min-nights actions -------------------------------------

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

  document.getElementById("ae-set-price-btn").addEventListener("click", () => {
    const val = document.getElementById("ae-price-input").value;
    const euros = Number(String(val).replace(",", "."));
    if (!Number.isFinite(euros) || euros <= 0) {
      alert("Vul een prijs groter dan €0 in.");
      return;
    }
    const cents = Math.round(euros * 100);
    const dates = datesInclusive(selStart, selEnd);
    showConfirm(
      `Dit zet de nachtprijs van ${dates.length} datum(s) (${fmtDateNL(selStart)} t/m ${fmtDateNL(selEnd)}) op ${fmtEuro(cents)}. Doorgaan?`,
      () => savePatch({ ratesPatch: Object.fromEntries(dates.map((d) => [d, { priceCents: cents }])) }, (n) => `✓ Nachtprijs van ${n} datum(s) ingesteld op ${fmtEuro(cents)}.`)
    );
  });

  document.getElementById("ae-clear-price-btn").addEventListener("click", () => {
    const dates = datesInclusive(selStart, selEnd);
    showConfirm(
      `Dit verwijdert de nachtprijs van ${dates.length} datum(s) — deze data worden weer NIET boekbaar. Doorgaan?`,
      () => savePatch({ ratesPatch: Object.fromEntries(dates.map((d) => [d, { priceCents: null }])) }, (n) => `✓ Prijs van ${n} datum(s) verwijderd (niet boekbaar).`)
    );
  });

  document.getElementById("ae-set-min-nights-btn").addEventListener("click", () => {
    const val = Number(document.getElementById("ae-min-nights-input").value);
    if (!Number.isInteger(val) || val < 1) {
      alert("Vul een geheel aantal nachten (≥ 1) in.");
      return;
    }
    const dates = datesInclusive(selStart, selEnd);
    showConfirm(
      `Dit zet het minimumverblijf van ${dates.length} datum(s) (${fmtDateNL(selStart)} t/m ${fmtDateNL(selEnd)}) op ${val} nacht(en). Dit geldt voor een boeking die op zo'n datum AANKOMT. Doorgaan?`,
      () => savePatch({ ratesPatch: Object.fromEntries(dates.map((d) => [d, { minNights: val }])) }, (n) => `✓ Minimumverblijf van ${n} datum(s) ingesteld op ${val} nacht(en).`)
    );
  });

  document.getElementById("ae-clear-min-nights-btn").addEventListener("click", () => {
    const dates = datesInclusive(selStart, selEnd);
    showConfirm(
      `Dit zet het minimumverblijf van ${dates.length} datum(s) terug naar de standaardwaarde (${settings.defaultMinNights} nacht(en)). Doorgaan?`,
      () => savePatch({ ratesPatch: Object.fromEntries(dates.map((d) => [d, { minNights: null }])) }, (n) => `✓ Minimumverblijf van ${n} datum(s) teruggezet naar standaard.`)
    );
  });

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
          <p class="admin-note">Dit geldt voor de hele site (nog niet per periode instelbaar). Een minimumverblijf van bijv. 7 nachten betekent hier NIET automatisch dat aankomst alleen op zaterdag mag — vink dat hierboven expliciet aan als je dat wilt.</p>
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
