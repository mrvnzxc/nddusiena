<?php
/**
 * Supabase REST API helper (no MySQL).
 * Requires config.php for SUPABASE_URL and SUPABASE_ANON_KEY.
 */

require_once __DIR__ . '/config.php';

/**
 * Call Supabase REST API.
 *
 * @param string $method GET|POST|PATCH|DELETE
 * @param string $table  Table name (e.g. rooms, user_positions)
 * @param array  $options [ 'query' => 'select=*&order=name', 'body' => json, 'filter' => [ 'name' => 'finance' ] ]
 * @return array [ 'code' => int, 'body' => array|string ]
 */
function supabase_request($method, $table, $options = []) {
    $url = rtrim(SUPABASE_URL, '/') . '/rest/v1/' . $table;
    if (!empty($options['query'])) {
        $url .= (strpos($url, '?') !== false ? '&' : '?') . $options['query'];
    }
    if (!empty($options['filter'])) {
        $parts = [];
        foreach ($options['filter'] as $col => $val) {
            $parts[] = $col . '=eq.' . rawurlencode($val);
        }
        $url .= (strpos($url, '?') !== false ? '&' : '?') . implode('&', $parts);
    }

    $headers = [
        'apikey: ' . SUPABASE_ANON_KEY,
        'Authorization: Bearer ' . SUPABASE_ANON_KEY,
        'Content-Type: application/json',
        'Prefer: return=representation',
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

    if (in_array($method, ['POST', 'PATCH']) && isset($options['body'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($options['body']) ? $options['body'] : json_encode($options['body']));
    }

    $response = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $body = $response;
    if ($response && (strpos($response, '[') === 0 || strpos($response, '{') === 0)) {
        $decoded = json_decode($response, true);
        if (json_last_error() === JSON_ERROR_NONE) {
            $body = $decoded;
        }
    }

    return ['code' => $code, 'body' => $body];
}

/**
 * Fetch rows from a table.
 *
 * @param string $table
 * @param string $query e.g. "select=*&order=name.asc"
 * @return array [ 'data' => array, 'error' => string|null ]
 */
function supabase_get($table, $query = 'select=*') {
    $r = supabase_request('GET', $table, ['query' => $query]);
    if ($r['code'] >= 400) {
        return ['data' => null, 'error' => is_array($r['body']) ? ($r['body']['message'] ?? json_encode($r['body'])) : (string) $r['body']];
    }
    $data = is_array($r['body']) ? $r['body'] : [];
    return ['data' => $data, 'error' => null];
}

/**
 * Update rows matching a filter (e.g. name=eq.finance).
 *
 * @param string $table
 * @param array  $payload e.g. [ 'latitude' => 6.15, 'x_coordinate' => 1.2 ]
 * @param string $filterColumn e.g. name
 * @param mixed  $filterValue  e.g. finance
 * @return array [ 'updated' => int, 'error' => string|null ]
 */
function supabase_patch($table, $payload, $filterColumn, $filterValue) {
    $r = supabase_request('PATCH', $table, [
        'filter' => [$filterColumn => $filterValue],
        'body'   => $payload,
    ]);
    if ($r['code'] >= 400) {
        return ['updated' => 0, 'error' => is_array($r['body']) ? ($r['body']['message'] ?? json_encode($r['body'])) : (string) $r['body']];
    }
    $count = is_array($r['body']) ? count($r['body']) : 0;
    return ['updated' => $count, 'error' => null];
}

/**
 * Insert a row.
 *
 * @param string $table
 * @param array  $row
 * @return array [ 'id' => mixed|null, 'error' => string|null ]
 */
function supabase_post($table, $row) {
    $r = supabase_request('POST', $table, ['body' => $row]);
    if ($r['code'] >= 400) {
        return ['id' => null, 'error' => is_array($r['body']) ? ($r['body']['message'] ?? json_encode($r['body'])) : (string) $r['body']];
    }
    $id = null;
    if (is_array($r['body']) && count($r['body']) > 0) {
        $first = $r['body'][0];
        $id = $first['id'] ?? $first['name'] ?? null;
    }
    return ['id' => $id, 'error' => null];
}

/**
 * Check Supabase config and connectivity (GET a table).
 *
 * @return array [ 'ok' => bool, 'message' => string ]
 */
function supabase_health() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return ['ok' => false, 'message' => 'SUPABASE_URL or SUPABASE_ANON_KEY not set in config/env'];
    }
    $r = supabase_request('GET', 'locations', ['query' => 'select=name&limit=1']);
    if ($r['code'] >= 400) {
        return ['ok' => false, 'message' => 'Supabase request failed: ' . (is_array($r['body']) ? json_encode($r['body']) : $r['body'])];
    }
    return ['ok' => true, 'message' => 'Connected'];
}
