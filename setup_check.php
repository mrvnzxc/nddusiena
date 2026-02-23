<?php
/**
 * AR Navigation System - Setup Verification (Supabase)
 * Run this file to check Supabase configuration and rooms data.
 */

require_once 'config.php';
require_once 'supabase_helper.php';

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>AR Navigation - Setup Check</title>
    <style>body{font-family:Arial;padding:20px;} .success{color:green;} .error{color:red;} table{border-collapse:collapse;margin-top:10px;} th,td{border:1px solid #ddd;padding:8px;}</style>
</head>
<body>
<h1>AR Navigation System - Setup Check (Supabase)</h1>

<h2>1. Supabase configuration</h2>
<?php
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    echo "<p class='error'>✗ SUPABASE_URL or SUPABASE_ANON_KEY is missing. Set them in .env or environment variables.</p>";
    echo "<p>Example .env: SUPABASE_URL=https://xxx.supabase.co, SUPABASE_ANON_KEY=eyJ...</p>";
} else {
    echo "<p class='success'>✓ SUPABASE_URL and SUPABASE_ANON_KEY are set.</p>";
}
?>

<h2>2. Supabase connectivity</h2>
<?php
$health = supabase_health();
if ($health['ok']) {
    echo "<p class='success'>✓ " . htmlspecialchars($health['message']) . "</p>";
} else {
    echo "<p class='error'>✗ " . htmlspecialchars($health['message']) . "</p>";
    echo "<p>Ensure the <code>locations</code> table exists in Supabase and RLS allows anon SELECT.</p>";
}
?>

<h2>3. Locations data</h2>
<?php
$result = supabase_get('locations', 'select=name,description,x_coordinate,y_coordinate,latitude,longitude,floor&order=name.asc');
if ($result['error']) {
    echo "<p class='error'>✗ Failed to fetch locations: " . htmlspecialchars($result['error']) . "</p>";
} else {
    $rows = $result['data'] ?: [];
    $n = count($rows);
    if ($n >= 1) {
        echo "<p class='success'>✓ Found $n location(s).</p>";
        echo "<table><tr><th>Name</th><th>Description</th><th>X</th><th>Y</th><th>Lat</th><th>Lng</th><th>Floor</th></tr>";
        foreach ($rows as $r) {
            echo "<tr>";
            echo "<td>" . htmlspecialchars($r['name'] ?? '') . "</td>";
            echo "<td>" . htmlspecialchars($r['description'] ?? '') . "</td>";
            echo "<td>" . htmlspecialchars($r['x_coordinate'] ?? '') . "</td>";
            echo "<td>" . htmlspecialchars($r['y_coordinate'] ?? '') . "</td>";
            echo "<td>" . htmlspecialchars($r['latitude'] ?? '') . "</td>";
            echo "<td>" . htmlspecialchars($r['longitude'] ?? '') . "</td>";
            echo "<td>" . htmlspecialchars($r['floor'] ?? '') . "</td>";
            echo "</tr>";
        }
        echo "</table>";
    } else {
        echo "<p class='error'>✗ No locations in table. Add rows to the <code>locations</code> table in Supabase.</p>";
    }
}
?>

<h2>4. API endpoint test</h2>
<?php
$base = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
$path = dirname($_SERVER['SCRIPT_NAME'] ?? '');
$apiUrl = rtrim($base . $path, '/') . '/api.php?action=get_rooms';
$response = @file_get_contents($apiUrl);
if ($response !== false) {
    $data = json_decode($response, true);
    if ($data && !empty($data['success']) && !empty($data['rooms'])) {
        echo "<p class='success'>✓ API get_rooms returned " . count($data['rooms']) . " room(s).</p>";
        echo "<pre style='background:#f0f0f0;padding:10px;overflow:auto;max-height:200px;'>" . htmlspecialchars(json_encode($data, JSON_PRETTY_PRINT)) . "</pre>";
    } else {
        echo "<p class='error'>✗ API error or no rooms: " . htmlspecialchars(substr($response, 0, 500)) . "</p>";
    }
} else {
    echo "<p class='error'>✗ Could not reach api.php. Check that the server is running and the path is correct.</p>";
}
?>

<h2>5. Next steps</h2>
<ol>
    <li>Ensure <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> are set (e.g. in Vercel env vars or .env).</li>
    <li>In Supabase: table <code>locations</code> (from your <code>campus_navigation.sql</code>) with at least name, description, floor, latitude/longitude or x/y coordinates.</li>
    <li>Optional: table <code>user_positions</code> if you use save_position (session_id, x_coordinate, y_coordinate, heading).</li>
    <li>Open <a href="index.html">index.html</a> in a mobile browser; grant camera and location when prompted.</li>
</ol>
<p><strong>Note:</strong> HTTPS or localhost is required for camera and geolocation.</p>
</body>
</html>
