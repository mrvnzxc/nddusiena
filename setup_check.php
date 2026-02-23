<?php
/**
 * AR Navigation System - Setup Verification
 * Run this file to check if your database is configured correctly
 */

require_once 'config.php';

echo "<h1>AR Navigation System - Setup Check</h1>";
echo "<style>body{font-family:Arial;padding:20px;} .success{color:green;} .error{color:red;}</style>";

// Check database connection
echo "<h2>1. Database Connection</h2>";
try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4", DB_USER, DB_PASS);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    echo "<p class='success'>✓ Database connection successful</p>";
} catch (PDOException $e) {
    echo "<p class='error'>✗ Database connection failed: " . $e->getMessage() . "</p>";
    echo "<p>Please check your config.php settings and ensure the database exists.</p>";
    exit;
}

// Check if rooms table exists
echo "<h2>2. Database Tables</h2>";
try {
    $stmt = $pdo->query("SHOW TABLES LIKE 'rooms'");
    if ($stmt->rowCount() > 0) {
        echo "<p class='success'>✓ Rooms table exists</p>";
    } else {
        echo "<p class='error'>✗ Rooms table not found. Please run database.sql to create it.</p>";
    }
} catch (PDOException $e) {
    echo "<p class='error'>✗ Error checking tables: " . $e->getMessage() . "</p>";
}

// Check rooms data
echo "<h2>3. Rooms Data</h2>";
try {
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM rooms");
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    $roomCount = $result['count'];
    
    if ($roomCount >= 3) {
        echo "<p class='success'>✓ Found $roomCount rooms in database</p>";
        
        // List rooms
        $stmt = $pdo->query("SELECT name, display_name, x_coordinate, y_coordinate FROM rooms");
        $rooms = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo "<table border='1' cellpadding='10' style='border-collapse:collapse;margin-top:10px;'>";
        echo "<tr><th>Name</th><th>Display Name</th><th>X</th><th>Y</th></tr>";
        foreach ($rooms as $room) {
            echo "<tr>";
            echo "<td>" . htmlspecialchars($room['name']) . "</td>";
            echo "<td>" . htmlspecialchars($room['display_name']) . "</td>";
            echo "<td>" . $room['x_coordinate'] . "</td>";
            echo "<td>" . $room['y_coordinate'] . "</td>";
            echo "</tr>";
        }
        echo "</table>";
    } else {
        echo "<p class='error'>✗ Only $roomCount rooms found. Expected 3 rooms (Clinic, Cashier, Registrar).</p>";
        echo "<p>Please run the INSERT statements from database.sql</p>";
    }
} catch (PDOException $e) {
    echo "<p class='error'>✗ Error checking rooms: " . $e->getMessage() . "</p>";
}

// Test API endpoint
echo "<h2>4. API Endpoint Test</h2>";
$apiUrl = 'api.php?action=get_rooms';
echo "<p>Testing: <a href='$apiUrl' target='_blank'>$apiUrl</a></p>";
$response = @file_get_contents($apiUrl);
if ($response) {
    $data = json_decode($response, true);
    if ($data && isset($data['success']) && $data['success']) {
        echo "<p class='success'>✓ API endpoint working correctly</p>";
        echo "<pre style='background:#f0f0f0;padding:10px;overflow:auto;'>" . htmlspecialchars(json_encode($data, JSON_PRETTY_PRINT)) . "</pre>";
    } else {
        echo "<p class='error'>✗ API returned error: " . htmlspecialchars($response) . "</p>";
    }
} else {
    echo "<p class='error'>✗ Could not reach API endpoint</p>";
}

echo "<h2>5. Next Steps</h2>";
echo "<ol>";
echo "<li>Ensure all files are uploaded to your web server</li>";
echo "<li>Open <a href='index.html'>index.html</a> in a mobile browser</li>";
echo "<li>Grant camera and orientation permissions when prompted</li>";
echo "<li>Select a destination room and start navigating!</li>";
echo "</ol>";

echo "<p><strong>Note:</strong> This system requires HTTPS or localhost for camera access to work properly.</p>";
