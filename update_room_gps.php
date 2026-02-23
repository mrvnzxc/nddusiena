<?php
/**
 * Helper script to update room GPS coordinates (Supabase only).
 * Usage: POST with JSON { name, latitude, longitude } or open in browser for the form.
 */

require_once 'config.php';
require_once 'supabase_helper.php';

header('Content-Type: application/json');

function convertGPSToLocal($lat, $lng) {
    $deltaLat = $lat - BUILDING_ORIGIN_LAT;
    $deltaLng = $lng - BUILDING_ORIGIN_LNG;
    $metersPerDegreeLng = METERS_PER_DEGREE_LNG * cos(deg2rad(BUILDING_ORIGIN_LAT));
    return ['x' => $deltaLng * $metersPerDegreeLng, 'y' => $deltaLat * METERS_PER_DEGREE_LAT];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        http_response_code(503);
        echo json_encode(['error' => 'Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.']);
        exit;
    }

    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $roomName = $data['name'] ?? '';
    $latitude = isset($data['latitude']) ? (float) $data['latitude'] : null;
    $longitude = isset($data['longitude']) ? (float) $data['longitude'] : null;

    if ($roomName === '' || $latitude === null || $longitude === null) {
        http_response_code(400);
        echo json_encode(['error' => 'Room name, latitude, and longitude are required']);
        exit;
    }

    $localCoords = convertGPSToLocal($latitude, $longitude);
    $result = supabase_patch('locations', [
        'latitude'     => $latitude,
        'longitude'    => $longitude,
        'x_coordinate' => $localCoords['x'],
        'y_coordinate' => $localCoords['y'],
    ], 'name', $roomName);

    if ($result['error']) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to update: ' . $result['error']]);
        exit;
    }
    if ($result['updated'] === 0) {
        http_response_code(404);
        echo json_encode(['error' => 'Room not found']);
        exit;
    }

    echo json_encode([
        'success' => true,
        'message' => "Room '$roomName' GPS coordinates updated",
        'gps'     => ['lat' => $latitude, 'lng' => $longitude],
        'local'   => $localCoords,
    ]);
    exit;
}

// GET: show HTML form (requires Supabase for room list)
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<h1>Update Room GPS</h1><p>Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env or environment.</p>';
    exit;
}

$roomsResult = supabase_get('locations', 'select=name,description,latitude,longitude,x_coordinate,y_coordinate&order=name.asc');
$rooms = $roomsResult['data'] ?: [];
if ($roomsResult['error']) {
    $rooms = [];
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Update Room GPS Coordinates</title>
    <style>
        body { font-family: Arial; padding: 20px; max-width: 800px; margin: 0 auto; }
        .room { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .form-group { margin: 10px 0; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input { width: 100%; padding: 8px; margin-bottom: 10px; }
        button { padding: 10px 20px; background: #0066FF; color: white; border: none; border-radius: 5px; cursor: pointer; }
        button:hover { background: #0052CC; }
        .info { background: #e3f2fd; padding: 10px; border-radius: 5px; margin-bottom: 20px; }
        .error { color: #c00; }
    </style>
</head>
<body>
    <h1>Update Room GPS Coordinates</h1>
    <div class="info">
        <p><strong>Instructions:</strong></p>
        <p>1. Enter the GPS coordinates (latitude, longitude) for each room.</p>
        <p>2. The system will convert GPS to local (x, y) and save to Supabase.</p>
        <p>3. API: <code>POST update_room_gps.php</code> or <code>api.php?action=update_room_gps</code> with JSON body.</p>
    </div>

    <?php if (empty($rooms)): ?>
        <p class="error">No rooms found. Check Supabase table <code>rooms</code> and RLS policies.</p>
    <?php else: ?>
        <?php foreach ($rooms as $room): ?>
            <div class="room">
                <h3><?php echo htmlspecialchars($room['display_name'] ?? $room['name']); ?> (<?php echo htmlspecialchars($room['name']); ?>)</h3>
                <form onsubmit="updateGPS(event, '<?php echo htmlspecialchars($room['name']); ?>')">
                    <div class="form-group">
                        <label>Latitude:</label>
                        <input type="number" step="0.00000001" id="lat-<?php echo htmlspecialchars($room['name']); ?>" value="<?php echo htmlspecialchars($room['latitude'] ?? ''); ?>" placeholder="e.g. 6.11234567" required>
                    </div>
                    <div class="form-group">
                        <label>Longitude:</label>
                        <input type="number" step="0.00000001" id="lng-<?php echo htmlspecialchars($room['name']); ?>" value="<?php echo htmlspecialchars($room['longitude'] ?? ''); ?>" placeholder="e.g. 125.17123456" required>
                    </div>
                    <button type="submit">Update GPS Coordinates</button>
                    <p><small>Current local: X=<?php echo htmlspecialchars($room['x_coordinate'] ?? '—'); ?>, Y=<?php echo htmlspecialchars($room['y_coordinate'] ?? '—'); ?></small></p>
                </form>
            </div>
        <?php endforeach; ?>
    <?php endif; ?>

    <script>
    async function updateGPS(event, roomName) {
        event.preventDefault();
        const lat = document.getElementById('lat-' + roomName).value;
        const lng = document.getElementById('lng-' + roomName).value;
        try {
            const response = await fetch('update_room_gps.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: roomName, latitude: parseFloat(lat), longitude: parseFloat(lng) })
            });
            const data = await response.json();
            if (data.success) {
                alert('GPS updated. Local: X=' + data.local.x.toFixed(2) + ', Y=' + data.local.y.toFixed(2));
                location.reload();
            } else {
                alert('Error: ' + (data.error || response.statusText));
            }
        } catch (err) {
            alert('Error: ' + err.message);
        }
    }
    </script>
</body>
</html>
