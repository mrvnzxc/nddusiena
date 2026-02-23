<?php
/**
 * Helper script to update room GPS coordinates
 * Usage: POST to this file with JSON data
 * Or use the API endpoint: api.php?action=update_room_gps
 */

require_once 'config.php';

header('Content-Type: application/json');

// Database connection
$host = DB_HOST;
$dbname = DB_NAME;
$username = DB_USER;
$password = DB_PASS;

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

/**
 * Convert GPS to local coordinates (same as in api.php)
 */
function convertGPSToLocal($lat, $lng) {
    $deltaLat = $lat - BUILDING_ORIGIN_LAT;
    $deltaLng = $lng - BUILDING_ORIGIN_LNG;
    $metersPerDegreeLng = METERS_PER_DEGREE_LNG * cos(deg2rad(BUILDING_ORIGIN_LAT));
    
    $x = $deltaLng * $metersPerDegreeLng;
    $y = $deltaLat * METERS_PER_DEGREE_LAT;
    
    return ['x' => $x, 'y' => $y];
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    
    $roomName = $data['name'] ?? '';
    $latitude = $data['latitude'] ?? null;
    $longitude = $data['longitude'] ?? null;
    
    if (empty($roomName) || $latitude === null || $longitude === null) {
        http_response_code(400);
        echo json_encode(['error' => 'Room name, latitude, and longitude are required']);
        exit;
    }
    
    try {
        // Convert GPS to local coordinates
        $localCoords = convertGPSToLocal((float)$latitude, (float)$longitude);
        
        // Update room
        $stmt = $pdo->prepare("UPDATE rooms SET latitude = ?, longitude = ?, x_coordinate = ?, y_coordinate = ? WHERE name = ?");
        $stmt->execute([$latitude, $longitude, $localCoords['x'], $localCoords['y'], $roomName]);
        
        if ($stmt->rowCount() > 0) {
            echo json_encode([
                'success' => true,
                'message' => "Room '$roomName' GPS coordinates updated",
                'gps' => ['lat' => $latitude, 'lng' => $longitude],
                'local' => $localCoords
            ]);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Room not found']);
        }
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to update room: ' . $e->getMessage()]);
    }
} else {
    // Show current rooms and instructions
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
        </style>
    </head>
    <body>
        <h1>Update Room GPS Coordinates</h1>
        <div class="info">
            <p><strong>Instructions:</strong></p>
            <p>1. Enter the GPS coordinates (latitude, longitude) for each room</p>
            <p>2. The system will automatically convert GPS coordinates to local (x, y) coordinates</p>
            <p>3. You can also use the API endpoint: <code>api.php?action=update_room_gps</code></p>
        </div>
        
        <?php
        try {
            $stmt = $pdo->query("SELECT name, display_name, latitude, longitude, x_coordinate, y_coordinate FROM rooms ORDER BY name");
            $rooms = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            foreach ($rooms as $room) {
                echo "<div class='room'>";
                echo "<h3>{$room['display_name']} ({$room['name']})</h3>";
                echo "<form onsubmit='updateGPS(event, \"{$room['name']}\")'>";
                echo "<div class='form-group'>";
                echo "<label>Latitude:</label>";
                echo "<input type='number' step='0.00000001' id='lat-{$room['name']}' value='" . ($room['latitude'] ?? '') . "' placeholder='e.g., 6.11234567' required>";
                echo "</div>";
                echo "<div class='form-group'>";
                echo "<label>Longitude:</label>";
                echo "<input type='number' step='0.00000001' id='lng-{$room['name']}' value='" . ($room['longitude'] ?? '') . "' placeholder='e.g., 125.17123456' required>";
                echo "</div>";
                echo "<button type='submit'>Update GPS Coordinates</button>";
                echo "<p><small>Current local coordinates: X={$room['x_coordinate']}, Y={$room['y_coordinate']}</small></p>";
                echo "</form>";
                echo "</div>";
            }
        } catch (PDOException $e) {
            echo "<p>Error: " . htmlspecialchars($e->getMessage()) . "</p>";
        }
        ?>
        
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
                    alert('GPS coordinates updated successfully!\nLocal coordinates: X=' + data.local.x.toFixed(2) + ', Y=' + data.local.y.toFixed(2));
                    location.reload();
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }
        </script>
    </body>
    </html>
    <?php
}
