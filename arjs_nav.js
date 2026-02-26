// AR.js location-based navigation using your checkpoint graph (no printed markers).
// This is a self-contained, simpler engine focused on GPS + compass.

const API_BASE_URL = 'api.php';
const GRAPH_API_ACTION = 'get_nav_graph';

const hudDestLabel = document.getElementById('hud-dest-label');
const hudDistance = document.getElementById('hud-distance');
const hudInstruction = document.getElementById('hud-instruction');
const hudStatus = document.getElementById('hud-status');
const destSelect = document.getElementById('dest-select');
const targetMarker = document.getElementById('target-marker');

// Earth radius
const R = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x) * (180 / Math.PI);
  let deg = (θ + 360) % 360;
  return deg;
}

function normalizeAngle(angle) {
  angle %= 360;
  if (angle < 0) angle += 360;
  return angle;
}

// --- Graph helpers (Dijkstra on checkpoints) ---

function buildAdj(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.from_checkpoint)) adj.set(e.from_checkpoint, []);
    adj.get(e.from_checkpoint).push({
      to: e.to_checkpoint,
      distance: parseFloat(e.distance),
    });
  }
  return adj;
}

function findNearestCheckpoint(lat, lon, checkpoints) {
  let best = null;
  let bestDist = Infinity;
  for (const cp of checkpoints) {
    const d = haversineMeters(
      lat,
      lon,
      parseFloat(cp.latitude),
      parseFloat(cp.longitude)
    );
    if (d < bestDist) {
      bestDist = d;
      best = cp;
    }
  }
  return { checkpoint: best, distance: bestDist };
}

function dijkstra(adj, startId, targetId) {
  const dist = new Map();
  const prev = new Map();
  const unvisited = new Set();

  for (const id of adj.keys()) {
    unvisited.add(id);
    dist.set(id, Infinity);
  }
  unvisited.add(startId);
  if (!dist.has(startId)) dist.set(startId, Infinity);
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

    const neighbors = adj.get(current) || [];
    for (const { to, distance } of neighbors) {
      const alt = currentDist + distance;
      if (alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        prev.set(to, current);
        if (!unvisited.has(to)) unvisited.add(to);
      }
    }
  }

  const path = [];
  let u = targetId;
  while (u !== undefined) {
    path.unshift(u);
    u = prev.get(u);
  }
  if (path[0] !== startId) return null;
  return path;
}

// --- Navigation state for AR.js ---

const NavState = {
  checkpoints: [],
  checkpointById: new Map(),
  edges: [],
  destinations: [],
  adj: null,

  userLat: null,
  userLon: null,
  heading: null,

  activeDestination: null,
  path: null, // array of checkpoint IDs
  currentIndex: 0,
  finalLegActive: false,

  arrivalRadius: 5, // meters
};

function updateHudStatus(text) {
  hudStatus.textContent = text;
}

function updateHudInstruction(text) {
  hudInstruction.textContent = text;
}

function updateHudDistance(meters) {
  if (meters == null || !isFinite(meters)) {
    hudDistance.textContent = 'Distance: --';
    return;
  }
  if (meters < 1000) {
    hudDistance.textContent = `Distance: ${meters.toFixed(1)} m`;
  } else {
    hudDistance.textContent = `Distance: ${(meters / 1000).toFixed(2)} km`;
  }
}

function currentTargetInfo() {
  if (!NavState.activeDestination || NavState.userLat == null) return null;

  // If final leg: go directly to office coordinates, if present.
  if (
    NavState.finalLegActive &&
    NavState.activeDestination.dest_latitude != null &&
    NavState.activeDestination.dest_longitude != null
  ) {
    const lat = parseFloat(NavState.activeDestination.dest_latitude);
    const lon = parseFloat(NavState.activeDestination.dest_longitude);
    return { type: 'office', lat, lon, name: NavState.activeDestination.name };
  }

  // Otherwise target next checkpoint in path
  if (!NavState.path || NavState.path.length === 0) return null;
  if (NavState.currentIndex >= NavState.path.length) return null;

  const id = NavState.path[NavState.currentIndex];
  const cp = NavState.checkpointById.get(id);
  if (!cp) return null;

  return {
    type: 'checkpoint',
    lat: parseFloat(cp.latitude),
    lon: parseFloat(cp.longitude),
    name: cp.name,
  };
}

