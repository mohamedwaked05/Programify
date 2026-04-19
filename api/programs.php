<?php
declare(strict_types=1);

// ── Headers ─────────────────────────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/db.php';

// ── Router ───────────────────────────────────────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'];
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Extract numeric ID from URI path (/api/programs/42) or query string (?id=42)
$id = null;
if (preg_match('#/(\d+)/?$#', $uri, $m)) {
    $id = (int) $m[1];
} elseif (isset($_GET['id']) && ctype_digit((string) $_GET['id'])) {
    $id = (int) $_GET['id'];
}

try {
    $db = getDB();

    if      ($method === 'GET'    && $id === null) { listPrograms($db); }
    elseif  ($method === 'GET'    && $id !== null) { getProgram($db, $id); }
    elseif  ($method === 'POST'   && $id === null) { createProgram($db); }
    elseif  ($method === 'PUT'    && $id !== null) { updateProgram($db, $id); }
    elseif  ($method === 'DELETE' && $id !== null) { deleteProgram($db, $id); }
    else    { respond(405, ['error' => 'Method not allowed']); }

} catch (PDOException $e) {
    error_log('[GymApp DB] ' . $e->getMessage());
    respond(500, ['error' => 'Database error — check server logs.']);
} catch (InvalidArgumentException $e) {
    respond(400, ['error' => $e->getMessage()]);
}

// ── Handlers ─────────────────────────────────────────────────────────────────

function listPrograms(PDO $db): void
{
    $stmt = $db->query(
        "SELECT
            id,
            name,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at,
            (SELECT COUNT(*) FROM days WHERE program_id = programs.id) AS day_count
         FROM programs
         ORDER BY updated_at DESC"
    );

    $rows = array_map(function (array $r): array {
        $r['id']        = (int) $r['id'];
        $r['day_count'] = (int) $r['day_count'];
        return $r;
    }, $stmt->fetchAll());

    respond(200, $rows);
}

function getProgram(PDO $db, int $id): void
{
    $stmt = $db->prepare(
        "SELECT
            id,
            name,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS updated_at
         FROM programs WHERE id = ?"
    );
    $stmt->execute([$id]);
    $program = $stmt->fetch();

    if (!$program) {
        respond(404, ['error' => 'Program not found']);
    }

    // Fetch days ordered by position
    $stmt = $db->prepare(
        'SELECT id, name, order_index FROM days WHERE program_id = ? ORDER BY order_index'
    );
    $stmt->execute([$id]);
    $days = $stmt->fetchAll();

    // Fetch all exercises in one round-trip, keyed by day_id
    $exercises = [];
    if (!empty($days)) {
        $dayIds       = array_column($days, 'id');
        $placeholders = implode(',', array_fill(0, count($dayIds), '?'));
        $stmt = $db->prepare(
            "SELECT id, day_id, name, sets, reps, rir, note, order_index
             FROM exercises
             WHERE day_id IN ($placeholders)
             ORDER BY day_id, order_index"
        );
        $stmt->execute($dayIds);
        foreach ($stmt->fetchAll() as $ex) {
            $exercises[(int) $ex['day_id']][] = castExercise($ex);
        }
    }

    // Attach exercises; cast all IDs to int
    foreach ($days as &$day) {
        $did              = (int) $day['id'];
        $day['id']        = $did;
        $day['order_index'] = (int) $day['order_index'];
        $day['exercises'] = $exercises[$did] ?? [];
    }
    unset($day);

    $program['id']   = (int) $program['id'];
    $program['days'] = $days;
    respond(200, $program);
}

