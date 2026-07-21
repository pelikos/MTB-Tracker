const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const exportButton = document.getElementById('exportButton');
const importFile = document.getElementById('importFile');
const addressInput = document.getElementById('addressInput');
const searchButton = document.getElementById('searchButton');
const navigateButton = document.getElementById('navigateButton');
const clearDestination = document.getElementById('clearDestination');
const routeInfo = document.getElementById('routeInfo');
const elevationSummaryEl = document.getElementById('elevationSummary');
const elevationChartEl = document.getElementById('elevationChart');
const themeToggle = document.getElementById('toggleTheme');

const instantSpeedEl = document.getElementById('instantSpeed');
const averageSpeedEl = document.getElementById('averageSpeed');
const distanceEl = document.getElementById('distance');
const elapsedEl = document.getElementById('elapsed');
const currentAltitudeEl = document.getElementById('currentAltitude');
const gpsAccuracyEl = document.getElementById('gpsAccuracy');
const gpsStatusEl = document.getElementById('gpsStatus');
const trackingStatusEl = document.getElementById('trackingStatus');

const SPEED_NOISE_THRESHOLD_MS = 0.5; // m/s (~1.8 km/h) - below this, treat GPS speed jitter as stationary

const currentLocationIcon = L.divIcon({
  className: 'current-pin-wrapper',
  html: '<span class="current-pin"><span class="current-pin-pulse"></span></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 24],
});

let map = null;
let trackLine = null;
let routeLine = null;
let destinationMarker = null;
let currentPositionMarker = null;
let accuracyCircle = null;
let currentWatchId = null;
let watchId = null;
let tracking = false;
let trackPoints = [];
let routeData = null;
let startTimestamp = null;
let elapsedTimer = null;
let lastPosition = null;
let currentPosition = null;
let currentAltitude = null;
let elevationPointsCache = [];
let elevationGeometry = null;

function formatTime(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function toKm(value) {
  return value ? (value / 1000).toFixed(2) : '0.00';
}

function computeDistance(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(sinDLat * sinDLat + sinDLon * sinDLon * Math.cos(lat1) * Math.cos(lat2)));
}

function setTrackingStatus(text, statusClass) {
  if (!trackingStatusEl) return;
  trackingStatusEl.textContent = text;
  trackingStatusEl.className = `status-pill ${statusClass}`;
}

function getGpsQuality(accuracy) {
  if (accuracy <= 10) return 'Eccellente';
  if (accuracy <= 25) return 'Ottima';
  if (accuracy <= 50) return 'Buona';
  if (accuracy <= 100) return 'Moderata';
  return 'Bassa';
}

function updateStats() {
  const totalDistance = trackPoints.reduce((sum, point, index) => {
    if (index === 0) return 0;
    return sum + computeDistance(trackPoints[index - 1], point);
  }, 0);

  const elapsedSeconds = startTimestamp ? Math.max(0, Math.floor((Date.now() - startTimestamp) / 1000)) : 0;
  const averageSpeed = elapsedSeconds > 0 ? (totalDistance / elapsedSeconds) * 3.6 : 0;

  const rawSpeed = lastPosition && lastPosition.speed !== null && lastPosition.speed !== undefined
    ? lastPosition.speed
    : (currentPosition && currentPosition.speed !== null && currentPosition.speed !== undefined ? currentPosition.speed : 0);
  const instantSpeed = rawSpeed > SPEED_NOISE_THRESHOLD_MS ? rawSpeed * 3.6 : 0;

  const altitude = currentAltitude !== null ? currentAltitude : currentPosition?.altitude ?? null;
  const accuracy = currentPosition?.accuracy ?? null;

  distanceEl.textContent = toKm(totalDistance);
  averageSpeedEl.textContent = averageSpeed.toFixed(1);
  elapsedEl.textContent = formatTime(elapsedSeconds);
  instantSpeedEl.textContent = instantSpeed.toFixed(1);
  currentAltitudeEl.textContent = altitude !== null ? `${Math.round(altitude)} m` : '—';
  gpsAccuracyEl.textContent = accuracy !== null ? `${Math.round(accuracy)} m` : '—';
  gpsStatusEl.textContent = accuracy !== null ? getGpsQuality(accuracy) : '—';
}

