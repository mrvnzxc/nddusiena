<?php
/**
 * AR Indoor Navigation System - API Endpoint
 * Returns room coordinates and handles user position updates
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// Load configuration
require_once 'config.php';

// Database configuration
$host = DB_HOST;
$dbname = DB_NAME;
$username = DB_USER;
$password = DB_PASS;

/**
 * Convert GPS coordinates (latitude, longitude) to local building coordinates (x, y)
 * Uses the building origin as reference point
 */
function convertGPSToLocal($lat, $lng) {
    // Calculate difference from building origin
    $deltaLat = $lat - BUILDING_ORIGIN_LAT;
    $deltaLng = $lng - BUILDING_ORIGIN_LNG;
    
    // Convert to meters
    // Adjust longitude conversion based on latitude (cosine correction)
    $metersPerDegreeLng = METERS_PER_DEGREE_LNG * cos(deg2rad(BUILDING_ORIGIN_LAT));
    
    $x = $deltaLng * $metersPerDegreeLng; // East-West (longitude)
    $y = $deltaLat * METERS_PER_DEGREE_LAT; // North-South (latitude)
    
    return ['x' => $x, 'y' => $y];
}

/**
 * Convert local building coordinates (x, y) to GPS coordinates (latitude, longitude)
 */
function convertLocalToGPS($x, $y) {
    // Convert from meters to degrees
    $metersPerDegreeLng = METERS_PER_DEGREE_LNG * cos(deg2rad(BUILDING_ORIGIN_LAT));
    
    $deltaLng = $x / $metersPerDegreeLng;
    $deltaLat = $y / METERS_PER_DEGREE_LAT;
    
    $lat = BUILDING_ORIGIN_LAT + $deltaLat;
    $lng = BUILDING_ORIGIN_LNG + $deltaLng;
    
    return ['lat' => $lat, 'lng' => $lng];
}

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'get_rooms':
        // Get all rooms with their coordinates
        try {
            $stmt = $pdo->query("SELECT name, display_name, x_coordinate, y_coordinate, latitude, longitude, floor_level, description FROM rooms ORDER BY name");
            $rooms = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            // Format coordinates and convert GPS to local if needed
            foreach ($rooms as &$room) {
                // If GPS coordinates exist, convert them to local coordinates
                if (!empty($room['latitude']) && !empty($room['longitude'])) {
                    $localCoords = convertGPSToLocal((float)$room['latitude'], (float)$room['longitude']);
                    $room['x'] = $localCoords['x'];
                    $room['y'] = $localCoords['y'];
                    // Update database with converted coordinates for consistency
                    $updateStmt = $pdo->prepare("UPDATE rooms SET x_coordinate = ?, y_coordinate = ? WHERE name = ?");
                    $updateStmt->execute([$localCoords['x'], $localCoords['y'], $room['name']]);
                } else {
                    // Use existing local coordinates
                    $room['x'] = (float)$room['x_coordinate'];
                    $room['y'] = (float)$room['y_coordinate'];
                }
                
                $room['floor'] = (int)($room['floor_level'] ?? 1);
                // Include GPS coordinates in response if available
                if (!empty($room['latitude']) && !empty($room['longitude'])) {
                    $room['gps'] = [
                        'lat' => (float)$room['latitude'],
                        'lng' => (float)$room['longitude']
                    ];
                }
                unset($room['x_coordinate'], $room['y_coordinate'], $room['floor_level'], $room['latitude'], $room['longitude']);
            }
            
            echo json_encode([
                'success' => true,
                'rooms' => $rooms
            ]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to fetch rooms: ' . $e->getMessage()]);
        }
        break;
        
    case 'get_room':
        // Get a specific room by name
        $roomName = $_GET['name'] ?? '';
        if (empty($roomName)) {
            http_response_code(400);
            echo json_encode(['error' => 'Room name is required']);
            break;
        }
        
        try {
            $stmt = $pdo->prepare("SELECT name, display_name, x_coordinate, y_coordinate, latitude, longitude, floor_level, description FROM rooms WHERE name = ?");
            $stmt->execute([$roomName]);
            $room = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if ($room) {
                // Convert GPS to local if GPS coordinates exist
                if (!empty($room['latitude']) && !empty($room['longitude'])) {
                    $localCoords = convertGPSToLocal((float)$room['latitude'], (float)$room['longitude']);
                    $room['x'] = $localCoords['x'];
                    $room['y'] = $localCoords['y'];
                    $room['gps'] = [
                        'lat' => (float)$room['latitude'],
                        'lng' => (float)$room['longitude']
                    ];
                } else {
                    $room['x'] = (float)$room['x_coordinate'];
                    $room['y'] = (float)$room['y_coordinate'];
                }
                $room['floor'] = (int)($room['floor_level'] ?? 1);
                unset($room['x_coordinate'], $room['y_coordinate'], $room['floor_level'], $room['latitude'], $room['longitude']);
                echo json_encode([
                    'success' => true,
                    'room' => $room
                ]);
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Room not found']);
            }
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to fetch room: ' . $e->getMessage()]);
        }
        break;
        
    case 'update_room_gps':
        // Update room GPS coordinates (will auto-convert to local coordinates)
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => 'Method not allowed']);
            break;
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        $roomName = $data['name'] ?? '';
        $latitude = $data['latitude'] ?? null;
        $longitude = $data['longitude'] ?? null;
        
        if (empty($roomName) || $latitude === null || $longitude === null) {
            http_response_code(400);
            echo json_encode(['error' => 'Room name, latitude, and longitude are required']);
            break;
        }
        
        try {
            // Convert GPS to local coordinates
            $localCoords = convertGPSToLocal((float)$latitude, (float)$longitude);
            
            // Update room with both GPS and local coordinates
            $stmt = $pdo->prepare("UPDATE rooms SET latitude = ?, longitude = ?, x_coordinate = ?, y_coordinate = ? WHERE name = ?");
            $stmt->execute([$latitude, $longitude, $localCoords['x'], $localCoords['y'], $roomName]);
            
            if ($stmt->rowCount() > 0) {
                echo json_encode([
                    'success' => true,
                    'message' => 'Room GPS coordinates updated and converted to local coordinates',
                    'local_coords' => $localCoords
                ]);
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Room not found']);
            }
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to update room: ' . $e->getMessage()]);
        }
        break;
        
    case 'save_position':
        // Save user position (for testing/tracking)
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => 'Method not allowed']);
            break;
        }
        
        $data = json_decode(file_get_contents('php://input'), true);
        $x = $data['x'] ?? null;
        $y = $data['y'] ?? null;
        $heading = $data['heading'] ?? null;
        $sessionId = $data['session_id'] ?? uniqid('session_', true);
        
        if ($x === null || $y === null) {
            http_response_code(400);
            echo json_encode(['error' => 'Coordinates are required']);
            break;
        }
        
        try {
            $stmt = $pdo->prepare("INSERT INTO user_positions (session_id, x_coordinate, y_coordinate, heading) VALUES (?, ?, ?, ?)");
            $stmt->execute([$sessionId, $x, $y, $heading]);
            echo json_encode([
                'success' => true,
                'message' => 'Position saved',
                'id' => $pdo->lastInsertId()
            ]);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save position: ' . $e->getMessage()]);
        }
        break;
        
    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
        break;
}
