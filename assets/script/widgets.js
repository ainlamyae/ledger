// Dashboard "bulb" widgets: live clock, multi-calendar date, Azan (prayer)
// times, and weather. These are independent of the Google Sheet — they only
// need the (possibly still-hidden) #dashboard markup to exist, so they're
// started once on page load rather than tied to the sign-in/data-load flow.

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

// Sun declination and equation of time (in hours) for a given Julian day.
// Based on the low-precision solar position formulas widely used for
// prayer-time calculation (e.g. praytimes.org's published method) — accurate
// to well within a minute, which is all a dashboard widget needs.
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

  return {
    fajr: hoursToHHMM(dhuhr - fajrOffset),
    dhuhr: hoursToHHMM(dhuhr),
    maghrib: hoursToHHMM(dhuhr + maghribOffset),
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

// "America/Toronto" -> "Toronto", used when geolocation/reverse-geocoding
// isn't available so the clock still shows a plausible location name.
function fallbackLocationLabel() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return tz.split('/').pop().replace(/_/g, ' ');
  } catch {
    return '';
  }
}

// Shown when the browser won't share a location (denied/unsupported) and the
// user hasn't set one manually, so the Azan/Weather widgets always have
// somewhere to work with instead of just showing an error. Overridable from
// the Google Sheet's Settings tab via the WIDGET_DEFAULT_CITY key (see
// applySettingsToWidgets()).
const DEFAULT_LOCATION = { lat: 43.4643, lon: -80.5204, label: 'Waterloo, ON' };
let sheetDefaultLocation = null;
let sheetDefaultCityQuery = null;

// The second clock row's reference city. Overridable per-browser via the
// picker (setupSecondClockPicker) or, as a shared default, from the
// Settings tab via WIDGET_SECOND_CLOCK_CITY.
const DEFAULT_SECOND_CLOCK = { label: 'Isfahan', timezone: 'Asia/Tehran' };
let sheetSecondClockCity = null;
let sheetSecondClockQuery = null;

const MANUAL_LOCATION_KEY = 'ledger_widget_manual_location';
const SECOND_CLOCK_MANUAL_KEY = 'ledger_widget_second_clock_location';