function updateTrackLine() {
  const path = trackPoints.map((point) => [point.lat, point.lng]);
  if (!trackLine) {
    trackLine = L.polyline(path, {
      color: '#111111',
      weight: 5,
      opacity: 0.85,
    }).addTo(map);
  } else {
    trackLine.setLatLngs(path);
  }
}

function updateCurrentLocation(position, setView = false) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const accuracy = position.coords.accuracy;
  const ele = position.coords.altitude;
  const latlng = [lat, lng];

  currentPosition = {
    lat,
    lng,
    accuracy,
    altitude: ele,
    speed: position.coords.speed,
    time: position.timestamp,
  };

  if (!currentPositionMarker) {
    currentPositionMarker = L.marker(latlng, { icon: currentLocationIcon, zIndexOffset: 1000 }).addTo(map);
  } else {
    currentPositionMarker.setLatLng(latlng);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(latlng, {
      radius: accuracy || 25,
      color: '#ff3b3b',
      weight: 1,
      opacity: 0.4,
      fillColor: '#ff3b3b',
      fillOpacity: 0.08,
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latlng).setRadius(accuracy || 25);
  }

  if (setView) {
    map.setView(latlng, 16);
  } else if (routeData) {
    map.panTo(latlng, { animate: true });
  }

  if (ele !== null && ele !== undefined) {
    currentAltitude = ele;
  }

  updateStats();
}

function addTrackPoint(position) {
  const point = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    ele: position.coords.altitude,
    time: position.timestamp,
    speed: position.coords.speed,
    accuracy: position.coords.accuracy,
  };

  updateCurrentLocation(position, false);

  if (!tracking) return;

  if (point.ele === null && currentAltitude !== null) {
    point.ele = currentAltitude;
  }

  trackPoints.push(point);
  lastPosition = point;
  if (point.ele !== null) {
    currentAltitude = point.ele;
  }

  if (trackPoints.length === 1) {
    map.setView([point.lat, point.lng], 16);
    L.circleMarker([point.lat, point.lng], {
      radius: 6,
      fillColor: '#111111',
      color: '#111111',
      weight: 2,
      fillOpacity: 1,
    }).addTo(map);
  }

  updateTrackLine();
  updateStats();
}

function showPositionError(error) {
  const messages = {
    1: 'Accesso alla posizione negato.',
    2: 'Impossibile determinare la posizione.',
    3: 'Timeout geolocalizzazione.',
  };
  alert(messages[error.code] || 'Errore di geolocalizzazione.');
}

function startTracking() {
  if (!navigator.geolocation) {
    alert('Il browser non supporta la geolocalizzazione.');
    return;
  }

  startButton.disabled = true;
  stopButton.disabled = false;
  exportButton.disabled = true;
  tracking = true;
  trackPoints = [];
  startTimestamp = Date.now();
  lastPosition = null;
  setTrackingStatus('Tracking attivo', 'running');
  if (trackLine) {
    map.removeLayer(trackLine);
    trackLine = null;
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => addTrackPoint(pos),
    showPositionError,
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
    }
  );

  elapsedTimer = setInterval(updateStats, 1000);
}

function stopTracking() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  tracking = false;
  stopButton.disabled = true;
  startButton.disabled = false;
  exportButton.disabled = trackPoints.length === 0;
  setTrackingStatus('Tracking fermo', 'stopped');
  clearInterval(elapsedTimer);
  updateStats();
}

