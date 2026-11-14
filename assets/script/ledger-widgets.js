// Dashboard "bulb" widgets: clock, multi-calendar date, Azan times and weather.
// They don't need the sheet, so they start once on page load, not on sign-in.

const DEG2RAD = Math.PI / 180;
const dsin = (deg) => Math.sin(deg * DEG2RAD);
const dcos = (deg) => Math.cos(deg * DEG2RAD);
const darcsin = (x) => Math.asin(x) / DEG2RAD;
const darccos = (x) => Math.acos(Math.max(-1, Math.min(1, x))) / DEG2RAD;
const darctan2 = (y, x) => Math.atan2(y, x) / DEG2RAD;

function fixAngle(angle) {
  const a = angle - 360 * Math.floor(angle / 360);
  return a < 0 ? a + 360 : a;
}

function fixHour(hours) {
  const h = hours - 24 * Math.floor(hours / 24);
  return h < 0 ? h + 24 : h;
}

function hoursToHHMM(hours) {
  const totalMinutes = Math.round(fixHour(hours) * 60);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Julian day number (at 0h UT) for a Gregorian calendar date.
function toJulianDay(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
}

// Sun declination and equation of time (hours) for a Julian day: praytimes.org's
// low-precision formulas, well within a minute.
function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * dsin(g) + 0.02 * dsin(2 * g));
  const e = 23.439 - 0.00000036 * D;

  const RA = darctan2(dcos(e) * dsin(L), dcos(L)) / 15;
  const equation = q / 15 - fixHour(RA);
  const declination = darcsin(dsin(e) * dsin(L));

  return { declination, equation };
}

// Hours between solar noon and the moment the sun is `angle` degrees below
// the horizon, at the given latitude/declination.
function sunAngleHours(angle, lat, declination) {
  const cosH = (-dsin(angle) - dsin(declination) * dsin(lat)) / (dcos(declination) * dcos(lat));
  return darccos(cosH) / 15;
}

// Shia "Tehran" (University of Tehran) method: Fajr at 17.7° below the
// horizon, Maghrib at 4.5° below the horizon (after sunset).
const TEHRAN_FAJR_ANGLE = 17.7;
const TEHRAN_MAGHRIB_ANGLE = 4.5;

function computePrayerTimes({ lat, lon, date, utcOffsetHours }) {
  const jd = toJulianDay(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const sun = sunPosition(jd + 0.5);

  const dhuhr = 12 - sun.equation + utcOffsetHours - lon / 15;
  const fajrOffset = sunAngleHours(TEHRAN_FAJR_ANGLE, lat, sun.declination);
  const maghribOffset = sunAngleHours(TEHRAN_MAGHRIB_ANGLE, lat, sun.declination);
  const fajr = dhuhr - fajrOffset;
  const maghrib = dhuhr + maghribOffset;

  // Midway from Maghrib to the next Fajr; today's Fajr + 24h stands in for tomorrow's.
  const midnight = (maghrib + fajr + 24) / 2;

  return {
    fajr: hoursToHHMM(fajr),
    dhuhr: hoursToHHMM(dhuhr),
    maghrib: hoursToHHMM(maghrib),
    midnight: hoursToHHMM(midnight),
  };
}

// Open-Meteo WMO weather codes -> icon/label.
const WEATHER_CODE_MAP = {
  0: { icon: '☀️', label: 'Clear sky' },
  1: { icon: '🌤️', label: 'Mainly clear' },
  2: { icon: '⛅', label: 'Partly cloudy' },
  3: { icon: '☁️', label: 'Overcast' },
  45: { icon: '🌫️', label: 'Fog' },
  48: { icon: '🌫️', label: 'Fog' },
  51: { icon: '🌦️', label: 'Light drizzle' },
  53: { icon: '🌦️', label: 'Drizzle' },
  55: { icon: '🌦️', label: 'Dense drizzle' },
  56: { icon: '🌧️', label: 'Freezing drizzle' },
  57: { icon: '🌧️', label: 'Freezing drizzle' },
  61: { icon: '🌧️', label: 'Light rain' },
  63: { icon: '🌧️', label: 'Rain' },
  65: { icon: '🌧️', label: 'Heavy rain' },
  66: { icon: '🌧️', label: 'Freezing rain' },
  67: { icon: '🌧️', label: 'Freezing rain' },
  71: { icon: '❄️', label: 'Light snow' },
  73: { icon: '❄️', label: 'Snow' },
  75: { icon: '❄️', label: 'Heavy snow' },
  77: { icon: '❄️', label: 'Snow grains' },
  80: { icon: '🌦️', label: 'Rain showers' },
  81: { icon: '🌦️', label: 'Rain showers' },
  82: { icon: '🌧️', label: 'Violent rain showers' },
  85: { icon: '🌨️', label: 'Snow showers' },
  86: { icon: '🌨️', label: 'Snow showers' },
  95: { icon: '⛈️', label: 'Thunderstorm' },
  96: { icon: '⛈️', label: 'Thunderstorm with hail' },
  99: { icon: '⛈️', label: 'Thunderstorm with hail' },
};

function mapWeatherCode(code) {
  return WEATHER_CODE_MAP[code] || { icon: '🌡️', label: '—' };
}

// "America/Toronto" -> "Toronto": a location name without geolocation.
function fallbackLocationLabel() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return tz.split('/').pop().replace(/_/g, ' ');
  } catch {
    return '';
  }
}

