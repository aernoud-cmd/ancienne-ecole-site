// The full ISO 3166-1 country list used by the guest address form's country
// dropdown (assets/booking.js) and, server-side, to resolve a stored
// country CODE back into a display name for admin and the confirmation
// emails (netlify/functions/_lib/notify.mjs, admin-bookings.mjs). Names are
// generated from the "i18n-iso-countries" package's CLDR-derived English/
// French/Dutch locale data (a handful of overly formal official names were
// shortened to their common form — e.g. "Russian Federation" -> "Russia",
// "United States of America" -> "United States" — see the generation notes
// in booking-module-setup.md). This exact array is duplicated, verbatim, as
// COUNTRIES in assets/booking.js — that file is a plain browser script with
// no bundler, so it can't import this module; keep the two in sync if this
// list is ever regenerated (same pattern this codebase already uses for
// WEEKDAY_FULL/MONTH_FULL, duplicated between booking.js and notify.mjs).
//
// Format: [ISO 3166-1 alpha-2 code, English name, French name, Dutch name].
export const COUNTRIES = [
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

// Stable codes are what's actually stored on a booking (never a localized
// name, which can be re-translated later) — this looks one up for display.
// Falls back to the bare code itself if it's ever missing from the list
// (defensive only; every code here comes from the same fixed list the
// dropdown itself is built from).
export function countryName(code, lang = "en") {
  if (!code) return "";
  const row = COUNTRIES.find((r) => r[0] === code);
  if (!row) return code;
  const idx = lang === "fr" ? 2 : lang === "nl" ? 3 : 1;
  return row[idx];
}

// Real-world countries that do not use postal codes at all (a well-known,
// commonly published list — the same countries most carriers/e-commerce
// platforms treat as "no postal code required"). A country NOT in this set
// still only needs a non-empty postal code in some reasonable format; three
// specific groups get a stricter, format-checked pattern below because
// Aernoud gave their exact digit counts.
export const COUNTRIES_WITHOUT_POSTAL_CODE = new Set([
  "AO", "AG", "AW", "BS", "BZ", "BJ", "BW", "BF", "BI", "CM", "CF", "KM",
  "CG", "CD", "CK", "CI", "DJ", "DM", "GQ", "ER", "FJ", "TF", "GM", "GH",
  "GD", "GN", "GY", "HK", "IE", "JM", "KE", "KI", "KP", "LC", "LY", "MO",
  "MW", "ML", "MR", "MU", "MS", "NR", "AN", "NU", "PA", "QA", "RW", "KN",
  "ST", "SC", "SL", "SB", "SO", "SR", "SY", "TZ", "TL", "TG", "TK", "TO",
  "TT", "TV", "UG", "AE", "VU", "YE", "ZW",
]);

// Countries Aernoud gave an exact digit format for. Everything else that
// does need a postal code just needs a non-empty, reasonably-shaped string
// (see validateAddress() below) — never a Dutch-style postcode+house-number
// pairing rule applied globally.
const POSTAL_CODE_PATTERNS = {
  // Alphanumeric, spaces allowed (e.g. "SW1A 1AA", "1234 AB").
  GB: /^[A-Za-z0-9]+(\s?[A-Za-z0-9]+)*$/,
  NL: /^[A-Za-z0-9]+(\s?[A-Za-z0-9]+)*$/,
  // Four digits.
  BE: /^\d{4}$/,
  CH: /^\d{4}$/,
  AT: /^\d{4}$/,
  // Five digits.
  FR: /^\d{5}$/,
  ES: /^\d{5}$/,
  DE: /^\d{5}$/,
};

// One place both book.mjs (server, authoritative) and assets/booking.js
// (client, for immediate feedback) can validate an address against — the
// client copy mirrors this logic but this is the one that actually decides
// whether a booking is accepted. Never invents/derives a field; only checks
// what the guest actually submitted. Returns a code (matching the style of
// every other QuoteError-like rejection in this codebase) or null if valid.
export function validateAddress({ line1, city, postalCode, country }) {
  if (!line1 || !String(line1).trim()) return "ADDRESS_LINE1_REQUIRED";
  if (!city || !String(city).trim()) return "ADDRESS_CITY_REQUIRED";
  if (!country || !COUNTRIES.some((r) => r[0] === country)) return "ADDRESS_COUNTRY_REQUIRED";
  const needsPostal = !COUNTRIES_WITHOUT_POSTAL_CODE.has(country);
  const trimmedPostal = postalCode ? String(postalCode).trim() : "";
  if (needsPostal && !trimmedPostal) return "ADDRESS_POSTAL_CODE_REQUIRED";
  if (trimmedPostal) {
    const pattern = POSTAL_CODE_PATTERNS[country];
    if (pattern && !pattern.test(trimmedPostal)) return "ADDRESS_POSTAL_CODE_INVALID";
    // Generic sanity check for every other country with a postal code —
    // loose on purpose (real-world formats vary widely), just rules out an
    // empty/garbage value slipping past the "required" check above.
    if (!pattern && (trimmedPostal.length < 2 || trimmedPostal.length > 12)) return "ADDRESS_POSTAL_CODE_INVALID";
  }
  return null;
}
