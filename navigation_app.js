// NDDSU AR graph-based navigation (no WebXR)
// This file talks directly to Supabase and controls the arrow.

// TODO: replace with your actual Supabase project credentials.
const SUPABASE_URL = 'https://pllmhqlssdmfijqagkxi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsbG1ocWxzc2RtZmlqcWFna3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NTEwOTEsImV4cCI6MjA4NzQyNzA5MX0.3QUWRVZo8EiyhsuUO-OFA2rrN51FxjL6or8Atp7htTE';

if (!window.supabase) {
  console.error('Supabase JS library failed to load.');
}

const supabaseClient =
  window.supabase && SUPABASE_URL !== 'https://pllmhqlssdmfijqagkxi.supabase.co'
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const statusTextEl = document.getElementById('status-text');
const pathPreviewEl = document.getElementById('path-preview');
const checkpointLabelEl = document.getElementById('checkpoint-label');
const startButton = document.getElementById('start-nav-btn');
const destinationSelect = document.getElementById('destination-select');
const arrowEl = document.getElementById('arrow');

// Basic helpers
const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

function bearingBetween(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const λ1 = toRad(lon1);
  const λ2 = toRad(lon2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

function findNearestCheckpoint(lat, lon, checkpoints) {
  let best = null;
  let bestDist = Infinity;

  for (const cp of checkpoints) {
    const d = haversineDistance(lat, lon, cp.latitude, cp.longitude);
    if (d < bestDist) {
      best = cp;
      bestDist = d;
    }
  }

  return { checkpoint: best, distance: bestDist };
}

function buildAdjacency(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from_checkpoint)) {
      adj.set(e.from_checkpoint, []);
    }
    adj.get(e.from_checkpoint).push({
      to: e.to_checkpoint,
      distance: e.distance
    });
  }
  return adj;
}

function dijkstra(adjacency, startId, targetId) {
  const dist = new Map();
  const prev = new Map();
  const unvisited = new Set();

  // include all known nodes
  for (const k of adjacency.keys()) {
    unvisited.add(k);
  }
  unvisited.add(startId);

  for (const id of unvisited) {
    dist.set(id, Infinity);
  }
  dist.set(startId, 0);

  while (unvisited.size > 0) {
    let current = null;
    let currentDist = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity;
      if (d < currentDist) {
        currentDist = d;
        current = id;
      }
    }

    if (current === null || currentDist === Infinity) break;
    unvisited.delete(current);

    if (current === targetId) break;

    const neighbors = adjacency.get(current) || [];
    for (const { to, distance } of neighbors) {
      const alt = currentDist + distance;
      if (alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        prev.set(to, current);
        if (!unvisited.has(to)) {
          unvisited.add(to);
        }
      }
    }
  }

  const path = [];
  let u = targetId;
  while (u !== undefined) {
    path.unshift(u);
    u = prev.get(u);
  }
  if (path[0] !== startId) {
    return null;
  }
  return path;
}

class NavigationEngine {
  constructor({ checkpoints, edges, arrivalRadiusMeters = 5 }) {
    this.checkpoints = checkpoints;
    this.checkpointById = new Map(checkpoints.map((cp) => [cp.id, cp]));
    this.adjacency = buildAdjacency(edges);
    this.arrivalRadiusMeters = arrivalRadiusMeters;

    this.path = null;
    this.currentIndex = 0;
    this.userPosition = null;

    this.onCheckpointReached = null;
    this.onArrived = null;
  }

  startNavigationFromUser({ userLat, userLon, destinationCheckpointId }) {
    this.userPosition = { lat: userLat, lon: userLon };

    const { checkpoint: nearest } = findNearestCheckpoint(
      userLat,
      userLon,
      this.checkpoints
    );
    if (!nearest) {
      throw new Error('No checkpoints available');
    }

    const path = dijkstra(
      this.adjacency,
      nearest.id,
      destinationCheckpointId
    );
    if (!path) {
      throw new Error('No path to destination');
    }

    this.path = path;
    this.currentIndex = path.length > 1 ? 1 : 0;
  }

  getCurrentTargetCheckpoint() {
    if (!this.path || this.currentIndex >= this.path.length) return null;
    const id = this.path[this.currentIndex];
    return this.checkpointById.get(id) || null;
  }

  updateUserPosition(lat, lon) {
    this.userPosition = { lat, lon };
    const target = this.getCurrentTargetCheckpoint();
    if (!target) return;

    const d = haversineDistance(
      lat,
      lon,
      target.latitude,
      target.longitude
    );

    if (d < this.arrivalRadiusMeters) {
      const reachedIndex = this.currentIndex;
      this.currentIndex += 1;

      if (this.onCheckpointReached) {
        this.onCheckpointReached(target, reachedIndex, this.path.length);
      }

      if (this.currentIndex >= this.path.length) {
        if (this.onArrived) {
          this.onArrived(target);
        }
      }
    }
  }

  getBearingToCurrentTarget() {
    if (!this.userPosition) return null;
    const target = this.getCurrentTargetCheckpoint();
    if (!target) return null;

    return bearingBetween(
      this.userPosition.lat,
      this.userPosition.lon,
      target.latitude,
      target.longitude
    );
  }

  getRemainingPathCheckpoints() {
    if (!this.path) return [];
    return this.path
      .slice(this.currentIndex)
      .map((id) => this.checkpointById.get(id));
  }
}

// Application state
let checkpoints = [];
let edges = [];
let destinations = [];
let engine = null;
let watchId = null;

let deviceHeadingDeg = 0;
let targetBearingDeg = null;