// Used when no location is shared or picked, so Azan/Weather always show
// something; the Settings tab's WIDGET_DEFAULT_CITY overrides it.
const DEFAULT_LOCATION = { lat: 43.4643, lon: -80.5204, label: 'Waterloo, ON' };
let sheetDefaultLocation = null;
let sheetDefaultCityQuery = null;

// The second clock's city: the picker overrides it per browser, WIDGET_SECOND_CLOCK_CITY for all.
const DEFAULT_SECOND_CLOCK = { label: 'Isfahan', timezone: 'Asia/Tehran' };
let sheetSecondClockCity = null;
let sheetSecondClockQuery = null;

const MANUAL_LOCATION_KEY = 'ledger_widget_manual_location';
const SECOND_CLOCK_MANUAL_KEY = 'ledger_widget_second_clock_location';
// What "Use my location" last found, kept so later visits don't ask again.
const DETECTED_LOCATION_KEY = 'ledger_widget_detected_location';

const GEOLOCATION_TIMEOUT_MS = 10000;
const CLOCK_TICK_MS = 1000;
const FORECAST_DAYS = 3;

// null when unset, unreadable or not JSON.
function readStoredJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getManualLocation() {
  return readStoredJson(MANUAL_LOCATION_KEY);
}

function setManualLocation(location) {
  localStorage.setItem(MANUAL_LOCATION_KEY, JSON.stringify(location));
}

function clearManualLocation() {
  localStorage.removeItem(MANUAL_LOCATION_KEY);
}

function getSecondClockManual() {
  return readStoredJson(SECOND_CLOCK_MANUAL_KEY);
}

function setSecondClockManual(city) {
  localStorage.setItem(SECOND_CLOCK_MANUAL_KEY, JSON.stringify(city));
}

function getDetectedLocation() {
  return readStoredJson(DETECTED_LOCATION_KEY);
}

async function getUserLocation() {
  if (!('geolocation' in navigator)) return null;

  const position = await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((pos) => resolve(pos), () => resolve(null), { timeout: GEOLOCATION_TIMEOUT_MS });
  });
  if (!position) return null;

  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  let label = fallbackLocationLabel();

  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    if (res.ok) {
      const data = await res.json();
      const city = data.city || data.locality;
      if (city) label = data.principalSubdivision ? `${city}, ${data.principalSubdivision}` : city;
    }
  } catch {
    // Keep the timezone-derived fallback label.
  }

  const location = { lat, lon, label };
  try {
    localStorage.setItem(DETECTED_LOCATION_KEY, JSON.stringify(location));
  } catch {
    // Not remembered; still used for this visit.
  }
  return location;
}