function getManualLocation() {
  try {
    const raw = localStorage.getItem(MANUAL_LOCATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setManualLocation(location) {
  localStorage.setItem(MANUAL_LOCATION_KEY, JSON.stringify(location));
}

function clearManualLocation() {
  localStorage.removeItem(MANUAL_LOCATION_KEY);
}

function getSecondClockManual() {
  try {
    const raw = localStorage.getItem(SECOND_CLOCK_MANUAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSecondClockManual(city) {
  localStorage.setItem(SECOND_CLOCK_MANUAL_KEY, JSON.stringify(city));
}

async function getUserLocation(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCached('widget_location', 6 * 60 * 60 * 1000);
    if (cached) return cached;
  }

  if (!('geolocation' in navigator)) return null;

  const position = await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((pos) => resolve(pos), () => resolve(null), { timeout: 10000 });
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
  setCached('widget_location', location);
  return location;
}

// Open-Meteo's free geocoding search — turns a typed city name into
// coordinates for the manual "Set location" option. The API's default
// top hit isn't necessarily a name match (e.g. searching "Waterloo" can
// rank "Austin, Texas" first), so fetch several candidates, prefer ones
// whose name actually matches the query, and break ties by population.
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

// Never calls navigator.geolocation itself — that's a real permission
// prompt and should only ever happen from an explicit click on "Use my
// location" (see setupLocationPicker), not silently on every page load.
// Manual override beats a previously-detected (cached) location, which
// beats the Settings-tab default city, which beats the hardcoded fallback.
function resolveLocation() {
  const manual = getManualLocation();
  if (manual) return manual;

  const cachedDetected = getCached('widget_location', 6 * 60 * 60 * 1000);
  if (cachedDetected) return cachedDetected;

  return sheetDefaultLocation || DEFAULT_LOCATION;
}

function applyLocation(location) {
  widgetLocationLabel = location.label;
  renderClock();
  initPrayerWidget(location);
  initWeatherWidget(location);
}

// Manual override beats the Settings-tab city, which beats the hardcoded
// Isfahan default.
function resolveSecondClockCity() {
  return getSecondClockManual() || sheetSecondClockCity || DEFAULT_SECOND_CLOCK;
}

// Called once the Google Sheet's Settings tab has loaded (see app.js ->
// loadDashboard) so WIDGET_DEFAULT_CITY / WIDGET_SECOND_CLOCK_CITY can
// override the hardcoded defaults, without overriding a per-browser manual
// pick made via the location pickers.
async function applySettingsToWidgets() {
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

function setupLocationPicker() {
  const container = document.getElementById('location-picker');
  const btn = document.getElementById('widget-clock-location-btn');
  const dropdown = document.getElementById('location-picker-dropdown');
  const autoBtn = document.getElementById('location-auto-btn');
  const manualInput = document.getElementById('location-manual-input');
  const manualBtn = document.getElementById('location-manual-btn');
  const statusEl = document.getElementById('location-picker-status');

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

  autoBtn.addEventListener('click', async () => {
    showStatus('Detecting your location…');
    clearManualLocation();

    const detected = await getUserLocation(true);
    if (detected) {
      applyLocation(detected);
      statusEl.hidden = true;
      closeDropdown();
    } else {
      applyLocation(DEFAULT_LOCATION);
      showStatus('Location access denied — using Waterloo, ON, Canada.');
    }
  });

  const submitManual = async () => {
    const query = manualInput.value.trim();
    if (!query) return;

    showStatus('Searching…');

    try {
      const location = await geocodeLocation(query);
      if (!location) {
        showStatus('Location not found.');
        return;
      }

      setManualLocation(location);
      applyLocation(location);
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
}

// Same picker pattern as the main location picker, but for the second
// clock row: no "use my location" option (it's a reference city, not
// the user's own location), just a manual city search.
function setupSecondClockPicker() {
  const container = document.getElementById('second-clock-picker');
  const btn = document.getElementById('second-clock-location-btn');
  const dropdown = document.getElementById('second-clock-dropdown');
  const manualInput = document.getElementById('second-clock-manual-input');
  const manualBtn = document.getElementById('second-clock-manual-btn');
  const statusEl = document.getElementById('second-clock-status');

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
      if (!result || !result.timezone) {
        showStatus('City not found.');
        return;
      }

      const city = { label: query, timezone: result.timezone };
      setSecondClockManual(city);
      renderClock();
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

// Renders {day} {MonthName} ({MonthNumber}) {year} for the given ICU
// calendar system, e.g. "5 July (7) 2026" or "14 Tir (4) 1405".
function formatCalendarDate(date, calendar) {
  const locale = `en-US-u-ca-${calendar}`;
  const numericParts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date);
  const monthNameParts = new Intl.DateTimeFormat(locale, { month: 'long' }).formatToParts(date);

  const get = (parts, type) => (parts.find((p) => p.type === type) || {}).value;

  const day = get(numericParts, 'day');
  const month = get(numericParts, 'month');
  const year = get(numericParts, 'year');
  const monthName = get(monthNameParts, 'month');

  return `${day} ${monthName} (${month}) ${year}`;
}

function safeFormatCalendarDate(date, calendar) {
  try {
    return formatCalendarDate(date, calendar);
  } catch {
    return '—';
  }
}

function renderDateWidget(date = new Date()) {
  document.getElementById('widget-date-gregorian').textContent = `✝️ ${safeFormatCalendarDate(date, 'gregory')}`;
  document.getElementById('widget-date-shamsi').textContent = `🌞 ${safeFormatCalendarDate(date, 'persian')}`;
  document.getElementById('widget-date-ghamari').textContent = `🌜 ${safeFormatCalendarDate(date, 'islamic')}`;
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

  document.getElementById('widget-prayer-fajr').textContent = times.fajr;
  document.getElementById('widget-prayer-dhuhr').textContent = times.dhuhr;
  document.getElementById('widget-prayer-maghrib').textContent = times.maghrib;
}

async function fetchWeather(lat, lon) {
  const cacheKey = `widget_weather_${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const cached = getCached(cacheKey, 30 * 60 * 1000);
  if (cached) return cached;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather request failed');

  const data = await res.json();
  setCached(cacheKey, data);
  return data;
}

function renderWeather(data) {
  const current = data.current;
  const unit = (data.current_units && data.current_units.temperature_2m) || '°C';
  const currentInfo = mapWeatherCode(current.weather_code);

  document.getElementById('widget-weather-current').textContent =
    `${currentInfo.icon} ${Math.round(current.temperature_2m)}${unit} — ${currentInfo.label}`;

  const forecastEl = document.getElementById('widget-weather-forecast');
  forecastEl.innerHTML = '';

  const FORECAST_DAYS_SHOWN = 3;
  data.daily.time.slice(0, FORECAST_DAYS_SHOWN).forEach((isoDate, i) => {
    const day = new Date(`${isoDate}T00:00:00`);
    const info = mapWeatherCode(data.daily.weather_code[i]);
    const high = Math.round(data.daily.temperature_2m_max[i]);
    const low = Math.round(data.daily.temperature_2m_min[i]);

    const item = document.createElement('div');
    item.className = 'widget-forecast-day';

    const dayLabel = document.createElement('span');
    dayLabel.textContent = day.toLocaleDateString(undefined, { weekday: 'short' });

    const icon = document.createElement('span');
    icon.className = 'widget-forecast-icon';
    icon.textContent = info.icon;

    const temps = document.createElement('span');
    temps.className = 'widget-forecast-temps';
    temps.textContent = `${high}°/${low}°`;

    item.append(dayLabel, icon, temps);
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

async function initWidgets() {
  widgetLocationLabel = fallbackLocationLabel();
  renderClock();
  setInterval(renderClock, 1000);
  setupLocationPicker();
  setupSecondClockPicker();

  applyLocation(resolveLocation());
}
