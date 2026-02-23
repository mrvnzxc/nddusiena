<?php
/**
 * AR Indoor Navigation System - Configuration
 * Uses Supabase (env) for database; no MySQL.
 */

// Supabase Configuration (from environment or .env)
if (!defined('SUPABASE_URL')) {
    define('SUPABASE_URL', getenv('SUPABASE_URL') ?: (function() {
        if (file_exists(__DIR__ . '/.env')) {
            $lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                if (strpos(trim($line), '#') === 0) continue;
                if (preg_match('/^\s*SUPABASE_URL\s*=\s*(.+)$/', $line, $m)) {
                    return trim($m[1], " \t\"'");
                }
            }
        }
        return '';
    })());
}

if (!defined('SUPABASE_ANON_KEY')) {
    define('SUPABASE_ANON_KEY', getenv('SUPABASE_ANON_KEY') ?: (function() {
        if (file_exists(__DIR__ . '/.env')) {
            $lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                if (strpos(trim($line), '#') === 0) continue;
                if (preg_match('/^\s*SUPABASE_ANON_KEY\s*=\s*(.+)$/', $line, $m)) {
                    return trim($m[1], " \t\"'");
                }
            }
        }
        return '';
    })());
}

// Application Configuration
define('ARRIVAL_THRESHOLD', 2.0); // meters - distance threshold for arrival detection

// GPS to Local Coordinate Conversion
define('BUILDING_ORIGIN_LAT', 6.153058);
define('BUILDING_ORIGIN_LNG', 125.167484);
define('METERS_PER_DEGREE_LAT', 111000);
define('METERS_PER_DEGREE_LNG', 111000);
