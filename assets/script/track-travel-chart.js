
// "Country, City" -> "Country".
function travelCountryName(countryCity) {
  return (countryCity || '').split(',')[0].trim();
}

// Date + Time as one instant, so a same-day round trip nets its real sub-day length.
// Midnight if Time is blank.
function travelInstant(t) {
  const date = new Date(t.date);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = timeToMinutes(t.time) || 0;
  return date.getTime() + minutes * 60000;
}

// Arrival/Departure events to days per country: an Arrival opens a stay, the next
// Departure (whatever country it names) closes it, and a trailing Arrival runs to now.
// Given a birthDate, a leading Departure counts as a stay there since birth, so the
// years before the first trip aren't dropped.
function computeCountryDays(travelEntries, birthDate) {
  const totals = new Map();
  let openCountry = null;
  let openSince = null;
  const closeStay = (until) => {
    const days = Math.max(0, (until - openSince) / MS_PER_DAY);
    totals.set(openCountry, (totals.get(openCountry) || 0) + days);
  };

  const sorted = [...travelEntries].sort((a, b) => a.row - b.row);

  if (birthDate && sorted.length > 0 && sorted[0].type.toLowerCase() === 'departure') {
    const birth = new Date(birthDate);
    if (!Number.isNaN(birth.getTime())) {
      openCountry = travelCountryName(sorted[0].countryCity);
      openSince = birth.getTime();
    }
  }

  sorted.forEach((t) => {
    const instant = travelInstant(t);
    if (instant === null) return;

    if (t.type.toLowerCase() === 'departure') {
      if (openCountry) closeStay(instant);
      openCountry = null;
      openSince = null;
    } else {
      // Anything else is an Arrival (including the sheet's "Arival" spelling).
      openCountry = travelCountryName(t.countryCity);
      openSince = instant;
    }
  });

  if (openCountry) closeStay(Date.now());

  return [...totals.entries()]
    .map(([country, days]) => ({ country, days }))
    .filter((c) => c.country)
    .sort((a, b) => b.days - a.days);
}

function getVisitedCountries(travelEntries) {
  return [...new Set(travelEntries.map((t) => travelCountryName(t.countryCity)).filter(Boolean))];
}

function formatDuration(days) {
  if (days >= 365) return `${(days / 365).toFixed(1)} yrs`;
  if (days >= 1) return `${Math.round(days)} d`;
  return `${Math.round(days * 24)} hr`;
}

// English country names -> ISO 3166-1 alpha-2, for flag emoji; anything missing
// gets a globe (countryFlagEmoji).
const COUNTRY_ISO2 = {
  Afghanistan: 'AF', Albania: 'AL', Algeria: 'DZ', Argentina: 'AR', Armenia: 'AM',
  Australia: 'AU', Austria: 'AT', Azerbaijan: 'AZ', Bahrain: 'BH', Bangladesh: 'BD',
  Belarus: 'BY', Belgium: 'BE', Bolivia: 'BO', Brazil: 'BR', Bulgaria: 'BG',
  Cambodia: 'KH', Cameroon: 'CM', Canada: 'CA', Chile: 'CL', China: 'CN',
  Colombia: 'CO', Croatia: 'HR', Cuba: 'CU', Cyprus: 'CY', Czechia: 'CZ',
  'Czech Republic': 'CZ', Denmark: 'DK', Ecuador: 'EC', Egypt: 'EG', Estonia: 'EE',
  Ethiopia: 'ET', Finland: 'FI', France: 'FR', Georgia: 'GE', Germany: 'DE',
  Ghana: 'GH', Greece: 'GR', 'Hong Kong': 'HK', Hungary: 'HU', Iceland: 'IS',
  India: 'IN', Indonesia: 'ID', Iran: 'IR', Iraq: 'IQ', Ireland: 'IE',
  Israel: 'IL', Italy: 'IT', Japan: 'JP', Jordan: 'JO', Kazakhstan: 'KZ',
  Kenya: 'KE', Kuwait: 'KW', Latvia: 'LV', Lebanon: 'LB', Lithuania: 'LT',
  Luxembourg: 'LU', Malaysia: 'MY', Malta: 'MT', Mexico: 'MX', Mongolia: 'MN',
  Morocco: 'MA', Nepal: 'NP', Netherlands: 'NL', 'New Zealand': 'NZ', Nigeria: 'NG',
  Norway: 'NO', Oman: 'OM', Pakistan: 'PK', Panama: 'PA', Peru: 'PE',
  Philippines: 'PH', Poland: 'PL', Portugal: 'PT', Qatar: 'QA', Romania: 'RO',
  Russia: 'RU', 'Saudi Arabia': 'SA', Serbia: 'RS', Singapore: 'SG', Slovakia: 'SK',
  Slovenia: 'SI', 'South Africa': 'ZA', 'South Korea': 'KR', Spain: 'ES', 'Sri Lanka': 'LK',
  Sweden: 'SE', Switzerland: 'CH', Syria: 'SY', Taiwan: 'TW', Thailand: 'TH',
  Tunisia: 'TN', Turkey: 'TR', Ukraine: 'UA', 'United Arab Emirates': 'AE',
  'United Kingdom': 'GB', 'United States': 'US', Uruguay: 'UY', Uzbekistan: 'UZ',
  Venezuela: 'VE', Vietnam: 'VN', Yemen: 'YE',
};