// A typed city -> coordinates via Open-Meteo. Its top hit needn't match the name
// ("Waterloo" can rank Austin first), so exact names win, then population.
async function geocodeLocation(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding request failed');

  const data = await res.json();
  const results = data.results || [];
  if (!results.length) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const nameMatches = results.filter((r) => r.name.toLowerCase() === normalizedQuery);
  const candidates = nameMatches.length ? nameMatches : results;
  const best = candidates.reduce((a, b) => ((b.population || 0) > (a.population || 0) ? b : a));

  const label = [best.name, best.admin1].filter(Boolean).join(', ');
  return { lat: best.latitude, lon: best.longitude, label, timezone: best.timezone };
}

// Manual, then last detected, then the Settings city, then the default. Never
// asks for geolocation: that prompt only follows a "Use my location" click.
function resolveLocation() {
  const manual = getManualLocation();
  if (manual) return manual;

  const detected = getDetectedLocation();
  if (detected) return detected;

  return sheetDefaultLocation || DEFAULT_LOCATION;
}

function applyLocation(location) {
  widgetLocationLabel = location.label;
  renderClock();
  initPrayerWidget(location);
  initWeatherWidget(location);
}

// Manual, then the Settings city, then Isfahan.
function resolveSecondClockCity() {
  return getSecondClockManual() || sheetSecondClockCity || DEFAULT_SECOND_CLOCK;
}

// After Settings load: WIDGET_DEFAULT_CITY / WIDGET_SECOND_CLOCK_CITY replace
// the defaults, but never a manual pick from the pickers.
async function applySettingsToWidgets() {
  if (!widgetsOnPage()) return;

  const defaultCityName = getSettingString('WIDGET_DEFAULT_CITY', null);
  if (defaultCityName && defaultCityName !== sheetDefaultCityQuery) {
    sheetDefaultCityQuery = defaultCityName;
    try {
      const geocoded = await geocodeLocation(defaultCityName);
      if (geocoded) sheetDefaultLocation = geocoded;
    } catch {
      // Keep whatever default was already in effect.
    }
  }

  const secondCityName = getSettingString('WIDGET_SECOND_CLOCK_CITY', null);
  if (secondCityName && secondCityName !== sheetSecondClockQuery) {
    sheetSecondClockQuery = secondCityName;
    try {
      const geocoded = await geocodeLocation(secondCityName);
      if (geocoded && geocoded.timezone) {
        sheetSecondClockCity = { label: secondCityName, timezone: geocoded.timezone };
      }
    } catch {
      // Keep whatever second-clock city was already in effect.
    }
  }

  if (!getManualLocation()) applyLocation(resolveLocation());
  if (!getSecondClockManual()) renderClock();
}

// A clock's city dropdown: its button toggles it, a click outside or Escape
// closes it, and a typed city is looked up on its button or Enter.
// `accept(result)` says whether a hit is usable; `apply(result, query)` uses it.
function setupCityPicker(ids, { notFoundMessage, accept, apply }) {
  const container = document.getElementById(ids.container);
  const btn = document.getElementById(ids.button);
  const dropdown = document.getElementById(ids.dropdown);
  const manualInput = document.getElementById(ids.input);
  const manualBtn = document.getElementById(ids.submit);
  const statusEl = document.getElementById(ids.status);

  const closeDropdown = () => { dropdown.hidden = true; };
  const showStatus = (message) => {
    statusEl.hidden = false;
    statusEl.textContent = message;
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) closeDropdown();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });

  const submitManual = async () => {
    const query = manualInput.value.trim();
    if (!query) return;

    showStatus('Searching…');

    try {
      const result = await geocodeLocation(query);
      if (!accept(result)) {
        showStatus(notFoundMessage);
        return;
      }

      apply(result, query);
      statusEl.hidden = true;
      manualInput.value = '';
      closeDropdown();
    } catch {
      showStatus('Search failed — try again.');
    }
  };

  manualBtn.addEventListener('click', submitManual);
  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitManual();
    }
  });

  return { statusEl, showStatus, closeDropdown };
}

