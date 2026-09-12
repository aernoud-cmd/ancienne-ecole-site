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
  // Full weekday names, Monday-first (index 0 = Monday), for the fully
  // written-out guest-facing dates (task: "Aankomst: zaterdag 6 februari
  // 2027", never "2027-02-06" or a truncated abbreviation). French keeps
  // weekday/month names lowercase per its own typographic convention —
  // matches MONTH_NAMES.fr above.
  const WEEKDAY_FULL = {
    en: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
    fr: ["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"],
    nl: ["maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag","zondag"],
  };
  // Full ISO 3166-1 country list for the address form's country dropdown —
  // generated from the "i18n-iso-countries" package's CLDR-derived English/
  // French/Dutch names (a few overly formal official names shortened to
  // their common form). This exact array is duplicated, verbatim, as
  // COUNTRIES in netlify/functions/_lib/countries.mjs (this file is a plain
  // browser script with no bundler, so it can't import that module) — keep
  // both in sync if this list is ever regenerated. Format: [ISO alpha-2
  // code, English name, French name, Dutch name].
  const COUNTRIES = [
  ["AD", "Andorra", "Andorre", "Andorra"],
  ["AE", "United Arab Emirates", "Émirats Arabes Unis", "Verenigde Arabische Emiraten"],
  ["AF", "Afghanistan", "Afghanistan", "Afghanistan"],
  ["AG", "Antigua and Barbuda", "Antigua-et-Barbuda", "Antigua en Barbuda"],
  ["AI", "Anguilla", "Anguilla", "Anguilla"],
  ["AL", "Albania", "Albanie", "Albanië"],
  ["AM", "Armenia", "Arménie", "Armenië"],
  ["AO", "Angola", "Angola", "Angola"],
  ["AQ", "Antarctica", "Antarctique", "Antarctica"],
  ["AR", "Argentina", "Argentine", "Argentinië"],
  ["AS", "American Samoa", "Samoa américaines", "Amerikaans-Samoa"],
  ["AT", "Austria", "Autriche", "Oostenrijk"],
  ["AU", "Australia", "Australie", "Australië"],
  ["AW", "Aruba", "Aruba", "Aruba"],
  ["AX", "Åland Islands", "Åland", "Åland"],
  ["AZ", "Azerbaijan", "Azerbaïdjan", "Azerbeidzjan"],
  ["BA", "Bosnia and Herzegovina", "Bosnie-Herzégovine", "Bosnië-Herzegovina"],
  ["BB", "Barbados", "Barbade", "Barbados"],
  ["BD", "Bangladesh", "Bangladesh", "Bangladesh"],
  ["BE", "Belgium", "Belgique", "België"],
  ["BF", "Burkina Faso", "Burkina Faso", "Burkina Faso"],
  ["BG", "Bulgaria", "Bulgarie", "Bulgarije"],
  ["BH", "Bahrain", "Bahreïn", "Bahrein"],
  ["BI", "Burundi", "Burundi", "Burundi"],
  ["BJ", "Benin", "Bénin", "Benin"],
  ["BL", "Saint Barthélemy", "Saint-Barthélemy", "Saint Barthélemy"],
  ["BM", "Bermuda", "Bermudes", "Bermuda"],
  ["BN", "Brunei Darussalam", "Brunei Darussalam", "Brunei"],
  ["BO", "Bolivia", "Bolivie", "Bolivië"],
  ["BQ", "Bonaire, Sint Eustatius and Saba", "Bonaire, Saint-Eustache et Saba", "Bonaire, Sint Eustatius en Saba"],
  ["BR", "Brazil", "Brésil", "Brazilië"],
  ["BS", "Bahamas", "Bahamas", "Bahama's"],
  ["BT", "Bhutan", "Bhoutan", "Bhutan"],
  ["BV", "Bouvet Island", "Île Bouvet", "Bouvet Eiland"],
  ["BW", "Botswana", "Botswana", "Botswana"],
  ["BY", "Belarus", "Biélorussie", "Wit-Rusland"],
  ["BZ", "Belize", "Belize", "Belize"],
  ["CA", "Canada", "Canada", "Canada"],
  ["CC", "Cocos (Keeling) Islands", "Îles Cocos", "Cocoseilanden"],
  ["CD", "Democratic Republic of the Congo", "République démocratique du Congo", "Congo-Kinshasa"],
  ["CF", "Central African Republic", "République Centrafricaine", "Centraal-Afrikaanse Republiek"],
  ["CG", "Republic of the Congo", "République du Congo", "Congo-Brazzaville"],
  ["CH", "Switzerland", "Suisse", "Zwitserland"],
  ["CI", "Ivory Coast", "Côte-d'Ivoire", "Ivoorkust"],
  ["CK", "Cook Islands", "Îles Cook", "Cookeilanden"],
  ["CL", "Chile", "Chili", "Chili"],
  ["CM", "Cameroon", "Cameroun", "Kameroen"],
  ["CN", "People's Republic of China", "Chine", "China"],
  ["CO", "Colombia", "Colombie", "Colombia"],
  ["CR", "Costa Rica", "Costa Rica", "Costa Rica"],
  ["CU", "Cuba", "Cuba", "Cuba"],
  ["CV", "Cape Verde", "Cap-Vert", "Kaapverdië"],
  ["CW", "Curaçao", "Curaçao", "Curaçao"],
  ["CX", "Christmas Island", "Île Christmas", "Kersteiland"],
  ["CY", "Cyprus", "Chypre", "Cyprus"],
  ["CZ", "Czech Republic", "République Tchèque", "Tsjechië"],
  ["DE", "Germany", "Allemagne", "Duitsland"],
  ["DJ", "Djibouti", "Djibouti", "Djibouti"],
  ["DK", "Denmark", "Danemark", "Denemarken"],
  ["DM", "Dominica", "Dominique", "Dominica"],
  ["DO", "Dominican Republic", "République Dominicaine", "Dominicaanse Republiek"],
  ["DZ", "Algeria", "Algérie", "Algerije"],
  ["EC", "Ecuador", "Équateur", "Ecuador"],
  ["EE", "Estonia", "Estonie", "Estland"],
  ["EG", "Egypt", "Égypte", "Egypte"],
  ["EH", "Western Sahara", "Sahara occidental", "Westelijke Sahara"],
  ["ER", "Eritrea", "Érythrée", "Eritrea"],
  ["ES", "Spain", "Espagne", "Spanje"],
  ["ET", "Ethiopia", "Éthiopie", "Ethiopië"],
  ["FI", "Finland", "Finlande", "Finland"],
  ["FJ", "Fiji", "Fidji", "Fiji"],
  ["FK", "Falkland Islands (Malvinas)", "Îles Malouines", "Falklandeilanden"],
  ["FM", "Micronesia, Federated States of", "Micronésie", "Micronesië"],
  ["FO", "Faroe Islands", "Îles Féroé", "Faeröer"],
  ["FR", "France", "France", "Frankrijk"],
  ["GA", "Gabon", "Gabon", "Gabon"],
  ["GB", "United Kingdom", "Royaume-Uni", "Verenigd Koninkrijk"],
  ["GD", "Grenada", "Grenade", "Grenada"],
  ["GE", "Georgia", "Géorgie", "Georgië"],
  ["GF", "French Guiana", "Guyane française", "Frans-Guyana"],
  ["GG", "Guernsey", "Guernesey", "Guernsey"],
  ["GH", "Ghana", "Ghana", "Ghana"],
  ["GI", "Gibraltar", "Gibraltar", "Gibraltar"],
  ["GL", "Greenland", "Groenland", "Groenland"],
  ["GM", "Republic of The Gambia", "Gambie", "Gambia"],
  ["GN", "Guinea", "Guinée", "Guinea"],
  ["GP", "Guadeloupe", "Guadeloupe", "Guadeloupe"],
  ["GQ", "Equatorial Guinea", "Guinée équatoriale", "Equatoriaal-Guinea"],
  ["GR", "Greece", "Grèce", "Griekenland"],
  ["GS", "South Georgia and the South Sandwich Islands", "Géorgie du Sud-et-les Îles Sandwich du Sud", "Zuid-Georgia en de Zuidelijke Sandwicheilanden"],
  ["GT", "Guatemala", "Guatemala", "Guatemala"],
  ["GU", "Guam", "Guam", "Guam"],
  ["GW", "Guinea-Bissau", "Guinée-Bissau", "Guinee-Bissau"],
  ["GY", "Guyana", "Guyana", "Guyana"],
  ["HK", "Hong Kong", "Hong Kong", "Hong Kong"],
  ["HM", "Heard Island and McDonald Islands", "Îles Heard-et-MacDonald", "Heard en McDonaldeilanden"],
  ["HN", "Honduras", "Honduras", "Honduras"],
  ["HR", "Croatia", "Croatie", "Kroatië"],
  ["HT", "Haiti", "Haïti", "Haïti"],
  ["HU", "Hungary", "Hongrie", "Hongarije"],
  ["ID", "Indonesia", "Indonésie", "Indonesië"],
  ["IE", "Ireland", "Irlande", "Ierland"],
  ["IL", "Israel", "Israël", "Israël"],
  ["IM", "Isle of Man", "Île de Man", "Man Eiland"],
  ["IN", "India", "Inde", "India"],
  ["IO", "British Indian Ocean Territory", "Océan Indien Britannique", "Brits Indische oceaan"],
  ["IQ", "Iraq", "Irak", "Irak"],
  ["IR", "Iran", "Iran", "Iran"],
  ["IS", "Iceland", "Islande", "IJsland"],
  ["IT", "Italy", "Italie", "Italië"],
  ["JE", "Jersey", "Jersey", "Jersey"],
  ["JM", "Jamaica", "Jamaïque", "Jamaica"],
  ["JO", "Jordan", "Jordanie", "Jordanië"],
  ["JP", "Japan", "Japon", "Japan"],
  ["KE", "Kenya", "Kenya", "Kenia"],
  ["KG", "Kyrgyzstan", "Kirghizistan", "Kirgizië"],
  ["KH", "Cambodia", "Cambodge", "Cambodja"],
  ["KI", "Kiribati", "Kiribati", "Kiribati"],
  ["KM", "Comoros", "Comores", "Comoren"],
  ["KN", "Saint Kitts and Nevis", "Saint-Christophe-et-Niévès", "Saint Kitts en Nevis"],
  ["KP", "North Korea", "Corée du Nord", "Noord-Korea"],
  ["KR", "South Korea", "Corée du Sud", "Zuid-Korea"],
  ["KW", "Kuwait", "Koweït", "Koeweit"],
  ["KY", "Cayman Islands", "Îles Caïmans", "Kaaimaneilanden"],
  ["KZ", "Kazakhstan", "Kazakhstan", "Kazachstan"],
  ["LA", "Laos", "Laos", "Laos"],
  ["LB", "Lebanon", "Liban", "Libanon"],
  ["LC", "Saint Lucia", "Sainte-Lucie", "Saint Lucia"],
  ["LI", "Liechtenstein", "Liechtenstein", "Liechtenstein"],
  ["LK", "Sri Lanka", "Sri Lanka", "Sri Lanka"],
  ["LR", "Liberia", "Libéria", "Liberia"],
  ["LS", "Lesotho", "Lesotho", "Lesotho"],
  ["LT", "Lithuania", "Lituanie", "Litouwen"],
  ["LU", "Luxembourg", "Luxembourg", "Luxemburg"],
  ["LV", "Latvia", "Lettonie", "Letland"],
  ["LY", "Libya", "Libye", "Libië"],
  ["MA", "Morocco", "Maroc", "Marokko"],
  ["MC", "Monaco", "Monaco", "Monaco"],
  ["MD", "Moldova, Republic of", "Moldavie", "Moldavië"],
  ["ME", "Montenegro", "Monténégro", "Montenegro"],
  ["MF", "Saint Martin (French part)", "Saint-Martin (partie française)", "Collectiviteit van Sint-Maarten"],
  ["MG", "Madagascar", "Madagascar", "Madagaskar"],
  ["MH", "Marshall Islands", "Îles Marshall", "Marshalleilanden"],
  ["MK", "North Macedonia", "Macédoine du Nord", "Noord-Macedonië"],
  ["ML", "Mali", "Mali", "Mali"],
  ["MM", "Myanmar", "Myanmar", "Myanmar"],
  ["MN", "Mongolia", "Mongolie", "Mongolië"],
  ["MO", "Macao", "Macao", "Macao"],
  ["MP", "Northern Mariana Islands", "Îles Mariannes du Nord", "Noordelijke Marianen"],
  ["MQ", "Martinique", "Martinique", "Martinique"],
  ["MR", "Mauritania", "Mauritanie", "Mauritanië"],
  ["MS", "Montserrat", "Montserrat", "Montserrat"],
  ["MT", "Malta", "Malte", "Malta"],
  ["MU", "Mauritius", "Maurice", "Mauritius"],
  ["MV", "Maldives", "Maldives", "Maldiven"],
  ["MW", "Malawi", "Malawi", "Malawi"],
  ["MX", "Mexico", "Mexique", "Mexico"],
  ["MY", "Malaysia", "Malaisie", "Maleisië"],
  ["MZ", "Mozambique", "Mozambique", "Mozambique"],
  ["NA", "Namibia", "Namibie", "Namibië"],
  ["NC", "New Caledonia", "Nouvelle-Calédonie", "Nieuw-Caledonië"],
  ["NE", "Niger", "Niger", "Niger"],
  ["NF", "Norfolk Island", "Île Norfolk", "Norfolk"],
  ["NG", "Nigeria", "Nigéria", "Nigeria"],
  ["NI", "Nicaragua", "Nicaragua", "Nicaragua"],
  ["NL", "Netherlands", "Pays-Bas", "Nederland"],
  ["NO", "Norway", "Norvège", "Noorwegen"],
  ["NP", "Nepal", "Népal", "Nepal"],
  ["NR", "Nauru", "Nauru", "Nauru"],
  ["NU", "Niue", "Niué", "Niue"],
  ["NZ", "New Zealand", "Nouvelle-Zélande", "Nieuw-Zeeland"],
  ["OM", "Oman", "Oman", "Oman"],
  ["PA", "Panama", "Panama", "Panama"],
  ["PE", "Peru", "Pérou", "Peru"],
  ["PF", "French Polynesia", "Polynésie française", "Frans-Polynesië"],
  ["PG", "Papua New Guinea", "Papouasie-Nouvelle-Guinée", "Papoea-Nieuw-Guinea"],
  ["PH", "Philippines", "Philippines", "Filipijnen"],
  ["PK", "Pakistan", "Pakistan", "Pakistan"],
  ["PL", "Poland", "Pologne", "Polen"],
  ["PM", "Saint Pierre and Miquelon", "Saint-Pierre-et-Miquelon", "Saint-Pierre en Miquelon"],
  ["PN", "Pitcairn", "Îles Pitcairn", "Pitcairn"],
  ["PR", "Puerto Rico", "Porto Rico", "Puerto Rico"],
  ["PS", "State of Palestine", "Palestine", "Palestina"],
  ["PT", "Portugal", "Portugal", "Portugal"],
  ["PW", "Palau", "Palaos", "Palau"],
  ["PY", "Paraguay", "Paraguay", "Paraguay"],
  ["QA", "Qatar", "Qatar", "Qatar"],
  ["RE", "Reunion", "Réunion", "Réunion"],
  ["RO", "Romania", "Roumanie", "Roemenië"],
  ["RS", "Serbia", "Serbie", "Servië"],
  ["RU", "Russia", "Russie", "Rusland"],
  ["RW", "Rwanda", "Rwanda", "Rwanda"],
  ["SA", "Saudi Arabia", "Arabie Saoudite", "Saudi-Arabië"],
  ["SB", "Solomon Islands", "Îles Salomon", "Salomonseilanden"],
  ["SC", "Seychelles", "Seychelles", "Seychellen"],
  ["SD", "Sudan", "Soudan", "Soedan"],
  ["SE", "Sweden", "Suède", "Zweden"],
  ["SG", "Singapore", "Singapour", "Singapore"],
  ["SH", "Saint Helena", "Sainte-Hélène", "Sint-Helena"],
  ["SI", "Slovenia", "Slovénie", "Slovenië"],
  ["SJ", "Svalbard and Jan Mayen", "Svalbard et Île Jan Mayen", "Spitsbergen en Jan Mayen"],
  ["SK", "Slovakia", "Slovaquie", "Slowakije"],
  ["SL", "Sierra Leone", "Sierra Leone", "Sierra Leone"],
  ["SM", "San Marino", "Saint-Marin", "San Marino"],
  ["SN", "Senegal", "Sénégal", "Senegal"],
  ["SO", "Somalia", "Somalie", "Somalië"],
  ["SR", "Suriname", "Suriname", "Suriname"],
  ["SS", "South Sudan", "Soudan du Sud", "Zuid-Soedan"],
  ["ST", "Sao Tome and Principe", "São Tomé-et-Principe", "São Tomé en Principe"],
  ["SV", "El Salvador", "El Salvador", "El Salvador"],
  ["SX", "Sint Maarten (Dutch part)", "Saint-Martin (partie néerlandaise)", "Land Sint Maarten"],
  ["SY", "Syria", "Syrie", "Syrië"],
  ["SZ", "Eswatini", "Royaume d'Eswatini", "Swaziland"],
  ["TC", "Turks and Caicos Islands", "Îles Turques-et-Caïques", "Turks- en Caicoseilanden"],
  ["TD", "Chad", "Tchad", "Tsjaad"],
  ["TF", "French Southern Territories", "Terres australes françaises", "Franse Zuidelijke Gebieden"],
  ["TG", "Togo", "Togo", "Togo"],
  ["TH", "Thailand", "Thaïlande", "Thailand"],
  ["TJ", "Tajikistan", "Tadjikistan", "Tadzjikistan"],
  ["TK", "Tokelau", "Tokelau", "Tokelau"],
  ["TL", "Timor-Leste", "Timor-Leste", "Timor Leste"],
  ["TM", "Turkmenistan", "Turkménistan", "Turkmenistan"],
  ["TN", "Tunisia", "Tunisie", "Tunesië"],
  ["TO", "Tonga", "Tonga", "Tonga"],
  ["TR", "Türkiye", "Turquie", "Turkije"],
  ["TT", "Trinidad and Tobago", "Trinité-et-Tobago", "Trinidad en Tobago"],
  ["TV", "Tuvalu", "Tuvalu", "Tuvalu"],
  ["TW", "Taiwan", "Taïwan", "Taiwan"],
  ["TZ", "United Republic of Tanzania", "République unie de Tanzanie", "Tanzania"],
  ["UA", "Ukraine", "Ukraine", "Oekraïne"],
  ["UG", "Uganda", "Ouganda", "Oeganda"],
  ["UM", "United States Minor Outlying Islands", "Îles mineures éloignées des États-Unis", "Amerikaanse Kleinere Afgelegen Eilanden"],
  ["US", "United States", "États-Unis d'Amérique", "Verenigde Staten"],
  ["UY", "Uruguay", "Uruguay", "Uruguay"],
  ["UZ", "Uzbekistan", "Ouzbékistan", "Oezbekistan"],
  ["VA", "Vatican City", "Saint-Siège (Vatican)", "Vaticaanstad"],
  ["VC", "Saint Vincent and the Grenadines", "Saint-Vincent-et-les-Grenadines", "Saint Vincent en de Grenadines"],
  ["VE", "Venezuela", "Venezuela", "Venezuela"],
  ["VG", "Virgin Islands, British", "Îles vierges britanniques", "Britse Maagdeneilanden"],
  ["VI", "Virgin Islands, U.S.", "Îles vierges américaines", "Amerikaanse Maagdeneilanden"],
  ["VN", "Vietnam", "Vietnam", "Vietnam"],
  ["VU", "Vanuatu", "Vanuatu", "Vanuatu"],
  ["WF", "Wallis and Futuna", "Wallis-et-Futuna", "Wallis en Futuna"],
  ["WS", "Samoa", "Samoa", "Samoa"],
  ["XK", "Kosovo", "Kosovo", "Kosovo"],
  ["YE", "Yemen", "Yémen", "Jemen"],
  ["YT", "Mayotte", "Mayotte", "Mayotte"],
  ["ZA", "South Africa", "Afrique du Sud", "Zuid-Afrika"],
  ["ZM", "Zambia", "Zambie", "Zambia"],
  ["ZW", "Zimbabwe", "Zimbabwe", "Zimbabwe"],
  ];

  // Aernoud's explicit top-of-list order (most likely guest countries for
  // this property), everything else follows alphabetically in the current
  // interface language — see populateCountrySelect() below.
  const TOP_COUNTRY_CODES = ["GB", "BE", "NL", "FR", "ES", "DE", "CH", "AT"];

  // Default country per page language when the guest hasn't chosen one
  // themselves yet (see populateCountrySelect()/wireLanguageSwitchLinks()).
  const DEFAULT_COUNTRY_BY_LANG = { nl: "NL", fr: "FR", en: "GB" };

  // Real-world countries that don't use postal codes at all — mirrors
  // _lib/countries.mjs's COUNTRIES_WITHOUT_POSTAL_CODE exactly (client-side
  // copy for immediate UI feedback; the server list is authoritative).
  const COUNTRIES_WITHOUT_POSTAL_CODE = new Set([
    "AO", "AG", "AW", "BS", "BZ", "BJ", "BW", "BF", "BI", "CM", "CF", "KM",
    "CG", "CD", "CK", "CI", "DJ", "DM", "GQ", "ER", "FJ", "TF", "GM", "GH",
    "GD", "GN", "GY", "HK", "IE", "JM", "KE", "KI", "KP", "LC", "LY", "MO",
    "MW", "ML", "MR", "MU", "MS", "NR", "AN", "NU", "PA", "QA", "RW", "KN",
    "ST", "SC", "SL", "SB", "SO", "SR", "SY", "TZ", "TL", "TG", "TK", "TO",
    "TT", "TV", "UG", "AE", "VU", "YE", "ZW",
  ]);

  // Same three exact-digit-count groups as _lib/countries.mjs's
  // POSTAL_CODE_PATTERNS — everything else with a postal code just needs a
  // non-empty value (loose on purpose; the server is authoritative).
  const POSTAL_CODE_PATTERNS = {
    GB: /^[A-Za-z0-9]+(\s?[A-Za-z0-9]+)*$/,
    NL: /^[A-Za-z0-9]+(\s?[A-Za-z0-9]+)*$/,
    BE: /^\d{4}$/,
    CH: /^\d{4}$/,
    AT: /^\d{4}$/,
    FR: /^\d{5}$/,
    ES: /^\d{5}$/,
    DE: /^\d{5}$/,
  };

  const STRINGS = {
    en: {
      selectRange: "Select your check-in and check-out dates on the calendar",
      nightsLabel: (n) => `${n} night${n === 1 ? "" : "s"} selected`,
      submit: "Send booking request",
      errorGeneric: "Something went wrong sending your request. Please try again, or reach out directly.",
      connectionTimeout: "We could not confirm whether the payment page was created. Your dates may be temporarily held. Please contact Aernoud if trying again reports that the dates are unavailable.",
      pickBothDates: "Please select both a check-in and a check-out date on the calendar.",
      fillNameEmail: "Please fill in your name and a valid email address.",
      rangeUnavailable: "Some of the nights in that range are already booked or requested. Please pick different dates.",
      pricePrompt: "Select your dates to see the price.",
      priceError: "Couldn't load the price just now — you can still continue to secure payment; the exact amount will be confirmed there.",
      rentGroup: (n, rate) => `${n} night${n === 1 ? "" : "s"} × ${rate}`,
      linen: (n, amt) => `Linen (${n} guests × ${amt})`,
      linenPerWeek: (n, weeks, amt) => `Linen (${n} guests × ${weeks} week${weeks === 1 ? "" : "s"} × ${amt})`,
      cleaning: "Final cleaning",
      tax: "Tourist tax",
      total: "Total (stay)",
      deposit: "Refundable security deposit (separate)",
      totalWithDeposit: "Charged now via Stripe",
      discountWeek: "Weekly discount",
      discountMonth: "Monthly discount",
      rentAfterDiscount: "Rent after discount",
      partyComposition: (adults, children, total) => children ? `${total} people: ${adults} adult${adults === 1 ? "" : "s"} + ${children} child${children === 1 ? "" : "ren"}` : `${total} adult${total === 1 ? "" : "s"}`,
      taxNoteFixed: (amt, adults, nights) => `${amt} per adult per night × ${adults} adult${adults === 1 ? "" : "s"} × ${nights} night${nights === 1 ? "" : "s"}. Children are exempt.`,
      taxNotePercent: (pct) => `${pct}% of the (discounted) nightly rate per adult. Children are exempt.`,
      depositNote: "Charged together with the stay total via Stripe Checkout, then refunded by bank transfer after check-out once the house has been checked.",
      fourNightGapNotice: "Exception: these 4 nights are the whole gap between two other bookings, so they're bookable together even though this period normally requires at least 5 nights.",
      minNights: (n) => `This period requires a minimum stay of ${n} nights.`,
      rateMissing: "Some of the selected nights aren't open for booking yet. Please try different dates or contact us.",
      dateBlocked: "One of the selected dates is not available. Please try different dates.",
      capacityExceeded: (max) => `This stay allows at most ${max.maxAdults} adults and ${max.maxChildren} children (${max.maxTotalGuests} guests total).`,
      capacityWarning: (max) => `That's more guests than this stay allows: at most ${max.maxAdults} adults, ${max.maxChildren} children, ${max.maxTotalGuests} guests in total. Please adjust the numbers above.`,
      childrenExceedTotal: "The number of children can't be more than the total number of people.",
      // Address — direct rental with self-check-in, needed for the rental
      // agreement (see book.mjs / _lib/countries.mjs for the server-side
      // rules this mirrors).
      addressHeading: "Address of the main renter",
      addressExplain: "For your booking and rental agreement.",
      fullNameLabel: "Full name (main renter)",
      addressLine1Label: "Street and house number",
      addressLine2Label: "Apartment, suite, etc. (optional)",
      postalCodeLabel: "Postal code",
      postalCodeOptionalLabel: "Postal code (not required for this country)",
      cityLabel: "City",
      countryLabel: "Country",
      countryPlaceholder: "Select a country",
      addressLine1Required: "Please fill in your street and house number.",
      addressCityRequired: "Please fill in your city.",
      addressCountryRequired: "Please select a country.",
      addressPostalCodeRequired: "Please fill in a postal code.",
      addressPostalCodeInvalid: "That doesn't look like a valid postal code for the selected country.",
      arrivalDayNotAllowed: "Stays can't start on that day of the week. Please pick a different check-in date.",
      saturdayTurnoverRequired: "During this period, stays must both start and end on a Saturday. Please adjust your check-in and/or check-out date.",
      dayHighSeasonWeekday: "high season — Saturdays only",
      highSeasonHint: "During high season, stays can only start and end on a Saturday (minimum 7 nights). Lighter-highlighted Saturdays below are valid check-in dates.",
      availabilityErrorTitle: "Couldn't check availability",
      availabilityErrorBody: "We couldn't reliably load the calendar just now, so no dates can be selected — we'd rather show nothing than risk showing a date as free when it might not be.",
      retry: "Try again",
      checkingAvailability: "Checking availability…",
      prevMonth: "Previous month",
      nextMonth: "Next month",
      // One neutral word for every reason a night isn't bookable (a synced
      // Airbnb/confirmed booking, or the owner's own block) — see the style
      // logic in renderCalendar() for why this is deliberately not split
      // into "booked" vs "owner's own use" on the guest side.
      dayUnavailable: "not available",
      dayRequested: "held, payment in progress",
      dayAvailable: "available",
      dayPast: "past date",
      dayNoPrice: "not yet open for booking",
      // Shown on a would-be CHECK-OUT date once an arrival is already
      // selected, when that specific date would not actually be accepted
      // (see meetsMinNights()/isValidCheckout() in renderCalendar() — these
      // mirror calculateQuote()'s own MIN_NIGHTS_NOT_MET/SATURDAY_TURNOVER_
      // REQUIRED checks exactly, so a date that looks disabled here is a
      // date the server would reject too, and vice versa).
      checkoutMinStay: (n) => `not a valid check-out — this arrival requires at least ${n} nights`,
      checkoutSaturdayOnly: "not a valid check-out — high season requires both check-in and check-out on a Saturday",
      checkoutRangeBlocked: "not a valid check-out — a night in between is already booked or held",
      minStaySuffix: (n) => `, minimum stay if arriving here: ${n} nights`,
      minStayNote: (n) => `Minimum stay: ${n} nights (some periods require longer — the calendar and price will tell you).`,
      // Shown right next to the calendar as soon as an arrival is picked
      // but no check-out yet — the earliest date isValidCheckout() would
      // actually accept, so this can never promise a date the calendar
      // itself disables (see findEarliestValidCheckout()).
      minStayFromDate: (n, dateStr) => `Minimum stay: ${n} nights — earliest check-out ${dateStr}.`,
      minStayFromDateUnknown: (n) => `Minimum stay: ${n} nights — no valid check-out found nearby; please try a different arrival date.`,
      clearSelectionLink: "Clear selection",
      tilePriceSuffix: (amount) => `, ${amount} per night`,
      tileCaption: "Every available day shows its nightly price in euros (€) and minimum stay (e.g. “5n” = 5 nights minimum).",
      termsHeading: "Booking terms, cancellation & deposit",
      termsBody:
        "You are booking directly with L'Ancienne École for the exact dates and price shown above. Payment is taken securely via Stripe on the next screen; your booking is confirmed the instant that payment succeeds — this is a real, immediate booking, not a request. The tourist tax is a local government charge collected on the owner's behalf. The refundable security deposit is charged together with the rest, and returned by bank transfer after your stay once the house has been checked for damage. To change or cancel a paid booking, please contact us directly — we'll confirm the terms that apply to your situation individually.",
      termsCheckboxLabel: "I have read and accept the terms above.",
      termsRequired: "Please accept the booking terms to continue.",
      submitPay: "Proceed to secure payment",
      redirecting: "Redirecting to secure payment…",
      directPaymentNote: "You'll pay securely via Stripe on the next screen. Your booking is confirmed the instant payment succeeds — not after a review.",
      confirmingPayment: "Confirming your payment…",
      paymentConfirmedTitle: "Payment received — you're booked!",
      paymentConfirmedBody: (checkin, checkout) => `Your stay from <b>${checkin}</b> to <b>${checkout}</b> is confirmed and paid. A confirmation email is on its way.`,
      paymentStillProcessingTitle: "Almost there…",
      paymentStillProcessingBody: "We're still confirming your payment with Stripe. This can take a moment on some payment methods — you'll receive a confirmation email as soon as it's done, so feel free to close this page.",
      paymentNotCompletedTitle: "Payment not completed",
      paymentNotCompletedBody: "Your payment wasn't completed, so these dates were not booked and nothing was charged. Feel free to select dates and try again.",
    },
    fr: {
      selectRange: "Sélectionnez vos dates d'arrivée et de départ sur le calendrier",
      nightsLabel: (n) => `${n} nuit${n === 1 ? "" : "s"} sélectionnée${n === 1 ? "" : "s"}`,
      submit: "Envoyer la demande de réservation",
      errorGeneric: "Une erreur est survenue lors de l'envoi. Merci de réessayer, ou contactez-nous directement.",
      connectionTimeout: "Nous n’avons pas pu confirmer la création de la page de paiement. Vos dates peuvent être temporairement retenues. Contactez Aernoud si une nouvelle tentative indique qu’elles sont indisponibles.",
      pickBothDates: "Merci de sélectionner une date d'arrivée et une date de départ sur le calendrier.",
      fillNameEmail: "Merci de renseigner votre nom et une adresse e-mail valide.",
      rangeUnavailable: "Certaines nuits de cette période sont déjà réservées ou en demande. Merci de choisir d'autres dates.",
      pricePrompt: "Sélectionnez vos dates pour voir le prix.",
      priceError: "Impossible de charger le prix pour le moment — vous pouvez tout de même continuer vers le paiement sécurisé ; le montant exact y sera confirmé.",
      rentGroup: (n, rate) => `${n} nuit${n === 1 ? "" : "s"} × ${rate}`,
      linen: (n, amt) => `Linge de maison (${n} pers. × ${amt})`,
      linenPerWeek: (n, weeks, amt) => `Linge de maison (${n} pers. × ${weeks} semaine${weeks === 1 ? "" : "s"} × ${amt})`,
      cleaning: "Ménage de fin de séjour",
      tax: "Taxe de séjour",
      total: "Total (séjour)",
      deposit: "Caution remboursable (séparée)",
      totalWithDeposit: "Débité maintenant via Stripe",
      discountWeek: "Réduction hebdomadaire",
      discountMonth: "Réduction mensuelle",
      rentAfterDiscount: "Location après réduction",
      partyComposition: (adults, children, total) => children ? `${total} personnes : ${adults} adulte${adults === 1 ? "" : "s"} + ${children} enfant${children === 1 ? "" : "s"}` : `${total} adulte${total === 1 ? "" : "s"}`,
      taxNoteFixed: (amt, adults, nights) => `${amt} par adulte et par nuit × ${adults} adulte${adults === 1 ? "" : "s"} × ${nights} nuit${nights === 1 ? "" : "s"}. Les enfants en sont exonérés.`,
      taxNotePercent: (pct) => `${pct} % du tarif nocturne (après réduction) par adulte. Les enfants en sont exonérés.`,
      depositNote: "Débitée en même temps que le total du séjour via Stripe Checkout, puis remboursée par virement après le départ, une fois la maison vérifiée.",
      fourNightGapNotice: "Exception : ces 4 nuits comblent entièrement l'intervalle entre deux autres réservations, elles sont donc réservables ensemble même si cette période impose normalement un minimum de 5 nuits.",
      minNights: (n) => `Cette période impose un séjour minimum de ${n} nuits.`,
      rateMissing: "Certaines nuits sélectionnées ne sont pas encore ouvertes à la réservation. Essayez d'autres dates ou contactez-nous.",
      dateBlocked: "Une des dates sélectionnées n'est pas disponible. Merci de choisir d'autres dates.",
      capacityExceeded: (max) => `Ce séjour accepte au maximum ${max.maxAdults} adultes et ${max.maxChildren} enfants (${max.maxTotalGuests} personnes au total).`,
      capacityWarning: (max) => `C'est plus de personnes que ce séjour n'accepte : au maximum ${max.maxAdults} adultes, ${max.maxChildren} enfants, ${max.maxTotalGuests} personnes au total. Merci d'ajuster les nombres ci-dessus.`,
      childrenExceedTotal: "Le nombre d'enfants ne peut pas dépasser le nombre total de personnes.",
      addressHeading: "Adresse du locataire principal",
      addressExplain: "Pour votre réservation et votre contrat de location.",
      fullNameLabel: "Nom complet (locataire principal)",
      addressLine1Label: "Rue et numéro",
      addressLine2Label: "Appartement, etc. (facultatif)",
      postalCodeLabel: "Code postal",
      postalCodeOptionalLabel: "Code postal (non requis pour ce pays)",
      cityLabel: "Ville",
      countryLabel: "Pays",
      countryPlaceholder: "Choisissez un pays",
      addressLine1Required: "Merci de renseigner votre rue et numéro.",
      addressCityRequired: "Merci de renseigner votre ville.",
      addressCountryRequired: "Merci de sélectionner un pays.",
      addressPostalCodeRequired: "Merci de renseigner un code postal.",
      addressPostalCodeInvalid: "Ce code postal ne semble pas valable pour le pays sélectionné.",
      arrivalDayNotAllowed: "Les séjours ne peuvent pas commencer ce jour-là. Merci de choisir une autre date d'arrivée.",
      saturdayTurnoverRequired: "Pendant cette période, les séjours doivent commencer ET se terminer un samedi. Merci d'ajuster votre date d'arrivée et/ou de départ.",
      dayHighSeasonWeekday: "haute saison — samedi uniquement",
      highSeasonHint: "En haute saison, un séjour ne peut commencer et se terminer qu'un samedi (minimum 7 nuits). Les samedis en surbrillance plus claire ci-dessous sont des dates d'arrivée valables.",
      availabilityErrorTitle: "Impossible de vérifier les disponibilités",
      availabilityErrorBody: "Nous n'avons pas pu charger le calendrier de façon fiable — aucune date ne peut donc être sélectionnée pour l'instant : mieux vaut ne rien afficher que risquer de montrer une date comme libre alors qu'elle ne l'est peut-être pas.",
      retry: "Réessayer",
      checkingAvailability: "Vérification des disponibilités…",
      prevMonth: "Mois précédent",
      nextMonth: "Mois suivant",
      dayUnavailable: "indisponible",
      dayRequested: "retenu, paiement en cours",
      dayAvailable: "disponible",
      dayPast: "date passée",
      dayNoPrice: "pas encore ouvert à la réservation",
      checkoutMinStay: (n) => `départ non valable — cette arrivée exige au moins ${n} nuits`,
      checkoutSaturdayOnly: "départ non valable — la haute saison exige une arrivée ET un départ le samedi",
      checkoutRangeBlocked: "départ non valable — une nuit entre les deux est déjà réservée ou retenue",
      minStaySuffix: (n) => `, séjour minimum en arrivant ici : ${n} nuits`,
      minStayNote: (n) => `Séjour minimum : ${n} nuits (certaines périodes exigent plus — le calendrier et le prix vous le préciseront).`,
      minStayFromDate: (n, dateStr) => `Séjour minimum : ${n} nuits — départ possible à partir du ${dateStr}.`,
      minStayFromDateUnknown: (n) => `Séjour minimum : ${n} nuits — aucun départ valable trouvé à proximité ; merci d'essayer une autre date d'arrivée.`,
      clearSelectionLink: "Effacer la sélection",
      tilePriceSuffix: (amount) => `, ${amount} par nuit`,
      tileCaption: "Chaque jour disponible indique son prix par nuit en euros (€) et le séjour minimum (par ex. « 5n » = minimum 5 nuits).",
      termsHeading: "Conditions de réservation, annulation et caution",
      termsBody:
        "Vous réservez directement auprès de L'Ancienne École pour les dates et le prix exacts indiqués ci-dessus. Le paiement s'effectue en toute sécurité via Stripe à l'écran suivant ; votre réservation est confirmée dès que ce paiement aboutit — il s'agit d'une réservation réelle et immédiate, pas d'une demande. La taxe de séjour est une taxe locale collectée pour le compte de la commune. La caution remboursable est débitée en même temps que le reste, puis restituée par virement après votre séjour une fois la maison vérifiée. Pour modifier ou annuler une réservation payée, merci de nous contacter directement — nous confirmerons avec vous les conditions applicables à votre situation.",
      termsCheckboxLabel: "J'ai lu et j'accepte les conditions ci-dessus.",
      termsRequired: "Merci d'accepter les conditions de réservation pour continuer.",
      submitPay: "Procéder au paiement sécurisé",
      redirecting: "Redirection vers le paiement sécurisé…",
      directPaymentNote: "Vous paierez en toute sécurité via Stripe à l'écran suivant. Votre réservation est confirmée dès que le paiement aboutit — pas après une vérification.",
      confirmingPayment: "Confirmation de votre paiement…",
      paymentConfirmedTitle: "Paiement reçu — c'est réservé !",
      paymentConfirmedBody: (checkin, checkout) => `Votre séjour du <b>${checkin}</b> au <b>${checkout}</b> est confirmé et payé. Un e-mail de confirmation est en route.`,
      paymentStillProcessingTitle: "Presque terminé…",
      paymentStillProcessingBody: "Nous confirmons encore votre paiement auprès de Stripe. Cela peut prendre un instant selon le moyen de paiement — vous recevrez un e-mail de confirmation dès que ce sera fait, vous pouvez donc fermer cette page.",
      paymentNotCompletedTitle: "Paiement non finalisé",
      paymentNotCompletedBody: "Votre paiement n'a pas été finalisé, ces dates n'ont donc pas été réservées et rien n'a été débité. N'hésitez pas à choisir des dates et réessayer.",
    },
    nl: {
      selectRange: "Selecteer je aankomst- en vertrekdatum in de kalender",
      nightsLabel: (n) => `${n} nacht${n === 1 ? "" : "en"} geselecteerd`,
      submit: "Boekingsaanvraag versturen",
      errorGeneric: "Er ging iets mis bij het versturen. Probeer het opnieuw, of neem rechtstreeks contact op.",
      connectionTimeout: "We konden niet bevestigen of de betaalpagina is aangemaakt. Je datums kunnen tijdelijk vastgehouden zijn. Neem contact op met Aernoud als een nieuwe poging meldt dat de datums niet beschikbaar zijn.",
      pickBothDates: "Selecteer zowel een aankomst- als een vertrekdatum in de kalender.",
      fillNameEmail: "Vul je naam en een geldig e-mailadres in.",
      rangeUnavailable: "Sommige nachten in die periode zijn al geboekt of aangevraagd. Kies andere data.",
      pricePrompt: "Selecteer je data om de prijs te zien.",
      priceError: "Kon de prijs nu niet ophalen — je kunt gewoon doorgaan naar de beveiligde betaling; het exacte bedrag wordt daar bevestigd.",
      rentGroup: (n, rate) => `${n} nacht${n === 1 ? "" : "en"} × ${rate}`,
      linen: (n, amt) => `Linnengoed (${n} pers. × ${amt})`,
      linenPerWeek: (n, weeks, amt) => `Linnengoed (${n} pers. × ${weeks} we${weeks === 1 ? "ek" : "ken"} × ${amt})`,
      cleaning: "Eindschoonmaak",
      tax: "Toeristenbelasting",
      total: "Totaal (verblijf)",
      deposit: "Terugbetaalbare borg (apart)",
      totalWithDeposit: "Nu afgerekend via Stripe",
      discountWeek: "Weekkorting",
      discountMonth: "Maandkorting",
      rentAfterDiscount: "Huur na korting",
      partyComposition: (adults, children, total) => children ? `${total} personen: ${adults} volwassene${adults === 1 ? "" : "n"} + ${children} kind${children === 1 ? "" : "eren"}` : `${total} volwassene${total === 1 ? "" : "n"}`,
      taxNoteFixed: (amt, adults, nights) => `${amt} per volwassene per nacht × ${adults} volwassene${adults === 1 ? "" : "n"} × ${nights} nacht${nights === 1 ? "" : "en"}. Kinderen zijn vrijgesteld.`,
      taxNotePercent: (pct) => `${pct}% van de nachtprijs (na korting) per volwassene. Kinderen zijn vrijgesteld.`,
      depositNote: "Wordt samen met het totaalbedrag afgerekend via Stripe Checkout, en na vertrek per bankoverschrijving terugbetaald zodra het huis is gecontroleerd.",
      fourNightGapNotice: "Uitzondering: deze 4 nachten vormen het volledige gat tussen twee andere boekingen, dus samen zijn ze boekbaar ook al geldt voor deze periode normaal een minimum van 5 nachten.",
      minNights: (n) => `Voor deze periode geldt een minimumverblijf van ${n} nachten.`,
      rateMissing: "Sommige geselecteerde nachten zijn nog niet open voor boeking. Probeer andere data of neem contact op.",
      dateBlocked: "Eén van de geselecteerde data is niet beschikbaar. Kies andere data.",
      capacityExceeded: (max) => `Dit verblijf biedt plaats aan maximaal ${max.maxAdults} volwassenen en ${max.maxChildren} kinderen (${max.maxTotalGuests} gasten totaal).`,
      capacityWarning: (max) => `Dat zijn meer gasten dan dit verblijf toestaat: maximaal ${max.maxAdults} volwassenen, ${max.maxChildren} kinderen, ${max.maxTotalGuests} gasten totaal. Pas de aantallen hierboven aan.`,
      childrenExceedTotal: "Het aantal kinderen kan niet groter zijn dan het totaal aantal personen.",
      addressHeading: "Adres van de hoofdhuurder",
      addressExplain: "Voor uw boeking en huurovereenkomst.",
      fullNameLabel: "Volledige naam (hoofdhuurder)",
      addressLine1Label: "Straat en huisnummer",
      addressLine2Label: "Toevoeging / adresregel 2 (optioneel)",
      postalCodeLabel: "Postcode",
      postalCodeOptionalLabel: "Postcode (niet verplicht voor dit land)",
      cityLabel: "Woonplaats",
      countryLabel: "Land",
      countryPlaceholder: "Kies een land",
      addressLine1Required: "Vul je straat en huisnummer in.",
      addressCityRequired: "Vul je woonplaats in.",
      addressCountryRequired: "Kies een land.",
      addressPostalCodeRequired: "Vul een postcode in.",
      addressPostalCodeInvalid: "Dit lijkt geen geldige postcode voor het gekozen land.",
      arrivalDayNotAllowed: "Een verblijf kan niet op die dag beginnen. Kies een andere aankomstdatum.",
      saturdayTurnoverRequired: "In deze periode moet een verblijf zowel op zaterdag beginnen als op zaterdag eindigen. Pas je aankomst- en/of vertrekdatum aan.",
      dayHighSeasonWeekday: "hoogseizoen — alleen zaterdag",
      highSeasonHint: "In het hoogseizoen kan een verblijf alleen op zaterdag beginnen en eindigen (minimaal 7 nachten). De lichter gemarkeerde zaterdagen hieronder zijn geldige aankomstdata.",
      availabilityErrorTitle: "Beschikbaarheid kon niet worden gecontroleerd",
      availabilityErrorBody: "We konden de kalender niet betrouwbaar laden, dus kunnen er nu geen data geselecteerd worden — dat is veiliger dan een datum als vrij tonen terwijl dat misschien niet zo is.",
      retry: "Opnieuw proberen",
      checkingAvailability: "Beschikbaarheid controleren…",
      prevMonth: "Vorige maand",
      nextMonth: "Volgende maand",
      dayUnavailable: "niet beschikbaar",
      dayRequested: "tijdelijk vastgehouden, betaling bezig",
      dayAvailable: "beschikbaar",
      dayPast: "verstreken datum",
      dayNoPrice: "nog niet open voor boeking",
      checkoutMinStay: (n) => `geen geldige vertrekdatum — dit verblijf vereist minimaal ${n} nachten`,
      checkoutSaturdayOnly: "geen geldige vertrekdatum — hoogseizoen vereist aankomst én vertrek op zaterdag",
      checkoutRangeBlocked: "geen geldige vertrekdatum — een nacht daartussen is al geboekt of vastgehouden",
      minStaySuffix: (n) => `, minimumverblijf bij aankomst hier: ${n} nachten`,
      minStayNote: (n) => `Minimumverblijf: ${n} nachten (voor sommige periodes geldt een langer minimum — de kalender en de prijs geven dit aan).`,
      minStayFromDate: (n, dateStr) => `Minimaal ${n} nachten — vertrek mogelijk vanaf ${dateStr}.`,
      minStayFromDateUnknown: (n) => `Minimaal ${n} nachten — geen geldige vertrekdatum gevonden in de buurt; probeer een andere aankomstdatum.`,
      clearSelectionLink: "Selectie wissen",
      tilePriceSuffix: (amount) => `, ${amount} per nacht`,
      tileCaption: "Elke beschikbare dag toont de prijs per nacht in euro's (€) en het minimumverblijf (bijv. “5n” = minimum 5 nachten).",
      termsHeading: "Boekingsvoorwaarden, annulering & borg",
      termsBody:
        "Je boekt rechtstreeks bij L'Ancienne École voor de exacte data en prijs hierboven. Betalen gebeurt veilig via Stripe op het volgende scherm; je boeking is bevestigd zodra die betaling lukt — dit is een echte, directe boeking, geen aanvraag. De toeristenbelasting is een gemeentelijke heffing die namens de gemeente wordt geïnd. De terugbetaalbare borg wordt samen met de rest afgerekend en na je verblijf per bankoverschrijving terugbetaald zodra het huis is gecontroleerd. Wil je een betaalde boeking wijzigen of annuleren, neem dan rechtstreeks contact met ons op — we bevestigen dan samen met jou welke voorwaarden voor jouw situatie gelden.",
      termsCheckboxLabel: "Ik heb de voorwaarden hierboven gelezen en ga ermee akkoord.",
      termsRequired: "Accepteer de boekingsvoorwaarden om door te gaan.",
      submitPay: "Doorgaan naar veilig betalen",
      redirecting: "Doorverwijzen naar veilig betalen…",
      directPaymentNote: "Je betaalt veilig via Stripe op het volgende scherm. Je boeking is bevestigd zodra de betaling lukt — niet pas na een controle.",
      confirmingPayment: "Je betaling wordt bevestigd…",
      paymentConfirmedTitle: "Betaling ontvangen — je bent geboekt!",
      paymentConfirmedBody: (checkin, checkout) => `Je verblijf van <b>${checkin}</b> t/m <b>${checkout}</b> is bevestigd en betaald. Een bevestigingsmail is onderweg.`,
      paymentStillProcessingTitle: "Bijna klaar…",
      paymentStillProcessingBody: "We bevestigen je betaling nog bij Stripe. Dit kan bij sommige betaalmethoden even duren — je ontvangt een bevestigingsmail zodra het rond is, dus je kunt deze pagina gerust sluiten.",
      paymentNotCompletedTitle: "Betaling niet voltooid",
      paymentNotCompletedBody: "Je betaling is niet voltooid, dus deze data zijn niet geboekt en er is niets afgeschreven. Kies gerust data en probeer het opnieuw.",
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
  // Nights explicitly flagged from /admin as requiring a Saturday-to-
  // Saturday stay (the explicit high-season window — see
  // _lib/pricing.mjs/availability.mjs). NOT inferred from minNights. Used
  // here purely to steer which dates the guest calendar offers as arrival/
  // departure candidates — quote.mjs/book.mjs remain the real enforcement.
  let saturdayTurnoverNights = new Set();
  let minNightsByDate = {};
  // {date: priceCents} — every night that has a price, already rounded to
  // the nearest €5 exactly the way calculateQuote() rounds it (see
  // _lib/availability.mjs buildPricesByDate() / _lib/money.mjs
  // roundNightlyPriceCents()). Used only to show the nightly price directly
  // on the calendar tile — the actual quote/charge is always recomputed
  // server-side from this same source, never trusted from here.
  let pricesByDate = {};
  let calendarCurrency = "EUR";
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

  // Monday-first weekday index is used everywhere else in this file, but
  // "Saturday" is simplest read straight off the JS Date (getUTCDay()===6)
  // rather than translating through that offset twice.
  function isSaturdayISO(dateISO) {
    return new Date(dateISO + "T00:00:00Z").getUTCDay() === 6;
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

  function addDaysISO(dateISO, delta) {
    const d = new Date(dateISO + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  // Mirrors calculateQuote()'s own MIN_NIGHTS_NOT_MET check AND its narrow
  // "exactly 4 free nights between two bookings" exception
  // (fourNightGapException() in _lib/pricing.mjs) exactly — same effective
  // per-arrival minimum (a per-date override in minNightsByDate, else the
  // site-wide defaultMinNights), same four conditions for the exception.
  // This is what a candidate check-out date is actually judged against, so
  // the calendar can never show as "clickable/available" a stay length the
  // server would reject with MIN_NIGHTS_NOT_MET, and never disables one the
  // four-night-gap exception would in fact allow.
  function meetsMinNights(startISO, endISO) {
    const nights = nightsInRange(startISO, endISO);
    const arrivalMinNights = minNightsByDate[startISO] ?? defaultMinNights;
    if (nights.length >= arrivalMinNights) return true;
    if (nights.length !== 4) return false;
    if (arrivalMinNights !== 5) return false;
    if (nights.some((d) => saturdayTurnoverNights.has(d))) return false;
    const prevNight = addDaysISO(startISO, -1);
    if (!busyNights.has(prevNight)) return false;
    if (!busyNights.has(endISO)) return false;
    return true;
  }

  // The single source of truth for "is dateISO a genuinely acceptable
  // check-out completing the stay that starts at startISO" — every night in
  // between must be free (rangeIsFree), any high-season night the stay
  // touches must be bracketed by a Saturday check-in AND check-out
  // (rangeNeedsSaturdayTurnover), and the resulting length must satisfy
  // meetsMinNights() above. Used both to decide what the calendar shows as
  // clickable (renderCalendar()) and, as defense in depth, inside pickDate()
  // itself — so a click can never complete a selection the calendar's own
  // rendering didn't actually offer as valid.
  function isValidCheckout(startISO, endISO) {
    if (!(endISO > startISO)) return false;
    if (!rangeIsFree(startISO, endISO)) return false;
    if (rangeNeedsSaturdayTurnover(startISO, endISO) && !(isSaturdayISO(startISO) && isSaturdayISO(endISO))) return false;
    return meetsMinNights(startISO, endISO);
  }

  // The date shown next to the calendar once an arrival is picked ("Minimum
  // stay: 5 nights — earliest check-out 12 May.") — the actual EARLIEST
  // date isValidCheckout() would accept for this arrival, not merely
  // startISO + minNights: if that arithmetic date happens to fall on an
  // already-busy night, or (in a high-season period) doesn't land on a
  // Saturday, the true earliest valid check-out is later still, and this
  // walks forward until it finds the first date that's actually offered as
  // clickable — so the note never promises a date the calendar itself would
  // reject. Capped at a year out so a stay with no valid check-out anywhere
  // nearby (e.g. hemmed in by bookings) doesn't loop indefinitely; the
  // caller simply shows no date in that case.
  function findEarliestValidCheckout(startISO, maxDaysAhead = 366) {
    for (let i = 1; i <= maxDaysAhead; i++) {
      const candidate = addDaysISO(startISO, i);
      if (isValidCheckout(startISO, candidate)) return candidate;
    }
    return null;
  }

  // True when ANY night actually stayed between startISO (inclusive) and
  // endISO (exclusive — checkout night itself is never "stayed", see
  // nightsInRange) is flagged saturdayTurnover — mirrors calculateQuote()'s
  // own needsSaturdayTurnover check in _lib/pricing.mjs, which looks at
  // every night in the stay, not just the arrival date's own rate. A stay
  // that starts in an ordinary period but extends into the high-season
  // window still needs a Saturday check-in AND check-out.
  function rangeNeedsSaturdayTurnover(startISO, endISO) {
    return nightsInRange(startISO, endISO).some((n) => saturdayTurnoverNights.has(n));
  }

  // Fully written-out, localized date for the guest-facing check-in/
  // check-out fields — "Saturday 6 February 2027" / "samedi 6 février 2027"
  // / "zaterdag 6 februari 2027". Deliberately no comma and an unpadded day
  // number, matching the exact style the owner asked for. Never truncates —
  // the check-in/check-out fields are <div>s that wrap, not fixed-width
  // <input>s (see reserve.html), specifically so this never gets clipped on
  // narrow screens.
  function formatLongDate(dateISO, lg) {
    if (!dateISO) return "";
    const d = new Date(dateISO + "T00:00:00Z");
    const weekday = WEEKDAY_FULL[lg][(d.getUTCDay() + 6) % 7];
    const day = d.getUTCDate();
    const month = MONTH_NAMES[lg][d.getUTCMonth()];
    const year = d.getUTCFullYear();
    return `${weekday} ${day} ${month} ${year}`;
  }

  // Short "12 mei" / "12 May" / "12 mai" form (no weekday, no year) — used
  // only for the compact "earliest check-out" hint next to the calendar
  // (see findEarliestValidCheckout()/renderCalendar() below), where a full
  // written-out date would be needlessly long for a single inline note.
  function formatShortDate(dateISO, lg) {
    if (!dateISO) return "";
    const d = new Date(dateISO + "T00:00:00Z");
    const day = d.getUTCDate();
    const month = MONTH_NAMES[lg][d.getUTCMonth()];
    return `${day} ${month}`;
  }

  function fmtMoneyCents(cents, currency) {
    try {
      return new Intl.NumberFormat(lang === "en" ? "en-IE" : lang, { style: "currency", currency: currency || "EUR" }).format((cents || 0) / 100);
    } catch (e) {
      return `${currency || "EUR"} ${((cents || 0) / 100).toFixed(2)}`;
    }
  }

  // Compact currency string for the calendar day tile (see renderCalendar())
  // — same locale-correct symbol/placement as fmtMoneyCents, but without
  // decimals: a nightly rate reaching the guest calendar has always already
  // been rounded to a whole €5 (see _lib/money.mjs roundNightlyPriceCents),
  // so ".00" never carries information and only costs the tile space it
  // doesn't have to spare.
  function fmtMoneyCentsCompact(cents, currency) {
    try {
      return new Intl.NumberFormat(lang === "en" ? "en-IE" : lang, { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format((cents || 0) / 100);
    } catch (e) {
      return `${Math.round((cents || 0) / 100)}`;
    }
  }

  // ---- URL state (so language-switch links can carry it over) -----------

  function currentStateParams() {
    const p = new URLSearchParams();
    if (selStart) p.set("checkin", selStart);
    if (selEnd) p.set("checkout", selEnd);
    const totalEl = document.getElementById("total-guests");
    const childrenEl = document.getElementById("children");
    if (totalEl) p.set("totalGuests", totalEl.value);
    if (childrenEl) p.set("children", childrenEl.value);
    // The country default depends on the page's OWN language (see
    // DEFAULT_COUNTRY_BY_LANG) — carrying it over unconditionally on a
    // language switch would fight that default. Only an explicit choice the
    // guest actually made themselves is preserved across the switch.
    const countryEl = document.getElementById("guest-address-country");
    if (countryEl && countryManuallyChosen && countryEl.value) p.set("country", countryEl.value);
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

  // Set by restoreStateFromURL() when a `country` param is present, so
  // populateCountrySelect() (called after this, in init()) applies it
  // instead of the page's own language default — and so it counts as an
  // already-manual choice for the NEXT language switch too.
  let pendingCountryFromURL = null;

  function restoreStateFromURL() {
    const p = new URLSearchParams(window.location.search);
    const ci = p.get("checkin"), co = p.get("checkout");
    if (ci && /^\d{4}-\d{2}-\d{2}$/.test(ci)) selStart = ci;
    if (co && /^\d{4}-\d{2}-\d{2}$/.test(co)) selEnd = co;
    const tg = p.get("totalGuests"), c = p.get("children");
    const totalEl = document.getElementById("total-guests");
    const childrenEl = document.getElementById("children");
    if (tg && totalEl) totalEl.value = tg;
    if (c && childrenEl) childrenEl.value = c;
    const countryParam = p.get("country");
    if (countryParam && /^[A-Za-z]{2}$/.test(countryParam)) pendingCountryFromURL = countryParam.toUpperCase();
    if (selStart) {
      const d = new Date(selStart + "T00:00:00Z");
      viewYear = d.getUTCFullYear();
      viewMonth = d.getUTCMonth();
    }
  }

  // ---- Capacity-driven guest selects --------------------------------

  // "Aantal personen" (total guests) + "waarvan kinderen onder 18 jaar"
  // (of which children) — the guest-facing input model matches what
  // quote.mjs/book.mjs now actually accept (see _lib/pricing.mjs
  // derivePartySize()); there is no separate "adults" field anywhere in the
  // form. The children select's own max is re-clamped to the current total
  // guest count every time either select changes, so it's never possible to
  // pick more children than people in the first place.
  function populateGuestSelects() {
    const totalEl = document.getElementById("total-guests");
    const childrenEl = document.getElementById("children");
    if (totalEl) {
      const prev = totalEl.value;
      totalEl.innerHTML = "";
      for (let i = 1; i <= capacity.maxTotalGuests; i++) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = String(i);
        if (String(i) === prev) opt.selected = true;
        totalEl.appendChild(opt);
      }
      if (!prev) {
        const preferred = Math.min(4, capacity.maxTotalGuests);
        totalEl.value = String(preferred);
      }
    }
    populateChildrenSelect();
    checkCapacity();
  }

  // Rebuilds the children select's option range (0..min(maxChildren,
  // totalGuests)) without discarding a still-valid current value, and clamps
  // it down when the total guest count just shrank below it.
  function populateChildrenSelect() {
    const totalEl = document.getElementById("total-guests");
    const childrenEl = document.getElementById("children");
    if (!childrenEl) return;
    const total = totalEl ? Number(totalEl.value) || 1 : capacity.maxTotalGuests;
    const maxChildren = Math.min(capacity.maxChildren, total);
    const prev = childrenEl.value;
    childrenEl.innerHTML = "";
    for (let i = 0; i <= maxChildren; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = String(i);
      childrenEl.appendChild(opt);
    }
    // An empty `prev` (the very first render, before the guest has ever
    // touched this field) must resolve to an explicit "0", not the empty
    // string — assigning "" here would match no <option>, leaving the
    // select showing blank (selectedIndex -1) even though 0 children is
    // already the effective value used everywhere else (getPartySize()/
    // derivePartySize() both treat a blank value as 0). Purely cosmetic —
    // no quote ever came out wrong — but a blank-looking field right next
    // to a populated "total guests" field reads as broken.
    if (prev === "") {
      childrenEl.value = "0";
    } else {
      childrenEl.value = Number(prev) <= maxChildren ? prev : String(maxChildren);
    }
  }

  // Builds the country <select>'s options: Aernoud's fixed top-8 order
  // first, then a divider, then every other country alphabetically BY NAME
  // IN THE CURRENT INTERFACE LANGUAGE (so the NL page sorts Dutch names,
  // etc.) — matches _lib/countries.mjs's COUNTRIES data exactly (same
  // codes, same three names) so the server always recognizes whatever code
  // this select actually submits.
  let countryManuallyChosen = false; // true once the guest picks one themselves (not the language default)
  function nameForLang(row) {
    return lang === "fr" ? row[2] : lang === "nl" ? row[3] : row[1];
  }
  function populateCountrySelect() {
    const el = document.getElementById("guest-address-country");
    if (!el) return;
    const prev = el.value;
    el.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = STRINGS[lang].countryPlaceholder;
    placeholder.disabled = true;
    el.appendChild(placeholder);

    const topRows = TOP_COUNTRY_CODES.map((code) => COUNTRIES.find((r) => r[0] === code)).filter(Boolean);
    for (const row of topRows) {
      const opt = document.createElement("option");
      opt.value = row[0];
      opt.textContent = nameForLang(row);
      el.appendChild(opt);
    }
    const divider = document.createElement("option");
    divider.disabled = true;
    divider.textContent = "──────────";
    el.appendChild(divider);

    const rest = COUNTRIES.filter((r) => !TOP_COUNTRY_CODES.includes(r[0]))
      .slice()
      .sort((a, b) => nameForLang(a).localeCompare(nameForLang(b), lang === "en" ? "en" : lang));
    for (const row of rest) {
      const opt = document.createElement("option");
      opt.value = row[0];
      opt.textContent = nameForLang(row);
      el.appendChild(opt);
    }

    if (pendingCountryFromURL && COUNTRIES.some((r) => r[0] === pendingCountryFromURL)) {
      // Carried over from a language switch where the guest had already
      // chosen a country themselves — restore it, and treat it as manually
      // chosen from here on too (so switching language AGAIN still keeps
      // it, rather than reverting to a default after one hop).
      el.value = pendingCountryFromURL;
      countryManuallyChosen = true;
    } else if (prev) {
      el.value = prev;
    } else {
      // No value yet — apply the language's own default. This does NOT
      // count as the guest manually choosing a country, so a later language
      // switch is still free to change it again.
      el.value = DEFAULT_COUNTRY_BY_LANG[lang] || "";
      countryManuallyChosen = false;
    }
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
    const totalEl = document.getElementById("total-guests");
    const row = totalEl && totalEl.closest(".form-grid-2");
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
    const { totalGuests, children, adults } = getPartySize();
    // Mirrors calculateQuote()'s own CAPACITY_EXCEEDED check (see
    // _lib/pricing.mjs) so the guest sees the same rule before ever sending
    // a request, not just after a rejected quote. The selects themselves
    // already keep totalGuests<=maxTotalGuests and children<=min(maxChildren,
    // totalGuests) structurally — this also catches the derived-adults edge
    // case (adults = totalGuests - children exceeding maxAdults).
    const invalid =
      totalGuests > capacity.maxTotalGuests ||
      children > capacity.maxChildren ||
      children > totalGuests ||
      adults > capacity.maxAdults;
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
    // Collects the effective minimum-stay (per-date override, falling back
    // to the site-wide default) for every non-past day actually shown in
    // this month, so the note below can say something true about THIS
    // view instead of a single global number that can contradict the
    // period actually on screen (flagged bug: a generic "minimum 5 nights"
    // note next to a month that's really a 30-night-minimum winter period).
    const viewMinNightsValues = new Set();
    for (let i = 0; i < leadingBlanks; i++) {
      html += `<div class="day" style="color: var(--text-dim);"></div>`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateISO = iso(viewYear, viewMonth, d);
      const isPast = dateISO < today;
      if (!isPast) viewMinNightsValues.add(minNightsByDate[dateISO] ?? defaultMinNights);
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
      // isValidCheckout() (see above) is the single source of truth: every
      // interior night free, both ends Saturday if the stay reaches a
      // high-season night, AND the stay is long enough (the site's ordinary
      // minimum-stay rule, or the narrow four-night-gap exception) — exactly
      // what calculateQuote() itself would accept or reject. A checkout
      // candidate that fails ANY of these must never look the same as one
      // that passes (see invalidCheckoutCandidate below) — this is what
      // fixes "picking an arrival left almost every later day looking
      // exactly as available as a real valid check-out".
      const validAsCheckout = isCandidateCheckout && isValidCheckout(selStart, dateISO);
      // A checkout candidate that ISN'T already going to render with its own
      // dark/disabled look for an unrelated reason (booked, held, an
      // owner-block) but still fails isValidCheckout() above — because a
      // night in between is unavailable, the stay doesn't reach the
      // required minimum length, or high season demands Saturday-to-
      // Saturday and this pair doesn't qualify — needs that SAME dark,
      // non-clickable treatment. Reason precedence mirrors how a guest would
      // actually diagnose it: an unavailable night in between first, then
      // the Saturday-turnover rule, then plain minimum-stay.
      const invalidCheckoutCandidate =
        isCandidateCheckout && !isOwnBlocked && !isBusy && !isPending && !isNoPrice && !validAsCheckout;
      let invalidCheckoutReason = "";
      if (invalidCheckoutCandidate) {
        if (!rangeIsFree(selStart, dateISO)) invalidCheckoutReason = t.checkoutRangeBlocked;
        else if (rangeNeedsSaturdayTurnover(selStart, dateISO) && !(isSaturdayISO(selStart) && isSaturdayISO(dateISO)))
          invalidCheckoutReason = t.checkoutSaturdayOnly;
        else invalidCheckoutReason = t.checkoutMinStay(minNightsByDate[selStart] ?? defaultMinNights);
      }

      // Whether this cell is being considered as a brand-new ARRIVAL pick
      // (no selection yet, or restarting one) rather than as the checkout
      // completing an in-progress selection — computed here (rather than
      // only later) so both the style and the high-season gating below can
      // use it.
      const startingFresh = !selStart || selEnd || dateISO <= selStart;
      // High season (Saturday-turnover): a night flagged from /admin means
      // any stay touching it must start AND end on a Saturday. As an
      // ARRIVAL candidate that means only Saturdays are offered at all —
      // every other high-season day is shown but disabled, exactly per
      // spec ("toon vooraf alleen geldige aankomstzaterdagen... overige
      // hoogseizoendagen uitgeschakeld"). This only applies while picking a
      // fresh arrival; once mid-selection, checkoutSpansHighSeason above is
      // what actually governs which dates are valid checkouts.
      const isHighSeasonNight = saturdayTurnoverNights.has(dateISO);
      const highSeasonArrivalBlocked =
        startingFresh && !isPast && !isBusy && !isPending && !isNoPrice && !isOwnBlocked &&
        isHighSeasonNight && !isSaturdayISO(dateISO);
      const highSeasonSaturdayArrival =
        startingFresh && !isPast && !isBusy && !isPending && !isNoPrice && !isOwnBlocked &&
        isHighSeasonNight && isSaturdayISO(dateISO);

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
        if (isOwnBlocked || isBusy) statusWord = t.dayUnavailable;
        else if (isNoPrice) statusWord = t.dayNoPrice;
      } else if (isOwnBlocked || isBusy) {
        // Deliberately ONE neutral look and ONE neutral word for every
        // reason a night isn't bookable — an owner's own-use block
        // (isOwnBlocked) and a busy night from the Airbnb/confirmed-
        // bookings feed (isBusy) used to read as two different *kinds* of
        // booking ("owner's own use" vs "booked (per our Airbnb
        // calendar)"). That was never actually knowable from the guest
        // side: a block synced from the Airbnb feed isn't necessarily an
        // Airbnb-made booking, and the owner doesn't track "own use"
        // separately from any other reason a night might be blocked. The
        // real distinction (own block vs. synced/confirmed booking) still
        // exists and still matters internally — see admin/admin.js's own
        // calendar, which keeps it — this is only about not asserting a
        // reason to the guest that the data can't actually back up.
        style = "background: var(--bg-panel); color: var(--text-dim); text-decoration: line-through;";
        statusWord = t.dayUnavailable;
        if (validAsCheckout) style += "cursor:pointer;border:1px dashed var(--gold-soft);";
      } else if (isPending) {
        style = "background: var(--bg-panel); color: var(--text-dim); border: 1px dashed var(--gold-soft);";
        statusWord = t.dayRequested;
      } else if (isNoPrice) {
        style = "color: var(--text-dim); border: 1px dashed var(--line-strong); opacity: 0.55;";
        statusWord = t.dayNoPrice;
        if (validAsCheckout) style += "cursor:pointer;";
      } else if (highSeasonArrivalBlocked) {
        // Free, priced, otherwise-bookable night — just not a valid ARRIVAL
        // during high season because it isn't a Saturday. Deliberately
        // distinct from "booked"/"no price": dashed gold border rather than
        // the rust "occupied" look, since nothing is actually wrong with the
        // date itself, only with starting a stay on it.
        style = "color: var(--text-dim); border: 1px dashed var(--gold-soft); opacity: 0.6;";
        statusWord = t.dayHighSeasonWeekday;
      } else if (invalidCheckoutCandidate) {
        // Same dark/disabled treatment as a booked or held night — this
        // date IS otherwise free and priced, but given the arrival already
        // picked, it isn't a check-out the server would accept either (see
        // isValidCheckout()/meetsMinNights() above). Without this branch
        // these dates fell through to the ordinary "available" look below,
        // which is exactly the reported bug: after picking an arrival,
        // almost every later day still looked identically bookable.
        // Explicit background (the same darker panel tone busy/owner-
        // blocked nights use, NOT --bg-available's lighter gold-brown) and
        // cursor: not-allowed were added after a live report that this
        // treatment still read as "looks clickable" at a glance — opacity
        // and line-through alone were too subtle against this dark theme's
        // default tile look. This must never again visually match the
        // plain "available" style above.
        style = "background: var(--bg-panel); color: var(--text-dim); border: 1px dashed var(--line-strong); opacity: 0.55; text-decoration: line-through; cursor: not-allowed;";
        statusWord = t.dayUnavailable;
      } else if (inSelectedRange) {
        style = "background: var(--gold); color: #1a1408; font-weight: 600; cursor:pointer;";
      } else if (highSeasonSaturdayArrival) {
        // "Iets lichter en aanklikbaar" — a valid high-season arrival
        // Saturday: same available fill, but a gold outline calls it out
        // among the disabled weekdays around it.
        style = "border:1px solid var(--gold-soft);background:var(--bg-available);cursor:pointer;";
      }

      // Clickable as a NEW start (no active selection, or completing one
      // already finished) requires a genuinely free, not-owner-blocked
      // arrival night that isn't blocked by the high-season Saturday-only
      // rule above. Clickable as the CHECKOUT that completes an in-progress
      // selection only needs validAsCheckout (every interior night free,
      // both ends Saturday if the stay reaches a high-season night, AND the
      // resulting length actually meets the minimum-stay rule or its
      // four-night-gap exception) — the departure date itself, and whether
      // it happens to have a price, is irrelevant (the guest never stays
      // that night). This is the fix for "can't select checkout on the day
      // the next guest arrives, or on an unpriced date" — and, together with
      // validAsCheckout's own minimum-stay check above, for "almost every
      // day still looked clickable/available right after picking an
      // arrival, even ones far too short or on the wrong side of the
      // Saturday-turnover rule". `!isOwnBlocked` was missing here before:
      // an owner-blocked date already rendered with the dark "unavailable"
      // look, but could still be picked as a fresh arrival start.
      const clickable = !isPast && (startingFresh ? (!isBusy && !isOwnBlocked && !isNoPrice && !highSeasonArrivalBlocked) : validAsCheckout);
      const dateObj = new Date(dateISO + "T00:00:00Z");
      const weekday = WEEKDAY_ABBR[lang][(dateObj.getUTCDay() + 6) % 7];
      const edgeSuffix = isRangeEdge
        ? dateISO === selStart
          ? " — " + (lang === "nl" ? "aankomst" : lang === "fr" ? "arrivée" : "check-in")
          : " — " + (lang === "nl" ? "vertrek" : lang === "fr" ? "départ" : "check-out")
        : "";
      // Every day that genuinely has a price and isn't past/unavailable/
      // held/not-yet-priced shows that price directly on the tile, together
      // with the effective minimum-stay length for that date — always, not
      // only where it differs from the site default (explicit choice: a
      // guest reads the calendar day by day, not as a once-per-month
      // aggregate — see the plain-language note above the calendar for
      // that aggregate view, which this doesn't replace).
      const isPriceRelevant = !isPast && !isOwnBlocked && !isBusy && !isPending && !isNoPrice;
      const tilePriceCents = isPriceRelevant ? pricesByDate[dateISO] : null;
      const effectiveMinNights = minNightsByDate[dateISO] ?? defaultMinNights;
      const hasTilePrice = isPriceRelevant && tilePriceCents != null;
      // Accessible text mirrors exactly what's visually on a priced tile —
      // a screen-reader user hears the same nightly price and minimum stay
      // a sighted guest sees, not only the override-only text this used to
      // carry.
      const priceSuffix = hasTilePrice ? t.tilePriceSuffix(fmtMoneyCentsCompact(tilePriceCents, calendarCurrency)) : "";
      const minSuffix = hasTilePrice ? t.minStaySuffix(effectiveMinNights) : "";
      // Spoken/announced explicitly for an invalid checkout candidate (see
      // invalidCheckoutCandidate above) — a screen-reader user gets the same
      // "why can't I pick this" answer a sighted guest sees from the dark
      // tile, instead of just hearing "available" while it's actually
      // aria-disabled.
      const checkoutReasonSuffix = invalidCheckoutReason ? `, ${invalidCheckoutReason}` : "";
      const dayLabel = `${weekday} ${d} ${MONTH_NAMES[lang][viewMonth]}, ${statusWord}${edgeSuffix}${checkoutReasonSuffix}${priceSuffix}${minSuffix}`;
      const titleBits = [];
      if (priceSuffix) titleBits.push(priceSuffix.replace(/^, /, ""));
      if (minSuffix) titleBits.push(minSuffix.replace(/^, /, ""));
      const titleAttr = titleBits.length ? ` title="${titleBits.join(" · ")}"` : "";
      // Two price spans (full locale-correct format, and bare digits) are
      // both always in the markup — CSS alone toggles which one is visible
      // per breakpoint (see assets/style.css), so the tile's real content
      // never depends on a JS resize listener. aria-hidden on all three
      // extra spans: the same information is already the tile's own
      // aria-label above, so a screen reader isn't told it twice.
      const tileInner = hasTilePrice
        ? `<span class="d-num">${d}</span>` +
          `<span class="d-price d-price-full" aria-hidden="true">${fmtMoneyCentsCompact(tilePriceCents, calendarCurrency)}</span>` +
          `<span class="d-price d-price-compact" aria-hidden="true">${Math.round(tilePriceCents / 100)}</span>` +
          `<span class="d-min" aria-hidden="true">${effectiveMinNights}n</span>`
        : `${d}`;
      const tileClass = hasTilePrice ? "day has-price" : "day";
      html += `<div class="${tileClass}" role="gridcell" data-date="${dateISO}" style="${style}"${titleAttr} ${clickable ? `tabindex="0" onclick="AE_BOOKING.pickDate('${dateISO}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();AE_BOOKING.pickDate('${dateISO}')}"` : `tabindex="-1"`} aria-label="${dayLabel}" aria-disabled="${!clickable}">${tileInner}</div>`;
    }
    grid.setAttribute("role", "grid");
    grid.innerHTML = html;

    // checkin/checkout are <div>s (not <input>s) specifically so a long
    // written-out date can wrap on narrow screens instead of being clipped
    // — see reserve.html. Setting .value on a <div> is a silent no-op, so
    // this must be .textContent. The &nbsp; keeps the field's height stable
    // (min-height alone collapses in some browsers) when nothing is picked
    // yet.
    const checkinInput = document.getElementById("checkin");
    const checkoutInput = document.getElementById("checkout");
    if (checkinInput) checkinInput.textContent = selStart ? formatLongDate(selStart, lang) : " ";
    if (checkoutInput) checkoutInput.textContent = selEnd ? formatLongDate(selEnd, lang) : " ";

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
      // Once an arrival is picked (whether or not a check-out is chosen
      // yet), this note becomes selection-specific — it's the concrete
      // answer to "why are the next few days dark, and when CAN I check
      // out" — rather than the generic month-level figure, which would
      // otherwise sit right next to disabled tiles without explaining them.
      // The color always resets to the normal (non-error) tone here: any
      // one-off error text a submit attempt wrote into this same element
      // (see submitBooking()/pickDate() below) is only ever meant to last
      // until the next render, exactly like #ae-booking-status's own
      // isError styling.
      minStayNoteEl.setAttribute("aria-live", "polite");
      minStayNoteEl.style.color = "var(--text-dim)";
      minStayNoteEl.innerHTML = "";
      if (selStart) {
        const arrivalMinNights = minNightsByDate[selStart] ?? defaultMinNights;
        const noteText = selEnd
          ? "" // a complete selection already shows its own night count/price — no extra note needed
          : (() => {
              const earliest = findEarliestValidCheckout(selStart);
              return earliest
                ? t.minStayFromDate(arrivalMinNights, formatShortDate(earliest, lang))
                : t.minStayFromDateUnknown(arrivalMinNights);
            })();
        const clearLink = `<a href="#" onclick="AE_BOOKING.clearSelection();return false;" style="color: var(--gold); text-decoration: underline; margin-left: 8px; white-space: nowrap;">${t.clearSelectionLink}</a>`;
        minStayNoteEl.innerHTML = `<span>${noteText}</span>${clearLink}`;
      } else {
        // No selection at all yet — back to the generic month-level figure,
        // exactly as before. Exactly one effective minimum across every
        // visible day this month (including the common "no override
        // anywhere" case, where the set holds only defaultMinNights) → safe
        // to state it. More than one value means this month itself mixes
        // periods with different minimums (e.g. a shoulder period turning
        // into the winter 30-night minimum) — a single generic number would
        // be actively wrong for part of the month, so say nothing here and
        // let each day's own tooltip/aria-label (minStaySuffix, set
        // per-date above) carry the real figure instead.
        const uniform = viewMinNightsValues.size === 1 ? [...viewMinNightsValues][0] : null;
        minStayNoteEl.textContent = uniform && uniform > 1 ? t.minStayNote(uniform) : "";
      }
    }

    const prevBtn = document.querySelector('[onclick="AE_BOOKING.prevMonth()"]');
    const nextBtn = document.querySelector('[onclick="AE_BOOKING.nextMonth()"]');
    if (prevBtn) prevBtn.setAttribute("aria-label", t.prevMonth);
    if (nextBtn) nextBtn.setAttribute("aria-label", t.nextMonth);

    refreshQuote();
  }

  // Writes into the same #ae-cal-minstay-note element renderCalendar() uses
  // for its own selection-state note, right NEXT TO the calendar — never a
  // browser alert() (jarring, and blocks further interaction) and never
  // only #ae-booking-status at the bottom of the form, below the personal-
  // data fields, which is where a date-selection problem used to surface.
  // Called after renderCalendar() so it overrides whatever note that render
  // pass just set.
  function showCalendarNote(msg, isError) {
    const el = document.getElementById("ae-cal-minstay-note");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "#d98c8c" : "var(--text-dim)";
  }

  function pickDate(dateISO) {
    if (!availabilityOk) return; // defense in depth — the grid shouldn't render clickable cells at all in this state
    if (!selStart || (selStart && selEnd) || dateISO <= selStart) {
      selStart = dateISO;
      selEnd = null;
      renderCalendar();
    } else {
      // Defense in depth: mirrors exactly what renderCalendar() already
      // required for this date's tile to be clickable at all (see
      // isValidCheckout() above — range-free, Saturday-turnover, AND
      // minimum-stay, not just range-free) — so even a stale render or a
      // race between two rapid clicks can never complete a selection the
      // calendar didn't actually offer as valid. In normal use this
      // "else" branch is unreachable (an invalid date never renders as
      // clickable in the first place — see isCandidateCheckout/
      // invalidCheckoutCandidate in renderCalendar()), but a rejected
      // attempt is still reported right next to the calendar, not via a
      // blocking alert(), and the guest's OLD selection is kept exactly as
      // it was rather than silently restarting from the rejected date.
      if (isValidCheckout(selStart, dateISO)) {
        selEnd = dateISO;
        renderCalendar();
      } else {
        renderCalendar();
        showCalendarNote(STRINGS[lang].rangeUnavailable, true);
      }
    }
  }

  // Lets the guest abandon an in-progress or completed date selection
  // without having to hunt for a specific "undo" date to click — wired to
  // the "Clear selection" / "Selectie wissen" / "Effacer la sélection" link
  // renderCalendar() shows next to the calendar as soon as an arrival is
  // picked (see the ae-cal-minstay-note block above).
  function clearSelection() {
    selStart = null;
    selEnd = null;
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
      const res = await fetch("/.netlify/functions/availability", { cache: "no-store" });
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
      // Same "must not break on an older/rolling deploy" reasoning as
      // ownBlockedNights above — an absent field just means no high-season
      // Saturday-turnover restriction is surfaced (every date behaves as it
      // did before this feature existed), never a fail-closed error.
      saturdayTurnoverNights = new Set(Array.isArray(data.saturdayTurnoverNights) ? data.saturdayTurnoverNights : []);
      minNightsByDate = data.minNightsByDate || {};
      // Same "must not break on an older/rolling deploy" reasoning as
      // ownBlockedNights/saturdayTurnoverNights above — an absent field
      // just means no per-tile price is shown yet (the calendar still
      // behaves exactly as before this feature existed), never a
      // fail-closed error.
      pricesByDate = data.pricesByDate && typeof data.pricesByDate === "object" ? data.pricesByDate : {};
      if (data.currency) calendarCurrency = data.currency;
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
    const totalEl = document.getElementById("total-guests");
    const childrenEl = document.getElementById("children");
    const totalGuests = totalEl ? Number(totalEl.value) : 1;
    const children = childrenEl ? Number(childrenEl.value) : 0;
    // Client-side mirror of derivePartySize() (_lib/pricing.mjs) purely for
    // display/capacity-check purposes — the server derives and validates
    // this itself from the same totalGuests/children pair, never trusting
    // this value.
    return { totalGuests, children, adults: Math.max(0, totalGuests - children) };
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

    const { totalGuests, children } = getPartySize();
    const mySeq = ++quoteRequestSeq;
    breakdown.style.opacity = "0.5";

    try {
      const params = new URLSearchParams({ checkin: selStart, checkout: selEnd, totalGuests, children });
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
    else if (data && data.code === "SATURDAY_TURNOVER_REQUIRED") msg = t.saturdayTurnoverRequired;
    else if (data && data.code === "CHILDREN_EXCEED_TOTAL") msg = t.childrenExceedTotal;
    breakdown.innerHTML = `<span style="color: #d98c8c;">${msg}</span>`;
  }

  // q.perNight is one {date, priceCents} entry per night booked (see
  // _lib/pricing.mjs) — always in stay order. Grouping consecutive nights
  // that share the exact same rate into a single "N nights × rate" row (per
  // the nightly price breakdown by rate-period requirement) rather than one
  // line per night, which would be unreadable for anything longer than a
  // week and would also obscure a stay that spans a price change.
  function groupPerNightRuns(perNight) {
    const runs = [];
    for (const n of perNight) {
      const last = runs[runs.length - 1];
      if (last && last.priceCents === n.priceCents) {
        last.count++;
      } else {
        runs.push({ priceCents: n.priceCents, count: 1 });
      }
    }
    return runs;
  }

  function renderPriceBreakdown(q) {
    const breakdown = document.getElementById("ae-price-breakdown");
    if (!breakdown) return;
    const t = STRINGS[lang];
    const row = (label, value, opts) => `
      <div style="display: flex; justify-content: space-between; font-size: 13.5px; color: ${opts && opts.dim ? "var(--text-dim)" : "var(--text)"}; padding: 3px 0;">
        <span>${label}</span><span>${value}</span>
      </div>`;

    const totalGuests = q.adults + q.children;
    let html = `<div style="font-size: 12.5px; color: var(--text-dim); margin-bottom: 8px;">${t.partyComposition(q.adults, q.children, totalGuests)}</div>`;
    for (const run of groupPerNightRuns(q.perNight)) {
      html += row(t.rentGroup(run.count, fmtMoneyCents(run.priceCents, q.currency)), fmtMoneyCents(run.priceCents * run.count, q.currency), { dim: true });
    }
    if (q.fourNightGapException) {
      html += `<div style="font-size: 11.5px; color: var(--gold); margin: 2px 0 4px; padding-left: 2px; line-height: 1.5;">${t.fourNightGapNotice}</div>`;
    }
    if (q.discountKind) {
      const label = q.discountKind === "month" ? t.discountMonth : t.discountWeek;
      html += row(`${label} (-${q.discountPercent}%)`, `-${fmtMoneyCents(q.discountAmountCents, q.currency)}`, { dim: true });
      html += row(t.rentAfterDiscount, fmtMoneyCents(q.rentalAfterDiscountCents, q.currency), { dim: true });
    }
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
      // A date-selection problem is shown right next to the calendar —
      // NOT only via #ae-booking-status at the bottom of the form, below
      // the personal-data fields, which is where this used to surface
      // (the guest would submit, then have to scroll back up past their
      // own name/email/phone to find out the calendar itself needed more
      // input).
      showCalendarNote(t.pickBothDates, true);
      showStatus("", false);
      return false;
    }
    const name = document.getElementById("guest-name").value.trim();
    const email = document.getElementById("guest-email").value.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showStatus(t.fillNameEmail, true);
      return false;
    }
    // isValidCheckout() (not just rangeIsFree()) — the same full check
    // renderCalendar()/pickDate() already require for this date pair to
    // ever have been offered as clickable, so a stale selection (e.g. the
    // owner changed the minimum-stay or Saturday-turnover rule from
    // /admin between page load and submit) is caught here too, not only
    // whether the interior nights happen to still be free.
    if (!isValidCheckout(selStart, selEnd)) {
      showCalendarNote(t.rangeUnavailable, true);
      showStatus("", false);
      return false;
    }
    const termsEl = document.getElementById("terms-accept");
    if (termsEl && !termsEl.checked) {
      // Right next to the checkbox itself (#ae-terms-note), not only the
      // generic #ae-booking-status message below the submit button — a
      // guest scanning the form for why nothing happened should see the
      // reason exactly where the checkbox is.
      showTermsNote(t.termsRequired, true);
      showStatus("", false);
      termsEl.focus();
      return false;
    }
    showTermsNote("", false);

    // Address gate — same spot as the terms gate above: fails BEFORE
    // btn.disabled is ever set, so a blocked submit here never leaves the
    // pay button stuck in its "Redirecting…" state; it just doesn't start.
    const addressError = validateAddressClient();
    if (addressError) {
      showAddressNote(addressError, true);
      showStatus("", false);
      return false;
    }
    showAddressNote("", false);

    const { totalGuests, children } = getPartySize();
    const payload = {
      checkin: selStart,
      checkout: selEnd,
      totalGuests,
      children,
      name,
      email,
      phone: document.getElementById("guest-phone").value.trim(),
      message: document.getElementById("guest-message") ? document.getElementById("guest-message").value.trim() : "",
      lang,
      termsAccepted: termsEl ? termsEl.checked : true,
      addressLine1: document.getElementById("guest-address-line1")?.value.trim() || "",
      addressLine2: document.getElementById("guest-address-line2")?.value.trim() || "",
      postalCode: document.getElementById("guest-address-postal")?.value.trim() || "",
      city: document.getElementById("guest-address-city")?.value.trim() || "",
      country: document.getElementById("guest-address-country")?.value || "",
    };

    btn.disabled = true;
    btn.textContent = t.redirecting;
    showStatus("", false);

    // Stop waiting indefinitely, but do not assume aborting the browser
    // request cancelled server-side work: a temporary hold may already exist.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch("/.netlify/functions/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (data.code === "DATES_UNAVAILABLE") throw new Error(t.rangeUnavailable);
        if (data.code === "MIN_NIGHTS_NOT_MET") throw new Error(t.minNights(data.details.requiredNights));
        if (data.code === "RATE_MISSING") throw new Error(t.rateMissing);
        if (data.code === "DATE_BLOCKED") throw new Error(t.dateBlocked);
        if (data.code === "CAPACITY_EXCEEDED") throw new Error(t.capacityExceeded(data.details));
        if (data.code === "ARRIVAL_DAY_NOT_ALLOWED") throw new Error(t.arrivalDayNotAllowed);
        if (data.code === "SATURDAY_TURNOVER_REQUIRED") throw new Error(t.saturdayTurnoverRequired);
        if (data.code === "CHILDREN_EXCEED_TOTAL") throw new Error(t.childrenExceedTotal);
        if (data.code === "TERMS_NOT_ACCEPTED") {
          const termsErr = new Error(t.termsRequired);
          termsErr.isTermsError = true;
          throw termsErr;
        }
        // Same address validation book.mjs runs (see _lib/countries.mjs) —
        // reached here only if it somehow disagreed with the client-side
        // check above (a stale page, a country list that changed, etc.).
        // Shown right next to the address fields either way, never as a
        // generic failure at the bottom of the form.
        const ADDRESS_CODES = {
          ADDRESS_LINE1_REQUIRED: t.addressLine1Required,
          ADDRESS_CITY_REQUIRED: t.addressCityRequired,
          ADDRESS_COUNTRY_REQUIRED: t.addressCountryRequired,
          ADDRESS_POSTAL_CODE_REQUIRED: t.addressPostalCodeRequired,
          ADDRESS_POSTAL_CODE_INVALID: t.addressPostalCodeInvalid,
        };
        if (ADDRESS_CODES[data.code]) {
          const addrErr = new Error(ADDRESS_CODES[data.code]);
          addrErr.isAddressError = true;
          throw addrErr;
        }
        throw new Error(data.error || t.errorGeneric);
      }
      // Full-page navigation to Stripe's own hosted Checkout page — payment
      // happens there, never on this site. The booking is only ever
      // confirmed later, via stripe-webhook.mjs, once Stripe verifies the
      // payment actually succeeded; this redirect itself confirms nothing.
      openHostedCheckout(data.checkoutUrl);
      return false;
    } catch (e) {
      // Restore a usable form. A timed-out request can have created a hold;
      // it must never be reported as proof that nothing happened server-side.
      if (e.isTermsError) {
        showTermsNote(e.message || t.termsRequired, true);
        showStatus("", false);
      } else if (e.isAddressError) {
        showAddressNote(e.message || t.errorGeneric, true);
        showStatus("", false);
      } else if (e.name === "AbortError") {
        showStatus(t.connectionTimeout, true);
      } else {
        showStatus(e.message || t.errorGeneric, true);
      }
      btn.disabled = false;
      btn.textContent = t.submitPay || t.submit;
    } finally {
      clearTimeout(timeoutId);
    }
    return false;
  }

  function openHostedCheckout(checkoutUrl) {
    const url = new URL(checkoutUrl);
    if (url.origin !== "https://checkout.stripe.com" || url.username || url.password) {
      throw new Error(STRINGS[lang].errorGeneric);
    }
    if (!window.parent || window.parent === window) {
      window.location.href = url.href;
      return;
    }
    // Hosted Checkout must leave the iframe. Ask the trusted WordPress
    // parent to navigate itself; browsers can block cross-origin top-navigation
    // after the asynchronous request has consumed the original user gesture.
    const status = document.getElementById("ae-booking-status");
    if (status) {
      status.textContent = "";
      const link = document.createElement("a");
      link.href = url.href;
      link.target = "_top";
      link.rel = "noopener";
      link.textContent = STRINGS[lang].submitPay;
      status.appendChild(link);
    }
    // A real link remains available if the parent listener is absent or
    // navigation is blocked; following it reuses the same Stripe session.
    window.parent.postMessage({ aeSource: "ae-booking-embed", type: "ae-checkout", checkoutUrl: url.href }, "https://ancienne-ecole.rent");
  }

  function showStatus(msg, isError) {
    const el = document.getElementById("ae-booking-status");
    if (!el) return;
    el.textContent = msg;
    el.setAttribute("role", isError ? "alert" : "status");
    el.style.color = isError ? "#d98c8c" : "var(--text-dim)";
  }

  // Writes into #ae-terms-note, right next to the terms checkbox itself —
  // not only #ae-booking-status below the submit button — so a guest who
  // hasn't accepted the terms sees why submission was blocked exactly where
  // the checkbox is, not somewhere else on the page.
  function showTermsNote(msg, isError) {
    const el = document.getElementById("ae-terms-note");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "#d98c8c" : "var(--text-dim)";
  }

  // Same idea as showTermsNote() — right next to the address fields, not
  // only the generic #ae-booking-status message below the pay button.
  function showAddressNote(msg, isError) {
    const el = document.getElementById("ae-address-note");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "#d98c8c" : "var(--text-dim)";
  }

  // Postal code is only REQUIRED where the selected country actually uses
  // one (see COUNTRIES_WITHOUT_POSTAL_CODE) — this just relabels the field
  // so the guest isn't left guessing why it's blank-friendly for some
  // countries; validateAddressClient()/book.mjs's own validateAddress() are
  // what actually enforce it either way.
  function updatePostalCodeOptionalHint() {
    const countryEl = document.getElementById("guest-address-country");
    const labelEl = document.getElementById("ae-postal-code-label");
    if (!countryEl || !labelEl) return;
    const t = STRINGS[lang];
    const optional = COUNTRIES_WITHOUT_POSTAL_CODE.has(countryEl.value);
    labelEl.textContent = optional ? t.postalCodeOptionalLabel : t.postalCodeLabel;
    const postalEl = document.getElementById("guest-address-postal");
    if (postalEl) postalEl.required = !optional;
  }

  // Mirrors _lib/countries.mjs's validateAddress() exactly, for immediate
  // client-side feedback — book.mjs re-runs the authoritative version of
  // this same check server-side before ever creating a Checkout Session, so
  // nothing here is trusted on its own. Returns a translated message, or
  // null if the address is complete.
  function validateAddressClient() {
    const t = STRINGS[lang];
    const line1 = document.getElementById("guest-address-line1")?.value.trim() || "";
    const city = document.getElementById("guest-address-city")?.value.trim() || "";
    const postalCode = document.getElementById("guest-address-postal")?.value.trim() || "";
    const country = document.getElementById("guest-address-country")?.value || "";
    if (!line1) return t.addressLine1Required;
    if (!city) return t.addressCityRequired;
    if (!country || !COUNTRIES.some((r) => r[0] === country)) return t.addressCountryRequired;
    const needsPostal = !COUNTRIES_WITHOUT_POSTAL_CODE.has(country);
    if (needsPostal && !postalCode) return t.addressPostalCodeRequired;
    if (postalCode) {
      const pattern = POSTAL_CODE_PATTERNS[country];
      if (pattern && !pattern.test(postalCode)) return t.addressPostalCodeInvalid;
      if (!pattern && (postalCode.length < 2 || postalCode.length > 12)) return t.addressPostalCodeInvalid;
    }
    return null;
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

  // Handles the guest landing back on this page after Stripe Checkout —
  // either success_url (?booking=<id>&pmt=return) or cancel_url
  // (?booking=<id>&pmt=cancelled), both set by book.mjs. Deliberately named
  // "pmt", not "checkout" — this page already uses a `checkout` query param
  // for the guest's chosen departure DATE (see restoreStateFromURL() above),
  // so reusing that name here would silently collide with it. This redirect
  // itself is NEVER treated as proof of payment (see submitBooking's own
  // comment) — it only decides what to show while the real confirmation
  // (stripe-webhook.mjs) does its work, by polling the minimal, public
  // booking-status.mjs endpoint a few times. Removes the query params
  // afterwards so a page refresh doesn't re-trigger this.
  async function checkPostRedirectStatus() {
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get("booking");
    const pmtParam = params.get("pmt");
    if (!bookingId || !pmtParam) return;

    const t = STRINGS[lang];
    const cleanUrl = () => {
      params.delete("booking");
      params.delete("pmt");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    };

    if (pmtParam === "cancelled") {
      showSuccess(t.paymentNotCompletedTitle, t.paymentNotCompletedBody);
      cleanUrl();
      return;
    }
    if (pmtParam !== "return") return;

    showSuccess(t.confirmingPayment, "");

    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(`/.netlify/functions/booking-status?id=${encodeURIComponent(bookingId)}`);
        const data = await res.json();
        if (res.ok && data.ok) {
          if (data.status === "confirmed" && data.paid) {
            selStart = null;
            selEnd = null;
            const arrival = new Date(data.checkin + "T12:00:00");
            viewYear = arrival.getFullYear();
            viewMonth = arrival.getMonth();
            await loadAvailability();
            showSuccess(t.paymentConfirmedTitle, t.paymentConfirmedBody(data.checkin, data.checkout));
            cleanUrl();
            return;
          }
          if (["payment_expired", "cancelled"].includes(data.status)) {
            showSuccess(t.paymentNotCompletedTitle, t.paymentNotCompletedBody);
            cleanUrl();
            return;
          }
          // Still "awaiting_payment" — the webhook hasn't landed yet (some
          // payment methods settle asynchronously). Keep polling briefly.
        }
      } catch (e) {
        // A transient fetch failure here just means one fewer poll attempt
        // — not worth surfacing as an error to a guest who has, in every
        // realistic case, already actually paid.
      }
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1500));
    }
    // Still not confirmed after polling — payment may be genuinely delayed
    // (async payment method) rather than failed. Say so honestly instead of
    // guessing either way; the confirmation email is the real source of
    // truth once stripe-webhook.mjs catches up.
    showSuccess(t.paymentStillProcessingTitle, t.paymentStillProcessingBody);
    cleanUrl();
  }

  window.AE_BOOKING = {
    init(initLang) {
      lang = ["en", "fr", "nl"].includes(initLang) ? initLang : "en";
      const t = new Date();
      viewYear = t.getFullYear();
      viewMonth = t.getMonth();
      restoreStateFromURL();
      wireLanguageSwitchLinks();
      populateCountrySelect();
      loadAvailability().then(() => checkPostRedirectStatus());

      const totalEl = document.getElementById("total-guests");
      const childrenEl = document.getElementById("children");
      if (totalEl) totalEl.addEventListener("change", () => { populateChildrenSelect(); checkCapacity(); refreshQuote(); });
      if (childrenEl) childrenEl.addEventListener("change", refreshQuote);

      const termsEl = document.getElementById("terms-accept");
      if (termsEl) termsEl.addEventListener("change", () => { if (termsEl.checked) showTermsNote("", false); });

      const countryEl = document.getElementById("guest-address-country");
      if (countryEl) {
        countryEl.addEventListener("change", () => {
          countryManuallyChosen = true;
          updatePostalCodeOptionalHint();
          showAddressNote("", false);
        });
      }
      updatePostalCodeOptionalHint();
    },
    pickDate,
    clearSelection,
    prevMonth: () => changeMonth(-1),
    nextMonth: () => changeMonth(1),
    submit: submitBooking,
  };
})();
