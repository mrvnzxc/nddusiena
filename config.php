<?php
/**
 * AR Indoor Navigation System - Configuration
 * Update these values according to your database setup
 */

// Database Configuration
define('DB_HOST', 'localhost');
define('DB_NAME', 'ar_navigation');
define('DB_USER', 'root');
define('DB_PASS', '');

// Application Configuration
define('ARRIVAL_THRESHOLD', 2.0); // meters - distance threshold for arrival detection

// GPS to Local Coordinate Conversion
// Reference point: Building origin in GPS coordinates (Notre Dame Siena College)
// Using the average/center of the three offices as building origin
// Finance: 6.153082, 125.167449
// Registrar: 6.153060, 125.167487
// Guidance: 6.153033, 125.167516
// Building origin (average): approximately center point
define('BUILDING_ORIGIN_LAT', 6.153058); // Latitude of building origin (center of offices)
define('BUILDING_ORIGIN_LNG', 125.167484); // Longitude of building origin (center of offices)

// Conversion factor: meters per degree (approximate for General Santos City area)
// 1 degree latitude ≈ 111,000 meters
// 1 degree longitude ≈ 111,000 * cos(latitude) meters
define('METERS_PER_DEGREE_LAT', 111000);
define('METERS_PER_DEGREE_LNG', 111000); // Will be adjusted based on latitude