function createProgram(PDO $db): void
{
    $body = parseBody();
    validateProgram($body);

    $db->beginTransaction();
    try {
        $stmt = $db->prepare(
            "INSERT INTO programs (name) VALUES (?)
             RETURNING id, name,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at"
        );
        $stmt->execute([sanitizeStr($body['name'], 255)]);
        $program       = $stmt->fetch();
        $program['id'] = (int) $program['id'];

        insertDays($db, $program['id'], $body['days']);
        $db->commit();

        respond(201, $program);
    } catch (\Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

function updateProgram(PDO $db, int $id): void
{
    $body = parseBody();
    validateProgram($body);

    $stmt = $db->prepare('SELECT id FROM programs WHERE id = ?');
    $stmt->execute([$id]);
    if (!$stmt->fetch()) {
        respond(404, ['error' => 'Program not found']);
    }

    $db->beginTransaction();
    try {
        $db->prepare('UPDATE programs SET name = ? WHERE id = ?')
           ->execute([sanitizeStr($body['name'], 255), $id]);

        // Delete days (exercises cascade automatically via FK)
        $db->prepare('DELETE FROM days WHERE program_id = ?')->execute([$id]);

        insertDays($db, $id, $body['days']);
        $db->commit();

        respond(200, ['id' => $id, 'message' => 'Program updated']);
    } catch (\Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

function deleteProgram(PDO $db, int $id): void
{
    $stmt = $db->prepare('DELETE FROM programs WHERE id = ? RETURNING id');
    $stmt->execute([$id]);

    if (!$stmt->fetch()) {
        respond(404, ['error' => 'Program not found']);
    }
    respond(200, ['message' => 'Program deleted']);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function insertDays(PDO $db, int $programId, array $days): void
{
    $dayStmt = $db->prepare(
        'INSERT INTO days (program_id, name, order_index) VALUES (?, ?, ?) RETURNING id'
    );
    $exStmt = $db->prepare(
        'INSERT INTO exercises (day_id, name, sets, reps, rir, note, order_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    foreach ($days as $i => $day) {
        $dayStmt->execute([
            $programId,
            sanitizeStr($day['name'] ?? '', 255),
            $i + 1,
        ]);
        $dayId = (int) $dayStmt->fetchColumn();

        foreach (($day['exercises'] ?? []) as $j => $ex) {
            $exStmt->execute([
                $dayId,
                sanitizeStr($ex['name'] ?? '', 255),
                clampInt((int) ($ex['sets'] ?? 3), 1, 6),
                clampInt((int) ($ex['reps'] ?? 10), 1, 25),
                clampInt((int) ($ex['rir']  ?? 2),  0, 5),
                sanitizeStr($ex['note'] ?? '', 2000),
                $j,
            ]);
        }
    }
}

function castExercise(array $ex): array
{
    return [
        'id'          => (int) $ex['id'],
        'name'        => $ex['name'],
        'sets'        => (int) $ex['sets'],
        'reps'        => (int) $ex['reps'],
        'rir'         => (int) $ex['rir'],
        'note'        => $ex['note'],
        'order_index' => (int) $ex['order_index'],
    ];
}

function clampInt(int $v, int $min, int $max): int
{
    return max($min, min($max, $v));
}

function sanitizeStr(string $s, int $maxLen): string
{
    return mb_substr(trim($s), 0, $maxLen);
}

function validateProgram(array $body): void
{
    $name = trim($body['name'] ?? '');
    if ($name === '') {
        throw new InvalidArgumentException('Program name is required');
    }
    if (mb_strlen($name) > 255) {
        throw new InvalidArgumentException('Program name must be 255 characters or fewer');
    }
    if (!isset($body['days']) || !is_array($body['days'])) {
        throw new InvalidArgumentException('days must be an array');
    }
    if (count($body['days']) !== 7) {
        throw new InvalidArgumentException('Program must contain exactly 7 days');
    }
    foreach ($body['days'] as $i => $day) {
        if (!is_array($day)) {
            throw new InvalidArgumentException("Day {$i} must be an object");
        }
        if (isset($day['exercises']) && !is_array($day['exercises'])) {
            throw new InvalidArgumentException("Day {$i} exercises must be an array");
        }
    }
}

function parseBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        throw new InvalidArgumentException('Request body is empty');
    }
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new InvalidArgumentException('Invalid JSON: ' . json_last_error_msg());
    }
    return is_array($data) ? $data : [];
}

function respond(int $code, array $data): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}
