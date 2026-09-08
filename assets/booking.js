// Drives the reserve-page calendar + booking form. Talks to the Netlify
// Functions backend (availability / book) — see netlify/functions/.
(function () {
  const MONTH_NAMES = {
    en: ["January","February","March","April","May","June","July","August","September","October","November","December"],
    fr: ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"],
    nl: ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"],
  };
  const STRINGS = {
    en: {
      selectRange: "Select your check-in and check-out dates on the calendar",
      nightsLabel: (n) => `${n} night${n === 1 ? "" : "s"} selected`,
      priceNote: "We'll confirm the exact price, personally, when we confirm your dates.",
      sending: "Sending…",
      submit: "Send booking request",
      successTitle: "Request sent!",
      successBody: "Thank you — Aernoud checks every request against the calendar personally and confirms within 24 hours. You'll hear from him by email.",
      errorGeneric: "Something went wrong sending your request. Please try again, or reach out directly.",
      pickBothDates: "Please select both a check-in and a check-out date on the calendar.",
      fillNameEmail: "Please fill in your name and a valid email address.",
      rangeUnavailable: "Some of the nights in that range are already booked. Please pick different dates.",
    },
    fr: {
      selectRange: "Sélectionnez vos dates d'arrivée et de départ sur le calendrier",
      nightsLabel: (n) => `${n} nuit${n === 1 ? "" : "s"} sélectionnée${n === 1 ? "" : "s"}`,
      priceNote: "Nous vous confirmerons le prix exact, personnellement, en validant vos dates.",
      sending: "Envoi…",
      submit: "Envoyer la demande de réservation",
      successTitle: "Demande envoyée !",
      successBody: "Merci — Aernoud vérifie chaque demande personnellement et confirme sous 24 heures. Vous recevrez sa réponse par e-mail.",
      errorGeneric: "Une erreur est survenue lors de l'envoi. Merci de réessayer, ou contactez-nous directement.",
      pickBothDates: "Merci de sélectionner une date d'arrivée et une date de départ sur le calendrier.",
      fillNameEmail: "Merci de renseigner votre nom et une adresse e-mail valide.",
      rangeUnavailable: "Certaines nuits de cette période sont déjà réservées. Merci de choisir d'autres dates.",
    },
    nl: {
      selectRange: "Selecteer je aankomst- en vertrekdatum in de kalender",
      nightsLabel: (n) => `${n} nacht${n === 1 ? "" : "en"} geselecteerd`,
      priceNote: "We bevestigen de exacte prijs persoonlijk zodra we je data bevestigen.",
      sending: "Bezig met versturen…",
      submit: "Boekingsaanvraag versturen",
      successTitle: "Aanvraag verstuurd!",
      successBody: "Dank je — Aernoud controleert elke aanvraag persoonlijk en bevestigt binnen 24 uur. Je hoort per e-mail van hem.",
      errorGeneric: "Er ging iets mis bij het versturen. Probeer het opnieuw, of neem rechtstreeks contact op.",
      pickBothDates: "Selecteer zowel een aankomst- als een vertrekdatum in de kalender.",
      fillNameEmail: "Vul je naam en een geldig e-mailadres in.",
      rangeUnavailable: "Sommige nachten in die periode zijn al geboekt. Kies andere data.",
    },
  };

  let lang = "en";
  let busyNights = new Set();
  let pendingNights = new Set();
  let viewYear, viewMonth; // month is 0-indexed
  let selStart = null, selEnd = null; // "YYYY-MM-DD"

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
    return nightsInRange(startISO, endISO).every((n) => !busyNights.has(n));
  }

  function renderCalendar() {
    const label = document.getElementById("ae-cal-month-label");
    const grid = document.getElementById("ae-cal-days");
    if (!label || !grid) return;

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
      const isBusy = busyNights.has(dateISO);
      const isPending = pendingNights.has(dateISO) && !busyNights.has(dateISO);
      const inSelectedRange =
        selStart && selEnd && dateISO >= selStart && dateISO < selEnd;
      const isRangeEdge = dateISO === selStart || dateISO === selEnd;

      let style = "border:1px solid var(--line);cursor:pointer;";
      if (isPast) {
        style = "color: var(--text-dim); opacity: 0.35;";
      } else if (isBusy) {
        style = "background: var(--bg-panel2); color: var(--text-dim); text-decoration: line-through;";
      } else if (isPending) {
        style = "background: var(--bg-panel2); color: var(--text-dim); border: 1px dashed var(--gold-soft);";
      } else if (inSelectedRange || isRangeEdge) {
        style = "background: var(--gold); color: #1a1408; font-weight: 600; cursor:pointer;";
      }

      const clickable = !isPast && !isBusy;
      html += `<div class="day" data-date="${dateISO}" style="${style}"${clickable ? ` onclick="AE_BOOKING.pickDate('${dateISO}')"` : ""}>${d}</div>`;
    }
    grid.innerHTML = html;

    const checkinInput = document.getElementById("checkin");
    const checkoutInput = document.getElementById("checkout");
    if (checkinInput) checkinInput.value = selStart || "";
    if (checkoutInput) checkoutInput.value = selEnd || "";

    const nightsEl = document.getElementById("ae-cal-nights");
    if (nightsEl) {
      if (selStart && selEnd) {
        const n = nightsInRange(selStart, selEnd).length;
        nightsEl.textContent = STRINGS[lang].nightsLabel(n);
      } else {
        nightsEl.textContent = STRINGS[lang].selectRange;
      }
    }
  }

  function pickDate(dateISO) {
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

  async function loadAvailability() {
    try {
      const res = await fetch("/.netlify/functions/availability");
      const data = await res.json();
      busyNights = new Set(data.busyNights || []);
      pendingNights = new Set(data.pendingNights || []);
    } catch (e) {
      console.warn("Could not load live availability — calendar will show all dates as open.", e);
    }
    renderCalendar();
  }

  async function submitBooking(evt) {
    evt.preventDefault();
    const t = STRINGS[lang];
    const statusEl = document.getElementById("ae-booking-status");
    const btn = document.getElementById("ae-booking-submit");

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

    const payload = {
      checkin: selStart,
      checkout: selEnd,
      adults: Number(document.getElementById("adults").value),
      children: Number(document.getElementById("children").value),
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
    el.style.color = isError ? "#d98c8c" : "var(--text-dim)";
  }

  function showSuccess(title, body) {
    const form = document.getElementById("ae-booking-form");
    if (!form) return;
    form.innerHTML = `
      <div style="text-align:center; padding: 20px 0;">
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
      loadAvailability();
    },
    pickDate,
    prevMonth: () => changeMonth(-1),
    nextMonth: () => changeMonth(1),
    submit: submitBooking,
  };
})();