// U+1F1E6, the Regional Indicator Symbol for "A".
const REGIONAL_INDICATOR_A = 0x1f1e6;

// Regional Indicator Symbol pair for an ISO2 code (e.g. "CA" -> 🇨🇦).
function flagFromIso2(iso2) {
  return [...iso2.toUpperCase()]
    .map((c) => String.fromCodePoint(REGIONAL_INDICATOR_A + c.charCodeAt(0) - 'A'.charCodeAt(0)))
    .join('');
}

function countryFlagEmoji(countryName) {
  const iso2 = COUNTRY_ISO2[countryName];
  return iso2 ? flagFromIso2(iso2) : '🌍';
}

function renderCountryDaysList(countryTotals) {
  const list = document.getElementById('travel-country-days-list');
  list.innerHTML = '';

  if (countryTotals.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'No travel history yet.';
    list.appendChild(empty);
    return;
  }

  countryTotals.forEach((c) => {
    const duration = formatDuration(c.days);
    const item = document.createElement('li');
    item.className = 'country-tile';
    item.title = `${c.country} — ${duration}`;

    const flag = document.createElement('span');
    flag.className = 'country-tile-flag';
    flag.textContent = countryFlagEmoji(c.country);

    const durationSpan = document.createElement('span');
    durationSpan.className = 'country-tile-duration';
    durationSpan.textContent = duration;

    item.append(flag, durationSpan);
    list.appendChild(item);
  });
}

let worldMapChart = null;
let worldTopologyPromise = null;

const WORLD_TOPOLOGY_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

// Fetched once per page session; only which countries are visited changes.
function loadWorldTopology() {
  if (!worldTopologyPromise) {
    worldTopologyPromise = fetch(WORLD_TOPOLOGY_URL)
      .then((res) => res.json());
  }
  return worldTopologyPromise;
}

async function renderWorldMapChart(visitedCountries) {
  const canvas = document.getElementById('travel-world-map-chart');
  const topology = await loadWorldTopology();

  const countries = ChartGeo.topojson.feature(topology, topology.objects.countries).features;
  const visited = new Set(visitedCountries.map((c) => c.toLowerCase()));
  const visitedColor = chartColor('--chart-blue');
  const unvisitedColor = chartColor('--color-border');

  worldMapChart = upsertChart(worldMapChart, canvas, {
    type: 'choropleth',
    data: {
      labels: countries.map((f) => f.properties.name),
      datasets: [{
        label: 'Visited',
        outline: countries,
        data: countries.map((f) => ({
          feature: f,
          value: visited.has((f.properties.name || '').toLowerCase()) ? 1 : 0,
        })),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      showOutline: true,
      showGraticule: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => item.raw.feature.properties.name } },
      },
      scales: {
        projection: { axis: 'x', projection: 'equalEarth' },
        color: {
          axis: 'x',
          display: false,
          legend: { display: false },
          interpolate: (t) => (t >= 1 ? visitedColor : unvisitedColor),
        },
      },
    },
  });
}

