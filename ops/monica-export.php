<?php

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(0);

const EXPORT_FORMAT = 'socos-monica-contacts';
const EXPORT_VERSION = 1;

/** @param array<string, mixed> $value */
function writeJsonLine(array $value): string
{
    $line = json_encode(
        $value,
        JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
    );
    $payload = $line . "\n";
    $offset = 0;
    while ($offset < strlen($payload)) {
        $written = fwrite(STDOUT, substr($payload, $offset));
        if ($written === false || $written === 0) {
            throw new RuntimeException('stream_write_failed');
        }
        $offset += $written;
    }
    return $line;
}

function requiredEnvironment(string $name): string
{
    $value = getenv($name);
    if (!is_string($value) || $value === '') {
        throw new RuntimeException('environment_missing');
    }
    return $value;
}

$database = null;

try {
    $host = requiredEnvironment('DB_HOST');
    $name = requiredEnvironment('DB_DATABASE');
    $username = requiredEnvironment('DB_USERNAME');
    $password = requiredEnvironment('DB_PASSWORD');
    $port = getenv('DB_PORT');
    $port = is_string($port) && $port !== '' ? $port : '5432';

    $database = new PDO(
        sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port, $name),
        $username,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ],
    );
    $database->beginTransaction();
    $database->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    $database->exec("SET LOCAL TIME ZONE 'UTC'");

    $contacts = $database->query(<<<'SQL'
        SELECT
          c.id::text AS source_id,
          c.first_name,
          c.last_name,
          c.middle_name,
          c.nickname,
          company.name AS company,
          c.job_position,
          to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS source_created_at,
          to_char(c.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS source_updated_at,
          COALESCE((
            SELECT json_agg(DISTINCT label.name ORDER BY label.name)
              FROM contact_label AS contact_label_link
              JOIN labels AS label ON label.id = contact_label_link.label_id
             WHERE contact_label_link.contact_id = c.id
          ), '[]'::json)::text AS labels,
          COALESCE((
            SELECT json_agg(DISTINCT contact_group.name ORDER BY contact_group.name)
              FROM contact_group AS contact_group_link
              JOIN groups AS contact_group ON contact_group.id = contact_group_link.group_id
             WHERE contact_group_link.contact_id = c.id
               AND contact_group.deleted_at IS NULL
          ), '[]'::json)::text AS groups
        FROM contacts AS c
        LEFT JOIN companies AS company ON company.id = c.company_id
        WHERE c.deleted_at IS NULL
          AND c.listed = true
        ORDER BY c.id
        SQL);

    writeJsonLine([
        'type' => 'header',
        'format' => EXPORT_FORMAT,
        'version' => EXPORT_VERSION,
    ]);

    $digest = hash_init('sha256');
    $count = 0;
    while ($row = $contacts->fetch()) {
        $line = writeJsonLine([
            'type' => 'contact',
            'sourceId' => $row['source_id'],
            'firstName' => $row['first_name'],
            'lastName' => $row['last_name'],
            'middleName' => $row['middle_name'],
            'nickname' => $row['nickname'],
            'company' => $row['company'],
            'jobTitle' => $row['job_position'],
            'labels' => json_decode($row['labels'], true, 512, JSON_THROW_ON_ERROR),
            'groups' => json_decode($row['groups'], true, 512, JSON_THROW_ON_ERROR),
            'sourceCreatedAt' => $row['source_created_at'],
            'sourceUpdatedAt' => $row['source_updated_at'],
        ]);
        hash_update($digest, $line . "\n");
        $count++;
    }

    $database->commit();
    writeJsonLine([
        'type' => 'trailer',
        'count' => $count,
        'sha256' => hash_final($digest),
    ]);
} catch (Throwable $error) {
    if ($database instanceof PDO && $database->inTransaction()) {
        $database->rollBack();
    }
    fwrite(STDERR, "export_status=failed code=export_failed\n");
    exit(1);
}