function refreshTargetMarker() {
  const target = currentTargetInfo();
  if (!target) {
    targetMarker.setAttribute('visible', 'false');
    return;
  }
  targetMarker.setAttribute(
    'gps-entity-place',
    `latitude: ${target.lat}; longitude: ${target.lon}`
  );
  targetMarker.setAttribute('visible', 'true');
}

function updateTurnInstruction(distance, bearingToTarget) {
  if (NavState.heading == null || bearingToTarget == null) {
    updateHudInstruction('Point your phone forward and walk carefully.');
    return;
  }

  let diff = bearingToTarget - NavState.heading;
  diff = ((diff % 360) + 540) % 360 - 180; // -180..180

  const absDiff = Math.abs(diff);
  let text;
  if (absDiff < 15) {
    text = 'Go straight';
  } else if (absDiff < 45) {
    text = diff > 0 ? 'Slightly turn right' : 'Slightly turn left';
  } else if (absDiff < 135) {
    text = diff > 0 ? 'Turn right' : 'Turn left';
  } else {
    text = 'Turn around';
  }

  if (NavState.activeDestination) {
    if (NavState.finalLegActive) {
      text += ` towards ${NavState.activeDestination.name}`;
    } else {
      text += ` towards ${NavState.activeDestination.name}`;
    }
  }

  updateHudInstruction(text);
}

function recomputePathFromUser() {
  const { userLat, userLon, checkpoints, destinations, adj } = NavState;
  if (
    userLat == null ||
    userLon == null ||
    !checkpoints.length ||
    !destinations.length ||
    !adj
  ) {
    return;
  }
  if (!NavState.activeDestination) return;

  const destCpId = NavState.activeDestination.checkpoint_id;
  const { checkpoint: nearest } = findNearestCheckpoint(
    userLat,
    userLon,
    checkpoints
  );
  if (!nearest) return;

  const path = dijkstra(adj, nearest.id, destCpId);
  if (!path) {
    updateHudStatus('No path to destination (check graph).');
    return;
  }

  NavState.path = path;
  NavState.currentIndex = path.length > 1 ? 1 : 0;
  NavState.finalLegActive = false;

  console.log('AR.js path:', path);
  updateHudStatus('Path ready. Start walking toward the marker.');
  refreshTargetMarker();
}

function handleGpsUpdate(lat, lon) {
  NavState.userLat = lat;
  NavState.userLon = lon;

  if (NavState.activeDestination && !NavState.path && !NavState.finalLegActive) {
    // First time we have both dest and GPS: build path
    recomputePathFromUser();
  }

  const target = currentTargetInfo();
  if (!target) return;

  const d = haversineMeters(lat, lon, target.lat, target.lon);

  // Auto-advance checkpoints
  if (!NavState.finalLegActive && NavState.path && NavState.path.length > 0) {
    const currentIndex = NavState.currentIndex;
    const nextIndex = currentIndex + 1;
    const hasNext = nextIndex < NavState.path.length;

    let shouldAdvance = d < NavState.arrivalRadius;

    if (!shouldAdvance && hasNext) {
      const nextCpId = NavState.path[nextIndex];
      const nextCp = NavState.checkpointById.get(nextCpId);
      if (nextCp) {
        const dNext = haversineMeters(
          lat,
          lon,
          parseFloat(nextCp.latitude),
          parseFloat(nextCp.longitude)
        );
        const SKIP_MARGIN = 10; // meters
        if (dNext + SKIP_MARGIN < d) {
          shouldAdvance = true;
        }
      }
    }

    if (shouldAdvance) {
      NavState.currentIndex += 1;
      if (NavState.currentIndex >= NavState.path.length) {
        // Switch to final leg to office
        NavState.finalLegActive = true;
        updateHudStatus('Follow marker to the office entrance.');
      } else {
        updateHudStatus('Next checkpoint reached. Continue to the marker.');
      }
      refreshTargetMarker();
    }
  } else if (NavState.finalLegActive && NavState.activeDestination) {
    // Final leg: office is target. If within radius, we are there.
    if (d < NavState.arrivalRadius) {
      updateHudInstruction(
        `You have arrived at ${NavState.activeDestination.name}.`
      );
      updateHudDistance(0);
      targetMarker.setAttribute('visible', 'false');
      return;
    }
  }

  updateHudDistance(d);

  // Turn-by-turn using current target
  let b = null;
  if (NavState.userLat != null && NavState.heading != null) {
    b = bearingDegrees(NavState.userLat, NavState.userLon, target.lat, target.lon);
  }
  updateTurnInstruction(d, b);
}