function setupLocationPicker() {
  const { statusEl, showStatus, closeDropdown } = setupCityPicker({
    container: 'location-picker',
    button: 'widget-clock-location-btn',
    dropdown: 'location-picker-dropdown',
    input: 'location-manual-input',
    submit: 'location-manual-btn',
    status: 'location-picker-status',
  }, {
    notFoundMessage: 'Location not found.',
    accept: (location) => Boolean(location),
    apply: (location) => {
      setManualLocation(location);
      applyLocation(location);
    },
  });

  document.getElementById('location-auto-btn').addEventListener('click', async () => {
    showStatus('Detecting your location…');
    clearManualLocation();

    const detected = await getUserLocation();
    if (detected) {
      applyLocation(detected);
      statusEl.hidden = true;
      closeDropdown();
    } else {
      applyLocation(DEFAULT_LOCATION);
      showStatus('Location access denied — using Waterloo, ON, Canada.');
    }
  });
}

// A reference city, not the user's own, so there's no "Use my location".
function setupSecondClockPicker() {
  setupCityPicker({
    container: 'second-clock-picker',
    button: 'second-clock-location-btn',
    dropdown: 'second-clock-dropdown',
    input: 'second-clock-manual-input',
    submit: 'second-clock-manual-btn',
    status: 'second-clock-status',
  }, {
    notFoundMessage: 'City not found.',
    accept: (result) => Boolean(result && result.timezone),
    apply: (result, query) => {
      setSecondClockManual({ label: query, timezone: result.timezone });
      renderClock();
    },
  });
}

