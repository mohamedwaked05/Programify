<?php
// Router for PHP's built-in server: php -S localhost:8000 router.php

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Serve existing static files (css, js, html, etc.) directly
if ($uri !== '/' && file_exists(__DIR__ . $uri)) {
    return false;
}

// Route /api/programs and /api/programs/123 to the PHP handler
if (preg_match('#^/api/programs(/\d+)?/?$#', $uri)) {
    require __DIR__ . '/api/programs.php';
    return;
}

// Everything else → index.html (single-page app)
require __DIR__ . '/index.html';
