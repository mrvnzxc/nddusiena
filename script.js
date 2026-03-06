/**
 * AR Indoor Navigation System - Main JavaScript
 * Handles camera, orientation, navigation math, and AR rendering
 */

// Application State
const AppState = {
    camera: null,
    video: null,
    canvas: null,
    ctx: null,
    rooms: [],
    selectedRoom: null,
    userPosition: { x: null, y: null, floor: 1 }, // Will be set from GPS
    gpsPosition: { lat: null, lng: null }, // GPS coordinates
    heading: null,
    headingUsable: true, // false when phone is too tilted (e.g. pointed at ground)
    headingSamples: [],  // recent headings for stability check
    headingStable: false, // becomes true after a few consistent readings
    isNavigating: false,
    // Local-coordinate arrival threshold for legacy direct navigation.
    // Graph-based navigation uses a 5m threshold internally.
    arrivalThreshold: 2.0, // meters
    orientationSupported: false,
    cameraPermissionGranted: false,
    locationDetected: false,
    locationWatchId: null,
    lastEnvironmentCheck: null,
    distanceSamples: [], // recent distance readings for smoothing
    useWebXR: false // true when WebXR immersive-ar session is active; false = compass fallback
};

// Graph-based navigation state (checkpoint graph using Supabase)
const GraphNav = {
    checkpoints: [],
    // Optional map from id -> checkpoint, filled after loadNavigationGraph
    // (engine maintains its own map internally as well)
    edges: [],
    destinations: [],
    engine: null,
    activeDestination: null,   // destination row from graph (Finance, Registrar, Clinic)
    pendingDestinationId: null, // checkpoint_id to start from once GPS is ready
    finalLegActive: false,      // true when walking last meters to office door
    finalCheckpoint: null,      // last checkpoint before office
    replanThreshold: 25,        // meters: when too far from current target, recompute path
    lastReplanTs: 0             // timestamp of last replan (ms)
};

// GPS to Local Coordinate Conversion Configuration
// Building origin: Notre Dame Siena College (center point of offices)
const BUILDING_CONFIG = {
    originLat: 6.153058, // Building origin latitude (center of Finance, Registrar, Guidance)
    originLng: 125.167484, // Building origin longitude (center of offices)
    metersPerDegreeLat: 111000, // Approximate meters per degree latitude
    metersPerDegreeLng: 111000 // Will be adjusted based on latitude
};

// Sensor smoothing (GPS and compass) - reduces jitter and drift into non-walkable areas
const GPS_EMA_ALPHA = 0.1;
const GPS_MOVEMENT_THRESHOLD_M = 3.5;
const HEADING_LERP_FACTOR = 0.25;
let smoothedLat = null;
let smoothedLon = null;
let lastAcceptedLat = null;
let lastAcceptedLon = null;
let smoothedHeading = null;

// Supabase Configuration (no PHP - direct client for Vercel/static hosting)
const SUPABASE_URL = 'https://pllmhqlssdmfijqagkxi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsbG1ocWxzc2RtZmlqcWFna3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NTEwOTEsImV4cCI6MjA4NzQyNzA5MX0.3QUWRVZo8EiyhsuUO-OFA2rrN51FxjL6or8Atp7htTE';

const supabaseClient = typeof window !== 'undefined' && window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// WebXR state - world-anchored AR on supported Android
const WebXRArrows = {
    supported: false,
    session: null,
    renderer: null,
    scene: null,
    camera: null,
    arrowMeshes: [],
    container: null,
    threeLoaded: false,

    async checkSupport() {
        if (typeof navigator === 'undefined' || !navigator.xr) return false;
        try {
            this.supported = await navigator.xr.isSessionSupported('immersive-ar');
            console.log('WebXR immersive-ar supported:', this.supported);
            return this.supported;
        } catch (e) {
            console.log('WebXR check failed:', e.message);
            return false;
        }
    },

    async loadThree() {
        if (window.THREE) {
            this.threeLoaded = true;
            return true;
        }
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
            script.onload = () => {
                this.threeLoaded = true;
                resolve(true);
            };
            script.onerror = () => resolve(false);
            document.head.appendChild(script);
        });
    },

    async startSession() {
        if (!this.supported || !navigator.xr) return false;
        try {
            await this.loadThree();
            if (!window.THREE) {
                console.warn('Three.js failed to load, using compass fallback');
                return false;
            }
            const session = await navigator.xr.requestSession('immersive-ar', {
                optionalFeatures: ['local-floor']
            });
            this.session = session;
            this._setupThreeScene();
            await this._setupWebGL(session);
            AppState.useWebXR = true;
            const pathContainer = document.getElementById('ar-path-container');
            if (pathContainer) pathContainer.style.display = 'none';
            const camVideo = document.getElementById('camera-video');
            if (camVideo) camVideo.style.display = 'none';
            console.log('WebXR mode active: world-anchored arrows');
            return true;
        } catch (e) {
            console.log('WebXR session failed, using compass fallback:', e.message);
            AppState.useWebXR = false;
            return false;
        }
    },

    _setupThreeScene() {
        const THREE = window.THREE;
        if (!THREE) return;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
        this.camera.position.set(0, 1.6, 0);
        this.arrowMeshes = [];
    },

    async _setupWebGL(session) {
        const THREE = window.THREE;
        if (!THREE) return;
        this.container = document.getElementById('camera-container') || document.body;
        const canvas = document.createElement('canvas');
        canvas.id = 'webxr-canvas';
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        this.container.appendChild(canvas);

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        this.renderer.xr.enabled = true;
        this.renderer.xr.setSession(session);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setAnimationLoop(() => this._renderLoop());
    },

    _renderLoop() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    },

    gpsToLocalFloor(userLat, userLon, cpLat, cpLon) {
        const dLat = (parseFloat(cpLat) - parseFloat(userLat)) * BUILDING_CONFIG.metersPerDegreeLat;
        const cosLat = Math.cos(parseFloat(userLat) * Math.PI / 180);
        const dLon = (parseFloat(cpLon) - parseFloat(userLon)) * BUILDING_CONFIG.metersPerDegreeLng * cosLat;
        return { x: dLon, y: 0, z: dLat };
    },

    updateArrows(userLat, userLon, checkpoints) {
        if (!this.scene || !window.THREE) return;
        if (!checkpoints || checkpoints.length === 0) {
            this.arrowMeshes.forEach(m => { m.visible = false; });
            return;
        }
        const THREE = window.THREE;
        const maxArrows = Math.min(checkpoints.length, 5);
        while (this.arrowMeshes.length < maxArrows) {
            const geo = new THREE.ConeGeometry(0.15, 0.5, 8);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
            const mesh = new THREE.Mesh(geo, mat);
            this.scene.add(mesh);
            this.arrowMeshes.push(mesh);
        }
        for (let i = 0; i < maxArrows; i++) {
            const cp = checkpoints[i];
            const pos = this.gpsToLocalFloor(userLat, userLon, cp.latitude, cp.longitude);
            this.arrowMeshes[i].position.set(pos.x, pos.y, pos.z);
            this.arrowMeshes[i].visible = true;
        }
        for (let i = maxArrows; i < this.arrowMeshes.length; i++) {
            this.arrowMeshes[i].visible = false;
        }
    },

    endSession() {
        if (this.session) {
            this.session.end();
            this.session = null;
        }
        if (this.renderer) {
            this.renderer.setAnimationLoop(null);
            this.renderer.dispose();
            if (this.renderer.domElement?.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
            this.renderer = null;
        }
        if (this.scene) {
            this.arrowMeshes.forEach(m => {
                if (m.geometry) m.geometry.dispose();
                if (m.material) m.material.dispose();
                this.scene.remove(m);
            });
            this.arrowMeshes = [];
            this.scene = null;
        }
        this.camera = null;
        AppState.useWebXR = false;
        const pathContainer = document.getElementById('ar-path-container');
        if (pathContainer) pathContainer.style.display = '';
        const camVideo = document.getElementById('camera-video');
        if (camVideo) camVideo.style.display = '';
        console.log('WebXR session ended, compass fallback active');
    }
};

/**
 * Initialize the application
 */