function formatHMS(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

let widgetLocationLabel = '';
let lastRenderedDateKey = '';

function renderClock() {
  const now = new Date();

  document.getElementById('widget-clock-time').textContent = formatHMS(now);
  document.getElementById('widget-clock-location-btn').textContent = widgetLocationLabel;

  const secondClock = resolveSecondClockCity();
  document.getElementById('widget-clock-isfahan').textContent = new Intl.DateTimeFormat('en-GB', {
    timeZone: secondClock.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
  document.getElementById('second-clock-location-btn').textContent = secondClock.label;

  const dateKey = now.toDateString();
  if (dateKey !== lastRenderedDateKey) {
    lastRenderedDateKey = dateKey;
    renderDateWidget(now);
  }
}

// Returns { day, month, year } for the given ICU calendar system, e.g.
// { day: '5', month: 'July (7)', year: '2026' } or { day: '14', month: 'Tir (4)', year: '1405' }.
function formatCalendarDateParts(date, calendar) {
  const locale = `en-US-u-ca-${calendar}`;
  const numericParts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date);
  const monthNameParts = new Intl.DateTimeFormat(locale, { month: 'long' }).formatToParts(date);

  const get = (parts, type) => (parts.find((p) => p.type === type) || {}).value;

  const day = get(numericParts, 'day');
  const monthNumber = get(numericParts, 'month');
  const year = get(numericParts, 'year');
  const monthName = get(monthNameParts, 'month');

  return { day, month: `${monthName} (${monthNumber})`, year };
}

function safeFormatCalendarDateParts(date, calendar) {
  try {
    return formatCalendarDateParts(date, calendar);
  } catch {
    return { day: '—', month: '—', year: '—' };
  }
}

// A <span> with text, and a class when given.
function makeWidgetSpan(className, text) {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

// One column per part, so the Gregorian/Shamsi/Ghamari rows line up.
function renderDateWidgetRow(elementId, icon, date, calendar) {
  const { day, month, year } = safeFormatCalendarDateParts(date, calendar);
  const el = document.getElementById(elementId);
  el.innerHTML = '';

  // Year, month, day: the app's date order.
  el.append(
    makeWidgetSpan('widget-date-icon', icon),
    makeWidgetSpan('widget-date-year', year),
    makeWidgetSpan('widget-date-month', month),
    makeWidgetSpan('widget-date-day', day),
  );
}

function renderDateWidget(date = new Date()) {
  renderDateWidgetRow('widget-date-gregorian', '✝️', date, 'gregory');
  renderDateWidgetRow('widget-date-shamsi', '🌞', date, 'persian');
  renderDateWidgetRow('widget-date-ghamari', '🌜', date, 'islamic');
}

function initPrayerWidget(location) {
  const statusEl = document.getElementById('widget-prayer-status');
  if (!location) {
    statusEl.hidden = false;
    statusEl.textContent = 'Enable location access to see prayer times.';
    return;
  }
  statusEl.hidden = true;

  const utcOffsetHours = -new Date().getTimezoneOffset() / 60;
  const times = computePrayerTimes({ lat: location.lat, lon: location.lon, date: new Date(), utcOffsetHours });

  ['fajr', 'dhuhr', 'maghrib', 'midnight'].forEach((name) => {
    document.getElementById(`widget-prayer-${name}`).textContent = times[name];
  });
}

async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=${FORECAST_DAYS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather request failed');

  return res.json();
}

function renderWeather(data) {
  const current = data.current;
  const unit = (data.current_units && data.current_units.temperature_2m) || '°C';
  const currentInfo = mapWeatherCode(current.weather_code);

  // Icon and temperature only, so sunrise/sunset fit on the same line; the label is the hover.
  const currentEl = document.getElementById('widget-weather-current');
  currentEl.textContent = `${currentInfo.icon} ${Math.round(current.temperature_2m)}${unit}`;
  currentEl.title = currentInfo.label;

  // Today's, in the location's own time (timezone=auto): "2026-10-12T07:28" -> "07:28".
  const hhmm = (iso) => (iso ? iso.slice(11, 16) : '—');
  document.getElementById('widget-weather-sunrise').textContent = `🌅 ${hhmm(data.daily.sunrise?.[0])}`;
  document.getElementById('widget-weather-sunset').textContent = `🌇 ${hhmm(data.daily.sunset?.[0])}`;

  const forecastEl = document.getElementById('widget-weather-forecast');
  forecastEl.innerHTML = '';

  data.daily.time.slice(0, FORECAST_DAYS).forEach((isoDate, i) => {
    const day = new Date(`${isoDate}T00:00:00`);
    const info = mapWeatherCode(data.daily.weather_code[i]);
    const high = Math.round(data.daily.temperature_2m_max[i]);
    const low = Math.round(data.daily.temperature_2m_min[i]);

    const item = document.createElement('div');
    item.className = 'widget-forecast-day';
    item.append(
      makeWidgetSpan(null, day.toLocaleDateString(undefined, { weekday: 'short' })),
      makeWidgetSpan('widget-forecast-icon', info.icon),
      makeWidgetSpan('widget-forecast-temps', `${high}°/${low}°`),
    );
    forecastEl.appendChild(item);
  });
}

async function initWeatherWidget(location) {
  const statusEl = document.getElementById('widget-weather-status');
  if (!location) {
    statusEl.hidden = false;
    statusEl.textContent = 'Enable location access to see weather.';
    return;
  }

  try {
    const data = await fetchWeather(location.lat, location.lon);
    statusEl.hidden = true;
    renderWeather(data);
  } catch {
    statusEl.hidden = false;
    statusEl.textContent = 'Weather unavailable right now.';
  }
}

// Section pages hide the bulbs row, and a clock and fetches behind it are wasted
// work; both entry points check this so no caller has to.
function widgetsOnPage() {
  const row = document.querySelector('.widget-cards');
  return Boolean(row) && !row.hidden;
}

// Guards the interval/fetches from starting twice.
let widgetsStarted = false;

async function startWidgets() {
  if (!widgetsOnPage() || widgetsStarted) return;
  widgetsStarted = true;

  widgetLocationLabel = fallbackLocationLabel();
  renderClock();
  setInterval(renderClock, CLOCK_TICK_MS);
  setupLocationPicker();
  setupSecondClockPicker();

  applyLocation(resolveLocation());
}

function initWidgets() {
  startWidgets();
}
