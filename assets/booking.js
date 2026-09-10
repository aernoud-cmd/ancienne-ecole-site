// Drives the reserve-page calendar, live price breakdown, and booking form.
// Talks to the Netlify Functions backend (availability / quote / book) —
// see netlify/functions/. The price shown here always comes from the same
// calculateQuote() the backend uses (netlify/functions/_lib/pricing.mjs), so
// it never drifts from what's actually charged after approval — except that
// an owner price/settings change between "seeing this price" and "sending
// the request" is real and possible; the request re-validates server-side
// and tells the guest plainly if the price or rules changed.
(function () {
  const MONTH_NAMES = {
    en: ["January","February","March","April","May","June","July","August","September","October","November","December"],
    fr: ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"],
    nl: ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"],
  };
  const WEEKDAY_ABBR = {
    en: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
    fr: ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"],
    nl: ["Ma","Di","Wo","Do","Vr","Za","Zo"],
  };
  const STRINGS = {
    en: {
      selectRange: "Select your check-in and check-out dates on the calendar",
      nightsLabel: (n) => `${n} night${n === 1 ? "" : "s"} selected`,
      sending: "Sending…",
      submit: "Send booking request",
      successTitle: "Request sent!",
      successBody: "Thank you — this is a REQUEST, not yet a confirmed booking. Aernoud checks it against the calendar personally and approves or declines it within 24 hours. You'll hear from him by email either way.",
      errorGeneric: "Something went wrong sending your request. Please try again, or reach out directly.",
      pickBothDates: "Please select both a check-in and a check-out date on the calendar.",
      fillNameEmail: "Please fill in your name and a valid email address.",
      rangeUnavailable: "Some of the nights in that range are already booked or requested. Please pick different dates.",
      pricePrompt: "Select your dates to see the price.",
      priceError: "Couldn't load the price just now — you can still send your request; we'll confirm the exact amount.",
      rent: (n) => `${n} night${n === 1 ? "" : "s"} rent`,
      linen: (n, amt) => `Linen (${n} guests × ${amt})`,
      linenPerWeek: (n, weeks, amt) => `Linen (${n} guests × ${weeks} week${weeks === 1 ? "" : "s"} × ${amt})`,
      cleaning: "Final cleaning",
      tax: "Tourist tax",
      total: "Total (stay)",
      deposit: "Refundable security deposit (separate)",
      totalWithDeposit: "Charged via payment link",
      discountWeek: "Weekly discount",
      discountMonth: "Monthly discount",
      rentAfterDiscount: "Rent after discount",
      taxNoteFixed: (amt, adults, nights) => `${amt} per adult per night × ${adults} adult${adults === 1 ? "" : "s"} × ${nights} night${nights === 1 ? "" : "s"}. Children are exempt.`,
      taxNotePercent: (pct) => `${pct}% of the (discounted) nightly rate per adult. Children are exempt.`,
      depositNote: "Charged together with the stay total via the same secure payment link, then refunded by bank transfer after check-out once the house has been checked.",
      minNights: (n) => `This period requires a minimum stay of ${n} nights.`,
      rateMissing: "Some of the selected nights aren't open for booking yet. Please try different dates or contact us.",
      dateBlocked: "One of the selected dates is not available. Please try different dates.",
      capacityExceeded: (max) => `This stay allows at most ${max.maxAdults} adults and ${max.maxChildren} children (${max.maxTotalGuests} guests total).`,
      capacityWarning: (max) => `That's more guests than this stay allows: at most ${max.maxAdults} adults, ${max.maxChildren} children, ${max.maxTotalGuests} guests in total. Please adjust the numbers above.`,
      arrivalDayNotAllowed: "Stays can't start on that day of the week. Please pick a different check-in date.",
      availabilityErrorTitle: "Couldn't check availability",
      availabilityErrorBody: "We couldn't reliably load the calendar just now, so no dates can be selected — we'd rather show nothing than risk showing a date as free when it might not be.",
      retry: "Try again",
      checkingAvailability: "Checking availability…",
      prevMonth: "Previous month",
      nextMonth: "Next month",
      dayBooked: "booked",
      dayOwnBlocked: "not available (owner's own use)",
      dayRequested: "requested, awaiting approval",
      dayAvailable: "available",
      dayPast: "past date",
      dayNoPrice: "not yet open for booking",
      minStaySuffix: (n) => `, minimum stay if arriving here: ${n} nights`,
      minStayNote: (n) => `Minimum stay: ${n} nights (some periods require longer — the calendar and price will tell you).`,
    },
    fr: {
      selectRange: "Sélectionnez vos dates d'arrivée et de départ sur le calendrier",
      nightsLabel: (n) => `${n} nuit${n === 1 ? "" : "s"} sélectionnée${n === 1 ? "" : "s"}`,
      sending: "Envoi…",
      submit: "Envoyer la demande de réservation",
      successTitle: "Demande envoyée !",
      successBody: "Merci — ceci est une DEMANDE, pas encore une réservation confirmée. Aernoud la vérifie personnellement et l'approuve ou la refuse sous 24 heures. Vous recevrez sa réponse par e-mail dans les deux cas.",
      errorGeneric: "Une erreur est survenue lors de l'envoi. Merci de réessayer, ou contactez-nous directement.",
      pickBothDates: "Merci de sélectionner une date d'arrivée et une date de départ sur le calendrier.",
      fillNameEmail: "Merci de renseigner votre nom et une adresse e-mail valide.",
      rangeUnavailable: "Certaines nuits de cette période sont déjà réservées ou en demande. Merci de choisir d'autres dates.",
      pricePrompt: "Sélectionnez vos dates pour voir le prix.",
      priceError: "Impossible de charger le prix pour le moment — vous pouvez tout de même envoyer votre demande, nous confirmerons le montant exact.",
      rent: (n) => `Location (${n} nuit${n === 1 ? "" : "s"})`,
      linen: (n, amt) => `Linge de maison (${n} pers. × ${amt})`,
      linenPerWeek: (n, weeks, amt) => `Linge de maison (${n} pers. × ${weeks} semaine${weeks === 1 ? "" : "s"} × ${amt})`,
      cleaning: "Ménage de fin de séjour",
      tax: "Taxe de séjour",
      total: "Total (séjour)",
      deposit: "Caution remboursable (séparée)",
      totalWithDeposit: "Débité via le lien de paiement",
      discountWeek: "Réduction hebdomadaire",
      discountMonth: "Réduction mensuelle",
      rentAfterDiscount: "Location après réduction",
      taxNoteFixed: (amt, adults, nights) => `${amt} par adulte et par nuit × ${adults} adulte${adults === 1 ? "" : "s"} × ${nights} nuit${nights === 1 ? "" : "s"}. Les enfants en sont exonérés.`,
      taxNotePercent: (pct) => `${pct} % du tarif nocturne (après réduction) par adulte. Les enfants en sont exonérés.`,
      depositNote: "Débitée en même temps que le total du séjour via le même lien de paiement sécurisé, puis remboursée par virement après le départ, une fois la maison vérifiée.",
      minNights: (n) => `Cette période impose un séjour minimum de ${n} nuits.`,
      rateMissing: "Certaines nuits sélectionnées ne sont pas encore ouvertes à la réservation. Essayez d'autres dates ou contactez-nous.",
      dateBlocked: "Une des dates sélectionnées n'est pas disponible. Merci de choisir d'autres dates.",
      capacityExceeded: (max) => `Ce séjour accepte au maximum ${max.maxAdults} adultes et ${max.maxChildren} enfants (${max.maxTotalGuests} personnes au total).`,
      capacityWarning: (max) => `C'est plus de personnes que ce séjour n'accepte : au maximum ${max.maxAdults} adultes, ${max.maxChildren} enfants, ${max.maxTotalGuests} personnes au total. Merci d'ajuster les nombres ci-dessus.`,
      arrivalDayNotAllowed: "Les séjours ne peuvent pas commencer ce jour-là. Merci de choisir une autre date d'arrivée.",
      availabilityErrorTitle: "Impossible de vérifier les disponibilités",
      availabilityErrorBody: "Nous n'avons pas pu charger le calendrier de façon fiable — aucune date ne peut donc être sélectionnée pour l'instant : mieux vaut ne rien afficher que risquer de montrer une date comme libre alors qu'elle ne l'est peut-être pas.",
      retry: "Réessayer",
      checkingAvailability: "Vérification des disponibilités…",
      prevMonth: "Mois précédent",
      nextMonth: "Mois suivant",
      dayBooked: "réservé",
      dayOwnBlocked: "indisponible (usage personnel du propriétaire)",
      dayRequested: "en demande, en attente d'approbation",
      dayAvailable: "disponible",
      dayPast: "date passée",
      dayNoPrice: "pas encore ouvert à la réservation",
      minStaySuffix: (n) => `, séjour minimum en arrivant ici : ${n} nuits`,
      minStayNote: (n) => `Séjour minimum : ${n} nuits (certaines périodes exigent plus — le calendrier et le prix vous le préciseront).`,
    },
    nl: {
      selectRange: "Selecteer je aankomst- en vertrekdatum in de kalender",
      nightsLabel: (n) => `${n} nacht${n === 1 ? "" : "en"} geselecteerd`,
      sending: "Bezig met versturen…",
      submit: "Boekingsaanvraag versturen",
      successTitle: "Aanvraag verstuurd!",
      successBody: "Dank je — dit is een AANVRAAG, nog geen bevestigde boeking. Aernoud controleert 'm persoonlijk en keurt 'm binnen 24 uur goed of af. Je hoort in beide gevallen per e-mail van hem.",
      errorGeneric: "Er ging iets mis bij het versturen. Probeer het opnieuw, of neem rechtstreeks contact op.",
      pickBothDates: "Selecteer zowel een aankomst- als een vertrekdatum in de kalender.",
      fillNameEmail: "Vul je naam en een geldig e-mailadres in.",
      rangeUnavailable: "Sommige nachten in die periode zijn al geboekt of aangevraagd. Kies andere data.",
      pricePrompt: "Selecteer je data om de prijs te zien.",
      priceError: "Kon de prijs nu niet ophalen — je kunt je aanvraag gewoon versturen, we bevestigen het exacte bedrag.",
      rent: (n) => `Huur (${n} nacht${n === 1 ? "" : "en"})`,
      linen: (n, amt) => `Linnengoed (${n} pers. × ${amt})`,
      linenPerWeek: (n, weeks, amt) => `Linnengoed (${n} pers. × ${weeks} we${weeks === 1 ? "ek" : "ken"} × ${amt})`,
      cleaning: "Eindschoonmaak",
      tax: "Toeristenbelasting",
      total: "Totaal (verblijf)",
      deposit: "Terugbetaalbare borg (apart)",
      totalWithDeposit: "Afgerekend via betaallink",
      discountWeek: "Weekkorting",
      discountMonth: "Maandkorting",
      rentAfterDiscount: "Huur na korting",
      taxNoteFixed: (amt, adults, nights) => `${amt} per volwassene per nacht × ${adults} volwassene${adults === 1 ? "" : "n"} × ${nights} nacht${nights === 1 ? "" : "en"}. Kinderen zijn vrijgesteld.`,
      taxNotePercent: (pct) => `${pct}% van de nachtprijs (na korting) per volwassene. Kinderen zijn vrijgesteld.`,
      depositNote: "Wordt samen met het totaalbedrag afgerekend via dezelfde beveiligde betaallink, en na vertrek per bankoverschrijving terugbetaald zodra het huis is gecontroleerd.",
      minNights: (n) => `Voor deze periode geldt een minimumverblijf van ${n} nachten.`,
      rateMissing: "Sommige geselecteerde nachten zijn nog niet open voor boeking. Probeer andere data of neem contact op.",
      dateBlocked: "Eén van de geselecteerde data is niet beschikbaar. Kies andere data.",
      capacityExceeded: (max) => `Dit verblijf biedt plaats aan maximaal ${max.maxAdults} volwassenen en ${max.maxChildren} kinderen (${max.maxTotalGuests} gasten totaal).`,
      capacityWarning: (max) => `Dat zijn meer gasten dan dit verblijf toestaat: maximaal ${max.maxAdults} volwassenen, ${max.maxChildren} kinderen, ${max.maxTotalGuests} gasten totaal. Pas de aantallen hierboven aan.`,
      arrivalDayNotAllowed: "Een verblijf kan niet op die dag beginnen. Kies een andere aankomstdatum.",
      availabilityErrorTitle: "Beschikbaarheid kon niet worden gecontroleerd",
      availabilityErrorBody: "We konden de kalender niet betrouwbaar laden, dus kunnen er nu geen data geselecteerd worden — dat is veiliger dan een datum als vrij tonen terwijl dat misschien niet zo is.",
      retry: "Opnieuw proberen",
      checkingAvailability: "Beschikbaarheid controleren…",
      prevMonth: "Vorige maand",
      nextMonth: "Volgende maand",
      dayBooked: "geboekt",
      dayOwnBlocked: "niet beschikbaar (eigen gebruik)",
      dayRequested: "aangevraagd, in afwachting van goedkeuring",
      dayAvailable: "beschikbaar",
      dayPast: "verstreken datum",
      dayNoPrice: "nog niet open voor boeking",
      minStaySuffix: (n) => `, minimumverblijf bij aankomst hier: ${n} nachten`,
      minStayNote: (n) => `Minimumverblijf: ${n} nachten (voor sommige periodes geldt een langer minimum — de kalender en de prijs geven dit aan).`,
    },
  };

  let lang = "en";
  let busyNights = new Set();
  let pendingNights = new Set();
  let noPriceNights = new Set();
  // Subset of busyNights that's busy specifically because the owner blocked
  // it themselves (personal use/maintenance) rather than an Airbnb sync or a
  // direct booking — kept separate purely so the calendar can show a
  // distinct state for it (see availability.mjs: ownBlockedNights is a
  // subset of busyNights, never additional dates).
  let ownBlockedNights = new Set();
  let minNightsByDate = {};
  let defaultMinNights = 1;
  let capacity = { maxAdults: 8, maxChildren: 2, maxTotalGuests: 10 };
  let viewYear, viewMonth; // month is 0-indexed
  let selStart = null, selEnd = null; // "YYYY-MM-DD"
  let quoteRequestSeq = 0;
  // Loading availability is safety-critical: if it fails, dates must NEVER
  // silently default to "all open". availabilityOk starts false and only
  // becomes true after a load that both succeeded (HTTP-wise) AND had the
  // expected shape — see loadAvailability(). Every date-picking/quote/submit
  // path checks this first.
  let availabilityOk = false;
  let availabilityLoading = false;

  function iso(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function todayISO() {
    const t = new Date();
    return iso(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function nightsInRange(startISO, endISO) {
    const nights = [];
    let cur = new Date(startISO + "T00:00:00Z");
    const end = new Date(endISO + "T00:00:00Z");
    while (cur < end) {
      nights.push(cur.toISOString().slice(0, 10));
      cur = new Date(cur.getTime() + 86400000);
    }
    return nights;
  }

  function rangeIsFree(startISO, endISO) {
    return nightsInRange(startISO, endISO).every((n) => !busyNights.has(n) && !noPriceNights.has(n));
  }

  function fmtMoneyCents(cents, currency) {
    try {
      return new Intl.NumberFormat(lang === "en" ? "en-IE" : lang, { style: "currency", currency: currency || "EUR" }).format((cents || 0) / 100);
    } catch (e) {
      return `${currency || "EUR"} ${((cents || 0) / 100).toFixed(2)}`;
    }
  }

  // ---- URL state (so language-switch links can carry it over) -----------

  function currentStateParams() {
    const p = new URLSearchParams();
    if (selStart) p.set("checkin", selStart);
    if (selEnd) p.set("checkout", selEnd);
    const adultsEl = document.getElementById("adults");
    const childrenEl = document.getElementById("children");
    if (adultsEl) p.set("adults", adultsEl.value);
    if (childrenEl) p.set("children", childrenEl.value);
    return p;
  }

  function wireLanguageSwitchLinks() {
    document.querySelectorAll(".lang-switch a").forEach((a) => {
      if (a.classList.contains("current")) return;
      a.addEventListener("click", (e) => {
        const params = currentStateParams();
        if ([...params.keys()].length === 0) return; // nothing to carry over
        e.preventDefault();
        const url = new URL(a.href, window.location.href);
        params.forEach((v, k) => url.searchParams.set(k, v));
        window.location.href = url.toString();
      });
    });
  }

  function restoreStateFromURL() {
    const p = new URLSearchParams(window.location.search);
    const ci = p.get("checkin"), co = p.get("checkout");
    if (ci && /^\d{4}-\d{2}-\d{2}$/.test(ci)) selStart = ci;
    if (co && /^\d{4}-\d{2}-\d{2}$/.test(co)) selEnd = co;
    const a = p.get("adults"), c = p.get("children");
    const adultsEl = document.getElementById("adults");
    const childrenEl = document.getElementById("children");
    if (a && adultsEl) adultsEl.value = a;
    if (c && childrenEl) childrenEl.value = c;
    if (selStart) {
      const d = new Date(selStart + "T00:00:00Z");
      viewYear = d.getUTCFullYear();
      viewMonth = d.getUTCMonth();
    }
  }

  // ---- Capacity-driven guest selects --------------------------------

  function populateGuestSelects() {
    const adultsEl = document.getElementById("adults");
    const childrenEl = document.getElementById("children");
    if (adultsEl) {
      const prev = adultsEl.value;
      adultsEl.innerHTML = "";
      for (let i = 1; i <= capacity.maxAdults; i++) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = String(i);
        if (String(i) === prev) opt.selected = true;
        adultsEl.appendChild(opt);
      }
      if (!prev) {
        const preferred = Math.min(4, capacity.maxAdults);
        adultsEl.value = String(preferred);
      }
    }
    if (childrenEl) {
      const prev = childrenEl.value;
      childrenEl.innerHTML = "";
      for (let i = 0; i <= capacity.maxChildren; i++) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = String(i);
        if (String(i) === prev) opt.selected = true;
        childrenEl.appendChild(opt);
      }
    }
    checkCapacity();
  }

  // Independent per-field maximums (adults 1..maxAdults, children
  // 0..maxChildren) can still combine into a total over maxTotalGuests
  // (e.g. settings maxAdults:8, maxChildren:6, maxTotalGuests:8 — 8+1 is
  // invalid even though each field alone is in range). Rather than silently
  // clamping whatever the guest actually chose, this shows a clear message
  // and blocks the price/submit until they adjust it themselves — the exact
  // same rule calculateQuote() enforces server-side (CAPACITY_EXCEEDED).
  function ensureCapacityWarningEl() {
    let el = document.getElementById("ae-capacity-warning");
    if (el) return el;
    const adultsEl = document.getElementById("adults");
    const row = adultsEl && adultsEl.closest(".form-grid-2");
    if (!row || !row.parentNode) return null;
    el = document.createElement("div");
    el.id = "ae-capacity-warning";
    el.setAttribute("role", "alert");
    el.setAttribute("aria-live", "assertive");
    el.style.cssText = "display:none; color:#d98c8c; font-size:13px; margin:-6px 0 16px; line-height:1.5;";
    row.parentNode.insertBefore(el, row.nextSibling);
    return el;
  }

  function checkCapacity() {
    const el = ensureCapacityWarningEl();
    const { adults, children } = getPartySize();
    const invalid = adults + children > capacity.maxTotalGuests;
    if (el) {
      el.style.display = invalid ? "block" : "none";
      el.textContent = invalid ? STRINGS[lang].capacityWarning(capacity) : "";
    }
    const submitBtn = document.getElementById("ae-booking-submit");
    if (submitBtn) submitBtn.disabled = invalid || !availabilityOk;
    return !invalid;
  }

  // ---- Calendar -----------------------------------------------------

  function ensureAvailabilityErrorEl() {
    let el = document.getElementById("ae-availability-error");
    if (el) return el;
    const grid = document.getElementById("ae-cal-days");
    if (!grid || !grid.parentNode) return null;
    el = document.createElement("div");
    el.id = "ae-availability-error";
    el.setAttribute("role", "alert");
    el.setAttribute("aria-live", "assertive");
    el.style.cssText = "display:none; padding:18px; border:1px solid #d98c8c; border-radius:2px; margin-bottom:16px; background:rgba(217,140,140,0.08);";
    grid.parentNode.insertBefore(el, grid);
    return el;
  }

  function renderAvailabilityBanner() {
    const el = ensureAvailabilityErrorEl();
    const grid = document.getElementById("ae-cal-days");
    if (!el) return;
    if (availabilityOk) {
      el.style.display = "none";
      // Explicitly "grid", not "" — clearing the inline style entirely would
      // fall back to the div's default block display (there's no stylesheet
      // rule for #ae-cal-days, only the original inline "display: grid" the
      // markup ships with), collapsing the 7-column calendar into a single
      // vertical stack of oversized cells. Restore the actual value, don't
      // just clear it.
      if (grid) grid.style.display = "grid";
      return;
    }
    const t = STRINGS[lang];
    if (grid) grid.style.display = "none";
    el.style.display = "block";
    el.innerHTML = `<div style="font-weight:600; margin-bottom:6px;">${availabilityLoading ? t.checkingAvailability : t.availabilityErrorTitle}</div>` +
      (availabilityLoading ? "" : `<div style="font-size:13.5px; color:var(--text-dim); margin-bottom:12px;">${t.availabilityErrorBody}</div>` +
      `<button type="button" class="btn-ghost" id="ae-availability-retry" style="border:1px solid var(--line); padding:8px 16px; cursor:pointer;">${t.retry}</button>`);
    const retryBtn = document.getElementById("ae-availability-retry");
    if (retryBtn) retryBtn.addEventListener("click", () => loadAvailability());
  }

  function renderCalendar() {
    const label = document.getElementById("ae-cal-month-label");
    const grid = document.getElementById("ae-cal-days");
    if (!label || !grid) return;
    const t = STRINGS[lang];

    renderAvailabilityBanner();
    const submitBtn = document.getElementById("ae-booking-submit");
    if (submitBtn) submitBtn.disabled = !availabilityOk || (document.getElementById("ae-capacity-warning") && document.getElementById("ae-capacity-warning").style.display === "block");

    if (!availabilityOk) {
      grid.innerHTML = "";
      const nightsEl = document.getElementById("ae-cal-nights");
      if (nightsEl) nightsEl.textContent = "";
      const breakdown = document.getElementById("ae-price-breakdown");
      if (breakdown) breakdown.innerHTML = "";
      return;
    }

    label.textContent = `${MONTH_NAMES[lang][viewMonth]} ${viewYear}`;

    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    // Monday-first weekday index (0 = Monday ... 6 = Sunday)
    const jsDay = firstOfMonth.getUTCDay(); // 0=Sun..6=Sat
    const leadingBlanks = (jsDay + 6) % 7;
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const today = todayISO();

    let html = "";
    for (let i = 0; i < leadingBlanks; i++) {
      html += `<div class="day" style="color: var(--text-dim);"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateISO = iso(viewYear, viewMonth, d);
      const isPast = dateISO < today;
      const isOwnBlocked = ownBlockedNights.has(dateISO);
      const isBusy = busyNights.has(dateISO) && !isOwnBlocked;
      const isPending = pendingNights.has(dateISO) && !busyNights.has(dateISO);
      const isNoPrice = noPriceNights.has(dateISO) && !isBusy && !isPending;
      const inSelectedRange =
        selStart && selEnd && dateISO >= selStart && dateISO < selEnd;
      const isRangeEdge = dateISO === selStart || dateISO === selEnd;

      // A busy/no-price date can still be a valid CHECK-OUT (departure) date
      // — the guest doesn't stay that night, so it doesn't need to be free.
      // rangeIsFree() already only checks the nights strictly between
      // selStart and this date (see nightsInRange's `cur < end` loop), so
      // reusing it here is what makes the click-gate match the logic that
      // already validates the actual selection.
      const isCandidateCheckout = !isPast && selStart && !selEnd && dateISO > selStart;
      const validAsCheckout = isCandidateCheckout && rangeIsFree(selStart, dateISO);

      // Available/bookable days get the LIGHTEST fill of any state (see
      // --bg-available) so a free week visibly pops out of a mostly-
      // booked/not-yet-priced month, rather than blending into it. Booked
      // and pending days deliberately get a darker fill than that (see
      // isBusy/isPending below) — they're not the ones a guest should be
      // drawn to.
      let style = "border:1px solid var(--line-strong);background:var(--bg-available);cursor:pointer;";
      let statusWord = t.dayAvailable;
      if (isPast) {
        style = "color: var(--text-dim); opacity: 0.35;";
        statusWord = t.dayPast;
      } else if (isRangeEdge) {
        style = "background: var(--gold); color: #1a1408; font-weight: 600; cursor:pointer;";
        if (isOwnBlocked) statusWord = t.dayOwnBlocked;
        else if (isBusy) statusWord = t.dayBooked;
        else if (isNoPrice) statusWord = t.dayNoPrice;
      } else if (isOwnBlocked) {
        // Deliberately a distinct rust/rose tone (not the neutral grey used
        // for "booked") — the same color the admin calendar's own "Eigen
        // blokkade" legend dot uses, so the two views read consistently.
        style = "background: rgba(217,140,140,0.14); color: var(--text-dim); border: 1px solid rgba(217,140,140,0.45); text-decoration: line-through;";
        statusWord = t.dayOwnBlocked;
        if (validAsCheckout) style += "cursor:pointer;";
      } else if (isBusy) {
        // Darker than --bg-available on purpose — a booked day should
        // recede, not compete visually with the free days around it.
        style = "background: var(--bg-panel); color: var(--text-dim); text-decoration: line-through;";
        statusWord = t.dayBooked;
        if (validAsCheckout) style += "cursor:pointer;border:1px dashed var(--gold-soft);";
      } else if (isPending) {
        style = "background: var(--bg-panel); color: var(--text-dim); border: 1px dashed var(--gold-soft);";
        statusWord = t.dayRequested;
      } else if (isNoPrice) {
        style = "color: var(--text-dim); border: 1px dashed var(--line-strong); opacity: 0.55;";
        statusWord = t.dayNoPrice;
        if (validAsCheckout) style += "cursor:pointer;";
      } else if (inSelectedRange) {
        style = "background: var(--gold); color: #1a1408; font-weight: 600; cursor:pointer;";
      }

      // Clickable as a NEW start (no active selection, or completing one
      // already finished) requires a genuinely free arrival night. Clickable
      // as the CHECKOUT that completes an in-progress selection only needs
      // every night strictly before it to be free — the departure date
      // itself, and whether it happens to have a price, is irrelevant (the
      // guest never stays that night). This is the fix for "can't select
      // checkout on the day the next guest arrives, or on an unpriced date".
      const startingFresh = !selStart || selEnd || dateISO <= selStart;
      const clickable = !isPast && (startingFresh ? (!isBusy && !isNoPrice) : validAsCheckout);
      const dateObj = new Date(dateISO + "T00:00:00Z");
      const weekday = WEEKDAY_ABBR[lang][(dateObj.getUTCDay() + 6) % 7];
      const edgeSuffix = isRangeEdge
        ? dateISO === selStart
          ? " — " + (lang === "nl" ? "aankomst" : lang === "fr" ? "arrivée" : "check-in")
          : " — " + (lang === "nl" ? "vertrek" : lang === "fr" ? "départ" : "check-out")
        : "";
      const minOverride = minNightsByDate[dateISO];
      const minSuffix = clickable && minOverride ? t.minStaySuffix(minOverride) : "";
      const dayLabel = `${weekday} ${d} ${MONTH_NAMES[lang][viewMonth]}, ${statusWord}${edgeSuffix}${minSuffix}`;
      const titleAttr = minSuffix ? ` title="${t.minStaySuffix(minOverride).replace(/^, /, "")}"` : "";
      html += `<div class="day" role="gridcell" data-date="${dateISO}" style="${style}"${titleAttr} ${clickable ? `tabindex="0" onclick="AE_BOOKING.pickDate('${dateISO}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();AE_BOOKING.pickDate('${dateISO}')}"` : `tabindex="-1"`} aria-label="${dayLabel}" aria-disabled="${!clickable}">${d}</div>`;
    }
    grid.setAttribute("role", "grid");
    grid.innerHTML = html;

    const checkinInput = document.getElementById("checkin");
    const checkoutInput = document.getElementById("checkout");
    if (checkinInput) checkinInput.value = selStart || "";
    if (checkoutInput) checkoutInput.value = selEnd || "";

    const nightsEl = document.getElementById("ae-cal-nights");
    if (nightsEl) {
      nightsEl.setAttribute("aria-live", "polite");
      if (selStart && selEnd) {
        const n = nightsInRange(selStart, selEnd).length;
        nightsEl.textContent = t.nightsLabel(n);
      } else {
        nightsEl.textContent = t.selectRange;
      }
    }

    const minStayNoteEl = document.getElementById("ae-cal-minstay-note");
    if (minStayNoteEl) {
      minStayNoteEl.textContent = defaultMinNights > 1 ? t.minStayNote(defaultMinNights) : "";
    }

    const prevBtn = document.querySelector('[onclick="AE_BOOKING.prevMonth()"]');
    const nextBtn = document.querySelector('[onclick="AE_BOOKING.nextMonth()"]');
    if (prevBtn) prevBtn.setAttribute("aria-label", t.prevMonth);
    if (nextBtn) nextBtn.setAttribute("aria-label", t.nextMonth);

    refreshQuote();
  }

  function pickDate(dateISO) {
    if (!availabilityOk) return; // defense in depth — the grid shouldn't render clickable cells at all in this state
    if (!selStart || (selStart && selEnd) || dateISO <= selStart) {
      selStart = dateISO;
      selEnd = null;
    } else {
      if (rangeIsFree(selStart, dateISO)) {
        selEnd = dateISO;
      } else {
        alert(STRINGS[lang].rangeUnavailable);
        selStart = dateISO;
        selEnd = null;
      }
    }
    renderCalendar();
  }

  function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  }

  // Safety-critical: a failed or malformed response must NEVER result in
  // dates being offered as available. availabilityOk stays false (its
  // startup default) unless this function positively confirms both an OK
  // HTTP response AND the expected shape — checking res.ok alone isn't
  // enough, since a 200 with a broken/truncated body is just as dangerous
  // as an outright error. On any failure, existing (possibly stale) data is
  // left untouched rather than reset, but availabilityOk still flips to
  // false so the calendar shows the blocking error state either way — using
  // stale-but-plausible data without telling the guest is exactly the
  // "quietly wrong" failure mode this is meant to avoid.
  async function loadAvailability() {
    availabilityLoading = true;
    renderAvailabilityBanner();
    try {
      const res = await fetch("/.netlify/functions/availability");
      if (!res.ok) throw new Error(`availability endpoint returned HTTP ${res.status}`);
      const data = await res.json();
      const shapeOk =
        data && typeof data === "object" &&
        Array.isArray(data.busyNights) &&
        Array.isArray(data.pendingNights) &&
        Array.isArray(data.noPriceNights) &&
        data.capacity && typeof data.capacity.maxAdults === "number";
      if (!shapeOk) throw new Error("availability endpoint returned an unexpected response shape");

      busyNights = new Set(data.busyNights);
      pendingNights = new Set(data.pendingNights);
      noPriceNights = new Set(data.noPriceNights);
      // Not required in shapeOk above — an older/rolling deploy without this
      // field must still show a safe, correct (if slightly less detailed)
      // calendar rather than falling back to the fail-closed error banner.
      ownBlockedNights = new Set(Array.isArray(data.ownBlockedNights) ? data.ownBlockedNights : []);
      minNightsByDate = data.minNightsByDate || {};
      if (data.defaultMinNights) defaultMinNights = data.defaultMinNights;
      capacity = data.capacity;
      availabilityOk = true;
    } catch (e) {
      console.error("Could not load live availability — blocking date selection rather than risking a stale/incorrect calendar.", e);
      availabilityOk = false;
    } finally {
      availabilityLoading = false;
    }
    populateGuestSelects();
    renderCalendar();
  }

  function getPartySize() {
    const adultsEl = document.getElementById("adults");
    const childrenEl = document.getElementById("children");
    return {
      adults: adultsEl ? Number(adultsEl.value) : 1,
      children: childrenEl ? Number(childrenEl.value) : 0,
    };
  }

  // Fetches the live price whenever dates or party size are complete, using
  // the same calculateQuote() as the backend. A sequence number guards
  // against an older, slower request overwriting a newer one's result.
  async function refreshQuote() {
    const breakdown = document.getElementById("ae-price-breakdown");
    if (!breakdown) return;

    if (!availabilityOk) {
      breakdown.innerHTML = "";
      return;
    }
    if (!checkCapacity()) {
      breakdown.innerHTML = ""; // the capacity warning banner already says why — no need to duplicate it here
      return;
    }

    if (!selStart || !selEnd) {
      breakdown.innerHTML = `<span style="color: var(--text-dim);">${STRINGS[lang].pricePrompt}</span>`;
      return;
    }

    const { adults, children } = getPartySize();
    const mySeq = ++quoteRequestSeq;
    breakdown.style.opacity = "0.5";

    try {
      const params = new URLSearchParams({ checkin: selStart, checkout: selEnd, adults, children });
      const res = await fetch(`/.netlify/functions/quote?${params.toString()}`);
      const data = await res.json();
      if (mySeq !== quoteRequestSeq) return; // a newer request has since started
      if (!res.ok || !data.ok) {
        renderQuoteError(data);
        return;
      }
      renderPriceBreakdown(data.quote);
    } catch (e) {
      if (mySeq !== quoteRequestSeq) return;
      breakdown.innerHTML = `<span style="color: var(--text-dim);">${STRINGS[lang].priceError}</span>`;
    } finally {
      if (mySeq === quoteRequestSeq) breakdown.style.opacity = "1";
    }
  }

  function renderQuoteError(data) {
    const breakdown = document.getElementById("ae-price-breakdown");
    const t = STRINGS[lang];
    let msg = t.priceError;
    if (data && data.code === "MIN_NIGHTS_NOT_MET") msg = t.minNights(data.details.requiredNights);
    else if (data && data.code === "RATE_MISSING") msg = t.rateMissing;
    else if (data && data.code === "DATE_BLOCKED") msg = t.dateBlocked;
    else if (data && data.code === "CAPACITY_EXCEEDED") msg = t.capacityExceeded(data.details);
    else if (data && data.code === "ARRIVAL_DAY_NOT_ALLOWED") msg = t.arrivalDayNotAllowed;
    breakdown.innerHTML = `<span style="color: #d98c8c;">${msg}</span>`;
  }

  function renderPriceBreakdown(q) {
    const breakdown = document.getElementById("ae-price-breakdown");
    if (!breakdown) return;
    const t = STRINGS[lang];
    const row = (label, value, opts) => `
      <div style="display: flex; justify-content: space-between; font-size: 13.5px; color: ${opts && opts.dim ? "var(--text-dim)" : "var(--text)"}; padding: 3px 0;">
        <span>${label}</span><span>${value}</span>
      </div>`;

    let html = row(t.rent(q.nights), fmtMoneyCents(q.rentalSubtotalCents, q.currency), { dim: true });
    if (q.discountKind) {
      const label = q.discountKind === "month" ? t.discountMonth : t.discountWeek;
      html += row(`${label} (-${q.discountPercent}%)`, `-${fmtMoneyCents(q.discountAmountCents, q.currency)}`, { dim: true });
      html += row(t.rentAfterDiscount, fmtMoneyCents(q.rentalAfterDiscountCents, q.currency), { dim: true });
    }
    const totalGuests = q.adults + q.children;
    const perPersonLinen = totalGuests > 0 ? q.linenFeeCents / (q.linenWeeks ? totalGuests * q.linenWeeks : totalGuests) : 0;
    const linenLabel = q.linenWeeks
      ? t.linenPerWeek(totalGuests, q.linenWeeks, fmtMoneyCents(perPersonLinen, q.currency))
      : t.linen(totalGuests, fmtMoneyCents(perPersonLinen, q.currency));
    html += row(linenLabel, fmtMoneyCents(q.linenFeeCents, q.currency), { dim: true });
    html += row(t.cleaning, fmtMoneyCents(q.cleaningFeeCents, q.currency), { dim: true });
    html += row(t.tax, fmtMoneyCents(q.touristTaxCents, q.currency), { dim: true });
    const taxNote = q.touristTaxMode === "fixed_per_person_per_night"
      ? t.taxNoteFixed(fmtMoneyCents(q.touristTaxFixedAmountCents, q.currency), q.adults, q.nights)
      : t.taxNotePercent(q.touristTaxRatePercent);
    html += `<div style="font-size: 11.5px; color: var(--text-dim); margin: -2px 0 4px; padding-left: 2px;">${taxNote}</div>`;
    html += `<div style="border-top: 1px solid var(--line); margin: 8px 0;"></div>`;
    html += row(`<b>${t.total}</b>`, `<b>${fmtMoneyCents(q.totalCents, q.currency)}</b>`);
    if (q.depositCents) {
      html += row(t.deposit, fmtMoneyCents(q.depositCents, q.currency), { dim: true });
      html += `<div style="font-size: 11.5px; color: var(--text-dim); margin: -2px 0 4px; padding-left: 2px;">${t.depositNote}</div>`;
      html += row(`<i>${t.totalWithDeposit}</i>`, `<i>${fmtMoneyCents(q.totalWithDepositCents, q.currency)}</i>`, { dim: true });
    }
    breakdown.innerHTML = html;
  }

  async function submitBooking(evt) {
    evt.preventDefault();
    const t = STRINGS[lang];
    const btn = document.getElementById("ae-booking-submit");

    if (!availabilityOk) {
      showStatus(t.availabilityErrorTitle, true);
      return false;
    }
    if (!checkCapacity()) {
      return false; // the capacity warning banner already explains why
    }
    if (!selStart || !selEnd) {
      showStatus(t.pickBothDates, true);
      return false;
    }
    const name = document.getElementById("guest-name").value.trim();
    const email = document.getElementById("guest-email").value.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStatus(t.fillNameEmail, true);
      return false;
    }
    if (!rangeIsFree(selStart, selEnd)) {
      showStatus(t.rangeUnavailable, true);
      return false;
    }

    const { adults, children } = getPartySize();
    const payload = {
      checkin: selStart,
      checkout: selEnd,
      adults,
      children,
      name,
      email,
      phone: document.getElementById("guest-phone").value.trim(),
      message: document.getElementById("guest-message") ? document.getElementById("guest-message").value.trim() : "",
      lang,
    };

    btn.disabled = true;
    btn.textContent = t.sending;
    showStatus("", false);

    try {
      const res = await fetch("/.netlify/functions/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === "DATES_UNAVAILABLE") throw new Error(t.rangeUnavailable);
        if (data.code === "MIN_NIGHTS_NOT_MET") throw new Error(t.minNights(data.details.requiredNights));
        if (data.code === "RATE_MISSING") throw new Error(t.rateMissing);
        if (data.code === "DATE_BLOCKED") throw new Error(t.dateBlocked);
        if (data.code === "CAPACITY_EXCEEDED") throw new Error(t.capacityExceeded(data.details));
        if (data.code === "ARRIVAL_DAY_NOT_ALLOWED") throw new Error(t.arrivalDayNotAllowed);
        throw new Error(data.error || t.errorGeneric);
      }
      showSuccess(t.successTitle, t.successBody);
      busyNights = new Set([...busyNights, ...nightsInRange(selStart, selEnd)]);
      pendingNights = new Set([...pendingNights, ...nightsInRange(selStart, selEnd)]);
      selStart = null;
      selEnd = null;
      renderCalendar();
    } catch (e) {
      showStatus(e.message || t.errorGeneric, true);
      btn.disabled = false;
      btn.textContent = t.submit;
    }
    return false;
  }

  function showStatus(msg, isError) {
    const el = document.getElementById("ae-booking-status");
    if (!el) return;
    el.textContent = msg;
    el.setAttribute("role", isError ? "alert" : "status");
    el.style.color = isError ? "#d98c8c" : "var(--text-dim)";
  }

  function showSuccess(title, body) {
    const form = document.getElementById("ae-booking-form");
    if (!form) return;
    form.innerHTML = `
      <div style="text-align:center; padding: 20px 0;" role="status" aria-live="polite">
        <div style="font-family:'Cormorant Garamond', serif; font-size: 28px; color: var(--gold); margin-bottom: 14px;">${title}</div>
        <p style="font-size: 15px; line-height:1.7; color: var(--text-dim); margin:0;">${body}</p>
      </div>`;
  }

  window.AE_BOOKING = {
    init(initLang) {
      lang = ["en", "fr", "nl"].includes(initLang) ? initLang : "en";
      const t = new Date();
      viewYear = t.getFullYear();
      viewMonth = t.getMonth();
      restoreStateFromURL();
      wireLanguageSwitchLinks();
      loadAvailability();

      const adultsEl = document.getElementById("adults");
      const childrenEl = document.getElementById("children");
      if (adultsEl) adultsEl.addEventListener("change", refreshQuote);
      if (childrenEl) childrenEl.addEventListener("change", refreshQuote);
    },
    pickDate,
    prevMonth: () => changeMonth(-1),
    nextMonth: () => changeMonth(1),
    submit: submitBooking,
  };
})();