async function init() {
    console.log('Initializing AR Navigation System...');
    
    // Get DOM elements (may not exist if on landing page)
    AppState.video = document.getElementById('camera-video');
    AppState.canvas = document.getElementById('ar-canvas');
    if (AppState.canvas) {
        AppState.ctx = AppState.canvas.getContext('2d');
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Check device orientation support
    checkOrientationSupport();
    
    // Load rooms from database
    await loadRooms();

    // Load checkpoint graph (checkpoints, edges, destinations) for graph-based navigation
    await loadNavigationGraph();

    // Detect WebXR immersive-ar support (Android with ARCore)
    await WebXRArrows.checkSupport();
    
    // Detect user's current location
    await detectUserLocation();
    
    // Initialize UI
    updateUI();
    
    console.log('Initialization complete');
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Camera permission button
    const requestCameraBtn = document.getElementById('request-camera-btn');
    if (requestCameraBtn) {
        requestCameraBtn.addEventListener('click', requestCameraPermission);
    }
    
    // Position update button (AR view)
    const updatePositionBtn = document.getElementById('update-position-btn');
    if (updatePositionBtn) {
        updatePositionBtn.addEventListener('click', updateUserPositionFromAR);
    }
    
    // Toggle panel button
    const togglePanelBtn = document.getElementById('toggle-panel-btn');
    if (togglePanelBtn) {
        togglePanelBtn.addEventListener('click', toggleControlPanel);
    }
    
    // Back button
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', goBackToLanding);
    }
    
    // Back to landing from arrival message
    const backToLandingBtn = document.getElementById('back-to-landing-btn');
    if (backToLandingBtn) {
        backToLandingBtn.addEventListener('click', goBackToLanding);
    }
    
    // Device orientation events
    if (window.DeviceOrientationEvent) {
        // Prefer absolute orientation (true compass) on Android
        if (window.DeviceOrientationEvent && 'ondeviceorientationabsolute' in window) {
            window.addEventListener('deviceorientationabsolute', handleDeviceOrientation);
        } else {
            window.addEventListener('deviceorientation', handleDeviceOrientation);
        }
    } else if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ requires permission
        if (requestCameraBtn) {
            requestCameraBtn.addEventListener('click', async () => {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    window.addEventListener('deviceorientation', handleDeviceOrientation);
                }
            });
        }
    }
    
    // Window resize handler
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);
}

/**
 * Check if device orientation is supported
 */
function checkOrientationSupport() {
    if (window.DeviceOrientationEvent || window.DeviceOrientationEventAbsolute) {
        AppState.orientationSupported = true;
        updateStatus('Orientation API supported', 'success');
    } else {
        AppState.orientationSupported = false;
        updateStatus('Orientation API not supported', 'warning');
    }
}

/**
 * Detect user's current location using GPS
 */
async function detectUserLocation() {
    updateLocationStatus('Detecting your location...', 'detecting');
    
    if (!navigator.geolocation) {
        updateLocationStatus('Geolocation not supported by your browser', 'error');
        // Use default fallback position
        AppState.userPosition = { x: 10.0, y: 15.0 };
        return;
    }
    
    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    };
    
    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, options);
        });
        
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        smoothedLat = lat;
        smoothedLon = lng;
        lastAcceptedLat = lat;
        lastAcceptedLon = lng;
        AppState.gpsPosition = { lat: smoothedLat, lng: smoothedLon };
        const localCoords = convertGPSToLocal(smoothedLat, smoothedLon);
        AppState.userPosition = localCoords;
        AppState.locationDetected = true;
        updateLocationStatus(`Location detected (Accuracy: ${Math.round(accuracy)}m)`, 'success');
        updateARPositionDisplay();
        startWatchingPosition();
        console.log('Location detected:', { lat, lng, local: localCoords });
        console.log('Smoothed GPS:', smoothedLat, smoothedLon);
        
    } catch (error) {
        console.error('Geolocation error:', error);
        let errorMessage = 'Unable to detect location';
        
        switch(error.code) {
            case error.PERMISSION_DENIED:
                errorMessage = 'Location permission denied. Please enable location access.';
                break;
            case error.POSITION_UNAVAILABLE:
                errorMessage = 'Location information unavailable.';
                break;
            case error.TIMEOUT:
                errorMessage = 'Location request timed out.';
                break;
        }
        
        updateLocationStatus(errorMessage, 'error');
        // Use default fallback position
        AppState.userPosition = { x: 10.0, y: 15.0 };
    }
}

/**
 * Start watching position for continuous updates
 */
function startWatchingPosition() {
    if (AppState.locationWatchId !== null) {
        return; // Already watching
    }
    
    const options = {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 1000
    };
    
    AppState.locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const movementM = (lastAcceptedLat != null && lastAcceptedLon != null)
                ? haversineDistanceMeters(lastAcceptedLat, lastAcceptedLon, lat, lng)
                : Infinity;
            if (movementM < GPS_MOVEMENT_THRESHOLD_M) {
                return;
            }
            if (smoothedLat == null || smoothedLon == null) {
                smoothedLat = lat;
                smoothedLon = lng;
            } else {
                smoothedLat = GPS_EMA_ALPHA * lat + (1 - GPS_EMA_ALPHA) * smoothedLat;
                smoothedLon = GPS_EMA_ALPHA * lng + (1 - GPS_EMA_ALPHA) * smoothedLon;
            }
            lastAcceptedLat = smoothedLat;
            lastAcceptedLon = smoothedLon;
            AppState.gpsPosition = { lat: smoothedLat, lng: smoothedLon };
            const localCoords = convertGPSToLocal(smoothedLat, smoothedLon);
            AppState.userPosition = localCoords;
            console.log('Smoothed GPS:', smoothedLat, smoothedLon);
            updateARPositionDisplay();
            if (GraphNav.engine && GraphNav.activeDestination && GraphNav.pendingDestinationId && !GraphNav.finalLegActive) {
                const now = Date.now();
                const needsReplan =
                    !GraphNav.engine.currentPath.length ||
                    GraphNav.engine.isUserOffPath(smoothedLat, smoothedLon, GraphNav.replanThreshold);
                if (needsReplan && (!GraphNav.lastReplanTs || now - GraphNav.lastReplanTs > 4000)) {
                    try {
                        GraphNav.engine.startNavigationFromUser({
                            userLat: smoothedLat,
                            userLon: smoothedLon,
                            destinationCheckpointId: GraphNav.pendingDestinationId
                        });
                        GraphNav.engine.onCheckpointReached = (checkpoint, index, total) => {
                            console.log('Reached checkpoint:', checkpoint.name);
                        };
                        GraphNav.engine.onArrived = (finalCheckpoint) => {
                            console.log('Reached final checkpoint in graph:', finalCheckpoint.name);
                            GraphNav.finalLegActive = true;
                            GraphNav.finalCheckpoint = finalCheckpoint;
                            GraphNav.pendingDestinationId = null;
                        };
                        GraphNav.lastReplanTs = now;
                    } catch (err) {
                        console.error('Error (re)starting graph navigation:', err);
                    }
                }
                if (GraphNav.engine.currentPath.length && !GraphNav.finalLegActive) {
                    const gpsAccuracy = position.coords.accuracy;
                    GraphNav.engine.updateUserPosition(smoothedLat, smoothedLon, gpsAccuracy);
                }
            }
            if (AppState.isNavigating && AppState.selectedRoom) {
                updateNavigation();
            }
        },
        (error) => {
            console.error('Position watch error:', error);
        },
        options
    );
}

/**
 * Convert GPS coordinates (latitude, longitude) to local building coordinates (x, y)
 * Uses the building origin as reference point
 */
function convertGPSToLocal(lat, lng) {
    // Calculate difference from building origin
    const deltaLat = lat - BUILDING_CONFIG.originLat;
    const deltaLng = lng - BUILDING_CONFIG.originLng;
    
    // Convert to meters
    // Adjust longitude conversion based on latitude (cosine correction)
    const metersPerDegreeLng = BUILDING_CONFIG.metersPerDegreeLng * Math.cos(BUILDING_CONFIG.originLat * Math.PI / 180);
    
    const x = deltaLng * metersPerDegreeLng; // East-West (longitude)
    const y = deltaLat * BUILDING_CONFIG.metersPerDegreeLat; // North-South (latitude)
    
    return { x, y };
}

/**
 * Update location status display on landing page
 */