function buildGpxContent(points) {
  const timeTags = points.map((point) => {
    const time = new Date(point.time).toISOString();
    const ele = point.ele !== null && point.ele !== undefined ? `<ele>${point.ele.toFixed(1)}</ele>` : '';
    return `      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}">
        ${ele}
        <time>${time}</time>
      </trkpt>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MTB Tracker" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>MTB Tracker Ride</name>\n    <trkseg>\n${timeTags.join('\n')}\n    </trkseg>\n  </trk>\n</gpx>`;
}

function exportGpx() {
  if (!trackPoints.length) return;
  const gpx = buildGpxContent(trackPoints);
  const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mtb-ride-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.gpx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseGpx(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');
  const trkpts = xml.querySelectorAll('trkpt');
  if (!trkpts.length) return [];
  const points = [];
  trkpts.forEach((trkpt) => {
    const lat = parseFloat(trkpt.getAttribute('lat'));
    const lon = parseFloat(trkpt.getAttribute('lon'));
    const eleTag = trkpt.querySelector('ele');
    const timeTag = trkpt.querySelector('time');
    const ele = eleTag ? parseFloat(eleTag.textContent) : null;
    const time = timeTag ? new Date(timeTag.textContent).getTime() : Date.now();
    points.push({ lat, lng: lon, ele, time, speed: null });
  });
  return points;
}

function importFileHandler(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const points = parseGpx(reader.result);
    if (!points.length) {
      alert('Il file non contiene tracce valide.');
      return;
    }
    trackPoints = points;
    if (trackLine) {
      map.removeLayer(trackLine);
      trackLine = null;
    }
    updateTrackLine();
    if (trackPoints.length) {
      const bounds = L.latLngBounds(trackPoints.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [20, 20] });
    }
    exportButton.disabled = false;
    stopButton.disabled = true;
    startButton.disabled = false;
    startTimestamp = Date.now() - Math.floor(points.length * 5 * 1000);
    currentAltitude = points[points.length - 1].ele ?? currentAltitude;
    updateStats();
  };
  reader.readAsText(file);
}

async function geocodeAddress(query) {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`);
  if (!response.ok) throw new Error('Geocoding failed');
  const results = await response.json();
  return results;
}

async function requestRoute(start, end) {
  const url = `https://router.project-osrm.org/route/v1/bicycle/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&steps=true&annotations=true`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Routing service non disponibile');
  const data = await response.json();
  if (!data.routes || !data.routes.length) throw new Error('Nessun percorso trovato');
  return data.routes[0];
}

async function elevationProfile(coordinates) {
  if (!coordinates.length) return null;

  const sampleCount = Math.min(40, coordinates.length);
  const step = Math.max(1, Math.floor(coordinates.length / sampleCount));
  const sampled = [];
  for (let i = 0; i < coordinates.length; i += step) {
    sampled.push(coordinates[i]);
  }
  if (sampled[sampled.length - 1] !== coordinates[coordinates.length - 1]) {
    sampled.push(coordinates[coordinates.length - 1]);
  }

  const query = sampled.map(([lng, lat]) => `${lat},${lng}`).join('|');
  try {
    const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${query}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.results || !data.results.length) return null;

    let cumulative = 0;
    const points = data.results.map((item, index) => {
      if (index > 0) {
        const prev = sampled[index - 1];
        const curr = sampled[index];
        cumulative += computeDistance({ lat: prev[1], lng: prev[0] }, { lat: curr[1], lng: curr[0] });
      }
      return { distance: cumulative, ele: item.elevation };
    });

    const altitudes = points.map((p) => p.ele);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < altitudes.length; i += 1) {
      const delta = altitudes[i] - altitudes[i - 1];
      if (delta > 0) gain += delta;
      else loss += -delta;
    }

    return { points, minAlt, maxAlt, gain, loss };
  } catch (error) {
    return null;
  }
}

function niceStep(range, targetTicks = 4) {
  if (!range || range <= 0) return 10;
  const rough = range / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / magnitude;
  let niceResidual;
  if (residual > 5) niceResidual = 10;
  else if (residual > 2) niceResidual = 5;
  else if (residual > 1) niceResidual = 2;
  else niceResidual = 1;
  return niceResidual * magnitude;
}

function clearElevationChart() {
  elevationPointsCache = [];
  elevationGeometry = null;
  elevationSummaryEl.textContent = 'Seleziona una destinazione e avvia la navigazione';
  elevationChartEl.innerHTML = '<p class="elevation-empty">Il profilo altimetrico del percorso apparirà qui.</p>';
}