function setStatus(html) {
  statusTextEl.innerHTML = html;
}

function updateArrowTransform() {
  if (targetBearingDeg == null) return;
  const relative = (targetBearingDeg - deviceHeadingDeg + 360) % 360;
  arrowEl.style.transform = `rotate(${relative}deg)`;
}

function renderPathPreview() {
  pathPreviewEl.innerHTML = '';
  if (!engine) return;
  const cps = engine.getRemainingPathCheckpoints();
  for (const cp of cps) {
    if (!cp) continue;
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = cp.name;
    pathPreviewEl.appendChild(span);
  }
}

function handleGpsUpdate(position) {
  const { latitude, longitude } = position.coords;
  if (!engine) return;

  engine.updateUserPosition(latitude, longitude);
  const bearing = engine.getBearingToCurrentTarget();
  targetBearingDeg = bearing;
  updateArrowTransform();
  renderPathPreview();

  const currentCp = engine.getCurrentTargetCheckpoint();
  if (currentCp) {
    checkpointLabelEl.textContent = `Next checkpoint: ${currentCp.name}`;
  }
}

function handleOrientation(event) {
  let heading = null;

  if (typeof event.webkitCompassHeading === 'number') {
    heading = event.webkitCompassHeading;
  } else if (event.absolute && typeof event.alpha === 'number') {
    heading = event.alpha;
  } else if (typeof event.alpha === 'number') {
    heading = 360 - event.alpha;
  }

  if (heading != null) {
    deviceHeadingDeg = heading;
    updateArrowTransform();
  }
}

async function loadGraphFromSupabase() {
  if (!supabaseClient) {
    setStatus(
      '<span class="pill">Configure Supabase URL and key in navigation_app.js</span>'
    );
    return;
  }

  try {
    setStatus('<span class="pill">Loading graph from Supabase…</span>');

    const [{ data: cps, error: cpErr }, { data: es, error: eErr }, { data: ds, error: dErr }] =
      await Promise.all([
        supabaseClient.from('checkpoints').select('*'),
        supabaseClient.from('edges').select('*'),
        supabaseClient.from('destinations').select('*')
      ]);

    if (cpErr || eErr || dErr) {
      console.error(cpErr || eErr || dErr);
      setStatus(
        '<span class="pill">Error loading data from Supabase. Check console.</span>'
      );
      return;
    }

    checkpoints = cps || [];
    edges = es || [];
    destinations = ds || [];

    engine = new NavigationEngine({ checkpoints, edges });

    startButton.disabled = false;
    setStatus(
      '<span class="pill"><span class="ok">Graph ready.</span> Choose a destination and tap Start.</span>'
    );
  } catch (err) {
    console.error(err);
    setStatus(
      '<span class="pill">Unexpected error loading data. See console.</span>'
    );
  }
}

async function startNavigation() {
  if (!engine) return;
  const destName = destinationSelect.value;
  if (!destName) {
    setStatus(
      '<span class="pill">Select a destination first (Finance, Registrar, or Clinic).</span>'
    );
    return;
  }

  const dest = destinations.find((d) => d.name === destName);
  if (!dest) {
    setStatus(
      `<span class="pill">Destination "${destName}" not found in database.</span>`
    );
    return;
  }

  setStatus(
    `<span class="pill">Waiting for GPS fix… starting route to <strong>${destName}</strong>.</span>`
  );

  // Request DeviceOrientation permission if needed
  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation, true);
      }
    } catch (err) {
      console.warn('DeviceOrientation permission error', err);
    }
  } else {
    window.addEventListener('deviceorientation', handleOrientation, true);
  }

  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;

      if (!engine.path) {
        try {
          engine.startNavigationFromUser({
            userLat: latitude,
            userLon: longitude,
            destinationCheckpointId: dest.checkpoint_id
          });

          engine.onCheckpointReached = (cp, idx, total) => {
            console.log('Reached checkpoint', cp.name);
            if (idx + 1 < total) {
              setStatus(
                `<span class="pill"><span class="ok">Reached</span> ${cp.name}. Moving to next checkpoint…</span>`
              );
            }
          };

          engine.onArrived = (finalCp) => {
            setStatus(
              `<span class="pill"><span class="ok">Arrived at destination.</span> Final checkpoint: <strong>${finalCp.name}</strong>.</span>`
            );
            checkpointLabelEl.textContent = 'Arrived at destination';
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
          };

          renderPathPreview();
          const currentCp = engine.getCurrentTargetCheckpoint();
          if (currentCp) {
            checkpointLabelEl.textContent = `Next checkpoint: ${currentCp.name}`;
          }
        } catch (err) {
          console.error(err);
          setStatus(
            '<span class="pill">Could not compute path. Check graph connectivity.</span>'
          );
          return;
        }
      }

      handleGpsUpdate(pos);
    },
    (err) => {
      console.error(err);
      setStatus(
        `<span class="pill"><span class="err">GPS error:</span> ${err.message}</span>`
      );
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );
}

destinationSelect.addEventListener('change', () => {
  if (engine && destinationSelect.value) {
    setStatus(
      `<span class="pill">Destination selected: <strong>${destinationSelect.value}</strong>. Tap Start to begin.</span>`
    );
  }
});

startButton.addEventListener('click', () => {
  startNavigation();
});

// Initial load
window.addEventListener('load', () => {
  if (!navigator.geolocation) {
    setStatus(
      '<span class="pill"><span class="err">Geolocation not supported in this browser.</span></span>'
    );
    return;
  }

  loadGraphFromSupabase();
});

