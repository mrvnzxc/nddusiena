<?php
/**
 * AR Indoor Navigation System - API Endpoint
 * Uses Supabase (no MySQL). Returns room coordinates and handles updates.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

require_once 'config.php';
require_once 'supabase_helper.php';

/**
 * Convert GPS coordinates to local building coordinates (x, y)
 */
function convertGPSToLocal($lat, $lng) {
    $deltaLat = $lat - BUILDING_ORIGIN_LAT;
    $deltaLng = $lng - BUILDING_ORIGIN_LNG;
    $metersPerDegreeLng = METERS_PER_DEGREE_LNG * cos(deg2rad(BUILDING_ORIGIN_LAT));
    $x = $deltaLng * $metersPerDegreeLng;
    $y = $deltaLat * METERS_PER_DEGREE_LAT;
    return ['x' => $x, 'y' => $y];
}

function convertLocalToGPS($x, $y) {
    $metersPerDegreeLng = METERS_PER_DEGREE_LNG * cos(deg2rad(BUILDING_ORIGIN_LAT));
    $deltaLng = $x / $metersPerDegreeLng;
    $deltaLat = $y / METERS_PER_DEGREE_LAT;
    return ['lat' => BUILDING_ORIGIN_LAT + $deltaLat, 'lng' => BUILDING_ORIGIN_LNG + $deltaLng];
}

/**
 * Normalize a room row from Supabase to API format (x, y, floor, gps)
 */
function normalizeRoom($row) {
    // Base fields from locations table
    $room = [];
    $room['name'] = $row['name'] ?? '';
    $room['display_name'] = $row['display_name'] ?? $row['name'] ?? '';
    $room['description'] = $row['description'] ?? null;

    // GPS → local or fallback to stored x/y
    $lat = isset($row['latitude']) ? (float) $row['latitude'] : null;
    $lng = isset($row['longitude']) ? (float) $row['longitude'] : null;
    if ($lat !== null && $lng !== null) {
        $local = convertGPSToLocal($lat, $lng);
        $room['x'] = $local['x'];
        $room['y'] = $local['y'];
        $room['gps'] = ['lat' => $lat, 'lng' => $lng];
    } else {
        $room['x'] = isset($row['x_coordinate']) ? (float) $row['x_coordinate'] : 0;
        $room['y'] = isset($row['y_coordinate']) ? (float) $row['y_coordinate'] : 0;
    }

    // Floor: from locations.floor (or floor_level if you added it)
    $room['floor'] = (int) ($row['floor'] ?? $row['floor_level'] ?? 1);

    return $room;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// Check Supabase config before any action
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    http_response_code(503);
    echo json_encode(['error' => 'Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env or environment.']);
    exit;
}

switch ($action) {
    case 'get_rooms':
        // Use Supabase table `locations` and map to rooms
        $result = supabase_get(
            'locations',
            'select=id,name,description,building,floor,room_number,latitude,longitude,x_coordinate,y_coordinate,z_coordinate,marker_id&order=name.asc'
        );
        if ($result['error']) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to fetch rooms: ' . $result['error']]);
            break;
        }
        $rooms = array_map('normalizeRoom', $result['data'] ?: []);
        echo json_encode(['success' => true, 'rooms' => $rooms]);
        break;

    case 'get_room':
        $roomName = $_GET['name'] ?? '';
        if ($roomName === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Room name is required']);
            break;
        }
        $result = supabase_request('GET', 'locations', [
            'query'  => 'select=id,name,description,building,floor,room_number,latitude,longitude,x_coordinate,y_coordinate,z_coordinate,marker_id',
            'filter' => ['name' => $roomName],
        ]);
        if ($result['code'] >= 400) {
            http_response_code($result['code']);
            echo json_encode(['error' => is_array($result['body']) ? ($result['body']['message'] ?? 'Not found') : $result['body']]);
            break;
        }
        $list = is_array($result['body']) ? $result['body'] : [];
        $room = count($list) > 0 ? $list[0] : null;
        if (!$room) {
            http_response_code(404);
            echo json_encode(['error' => 'Room not found']);
            break;
        }
        echo json_encode(['success' => true, 'room' => normalizeRoom($room)]);
        break;

    case 'update_room_gps':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => 'Method not allowed']);
            break;
        }
        $data = json_decode(file_get_contents('php://input'), true) ?: [];
        $roomName = $data['name'] ?? '';
        $latitude = isset($data['latitude']) ? (float) $data['latitude'] : null;
        $longitude = isset($data['longitude']) ? (float) $data['longitude'] : null;
        if ($roomName === '' || $latitude === null || $longitude === null) {
            http_response_code(400);
            echo json_encode(['error' => 'Room name, latitude, and longitude are required']);
            break;
        }
        $local = convertGPSToLocal($latitude, $longitude);
        $patch = supabase_patch('locations', [
            'latitude'     => $latitude,
            'longitude'    => $longitude,
            'x_coordinate' => $local['x'],
            'y_coordinate' => $local['y'],
        ], 'name', $roomName);
        if ($patch['error']) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to update room: ' . $patch['error']]);
            break;
        }
        if ($patch['updated'] === 0) {
            http_response_code(404);
            echo json_encode(['error' => 'Room not found']);
            break;
        }
        echo json_encode([
            'success'       => true,
            'message'       => 'Room GPS coordinates updated and converted to local coordinates',
            'local_coords'  => $local,
        ]);
        break;

    case 'save_position':
        if ($method !== 'POST') {
            http_response_code(405);
            echo json_encode(['error' => 'Method not allowed']);
            break;
        }
        $data = json_decode(file_get_contents('php://input'), true) ?: [];
        $x = isset($data['x']) ? (float) $data['x'] : null;
        $y = isset($data['y']) ? (float) $data['y'] : null;
        $heading = isset($data['heading']) ? $data['heading'] : null;
        $sessionId = $data['session_id'] ?? 'session_' . uniqid('', true);
        if ($x === null || $y === null) {
            http_response_code(400);
            echo json_encode(['error' => 'Coordinates are required']);
            break;
        }
        $row = [
            'session_id'   => $sessionId,
            'x_coordinate' => $x,
            'y_coordinate' => $y,
            'heading'     => $heading,
        ];
        $insert = supabase_post('user_positions', $row);
        if ($insert['error']) {
            http_response_code(500);
            echo json_encode(['error' => 'Failed to save position: ' . $insert['error']]);
            break;
        }
        echo json_encode(['success' => true, 'message' => 'Position saved', 'id' => $insert['id']]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action']);
        break;
}