function renderElevationChart(profile) {
  elevationPointsCache = profile.points;

  const width = 600;
  const height = 200;
  const padLeft = 46;
  const padRight = 14;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const totalDistance = profile.points[profile.points.length - 1].distance || 1;

  const step = niceStep(profile.maxAlt - profile.minAlt);
  const niceMin = Math.floor(profile.minAlt / step) * step;
  const niceMax = Math.ceil(profile.maxAlt / step) * step;
  const range = (niceMax - niceMin) || step;

  elevationGeometry = { padLeft, padRight, padTop, padBottom, width, height, plotW, plotH, niceMin, range, totalDistance };

  const x = (d) => padLeft + (d / totalDistance) * plotW;
  const y = (ele) => padTop + plotH - ((ele - niceMin) / range) * plotH;

  const linePoints = profile.points.map((p) => `${x(p.distance).toFixed(1)},${y(p.ele).toFixed(1)}`).join(' ');
  const baseY = (padTop + plotH).toFixed(1);
  const areaPoints = `${padLeft},${baseY} ${linePoints} ${(padLeft + plotW).toFixed(1)},${baseY}`;

  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.001; v += step) {
    ticks.push(v);
  }

  const gridMarkup = ticks.map((tick) => {
    const ty = y(tick).toFixed(1);
    return `<line class="elevation-grid" x1="${padLeft}" y1="${ty}" x2="${padLeft + plotW}" y2="${ty}"></line><text class="elevation-tick" x="${padLeft - 8}" y="${ty}" text-anchor="end" dominant-baseline="middle">${Math.round(tick)}</text>`;
  }).join('');

  elevationSummaryEl.textContent = `↑ ${Math.round(profile.gain)} m  ↓ ${Math.round(profile.loss)} m  ·  min ${Math.round(profile.minAlt)} m  ·  max ${Math.round(profile.maxAlt)} m`;

  elevationChartEl.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="elevation-svg" role="img" aria-label="Andamento altimetrico del percorso">
    ${gridMarkup}
    <polygon class="elevation-area" points="${areaPoints}"></polygon>
    <polyline class="elevation-line" points="${linePoints}"></polyline>
    <text class="elevation-axis-label" x="${padLeft}" y="${height - 6}" text-anchor="start">0 km</text>
    <text class="elevation-axis-label" x="${padLeft + plotW}" y="${height - 6}" text-anchor="end">${(totalDistance / 1000).toFixed(1)} km</text>
    <g class="elevation-cursor" hidden>
      <line class="elevation-cursor-line" x1="0" y1="${padTop}" x2="0" y2="${padTop + plotH}"></line>
      <circle class="elevation-cursor-dot" r="4" cx="0" cy="0"></circle>
    </g>
    <rect class="elevation-hit" x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="transparent"></rect>
  </svg>
  <div class="elevation-tooltip" hidden></div>`;

  attachElevationInteraction();
}

function attachElevationInteraction() {
  const svg = elevationChartEl.querySelector('.elevation-svg');
  const cursorGroup = elevationChartEl.querySelector('.elevation-cursor');
  const cursorLine = elevationChartEl.querySelector('.elevation-cursor-line');
  const cursorDot = elevationChartEl.querySelector('.elevation-cursor-dot');
  const tooltip = elevationChartEl.querySelector('.elevation-tooltip');
  const hitRect = elevationChartEl.querySelector('.elevation-hit');
  if (!svg || !hitRect || !elevationGeometry || !elevationPointsCache.length) return;

  const geo = elevationGeometry;

  function nearestPoint(clientX) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = 0;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const svgPoint = pt.matrixTransform(ctm.inverse());
    const ratio = Math.min(1, Math.max(0, (svgPoint.x - geo.padLeft) / geo.plotW));
    const targetDistance = ratio * geo.totalDistance;
    let nearest = elevationPointsCache[0];
    elevationPointsCache.forEach((p) => {
      if (Math.abs(p.distance - targetDistance) < Math.abs(nearest.distance - targetDistance)) nearest = p;
    });
    return nearest;
  }

  function showAt(clientX) {
    const nearest = nearestPoint(clientX);
    if (!nearest) return;
    const px = geo.padLeft + (nearest.distance / geo.totalDistance) * geo.plotW;
    const py = geo.padTop + geo.plotH - ((nearest.ele - geo.niceMin) / geo.range) * geo.plotH;
    cursorLine.setAttribute('x1', px);
    cursorLine.setAttribute('x2', px);
    cursorDot.setAttribute('cx', px);
    cursorDot.setAttribute('cy', py);
    cursorGroup.removeAttribute('hidden');
    tooltip.hidden = false;
    tooltip.textContent = `${Math.round(nearest.ele)} m · ${(nearest.distance / 1000).toFixed(2)} km`;
    const rect = elevationChartEl.getBoundingClientRect();
    const left = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    tooltip.style.left = `${left}px`;
  }

  function hide() {
    cursorGroup.setAttribute('hidden', '');
    tooltip.hidden = true;
  }

  hitRect.addEventListener('pointermove', (event) => showAt(event.clientX));
  hitRect.addEventListener('pointerdown', (event) => showAt(event.clientX));
  hitRect.addEventListener('pointerleave', hide);
}

function showRoute(route, destination) {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }

  const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  routeLine = L.polyline(coords, {
    color: '#444444',
    weight: 5,
    opacity: 0.85,
    dashArray: '8,8',
  }).addTo(map);

  destinationMarker = L.marker([destination.lat, destination.lng]).addTo(map);

  const bounds = routeLine.getBounds();
  if (lastPosition) bounds.extend([lastPosition.lat, lastPosition.lng]);
  map.fitBounds(bounds, { padding: [20, 20] });

  routeInfo.textContent = `Percorso: ${(route.distance / 1000).toFixed(2)} km • ${(route.duration / 60).toFixed(0)} min`;
}

function setDestinationSummary(destination) {
  routeInfo.textContent = `Destinazione: ${destination.display_name}`;
}

async function searchDestination() {
  const query = addressInput.value.trim();
  if (!query) {
    routeInfo.textContent = 'Inserisci un indirizzo o una città.';
    return;
  }
  searchButton.disabled = true;
  routeInfo.textContent = 'Ricerca indirizzo...';
  try {
    const results = await geocodeAddress(query);
    if (!results.length) {
      routeInfo.textContent = 'Nessun indirizzo trovato.';
      return;
    }
    routeData = {
      location: {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
      },
      display_name: results[0].display_name,
    };
    setDestinationSummary(routeData);
    navigateButton.disabled = false;
    clearDestination.disabled = false;
  } catch (err) {
    routeInfo.textContent = `Errore ricerca indirizzo: ${err.message}`;
  } finally {
    searchButton.disabled = false;
  }
}

async function startNavigation() {
  if (!routeData) return;
  const current = lastPosition
    ? { lat: lastPosition.lat, lng: lastPosition.lng }
    : currentPosition
      ? { lat: currentPosition.lat, lng: currentPosition.lng }
      : null;

  if (!current) {
    routeInfo.textContent = 'Attendere la posizione GPS prima di avviare la navigazione.';
    return;
  }
  routeInfo.textContent = 'Calcolo percorso...';
  navigateButton.disabled = true;
  try {
    const route = await requestRoute(current, routeData.location);
    showRoute(route, routeData.location);
    elevationSummaryEl.textContent = 'Calcolo profilo altimetrico...';
    const profile = await elevationProfile(route.geometry.coordinates);
    if (profile) {
      renderElevationChart(profile);
    } else {
      elevationSummaryEl.textContent = 'Profilo altimetrico non disponibile';
      elevationChartEl.innerHTML = '<p class="elevation-empty">Impossibile calcolare l\'altimetria per questo percorso.</p>';
    }
  } catch (err) {
    routeInfo.textContent = `Errore nel calcolo del percorso: ${err.message}`;
  } finally {
    navigateButton.disabled = false;
  }
}

function clearDestinationRoute() {
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  if (destinationMarker) {
    map.removeLayer(destinationMarker);
    destinationMarker = null;
  }
  routeData = null;
  routeInfo.textContent = 'Nessuna destinazione impostata.';
  navigateButton.disabled = true;
  clearDestination.disabled = true;
  clearElevationChart();
  updateStats();
}

function updateThemeButton() {
  const isLight = document.body.classList.contains('light-theme');
  themeToggle.textContent = isLight ? '🌙' : '☀️';
  themeToggle.setAttribute('aria-label', isLight ? 'Attiva tema scuro' : 'Attiva tema chiaro');
}

function toggleTheme() {
  document.body.classList.toggle('light-theme');
  updateThemeButton();
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([45.0, 9.0], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  initLocation();
  updateStats();
}

function initLocation() {
  if (!navigator.geolocation || currentWatchId !== null) return;

  navigator.geolocation.getCurrentPosition(
    (pos) => updateCurrentLocation(pos, true),
    showPositionError,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );

  currentWatchId = navigator.geolocation.watchPosition(
    (pos) => updateCurrentLocation(pos, false),
    showPositionError,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

startButton.addEventListener('click', () => startTracking());
stopButton.addEventListener('click', () => stopTracking());
exportButton.addEventListener('click', exportGpx);
importFile.addEventListener('change', importFileHandler);
searchButton.addEventListener('click', searchDestination);
addressInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchDestination();
  }
});
navigateButton.addEventListener('click', startNavigation);
clearDestination.addEventListener('click', clearDestinationRoute);
themeToggle.addEventListener('click', toggleTheme);

initMap();
updateThemeButton();
