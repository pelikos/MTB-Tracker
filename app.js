const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const exportButton = document.getElementById('exportButton');
const importFile = document.getElementById('importFile');
const addressInput = document.getElementById('addressInput');
const searchButton = document.getElementById('searchButton');
const navigateButton = document.getElementById('navigateButton');
const clearDestination = document.getElementById('clearDestination');
const routeInfo = document.getElementById('routeInfo');
const navigationInstructions = document.getElementById('navigationInstructions');

const instantSpeedEl = document.getElementById('instantSpeed');
const averageSpeedEl = document.getElementById('averageSpeed');
const distanceEl = document.getElementById('distance');
const elapsedEl = document.getElementById('elapsed');
const currentAltitudeEl = document.getElementById('currentAltitude');
const routeAltitudeEl = document.getElementById('routeAltitude');
const gpsAccuracyEl = document.getElementById('gpsAccuracy');
const gpsStatusEl = document.getElementById('gpsStatus');

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
let routeAltitudeSummary = null;

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

function updateStats() {
  const totalDistance = trackPoints.reduce((sum, point, index) => {
    if (index === 0) return 0;
    return sum + computeDistance(trackPoints[index - 1], point);
  }, 0);

  const elapsedSeconds = startTimestamp ? Math.max(0, Math.floor((Date.now() - startTimestamp) / 1000)) : 0;
  const averageSpeed = elapsedSeconds > 0 ? (totalDistance / elapsedSeconds) * 3.6 : 0;
  const instantSpeed = lastPosition && lastPosition.speed !== null ? lastPosition.speed * 3.6 : (currentPosition && currentPosition.speed !== null ? currentPosition.speed * 3.6 : 0);
  const altitude = currentAltitude !== null ? currentAltitude : currentPosition?.altitude ?? null;
  const accuracy = currentPosition?.accuracy ?? null;

  distanceEl.textContent = toKm(totalDistance);
  averageSpeedEl.textContent = averageSpeed.toFixed(1);
  elapsedEl.textContent = formatTime(elapsedSeconds);
  instantSpeedEl.textContent = instantSpeed.toFixed(1);
  currentAltitudeEl.textContent = altitude !== null ? `${Math.round(altitude)} m` : '—';
  routeAltitudeEl.textContent = routeAltitudeSummary ? routeAltitudeSummary : '—';
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

function getGpsQuality(accuracy) {
  if (accuracy <= 10) return 'Eccellente';
  if (accuracy <= 25) return 'Ottima';
  if (accuracy <= 50) return 'Buona';
  if (accuracy <= 100) return 'Moderata';
  return 'Bassa';
}

function updateCurrentLocation(position, setView = false) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const accuracy = position.coords.accuracy;
  const ele = position.coords.altitude;

  currentPosition = {
    lat,
    lng,
    accuracy,
    altitude: ele,
    speed: position.coords.speed,
    time: position.timestamp,
  };

  if (!currentPositionMarker) {
    currentPositionMarker = L.circleMarker([lat, lng], {
      radius: 8,
      fillColor: '#111111',
      color: '#fff',
      weight: 2,
      fillOpacity: 1,
    }).addTo(map);
  } else {
    currentPositionMarker.setLatLng([lat, lng]);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle([lat, lng], {
      radius: accuracy || 25,
      color: '#111111',
      weight: 1,
      opacity: 0.5,
      fillColor: '#111111',
      fillOpacity: 0.08,
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy || 25);
  }

  if (setView) {
    map.setView([lat, lng], 16);
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

  updateCurrentLocation(position, false);
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

async function elevationProfile(coords) {
  if (!coords.length) return null;
  const sample = coords.filter((_, idx) => idx % Math.max(1, Math.floor(coords.length / 10)) === 0);
  const query = sample.map((pt) => `${pt[1]},${pt[0]}`).join('|');
  try {
    const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${query}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.results) return null;
    const altitudes = data.results.map((item) => item.elevation);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    const gain = altitudes.reduce((sum, value, index) => {
      if (index === 0) return 0;
      return sum + Math.max(0, value - altitudes[index - 1]);
    }, 0);
    return { minAlt, maxAlt, gain };
  } catch (error) {
    return null;
  }
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

  const instructions = route.legs[0].steps.map((step) => `• ${step.maneuver.instruction}`).slice(0, 12);
  navigationInstructions.innerHTML = instructions.map((text) => `<p>${text}</p>`).join('');
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
    const elevation = await elevationProfile(route.geometry.coordinates);
    if (elevation) {
      routeAltitudeSummary = `min ${Math.round(elevation.minAlt)} m • max ${Math.round(elevation.maxAlt)} m • ↑${Math.round(elevation.gain)}m`;
    } else {
      routeAltitudeSummary = 'Altitudine prevista non disponibile';
    }
    updateStats();
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
  navigationInstructions.innerHTML = '';
  navigateButton.disabled = true;
  clearDestination.disabled = true;
  routeAltitudeSummary = null;
  updateStats();
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([45.0, 9.0], 13);
  L.tileLayer('https://tiles.wmflabs.org/bw-mapnik/{z}/{x}/{y}.png', {
    maxZoom: 18,
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

initMap();
