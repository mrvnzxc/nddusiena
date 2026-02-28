# AR Indoor Navigation System — Complete Technical Guide

**Notre Dame Siena College of General Santos City**

This document explains the entire Web-Based AR Indoor Navigation System: architecture, how augmented reality is performed, the navigation engine, database schema, and setup instructions.

---

## Table of Contents

1. [Overview](#1-overview)
2. [How Augmented Reality Works](#2-how-augmented-reality-works)
3. [Architecture & File Structure](#3-architecture--file-structure)
4. [Database Schema](#4-database-schema)
5. [Graph-Based Navigation Engine](#5-graph-based-navigation-engine)
6. [AR Overlay Components](#6-ar-overlay-components)
7. [Sensor Handling & Filtering](#7-sensor-handling--filtering)
8. [Setup & Deployment](#8-setup--deployment)

---

## 1. Overview

The system is a **web-based augmented reality navigation app** for indoor campus navigation. It guides users from their current GPS location to destinations (Finance, Registrar, Clinic) by:

- Showing a **live camera feed** as the background
- Overlaying **directional arrows** that point to the next checkpoint
- Using **checkpoint-based graph navigation** instead of direct “point to destination” so users follow real walkable paths (hallways, entrances) and avoid walls and obstacles

**Tech stack:**

- **Frontend:** HTML, CSS, JavaScript (no build step)
- **Backend / DB:** Supabase (PostgreSQL), PHP (`api.php`) as an API proxy
- **Deploy:** Vercel (static), XAMPP (local with PHP)

**Supported destinations:** Finance Office, Registrar Office, Clinic.

---

## 2. How Augmented Reality Works

This system uses a **camera-overlay AR approach** (no WebXR or AR.js in the main flow). Augmented reality is achieved by:

### 2.1 Live Camera as Background

- The app uses `navigator.mediaDevices.getUserMedia()` to request the **back camera** (`facingMode: 'environment'`).
- The video feed is shown full-screen in an HTML `<video>` element.
- A transparent `<canvas>` and AR overlay elements are layered on top of the video.
- Result: The user sees the real world through the camera with navigation information overlaid.

### 2.2 AR Overlay Layers

Several elements are rendered on top of the camera view:

1. **Arrow path** (`#arrow-path`) — 3D-style chevron arrows that indicate direction
2. **Destination label** — “To: Finance” (or Registrar, Clinic)
3. **Distance display** — Approximate meters to the next target
4. **Turn-by-turn instruction** — “Go straight towards Finance”, “Turn left towards Clinic”, etc.
5. **Heading display** — Compass heading in degrees (for debugging)
6. **Arrival message** — Full-screen “You have arrived at Finance” when destination is reached

All overlays use fixed positioning and semi-transparent backgrounds so they blend with the camera view.

### 2.3 Arrow Direction (Compass + Bearing)

The direction the arrow points is computed as follows:

1. **Compass heading** — Where the user is facing (0° = North, 90° = East, etc.).
   - Source: `DeviceOrientationEvent` (`event.alpha`, or `event.webkitCompassHeading` on iOS).

2. **Bearing to target** — Direction from the user to the next checkpoint (or office in the final leg).
   - Uses the Haversine formula with GPS coordinates to get a compass bearing.
   - JavaScript: `bearingBetweenLatLon(lat1, lon1, lat2, lon2)`.

3. **Arrow rotation angle** — `angleDiff = heading - bearing`
   - Positive → target is to your left → arrow points left
   - Negative → target is to your right → arrow points right
   - 0° → facing target → arrow points straight ahead
   - Normalized to -180° to +180° so the arrow shows the shortest turn.

4. **CSS transform** — The arrow path container is rotated with:
   - `transform: rotateZ(angleDiff deg)`
   - Applied immediately (no transition) for responsiveness.

### 2.4 3D Visual Effect for Arrows

Arrows appear “standing” on the ground using CSS transforms:

- Each arrow is tilted with `rotateX(60deg)` for a 3D perspective.
- Arrows are staggered along the path with `translateZ` and `translateY` for depth.
- Further arrows are slightly smaller and less opaque to create a sense of distance.
- A radial gradient shadow (`::before`) simulates a ground shadow.

### 2.5 No Printed Markers

- The system uses **GPS coordinates only**.
- No image markers or QR codes are required.
- Works outdoors and near building entrances where GPS is available.

---

## 3. Architecture & File Structure

```
nddusiena/
├── index.html          # Main UI: landing page + AR view
├── style.css           # All styles including AR overlay and arrows
├── script.js           # Core logic: camera, compass, GPS, navigation, AR
├── api.php             # API proxy to Supabase (rooms, graph data)
├── config.php          # Supabase credentials (URL, anon key)
├── supabase_helper.php # Supabase API helpers
├── supabase_schema.sql # DB tables: checkpoints, edges, destinations
├── supabase_seed.sql   # Seed data for checkpoints, edges, destinations
├── locations_rows.sql  # Reference data for locations table
├── logo.png            # Favicon and header logo
└── README.md           # Quick setup instructions
```

**Data flow:**

1. `index.html` loads `script.js`, which calls `init()`.
2. `init()` loads rooms (`api.php?action=get_rooms`) and navigation graph (`api.php?action=get_nav_graph`).
3. User selects a destination → `startNavigation()` → switch to AR view, request camera, start GPS watch.
4. On each GPS update and device orientation change, `updateNavigation()` recalculates bearing, distance, and arrow rotation.
5. Arrows and text are updated in the DOM.

---

## 4. Database Schema

### 4.1 Tables

| Table          | Purpose |
|----------------|---------|
| `checkpoints` | Physical points with GPS (entrances, hallways, landmarks) |
| `edges`       | Bidirectional connections between checkpoints with distance (meters) |
| `destinations`| Offices (Finance, Registrar, Clinic) linked to a checkpoint + optional exact office GPS |
| `locations`   | Legacy room list for `get_rooms` (display names, icons) |

### 4.2 Checkpoints

```
checkpoints (id, name, latitude, longitude)
```

Examples: `parking_area`, `parking_side_entrance`, `hallway_1`, `hallway_2`, `front_clinic`, `gym_entrance`, etc.

### 4.3 Edges

```
edges (id, from_checkpoint, to_checkpoint, distance)
```

- All edges are bidirectional (A↔B stored as two rows).
- Distance is computed with a PostgreSQL `haversine_distance` function.
- Edges encode walkable paths (e.g., parking → hallway_1 → hallway_2 → office).

### 4.4 Destinations

```
destinations (id, name, checkpoint_id, dest_latitude, dest_longitude)
```

- `checkpoint_id` = last checkpoint before the office.
- `dest_latitude` / `dest_longitude` = exact office coordinates (used for the final leg).

| Destination | Checkpoint | Office Coordinates |
|-------------|------------|--------------------|
| Finance     | hallway_2  | 6.15309…, 125.16745… |
| Registrar   | hallway_2  | 6.15305…, 125.16751… |
| Clinic      | front_clinic | Uses checkpoint coords |

---

## 5. Graph-Based Navigation Engine

### 5.1 Why a Graph?

Direct GPS-to-office pointing would lead users through walls. The graph forces navigation along real paths: checkpoints → edges → next checkpoint.

### 5.2 Dijkstra’s Algorithm

1. **Nearest checkpoint:** `findNearestCheckpointGraph()` picks the checkpoint closest to the user’s GPS.
2. **Shortest path:** `dijkstraGraph(adjacency, startId, targetId)` computes the minimum-distance path.
3. **Path format:** Ordered list of checkpoint IDs from start to destination.

### 5.3 Navigation States

1. **Checkpoint-by-checkpoint** — Arrow points to the *next* checkpoint only.
2. **Checkpoint arrival** — When user is within ~5 m of a checkpoint:
   - Advance to the next checkpoint.
   - Or auto-skip if already closer to a later checkpoint on the path.
3. **Final leg** — After the last checkpoint, point directly to office coordinates (`dest_latitude`, `dest_longitude`).
4. **Arrival** — When within ~25 m of the office, show “You have arrived at [Office]”.

### 5.4 Map-Matching & Replanning

- **Replanning:** If the user is far from the current target (e.g. > 25 m) or there is no path, the engine recomputes the path from the current GPS position.
- **Throttling:** Replanning is limited to once every 4 seconds to avoid excessive computation.

### 5.5 NavigationEngineGraph Class

- `startNavigationFromUser({ userLat, userLon, destinationCheckpointId })` — Computes path from nearest checkpoint to destination.
- `getCurrentTargetCheckpoint()` — Returns the checkpoint the user is moving toward.
- `getRemainingPathCheckpoints()` — Remaining checkpoints on the path.
- `updateUserPosition(lat, lon)` — Advances to the next checkpoint when within radius or when closer to a future checkpoint.

---

## 6. AR Overlay Components

### 6.1 Arrow Path (`#arrow-path`)

- **Rendered by:** `createArrowPath(waypoints)`
- **Content:** Up to 7 SVG chevron arrows.
- **Rotation:** Entire container rotated with `rotateZ(angle)` based on heading vs. bearing.
- **Waypoints:** From the graph’s remaining checkpoints (or a straight path for legacy mode).

### 6.2 Destination Label

- **Position:** Top center (e.g. `top: 10%`).
- **Content:** “To: Finance” (always the office name, not checkpoint names).

### 6.3 Distance Display

- **Position:** Below destination label.
- **Content:** “≈ 42.3 meters”
- **Smoothing:** Moving average of the last 5 distance readings to reduce GPS jitter.

### 6.4 Turn-by-Turn Instruction

- **Position:** Between destination label and distance.
- **Content:** “Go straight”, “Slightly turn left”, “Turn right”, “Turn around” + “ towards [Office]”.
- **Logic:** Based on absolute value of `arrowRotation`:
  - &lt; 15° → “Go straight”
  - 15–45° → “Slightly turn left/right”
  - 45–135° → “Turn left/right”
  - &gt; 135° → “Turn around”

### 6.5 Arrival Message

- Full-screen overlay when within ~25 m of the office (final leg) or legacy arrival threshold.
- Shows “You have arrived at [Office]” and a “Back to Selection” button.

---

## 7. Sensor Handling & Filtering

### 7.1 Compass (DeviceOrientation)

- **Source:** `event.alpha` (0–360°) or `event.webkitCompassHeading` on iOS.
- **Heading stability:** The arrow only updates when `headingStable` is true:
  - Last 4+ samples must be within a 20° window.
  - Avoids erratic arrow movement at startup or when compass is noisy.
- **Tilt check:** If `event.beta` indicates the phone is very flat or upside-down (outside 30–120°), heading is treated as unusable.

### 7.2 GPS (Geolocation API)

- **Initial fix:** `getCurrentPosition()` with `enableHighAccuracy: true`.
- **Continuous updates:** `watchPosition()` with `maximumAge: 1000` ms.
- **Distance smoothing:** Moving average of last 5 Haversine distances to reduce jumps.

### 7.3 Calibration Message

When heading is not usable or not stable:

- Arrow points straight (0°).
- Instruction: “Hold your phone upright and steady to calibrate direction”.

---

## 8. Setup & Deployment

### 8.1 Supabase

1. Create a Supabase project.
2. Run `supabase_schema.sql` in the SQL editor.
3. Run `supabase_seed.sql`.
4. Configure RLS so the `anon` role can `SELECT` from `checkpoints`, `edges`, `destinations`, and `locations`.
5. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env` or your PHP config.

### 8.2 Local (XAMPP)

1. Place the project in `htdocs/nddusiena`.
2. Ensure `config.php` loads Supabase credentials from `.env`.
3. Open `http://localhost/nddusiena/` in a browser.
4. Use HTTPS or `localhost` for camera and geolocation.
5. Best tested on a real mobile device with GPS and compass.

### 8.3 Vercel

- Vercel serves static files; `api.php` does **not** run there.
- `get_rooms` and `get_nav_graph` will fail; the app falls back to hardcoded rooms and no graph.
- For full functionality on Vercel, you would need to:
  - Call Supabase directly from the frontend (with anon key), or
  - Use Vercel serverless functions as an API proxy.

### 8.4 API Endpoints

| Action         | Method | Description                          |
|----------------|--------|--------------------------------------|
| `get_rooms`    | GET    | List of rooms (Finance, Registrar, Clinic) |
| `get_nav_graph`| GET    | Checkpoints, edges, destinations for graph navigation |
| `get_room`     | GET    | Single room by name                  |
| `update_room_gps` | POST | Update room GPS coordinates          |

---

## Summary: How AR Is Achieved

| Component       | Technology / Approach |
|----------------|------------------------|
| **Real-world view** | Back camera via `getUserMedia` |
| **Overlay**         | Transparent `<div>` elements on top of the video |
| **Direction**       | Compass (DeviceOrientation) vs. bearing (Haversine) |
| **Arrow rotation**  | CSS `transform: rotateZ(angle)` on the arrow container |
| **3D effect**        | CSS `rotateX`, `translateZ`, `translateY`, drop-shadow |
| **Navigation path**  | Dijkstra on checkpoint graph, checkpoint-by-checkpoint |
| **Stability**        | Heading samples, tilt check, distance smoothing |

The result is a lightweight, web-only AR navigation experience that works on mobile browsers without WebXR, AR.js, or printed markers.

---

© Notre Dame Siena College of General Santos City