async function loadGraph() {
  try {
    const res = await fetch(`${API_BASE_URL}?action=${GRAPH_API_ACTION}`);
    const data = await res.json();
    if (!data || !data.success) {
      updateHudStatus('Failed to load graph from server.');
      console.error('Graph error', data);
      return;
    }

    NavState.checkpoints = data.checkpoints || [];
    NavState.edges = data.edges || [];
    NavState.destinations = data.destinations || [];
    NavState.checkpointById = new Map(
      NavState.checkpoints.map((cp) => [cp.id, cp])
    );
    NavState.adj = buildAdj(NavState.edges);

    console.log('AR.js graph loaded', {
      checkpoints: NavState.checkpoints.length,
      edges: NavState.edges.length,
      destinations: NavState.destinations.length,
    });

    updateHudStatus('Graph ready. Choose a destination.');
  } catch (err) {
    console.error(err);
    updateHudStatus('Error loading graph data.');
  }
}

function selectDestinationByName(name) {
  if (!name) {
    NavState.activeDestination = null;
    NavState.path = null;
    NavState.finalLegActive = false;
    targetMarker.setAttribute('visible', 'false');
    hudDestLabel.textContent = 'No destination';
    updateHudInstruction('Select a destination to start AR.');
    updateHudDistance(null);
    return;
  }

  const dest = NavState.destinations.find(
    (d) => (d.name || '').toLowerCase() === name.toLowerCase()
  );
  if (!dest) {
    updateHudStatus(`Destination "${name}" not found in graph.`);
    return;
  }

  NavState.activeDestination = dest;
  NavState.path = null;
  NavState.currentIndex = 0;
  NavState.finalLegActive = false;

  hudDestLabel.textContent = dest.name;
  updateHudStatus('Waiting for GPS fix near your position…');
  updateHudInstruction(`Face forward and wait for GPS to stabilize.`);

  // If we already know where the user is, we can compute path immediately.
  if (NavState.userLat != null && NavState.userLon != null) {
    recomputePathFromUser();
  }
}

function initGpsWatch() {
  if (!navigator.geolocation) {
    updateHudStatus('Geolocation not supported on this device.');
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      NavState.userLat = latitude;
      NavState.userLon = longitude;
      updateHudStatus(`GPS accuracy ~${Math.round(accuracy)} m`);
      handleGpsUpdate(latitude, longitude);
    },
    (err) => {
      console.error('GPS error', err);
      updateHudStatus(`GPS error: ${err.message}`);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    }
  );
}

function initHeadingListener() {
  window.addEventListener('deviceorientation', (ev) => {
    let alpha = ev.alpha;
    if (alpha == null && typeof ev.webkitCompassHeading === 'number') {
      alpha = ev.webkitCompassHeading;
    }
    if (alpha == null) return;
    NavState.heading = normalizeAngle(alpha);
  });
}

// Wire destination selector
destSelect.addEventListener('change', (e) => {
  selectDestinationByName(e.target.value);
});

// Bootstrap
window.addEventListener('load', () => {
  updateHudStatus('Loading graph and initializing AR…');
  loadGraph();
  initGpsWatch();
  initHeadingListener();
});