function updateLocationStatus(message, status = 'detecting') {
    const statusElement = document.getElementById('location-status-text');
    const statusContainer = document.getElementById('location-status');
    
    if (statusElement) {
        statusElement.textContent = message;
    }
    
    if (statusContainer) {
        statusContainer.className = `location-status status-${status}`;
    }
}

/**
 * Update AR view position display
 */
function updateARPositionDisplay() {
    const arXInput = document.getElementById('ar-user-x');
    const arYInput = document.getElementById('ar-user-y');
    
    if (arXInput && AppState.userPosition.x !== null) {
        arXInput.value = AppState.userPosition.x.toFixed(2);
    }
    
    if (arYInput && AppState.userPosition.y !== null) {
        arYInput.value = AppState.userPosition.y.toFixed(2);
    }
}

/**
 * Request camera permission and start video stream
 */
async function requestCameraPermission() {
    try {
        const constraints = {
            video: {
                facingMode: 'environment', // Use back camera
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };
        
        AppState.camera = await navigator.mediaDevices.getUserMedia(constraints);
        AppState.video.srcObject = AppState.camera;
        AppState.cameraPermissionGranted = true;
        
        // Wait for video to be ready
        AppState.video.addEventListener('loadedmetadata', () => {
            resizeCanvas();
            updateStatus('Camera active', 'success');
            document.getElementById('camera-permission-section').style.display = 'none';
        });
        
    } catch (error) {
        console.error('Camera access error:', error);
        updateStatus('Camera access denied', 'error');
        alert('Camera access is required for AR navigation. Please grant permission and refresh the page.');
    }
}

/**
 * Handle device orientation events
 */
function handleDeviceOrientation(event) {
    // Get compass heading from device orientation (0-360, North=0, clockwise)
    let alpha = null;

    if (typeof event.webkitCompassHeading === 'number') {
        // iOS: webkitCompassHeading is already true-North clockwise (0-360)
        alpha = event.webkitCompassHeading;
    } else if (event.absolute === true && typeof event.alpha === 'number') {
        // Android absolute: alpha is counterclockwise from North, convert to clockwise
        alpha = (360 - event.alpha) % 360;
    } else if (typeof event.alpha === 'number') {
        // Fallback: treat alpha as-is (may not be true North)
        alpha = (360 - event.alpha) % 360;
    }
    
    // Determine if phone is too tilted (e.g. pointed at ground)
    // beta ~ 0 when flat on table, ~90 when upright in portrait
    const beta = typeof event.beta === 'number' ? event.beta : null;
    if (beta !== null) {
        // Treat heading as unreliable if phone is very flat or upside-down
        AppState.headingUsable = Math.abs(beta) > 30 && Math.abs(beta) < 120;
    } else {
        AppState.headingUsable = true;
    }

    if (alpha !== null && alpha !== undefined) {
        const newHeading = normalizeAngle(alpha);
        if (smoothedHeading == null) {
            smoothedHeading = newHeading;
        } else {
            const d = headingDiff(smoothedHeading, newHeading);
            smoothedHeading = normalizeAngle(smoothedHeading + HEADING_LERP_FACTOR * d);
        }
        AppState.heading = smoothedHeading;
        AppState.headingSamples.push(smoothedHeading);
        if (AppState.headingSamples.length > 10) {
            AppState.headingSamples.shift();
        }
        if (AppState.headingSamples.length >= 4) {
            const minH = Math.min(...AppState.headingSamples);
            const maxH = Math.max(...AppState.headingSamples);
            AppState.headingStable = (maxH - minH) <= 20;
        } else {
            AppState.headingStable = false;
        }
        const headingDisplay = document.getElementById('heading-value');
        if (headingDisplay) {
            headingDisplay.textContent = Math.round(AppState.heading);
        }
        console.log('Smoothed Heading:', smoothedHeading);
        if (AppState.isNavigating && AppState.selectedRoom && AppState.headingUsable && AppState.headingStable) {
            updateNavigation();
        }
    }
}

/**
 * Normalize angle to 0-360 range
 */
function normalizeAngle(angle) {
    angle = angle % 360;
    if (angle < 0) {
        angle += 360;
    }
    return angle;
}

/**
 * Shortest signed angle difference (to - from), in [-180, 180], for heading wrap-around
 */
function headingDiff(fromDeg, toDeg) {
    let d = (toDeg - fromDeg) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

/**
 * Calculate bearing from user position to destination
 * Returns angle in degrees (0-360)
 */
function calculateBearing(userPos, destPos) {
    const dx = destPos.x - userPos.x;
    const dy = destPos.y - userPos.y;
    
    // Calculate bearing using atan2
    // atan2 returns angle in radians from -π to π
    // We convert to degrees and normalize to 0-360
    let bearing = Math.atan2(dy, dx) * (180 / Math.PI);
    
    // Convert from mathematical angle (0° = East, 90° = North)
    // to compass bearing (0° = North, 90° = East)
    bearing = 90 - bearing;
    
    return normalizeAngle(bearing);
}

/**
 * Calculate Euclidean distance between two points
 */
function calculateDistance(pos1, pos2) {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate angle difference for arrow rotation
 * Returns the angle the arrow should rotate relative to screen up (0°)
 */
/**
 * Calculate arrow rotation - ACCURATE navigation
 * Arrow behavior:
 * - Positive angle = destination is to your RIGHT, arrow points RIGHT (turn right)
 * - Negative angle = destination is to your LEFT, arrow points LEFT (turn left)
 * - 0° = you're facing destination, arrow points STRAIGHT
 * 
 * Example: If arrow says "straight" (0°) and you turn phone LEFT:
 * - Your heading decreases (e.g., from 90° to 60°)
 * - Bearing stays same (e.g., 90°)
 * - angleDiff = 90 - 60 = 30° (positive = arrow points RIGHT = correct!)
 */
function calculateArrowRotation(heading, bearing) {
    if (heading === null || bearing === null) {
        return 0;
    }
    
    // Calculate the difference: bearing (where to go) - heading (where you're facing)
    // Positive = target is to your RIGHT, negative = to your LEFT
    let angleDiff = bearing - heading;
    
    // Normalize to -180 to 180 range for shortest rotation path
    // This ensures we always take the shortest turn direction
    angleDiff = ((angleDiff % 360) + 540) % 360 - 180;
    
    // Return the angle difference - this is the exact direction to turn
    return angleDiff;
}

/**
 * Detect if user is facing a wall
 * Rule-based: If heading is perpendicular to bearing (90° difference)
 */
function detectWall(heading, bearing) {
    if (heading === null || bearing === null) return false;
    
    const angleDiff = Math.abs(normalizeAngle(bearing - heading));
    // Wall detection: heading is perpendicular to destination (80-100 degrees difference)
    return angleDiff >= 80 && angleDiff <= 100;
}

/**
 * Detect doors (rule-based: near waypoints or coordinate boundaries)
 */
function detectDoor(userPos, destPos, distance) {
    // Assume doors are at coordinate boundaries or waypoints
    // Check if user is near a coordinate that might have a door
    const dx = Math.abs(destPos.x - userPos.x);
    const dy = Math.abs(destPos.y - userPos.y);
    
    // Door detection: if path requires significant coordinate change
    // and user is close to a boundary (within 3 meters of coordinate change)
    const nearXBoundary = dx > 5 && Math.abs(userPos.x % 10) < 3;
    const nearYBoundary = dy > 5 && Math.abs(userPos.y % 10) < 3;
    
    return (nearXBoundary || nearYBoundary) && distance > 5;
}

/**
 * Detect gates (rule-based: major coordinate transitions)
 */
function detectGate(userPos, destPos, distance) {
    // Gates are typically at major building entrances or floor transitions
    const dx = Math.abs(destPos.x - userPos.x);
    const dy = Math.abs(destPos.y - userPos.y);
    
    // Gate detection: major coordinate change (likely building entrance/exit)
    const majorTransition = dx > 15 || dy > 15;
    const nearTransition = distance < 20 && distance > 8;
    
    return majorTransition && nearTransition;
}

/**
 * Detect if stairs are needed
 * Rule-based: If destination is on different floor level
 */
function detectStairs(userFloor, destFloor) {
    return userFloor !== destFloor;
}

/**
 * Detect hallway/pathway
 * Rule-based: If user is moving toward destination (heading aligns with bearing)
 */
function detectHallway(heading, bearing) {
    if (heading === null || bearing === null) return false;
    
    const angleDiff = Math.abs(normalizeAngle(bearing - heading));
    // Hallway: heading aligns with destination (within 30 degrees)
    return angleDiff <= 30;
}

/**
 * Show environment detection message
 */
function showEnvironmentMessage(type, message, icon) {
    const envMessage = document.getElementById('environment-message');
    const envText = document.getElementById('environment-text');
    const envIcon = document.getElementById('environment-icon');
    
    if (envMessage && envText && envIcon) {
        envText.textContent = message;
        envIcon.className = `bi ${icon}`;
        envMessage.className = `environment-message environment-${type}`;
        envMessage.classList.remove('hidden');
    }
}

/**
 * Hide environment detection message
 */
function hideEnvironmentMessage() {
    const envMessage = document.getElementById('environment-message');
    if (envMessage) {
        envMessage.classList.add('hidden');
    }
}

/**
 * Update navigation display
 */
function updateNavigation() {
    if (!AppState.selectedRoom) {
        return;
    }
    
    // Check if user position is valid
    if (AppState.userPosition.x === null || AppState.userPosition.y === null) {
        return;
    }

    const checkpointTarget = GraphNav.engine
        ? GraphNav.engine.getCurrentTargetCheckpoint()
        : null;

    const usingGraph = !!GraphNav.activeDestination;

    let destination;
    let userFloor = AppState.userPosition.floor || 1;
    let bearing;
    let distance;
    let labelName;
    let currentCheckpoint = checkpointTarget;

    // Decide what the "navigation target" is:
    // - While following checkpoints: current checkpoint
    // - Final leg: actual office coordinates (dest_latitude/dest_longitude)
    let targetLat = null;
    let targetLon = null;

    if (
        usingGraph &&
        GraphNav.finalLegActive &&
        GraphNav.activeDestination &&
        GraphNav.activeDestination.dest_latitude !== null &&
        GraphNav.activeDestination.dest_longitude !== null
    ) {
        // Final meters: direct to the office
        targetLat = parseFloat(GraphNav.activeDestination.dest_latitude);
        targetLon = parseFloat(GraphNav.activeDestination.dest_longitude);
        const local = convertGPSToLocal(targetLat, targetLon);
        destination = { x: local.x, y: local.y, floor: 1 };
    } else if (usingGraph && currentCheckpoint) {
        targetLat = parseFloat(currentCheckpoint.latitude);
        targetLon = parseFloat(currentCheckpoint.longitude);
        const local = currentCheckpoint.local || convertGPSToLocal(targetLat, targetLon);
        currentCheckpoint.local = local;
        destination = { x: local.x, y: local.y, floor: 1 };
    } else {
        destination = {
            x: AppState.selectedRoom.x,
            y: AppState.selectedRoom.y,
            floor: AppState.selectedRoom.floor || 1
        };

        labelName = AppState.selectedRoom.display_name;
    }

    // High-level label: always talk about the destination office, not checkpoints
    if (usingGraph && GraphNav.activeDestination) {
        labelName = GraphNav.activeDestination.name;
    }
    
    // Calculate bearing to navigation target.
    // Prefer GPS bearings (true compass) when available.
    if (
        usingGraph &&
        targetLat !== null &&
        targetLon !== null &&
        AppState.gpsPosition.lat !== null &&
        AppState.gpsPosition.lng !== null
    ) {
        bearing = bearingBetweenLatLon(
            AppState.gpsPosition.lat,
            AppState.gpsPosition.lng,
            targetLat,
            targetLon
        );
    } else {
        // Fallback: use local x/y bearing
        bearing = calculateBearing(AppState.userPosition, destination);
    }
    
    // Distance: use Haversine when targetLat/targetLon are known, otherwise local x/y (in meters)
    if (
        usingGraph &&
        targetLat !== null &&
        targetLon !== null &&
        AppState.gpsPosition.lat !== null &&
        AppState.gpsPosition.lng !== null
    ) {
        distance = haversineDistanceMeters(
            AppState.gpsPosition.lat,
            AppState.gpsPosition.lng,
            targetLat,
            targetLon
        );
    } else {
        distance = calculateDistance(AppState.userPosition, destination);
    }
    
    // Smooth distance for display to reduce GPS jitter near checkpoints
    if (!Number.isNaN(distance) && isFinite(distance)) {
        AppState.distanceSamples.push(distance);
        if (AppState.distanceSamples.length > 5) {
            AppState.distanceSamples.shift();
        }
    }
    const smoothedDistance =
        AppState.distanceSamples.length > 0
            ? AppState.distanceSamples.reduce((a, b) => a + b, 0) / AppState.distanceSamples.length
            : distance;

    // Update distance display (smoothed)
    updateDistanceDisplay(smoothedDistance);
    
    // Handle arrival on final leg for graph navigation (office coordinates)
    if (usingGraph && GraphNav.finalLegActive && smoothedDistance < 10 && GraphNav.activeDestination) {
        showArrivalMessage(GraphNav.activeDestination.name);
        hideFloorMarker();
        hideEnvironmentMessage();
        AppState.isNavigating = false;
        GraphNav.finalLegActive = false;
        return;
    }

    // Update destination label
    updateDestinationLabel(labelName);
    
    // For legacy direct navigation, arrival is based on distance to final room.
    // For graph navigation, per-checkpoint arrival is handled inside GraphNav.engine.
    if (!usingGraph && distance < AppState.arrivalThreshold) {
        showArrivalMessage(AppState.selectedRoom.display_name);
        hideFloorMarker();
        hideEnvironmentMessage();
        return;
    }
    
    // Simplified: always show floor marker, no "door/gate/wall" messages
    hideEnvironmentMessage();
    showFloorMarker();
    
    // Calculate pathway waypoints
    let newPathway;
    if (usingGraph) {
        // Build waypoints from remaining checkpoints in the graph path
        const remaining = GraphNav.engine.getRemainingPathCheckpoints() || [];
        const waypoints = remaining.map(cp => {
            const local = cp.local || convertGPSToLocal(
                parseFloat(cp.latitude),
                parseFloat(cp.longitude)
            );
            cp.local = local;
            return { x: local.x, y: local.y };
        });
        newPathway = waypoints.length > 0 ? waypoints : [destination];
    } else {
        newPathway = calculatePathway(AppState.userPosition, destination);
    }
    
    // Check if pathway changed significantly (more than 2 meters difference)
    let pathwayChanged = false;
    if (currentPathway.length !== newPathway.length) {
        pathwayChanged = true;
    } else {
        for (let i = 0; i < newPathway.length; i++) {
            const dist = calculateDistance(currentPathway[i] || AppState.userPosition, newPathway[i]);
            if (dist > 2) {
                pathwayChanged = true;
                break;
            }
        }
    }
    currentPathway = newPathway;

    // Graph checkpoint phase: ground-projected path arrows (Google Maps Live View style)
    // Use headingUsable only (not headingStable) so path arrows show immediately - they have their own smoothing
    const hasGps = AppState.gpsPosition.lat != null && AppState.gpsPosition.lng != null;
    const hasManualPos = AppState.userPosition.x != null && AppState.userPosition.y != null;
    const usePathArrows = usingGraph && !GraphNav.finalLegActive && GraphNav.engine &&
        (hasGps || hasManualPos) &&
        (AppState.useWebXR || (AppState.heading !== null && AppState.headingUsable));

    const arrowPathEl = document.getElementById('arrow-path');
    if (usePathArrows) {
        let pathUserLat = AppState.gpsPosition.lat;
        let pathUserLon = AppState.gpsPosition.lng;
        if (pathUserLat == null || pathUserLon == null) {
            const m = BUILDING_CONFIG.metersPerDegreeLng * Math.cos(BUILDING_CONFIG.originLat * Math.PI / 180);
            pathUserLat = BUILDING_CONFIG.originLat + (AppState.userPosition.y || 0) / BUILDING_CONFIG.metersPerDegreeLat;
            pathUserLon = BUILDING_CONFIG.originLng + (AppState.userPosition.x || 0) / m;
        }
        if (AppState.useWebXR) {
            const remaining = GraphNav.engine.getRemainingPathCheckpoints() || [];
            WebXRArrows.updateArrows(pathUserLat, pathUserLon, remaining.slice(0, 5));
        } else {
            renderPathArrows(pathUserLat, pathUserLon, AppState.heading);
        }
    } else {
        // Legacy: single rotated arrow path or final-leg/non-graph mode
        const hasPathArrows = arrowPathEl?.querySelector('.ar-path-arrow');
        if (pathwayChanged || currentPathway.length === 0 || hasPathArrows) {
            createArrowPath(currentPathway);
        }
    }

    // Always update arrow rotation and text instruction - MUST be accurate and responsive
    if (AppState.heading !== null && AppState.headingUsable && AppState.headingStable) {
        let targetBearing;

        // Graph navigation (checkpoint phase): arrow bearing STRICTLY from getCurrentTargetCheckpoint only
        const target = GraphNav.engine ? GraphNav.engine.getCurrentTargetCheckpoint() : null;
        if (usingGraph && !GraphNav.finalLegActive && target) {
            const userLat = AppState.gpsPosition.lat;
            const userLon = AppState.gpsPosition.lng;
            if (userLat !== null && userLon !== null) {
                targetBearing = bearingBetweenLatLon(userLat, userLon, parseFloat(target.latitude), parseFloat(target.longitude));
            } else {
                const targetLocal = target.local || convertGPSToLocal(parseFloat(target.latitude), parseFloat(target.longitude));
                targetBearing = calculateBearing(AppState.userPosition, { x: targetLocal.x, y: targetLocal.y });
            }
            console.log('ARROW TARGET:', target.name);
        } else if (usingGraph && GraphNav.finalLegActive && targetLat !== null && targetLon !== null && AppState.gpsPosition.lat !== null && AppState.gpsPosition.lng !== null) {
            // Final leg: bearing to office coordinates
            targetBearing = bearingBetweenLatLon(
                AppState.gpsPosition.lat,
                AppState.gpsPosition.lng,
                targetLat,
                targetLon
            );
        } else if (!usingGraph) {
            // Non-graph: bearing in local coordinate space
            const targetPoint = currentPathway.length > 0 ? currentPathway[0] : destination;
            targetBearing = calculateBearing(AppState.userPosition, targetPoint);
        } else {
            targetBearing = null;
        }

        const arrowRotation = targetBearing !== null ? calculateArrowRotation(AppState.heading, targetBearing) : 0;
        
        // Rotate arrow only when NOT using ground-projected path arrows
        if (!usePathArrows) {
            rotateArrow(arrowRotation);
        }

        // Turn-by-turn text instruction
        const absDiff = Math.abs(arrowRotation);
        let instruction;
        if (absDiff < 15) {
            instruction = 'Go straight';
        } else if (absDiff < 45) {
            instruction = arrowRotation > 0 ? 'Slightly turn right' : 'Slightly turn left';
        } else if (absDiff < 135) {
            instruction = arrowRotation > 0 ? 'Turn right' : 'Turn left';
        } else {
            instruction = 'Turn around';
        }

        if (usingGraph && GraphNav.activeDestination) {
            instruction += ` towards ${GraphNav.activeDestination.name}`;
        } else if (AppState.selectedRoom) {
            instruction += ` towards ${AppState.selectedRoom.display_name}`;
        }

        updateNavInstruction(instruction);
    } else {
        // Even without a reliable, stable heading, keep arrows neutral and guide user
        rotateArrow(0); // Point straight initially
        updateNavInstruction('Hold your phone upright and steady to calibrate direction');
    }
}

/**
 * Update distance display
 */
function updateDistanceDisplay(distance) {
    const distanceText = document.getElementById('distance-text');
    distanceText.textContent = `≈ ${distance.toFixed(1)} meters`;
}

// Store current pathway waypoints
let currentPathway = [];

// Ground-projected path arrows: smoothed positions for anti-jitter
const pathArrowSmoothState = {
    positions: [],  // [{ x, y }] per arrow index
    lerpFactor: 0.25
};

/**
 * Render ground-anchored path arrows in the lower screen (65%-90% height).
 * Arrows use horizontal placement for direction; no rotateZ. transform-origin: 50% 100%.
 */
function renderPathArrows(userLat, userLon, heading) {
    const arrowPath = document.getElementById('arrow-path');
    const pathContainer = document.getElementById('ar-path-container');
    if (!arrowPath || !pathContainer || !GraphNav.engine) return;

    const remaining = GraphNav.engine.getRemainingPathCheckpoints() || [];
    const maxArrows = 5;
    const checkpoints = remaining.slice(0, maxArrows);
    if (checkpoints.length === 0) {
        arrowPath.querySelectorAll('.ar-path-arrow').forEach(el => { el.style.visibility = 'hidden'; });
        return;
    }

    const screenWidth = pathContainer.offsetWidth || window.innerWidth;
    const screenHeight = pathContainer.offsetHeight || window.innerHeight;
    const centerX = screenWidth / 2;
    const maxXOffset = screenWidth * 0.35;
    const arrowHeight = 70;

    arrowPath.style.transform = 'none';
    arrowPath.querySelectorAll('.ar-arrow-marker').forEach(el => el.remove());

    let arrows = arrowPath.querySelectorAll('.ar-path-arrow');
    for (let i = arrows.length; i < checkpoints.length; i++) {
        const marker = document.createElement('div');
        marker.className = 'ar-path-arrow';
        marker.style.position = 'absolute';
        marker.style.transformOrigin = '50% 100%';
        marker.style.willChange = 'transform';
        marker.style.pointerEvents = 'none';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', 'M50 15 L75 55 L60 55 L60 80 L40 80 L40 55 L25 55 Z');
        pathEl.setAttribute('class', 'arrow-shape');
        pathEl.setAttribute('fill', '#00ff88');
        pathEl.setAttribute('stroke', '#00cc6a');
        pathEl.setAttribute('stroke-width', '2');
        svg.appendChild(pathEl);
        marker.appendChild(svg);
        arrowPath.appendChild(marker);
    }
    arrows = arrowPath.querySelectorAll('.ar-path-arrow');

    for (let i = checkpoints.length; i < arrows.length; i++) {
        arrows[i].style.visibility = 'hidden';
    }

    const userLatF = parseFloat(userLat);
    const userLonF = parseFloat(userLon);
    const headingNorm = ((heading % 360) + 360) % 360;

    for (let i = 0; i < checkpoints.length; i++) {
        const cp = checkpoints[i];
        const cpLat = parseFloat(cp.latitude);
        const cpLon = parseFloat(cp.longitude);

        const bearing = bearingBetweenLatLon(userLatF, userLonF, cpLat, cpLon);
        let relativeAngle = bearing - headingNorm;
        while (relativeAngle > 180) relativeAngle -= 360;
        while (relativeAngle < -180) relativeAngle += 360;

        const distanceMeters = haversineDistanceMeters(userLatF, userLonF, cpLat, cpLon);

        const normalizedDistance = Math.max(0, Math.min(1, distanceMeters / 40));
        const screenY = screenHeight * (0.9 - normalizedDistance * 0.25);
        const scale = 1.0 - normalizedDistance * 0.5;
        const screenX = centerX + (relativeAngle / 90) * maxXOffset;

        if (typeof console !== 'undefined' && console.log) {
            console.log(`PathArrow[${i}] screenX=${screenX.toFixed(0)} screenY=${screenY.toFixed(0)} distanceMeters=${distanceMeters.toFixed(1)} relativeAngle=${relativeAngle.toFixed(1)}`);
        }

        const isVisible = relativeAngle >= -90 && relativeAngle <= 90;

        const targetX = isVisible ? screenX : centerX;
        const targetY = isVisible ? screenY : screenHeight * 0.85;

        if (!pathArrowSmoothState.positions[i]) {
            pathArrowSmoothState.positions[i] = { x: targetX, y: targetY };
        }
        const state = pathArrowSmoothState.positions[i];
        const factor = pathArrowSmoothState.lerpFactor;
        state.x += (targetX - state.x) * factor;
        state.y += (targetY - state.y) * factor;

        const opacity = Math.max(0.5, 0.95 - i * 0.15);

        const marker = arrows[i];
        marker.style.visibility = isVisible ? 'visible' : 'hidden';
        marker.style.opacity = isVisible ? opacity : '0';
        marker.style.left = state.x + 'px';
        marker.style.top = (state.y - arrowHeight) + 'px';
        marker.style.transform = `translateX(-50%) rotateX(65deg) scale(${scale})`;
    }
}

/**
 * Create AR arrow path with multiple arrows following the pathway
 */
function createArrowPath(waypoints = null) {
    const arrowPath = document.getElementById('arrow-path');
    if (!arrowPath) return;
    
    // Use provided waypoints or current pathway
    const pathWaypoints = waypoints || currentPathway;
    
    // Clear existing arrows
    arrowPath.innerHTML = '';
    
    if (pathWaypoints.length === 0) {
        // Default straight path if no waypoints
        createDefaultArrowPath(arrowPath);
        return;
    }
    
    // Create arrows along the pathway
    const arrowCount = Math.min(pathWaypoints.length, 7);
    const spacing = 40; // pixels between arrows
    const baseOpacity = 0.9;
    
    for (let i = 0; i < arrowCount; i++) {
        const arrowMarker = document.createElement('div');
        arrowMarker.className = 'ar-arrow-marker';
        
        // Position arrows forward in a line, with 3D perspective
        // All arrows start pointing straight (0 degrees), rotation will be applied to the path container
        const distance = i * spacing;
        const scale = 1 - (i * 0.08); // Smaller arrows further away
        const opacity = baseOpacity - (i * 0.12);
        
        // Base transform - arrows standing up more (60deg) for 3D look
        // Positioned along the path with proper 3D perspective
        arrowMarker.style.transform = `translateX(-50%) rotateX(60deg) translateZ(${-distance * 0.5}px) translateY(${-distance * 1.5}px) scale(${scale})`;
        arrowMarker.style.opacity = Math.max(opacity, 0.5);
        arrowMarker.style.transition = 'none'; // No transition for instant updates
        
        // Create SVG arrow (chevron style - upward pointing)
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        // Chevron arrow pointing up
        path.setAttribute('d', 'M50 15 L75 55 L60 55 L60 80 L40 80 L40 55 L25 55 Z');
        path.setAttribute('class', 'arrow-shape');
        path.setAttribute('fill', '#00ff88');
        path.setAttribute('stroke', '#00cc6a');
        path.setAttribute('stroke-width', '2');
        
        svg.appendChild(path);
        arrowMarker.appendChild(svg);
        arrowPath.appendChild(arrowMarker);
    }
}

/**
 * Create default straight arrow path
 */
function createDefaultArrowPath(arrowPath) {
    const arrowCount = 7;
    const spacing = 40;
    const baseOpacity = 0.9;
    
    for (let i = 0; i < arrowCount; i++) {
        const arrowMarker = document.createElement('div');
        arrowMarker.className = 'ar-arrow-marker';
        
        const distance = i * spacing;
        const scale = 1 - (i * 0.08);
        const opacity = baseOpacity - (i * 0.12);
        
        // Arrows standing up more (60deg) for 3D look, integrated into real world
        arrowMarker.style.transform = `translateX(-50%) rotateX(60deg) translateZ(${-distance * 0.5}px) translateY(${-distance * 1.5}px) scale(${scale})`;
        arrowMarker.style.opacity = Math.max(opacity, 0.5);
        arrowMarker.style.transition = 'none'; // No transition for instant updates
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M50 15 L75 55 L60 55 L60 80 L40 80 L40 55 L25 55 Z');
        path.setAttribute('class', 'arrow-shape');
        path.setAttribute('fill', '#00ff88');
        path.setAttribute('stroke', '#00cc6a');
        path.setAttribute('stroke-width', '2');
        
        svg.appendChild(path);
        arrowMarker.appendChild(svg);
        arrowPath.appendChild(arrowMarker);
    }
}

/**
 * Calculate pathway waypoints between current position and destination
 * This creates intermediate points for a smoother navigation path
 */
function calculatePathway(userPos, destPos) {
    const waypoints = [];
    const distance = calculateDistance(userPos, destPos);
    
    // If distance is small, just go straight
    if (distance < 10) {
        return [destPos];
    }
    
    // Create waypoints along the path
    // For indoor navigation, we'll create a simple straight path with intermediate points
    const numWaypoints = Math.min(Math.floor(distance / 5), 4); // Max 4 waypoints
    
    for (let i = 1; i <= numWaypoints; i++) {
        const ratio = i / (numWaypoints + 1);
        const waypoint = {
            x: userPos.x + (destPos.x - userPos.x) * ratio,
            y: userPos.y + (destPos.y - userPos.y) * ratio
        };
        waypoints.push(waypoint);
    }
    
    waypoints.push(destPos);
    return waypoints;
}

/**
 * Rotate AR arrow path based on device orientation
 * Arrows stay anchored at bottom, only direction rotates
 * When user faces destination, arrow points straight (0 degrees)
 * INSTANT updates for maximum responsiveness
 */
function rotateArrow(angle) {
    const arrowPath = document.getElementById('arrow-path');
    
    if (!arrowPath) {
        console.warn('Arrow path not found');
        return;
    }
    
    // Normalize angle to -180 to 180 range for shortest rotation
    let normalizedAngle = angle;
    while (normalizedAngle > 180) normalizedAngle -= 360;
    while (normalizedAngle < -180) normalizedAngle += 360;
    
    // DON'T clamp too much - allow full rotation range for accurate navigation
    // Only prevent extreme rotations that would be confusing (>150 degrees means going backwards)
    let finalAngle = normalizedAngle;
    if (finalAngle > 150) finalAngle = 150;
    if (finalAngle < -150) finalAngle = -150;
    
    // Apply rotation INSTANTLY - use setProperty with important for maximum accuracy
    arrowPath.style.setProperty('transform', `rotateZ(${finalAngle}deg)`, 'important');
    
    // Force immediate browser update - no batching or delays
    arrowPath.offsetHeight;
}

/**
 * Update destination label
 */
function updateDestinationLabel(roomName) {
    const destinationText = document.getElementById('destination-text');
    if (destinationText && roomName) {
        destinationText.textContent = `To: ${roomName}`;
    }
}

/**
 * Show AR path
 */
function showFloorMarker() {
    const pathContainer = document.getElementById('ar-path-container');
    if (pathContainer) {
        // Create arrows with current pathway
        createArrowPath(currentPathway);
        
        // Apply initial rotation if heading is available
        // This ensures arrows point correctly when first shown
        if (AppState.heading !== null && AppState.selectedRoom) {
            setTimeout(() => {
                const destination = {
                    x: AppState.selectedRoom.x,
                    y: AppState.selectedRoom.y
                };
                const targetPoint = currentPathway.length > 0 ? currentPathway[0] : destination;
                const targetBearing = calculateBearing(AppState.userPosition, targetPoint);
                const arrowRotation = calculateArrowRotation(AppState.heading, targetBearing);
                rotateArrow(arrowRotation);
            }, 50);
        }
        
        pathContainer.style.display = 'block';
        setTimeout(() => {
            pathContainer.style.opacity = '1';
        }, 10);
    }
}

/**
 * Hide AR path
 */
function hideFloorMarker() {
    const pathContainer = document.getElementById('ar-path-container');
    if (pathContainer) {
        pathContainer.style.opacity = '0';
        setTimeout(() => {
            if (pathContainer) {
                pathContainer.style.display = 'none';
            }
        }, 300);
    }
}

/**
 * Show arrival message
 */
function showArrivalMessage(roomName) {
    const arrivalMessage = document.getElementById('arrival-message');
    const arrivalRoom = document.getElementById('arrival-room');
    arrivalRoom.textContent = `You have arrived at ${roomName}`;
    arrivalMessage.classList.remove('hidden');
    AppState.isNavigating = false;
}

/**
 * Hide arrival message
 */
function hideArrivalMessage() {
    const arrivalMessage = document.getElementById('arrival-message');
    arrivalMessage.classList.add('hidden');
}

/**
 * Update on-screen navigation instruction text
 */
function updateNavInstruction(text) {
    const el = document.getElementById('nav-instruction');
    if (!el) return;
    if (!text) {
        el.classList.add('hidden');
    } else {
        el.textContent = text;
        el.classList.remove('hidden');
    }
}

/**
 * Load rooms from Supabase destinations table (no PHP)
 */
async function loadRooms() {
    try {
        if (!supabaseClient) {
            throw new Error('Supabase client not available');
        }
        const { data: dests, error: destErr } = await supabaseClient
            .from('destinations')
            .select('id,name,checkpoint_id,dest_latitude,dest_longitude');
        if (destErr) throw destErr;
        const cpIds = [...new Set((dests || []).map(d => d.checkpoint_id).filter(Boolean))];
        let cpMap = {};
        if (cpIds.length > 0) {
            const { data: cps, error: cpErr } = await supabaseClient
                .from('checkpoints')
                .select('id,latitude,longitude')
                .in('id', cpIds);
            if (!cpErr && cps) cpMap = Object.fromEntries(cps.map(c => [c.id, c]));
        }
        const rooms = (dests || []).map(d => {
            const lat = d.dest_latitude ?? cpMap[d.checkpoint_id]?.latitude;
            const lng = d.dest_longitude ?? cpMap[d.checkpoint_id]?.longitude;
            let x = 15, y = 25;
            if (lat != null && lng != null) {
                const local = convertGPSToLocal(lat, lng);
                x = local.x;
                y = local.y;
            }
            return {
                name: (d.name || '').toLowerCase().replace(/\s+/g, '_'),
                display_name: d.name || 'Room',
                x, y, floor: 1
            };
        });
        AppState.rooms = rooms.length > 0 ? rooms : getFallbackRooms();
        renderRoomsList();
        updateStatus('Rooms loaded', 'success');
    } catch (error) {
        console.error('Error loading rooms:', error);
        updateStatus('Failed to load rooms', 'error');
        AppState.rooms = getFallbackRooms();
        renderRoomsList();
    }
}

function getFallbackRooms() {
    return [
        { name: 'finance', display_name: 'Finance', x: 15.0, y: 25.0, floor: 1 },
        { name: 'registrar', display_name: 'Registrar', x: 5.0, y: 35.0, floor: 1 },
        { name: 'clinic', display_name: 'Clinic', x: 12.0, y: 18.0, floor: 1 }
    ];
}

/**
 * Get Bootstrap icon for room
 */
function getRoomIcon(roomName) {
    if (!roomName) return 'bi-geo-alt';
    const key = roomName.toLowerCase();

    // Clinic: medicine / health icon
    if (key.includes('clinic')) {
        return 'bi-clipboard2-pulse';
    }

    // Finance / Cashier: money icon
    if (key.includes('finance') || key.includes('cashier')) {
        return 'bi-cash-coin';
    }

    // Registrar: documents / records icon
    if (key.includes('registrar')) {
        return 'bi-file-earmark-text';
    }

    // Guidance (if you add it later)
    if (key.includes('guidance') || key.includes('counsel')) {
        return 'bi-person-heart';
    }

    // Default location pin
    return 'bi-geo-alt';
}

/**
 * Render rooms list in UI
 */
function renderRoomsList() {
    const roomsList = document.getElementById('rooms-list');
    if (!roomsList) return;
    
    roomsList.innerHTML = '';
    
    if (AppState.rooms.length === 0) {
        roomsList.innerHTML = `
            <div class="loading-state">
                <i class="bi bi-exclamation-circle"></i>
                <p class="loading-text">No destinations available</p>
            </div>
        `;
        return;
    }
    
    AppState.rooms.forEach(room => {
        const roomCard = document.createElement('div');
        // Add unique color class based on room name
        const roomNameLower = room.name.toLowerCase();
        const colorClass = `room-${roomNameLower}`;
        roomCard.className = `room-card ${colorClass}`;
        const iconClass = getRoomIcon(room.name);
        roomCard.innerHTML = `
            <div class="room-icon">
                <i class="bi ${iconClass}"></i>
            </div>
            <div class="room-info">
                <div class="room-card-name">${room.display_name}</div>
                <div class="room-card-coords">Ready to navigate</div>
            </div>
        `;
        
        roomCard.addEventListener('click', () => startNavigation(room));
        roomsList.appendChild(roomCard);
    });
}

/**
 * Start navigation to selected room (switch to AR view)
 */
function startNavigation(room) {
    // Check if location is detected
    if (!AppState.locationDetected || AppState.userPosition.x === null || AppState.userPosition.y === null) {
        alert('Please wait for location detection or enable location access in your browser settings.\n\nYour current position will be automatically detected using GPS.');
        // Allow navigation with default position for testing
        if (AppState.userPosition.x === null || AppState.userPosition.y === null) {
            AppState.userPosition = { x: 10.0, y: 15.0 };
        }
    }
    
    // Update AR view position display
    updateARPositionDisplay();
    
    AppState.selectedRoom = room;
    AppState.isNavigating = true;

    // Configure graph-based navigation when the room is mapped to a destination checkpoint
    GraphNav.activeDestination = null;
    GraphNav.pendingDestinationId = null;

    if (GraphNav.engine && GraphNav.destinations && GraphNav.destinations.length > 0) {
        const roomKey = (room.display_name || room.name || '').toLowerCase();
        let destName = null;

        // Map room names to destination records in Supabase
        if (roomKey.includes('finance')) {
            destName = 'Finance';
        } else if (roomKey.includes('registrar')) {
            destName = 'Registrar';
        } else if (roomKey.includes('clinic')) {
            destName = 'Clinic';
        }

        if (destName) {
            const destRecord = GraphNav.destinations.find(
                d => (d.name || '').toLowerCase() === destName.toLowerCase()
            );
            if (destRecord) {
                GraphNav.activeDestination = destRecord;
                GraphNav.pendingDestinationId = destRecord.checkpoint_id || destRecord.checkpointId;
            }
        }
    }
    
    // Switch to AR view
    switchToARView();
    
    // Request camera permission automatically
    requestCameraPermission();
    
    // Try WebXR immersive-ar (must be in user gesture; falls back to compass if unsupported)
    if (WebXRArrows.supported) {
        tryStartWebXRSession();
    } else {
        console.log('AR mode: compass fallback (WebXR not supported on this device)');
    }
    
    // Show floor marker (hidden when WebXR active)
    showFloorMarker();
    
    // Start navigation updates
    updateNavigation();
    updateStatus(`Navigating to ${room.display_name}`, 'success');
}

/**
 * Try to start WebXR immersive-ar session (must be called from user gesture).
 * Falls back silently to compass mode if unsupported or session fails.
 */
async function tryStartWebXRSession() {
    const started = await WebXRArrows.startSession();
    if (!started) {
        console.log('AR mode: compass fallback (WebXR session could not start)');
    }
}

/**
 * Switch to AR view
 */
function switchToARView() {
    const landingPage = document.getElementById('landing-page');
    const arView = document.getElementById('ar-view');
    
    if (landingPage) landingPage.classList.add('hidden');
    if (arView) {
        arView.classList.remove('hidden');
        arView.style.display = 'block';
        // Initialize canvas context if not already done
        if (!AppState.ctx && AppState.canvas) {
            AppState.ctx = AppState.canvas.getContext('2d');
        }
        // Resize canvas
        resizeCanvas();
    }
}

/**
 * Go back to landing page
 */
function goBackToLanding() {
    const landingPage = document.getElementById('landing-page');
    const arView = document.getElementById('ar-view');
    
    // Stop navigation
    AppState.isNavigating = false;
    AppState.selectedRoom = null;
    
    // Hide arrival message
    hideArrivalMessage();
    
    // Hide floor marker
    hideFloorMarker();

    // End WebXR session if active
    if (AppState.useWebXR && WebXRArrows.endSession) {
        WebXRArrows.endSession();
    }
    
    // Stop camera if active
    if (AppState.camera) {
        AppState.camera.getTracks().forEach(track => track.stop());
        AppState.camera = null;
        AppState.cameraPermissionGranted = false;
    }
    
    // Switch views
    if (arView) {
        arView.classList.add('hidden');
        arView.style.display = 'none';
    }
    if (landingPage) {
        landingPage.classList.remove('hidden');
    }
    
    // Close control panel
    const panel = document.getElementById('control-panel');
    if (panel) panel.classList.remove('open');
}

/**
 * Update user position from AR view input fields (manual override for testing)
 */
function updateUserPositionFromAR() {
    const x = parseFloat(document.getElementById('ar-user-x').value);
    const y = parseFloat(document.getElementById('ar-user-y').value);
    
    if (isNaN(x) || isNaN(y)) {
        alert('Please enter valid coordinates');
        return;
    }
    
    AppState.userPosition = { x, y };
    
    if (AppState.isNavigating && AppState.selectedRoom) {
        updateNavigation();
    }
    
    updateStatus('Position updated manually', 'success');
}

/**
 * Update status indicator
 */
function updateStatus(message, type = 'success') {
    const statusText = document.getElementById('status-text');
    const statusDot = document.querySelector('.status-dot');
    
    statusText.textContent = message;
    statusDot.className = 'status-dot';
    
    if (type === 'warning') {
        statusDot.classList.add('warning');
    } else if (type === 'error') {
        statusDot.classList.add('error');
    }
}

/**
 * Toggle control panel
 */
function toggleControlPanel() {
    const panel = document.getElementById('control-panel');
    panel.classList.toggle('open');
}

/**
 * Update UI elements
 */
function updateUI() {
    // Set initial position values for AR view (if position is available)
    const arX = document.getElementById('ar-user-x');
    const arY = document.getElementById('ar-user-y');
    if (arX && AppState.userPosition.x !== null) {
        arX.value = AppState.userPosition.x.toFixed(2);
    }
    if (arY && AppState.userPosition.y !== null) {
        arY.value = AppState.userPosition.y.toFixed(2);
    }
}

/**
 * Resize canvas to match video dimensions
 */
function resizeCanvas() {
    if (AppState.video && AppState.canvas) {
        const videoWidth = AppState.video.videoWidth || window.innerWidth;
        const videoHeight = AppState.video.videoHeight || window.innerHeight;
        
        AppState.canvas.width = window.innerWidth;
        AppState.canvas.height = window.innerHeight;
    }
}

/**
 * Start navigation loop (if needed for continuous updates)
 */
function startNavigationLoop() {
    if (AppState.isNavigating && AppState.selectedRoom) {
        updateNavigation();
    }
    requestAnimationFrame(startNavigationLoop);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Start navigation update loop
requestAnimationFrame(startNavigationLoop);

// === Graph-based navigation engine using checkpoints ===

// Haversine helpers (meters)
const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
    return (deg * Math.PI) / 180;
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
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

// Bearing between two GPS coordinates in degrees (0° = North, clockwise)
function bearingBetweenLatLon(lat1, lon1, lat2, lon2) {
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x =
        Math.cos(φ1) * Math.sin(φ2) -
        Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x) * (180 / Math.PI);
    return normalizeAngle(θ);
}

function findNearestCheckpointGraph(lat, lon, checkpoints) {
    let best = null;
    let bestDist = Infinity;
    for (const cp of checkpoints) {
        const d = haversineDistanceMeters(
            parseFloat(cp.latitude),
            parseFloat(cp.longitude),
            lat,
            lon
        );
        if (d < bestDist) {
            bestDist = d;
            best = cp;
        }
    }
    return { checkpoint: best, distance: bestDist };
}

function buildAdjacencyGraph(edges) {
    const adj = new Map();
    for (const e of edges) {
        if (!adj.has(e.from_checkpoint)) {
            adj.set(e.from_checkpoint, []);
        }
        adj.get(e.from_checkpoint).push({
            to: e.to_checkpoint,
            distance: parseFloat(e.distance)
        });
    }
    return adj;
}

function dijkstraGraph(adjacency, startId, targetId) {
    const dist = new Map();
    const prev = new Map();
    const unvisited = new Set();

    for (const id of adjacency.keys()) {
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

class NavigationEngineGraph {
    constructor({ checkpoints, edges, arrivalRadiusMeters = 5 }) {
        this.checkpoints = checkpoints;
        this.checkpointById = new Map(checkpoints.map(cp => [cp.id, cp]));
        this.adjacency = buildAdjacencyGraph(edges);
        this.arrivalRadiusMeters = arrivalRadiusMeters;

        this.currentPath = [];       // full checkpoint ID path from Dijkstra
        this.currentPathIndex = 0;   // index of current position in path (arrow points to currentPath[currentPathIndex + 1])

        this.onCheckpointReached = null;
        this.onArrived = null;
    }

    startNavigationFromUser({ userLat, userLon, destinationCheckpointId }) {
        const { checkpoint: nearest } = findNearestCheckpointGraph(
            userLat,
            userLon,
            this.checkpoints
        );
        if (!nearest) {
            throw new Error('No checkpoints available for navigation');
        }

        const path = dijkstraGraph(
            this.adjacency,
            nearest.id,
            destinationCheckpointId
        );
        if (!path) {
            throw new Error('No path to destination checkpoint');
        }

        this.currentPath = path;
        this.currentPathIndex = -1;
        console.log('FULL PATH:', this.currentPath.map(id => this.checkpointById.get(id)?.name || id));
        console.log('CURRENT INDEX:', this.currentPathIndex);
    }

    getCurrentTargetCheckpoint() {
        const nextCheckpoint = this.currentPath[this.currentPathIndex + 1];
        if (nextCheckpoint === undefined) return null;
        const cp = this.checkpointById.get(nextCheckpoint);
        return cp || null;
    }

    getRemainingPathCheckpoints() {
        if (!this.currentPath.length) return [];
        return this.currentPath
            .slice(this.currentPathIndex + 1)
            .map(id => this.checkpointById.get(id))
            .filter(Boolean);
    }

    isUserOffPath(lat, lon, thresholdMeters = 25) {
        if (!this.currentPath.length) return true;
        for (const id of this.currentPath) {
            const cp = this.checkpointById.get(id);
            if (!cp) continue;
            const d = haversineDistanceMeters(lat, lon, parseFloat(cp.latitude), parseFloat(cp.longitude));
            if (d <= thresholdMeters) return false;
        }
        return true;
    }

    updateUserPosition(lat, lon, gpsAccuracyMeters) {
        const nextCheckpoint = this.currentPath[this.currentPathIndex + 1];
        if (nextCheckpoint === undefined) return;

        const nextCp = this.checkpointById.get(nextCheckpoint);
        if (!nextCp) return;

        const distanceToNextCheckpoint = haversineDistanceMeters(
            lat,
            lon,
            parseFloat(nextCp.latitude),
            parseFloat(nextCp.longitude)
        );

        const effectiveRadius = Math.max(
            this.arrivalRadiusMeters,
            gpsAccuracyMeters != null ? gpsAccuracyMeters : this.arrivalRadiusMeters,
            10
        );

        console.log('NEXT TARGET:', nextCp.name);

        if (distanceToNextCheckpoint < effectiveRadius) {
            this.currentPathIndex += 1;
            console.log('CURRENT INDEX:', this.currentPathIndex);

            if (this.onCheckpointReached) {
                this.onCheckpointReached(nextCp, this.currentPathIndex, this.currentPath.length);
            }

            const newNext = this.currentPath[this.currentPathIndex + 1];
            if (newNext === undefined) {
                if (this.onArrived) {
                    this.onArrived(nextCp);
                }
            }
        }
    }
}

/**
 * Load navigation graph (checkpoints, edges, destinations) from Supabase (no PHP)
 */
async function loadNavigationGraph() {
    try {
        if (!supabaseClient) {
            console.warn('Supabase client not available, graph navigation disabled');
            return;
        }
        const [cpRes, edgeRes, destRes] = await Promise.all([
            supabaseClient.from('checkpoints').select('id,name,latitude,longitude'),
            supabaseClient.from('edges').select('id,from_checkpoint,to_checkpoint,distance'),
            supabaseClient.from('destinations').select('id,name,checkpoint_id,dest_latitude,dest_longitude')
        ]);
        if (cpRes.error) throw cpRes.error;
        if (edgeRes.error) throw edgeRes.error;
        if (destRes.error) throw destRes.error;

        GraphNav.checkpoints = cpRes.data || [];
        GraphNav.edges = edgeRes.data || [];
        GraphNav.destinations = destRes.data || [];

        // Precompute local coordinates for each checkpoint for AR math
        GraphNav.checkpoints.forEach(cp => {
            const lat = parseFloat(cp.latitude);
            const lng = parseFloat(cp.longitude);
            if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
                cp.local = convertGPSToLocal(lat, lng);
            }
        });

        GraphNav.engine = new NavigationEngineGraph({
            checkpoints: GraphNav.checkpoints,
            edges: GraphNav.edges,
            arrivalRadiusMeters: 5
        });

        console.log('Graph navigation loaded:', {
            checkpoints: GraphNav.checkpoints.length,
            edges: GraphNav.edges.length,
            destinations: GraphNav.destinations.length
        });
    } catch (err) {
        console.error('Failed to load navigation graph:', err);
    }
}
