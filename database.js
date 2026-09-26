/* ═══════════════════════════════════════════════════
   DATABASE SETUP — With Users & Auth
   ═══════════════════════════════════════════════════

   Two tables now:
     1. users   — stores accounts (username + hashed password)
     2. reports — stores scan results, linked to a user via user_id

   The "user_id" column in reports is a FOREIGN KEY.
   Think of it like a link: each report points to the user who created it.

   ═══════════════════════════════════════════════════ */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'reports.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

/* ═══════════════════════════════════════════════════
   TABLE 1: users
   ═══════════════════════════════════════════════════

   UNIQUE on username = the database itself rejects duplicates.
   If you try INSERT with a username that exists, it errors.
   We catch that error and show "Username already taken."

   ═══════════════════════════════════════════════════ */

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/* ═══════════════════════════════════════════════════
   TABLE 2: reports (now with user_id)
   ═══════════════════════════════════════════════════

   REFERENCES users(id) = foreign key constraint.
   This means user_id MUST match an existing user's id.
   The database won't let you insert a report for a
   user that doesn't exist.

   ═══════════════════════════════════════════════════ */

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    project_name    TEXT    NOT NULL,
    language        TEXT    NOT NULL,
    setup_cmd       TEXT    DEFAULT '',
    run_cmd         TEXT    NOT NULL,
    expected_result TEXT    DEFAULT '',
    status          TEXT    NOT NULL,
    good            TEXT    DEFAULT '[]',
    problems        TEXT    DEFAULT '[]',
    warnings        TEXT    DEFAULT '[]',
    suggestions     TEXT    DEFAULT '[]',
    files           TEXT    DEFAULT '[]',
    execution_status TEXT   DEFAULT 'Not Run',
    execution_output TEXT   DEFAULT '',
    file_contents   TEXT    DEFAULT '{}',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration for existing tables
try {
  db.exec("ALTER TABLE reports ADD COLUMN execution_status TEXT DEFAULT 'Not Run'");
  db.exec("ALTER TABLE reports ADD COLUMN execution_output TEXT DEFAULT ''");
} catch (err) {}
try {
  db.exec("ALTER TABLE reports ADD COLUMN file_contents TEXT DEFAULT '{}'");
} catch (err) {}

// Enable foreign key enforcement (SQLite has it off by default!)
db.pragma('foreign_keys = ON');

/* ═══════════════════════════════════════════════════
   PREPARED STATEMENTS
   ═══════════════════════════════════════════════════ */

// ── User queries ────────────────────────────────────

// Register: insert a new user
const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash)
  VALUES (?, ?)
`);

// Login: find user by username
const findUserByUsername = db.prepare(`
  SELECT * FROM users WHERE username = ?
`);

// Get user by ID (for session lookups)
const findUserById = db.prepare(`
  SELECT id, username, created_at FROM users WHERE id = ?
`);

// ── Report queries (now filtered by user_id) ────────

// Save a report linked to a user
const insertReport = db.prepare(`
  INSERT INTO reports (
    user_id, project_name, language, setup_cmd, run_cmd, expected_result, status, 
    good, problems, warnings, suggestions, files, execution_status, execution_output, file_contents
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Get recent reports for ONE user only
// This is the key difference from before:
//   WHERE user_id = ?  ← only show THIS user's reports
const getRecentByUser = db.prepare(`
  SELECT * FROM reports
  WHERE user_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

// Get one report (only if it belongs to this user)
const getReportByIdAndUser = db.prepare(`
  SELECT * FROM reports
  WHERE id = ? AND user_id = ?
`);

// Delete one report (only if it belongs to this user)
const deleteReportByIdAndUser = db.prepare(`
  DELETE FROM reports
  WHERE id = ? AND user_id = ?
`);

// Update execution results for a report
const updateReportExecution = db.prepare(`
  UPDATE reports 
  SET execution_status = ?, execution_output = ?
  WHERE id = ?
`);

// Count reports for one user
const getReportCountByUser = db.prepare(`
  SELECT COUNT(*) as total FROM reports WHERE user_id = ?
`);

// Status breakdown for one user
const getStatusCountsByUser = db.prepare(`
  SELECT status, COUNT(*) as count
  FROM reports
  WHERE user_id = ?
  GROUP BY status
`);

/* ═══════════════════════════════════════════════════
   EXPORTED FUNCTIONS
   ═══════════════════════════════════════════════════ */

// ── Auth functions ──────────────────────────────────

/**
 * Create a new user account.
 * @param {string} username
 * @param {string} passwordHash - already hashed by bcrypt
 * @returns {number} The new user's ID
 * @throws If username is already taken (UNIQUE constraint)
 */
function createUser(username, passwordHash) {
  const result = insertUser.run(username, passwordHash);
  return Number(result.lastInsertRowid);
}

/**
 * Find a user by username (for login).
 * @returns {object|undefined} { id, username, password_hash, created_at }
 */
function getUserByUsername(username) {
  return findUserByUsername.get(username);
}

/**
 * Find a user by ID (for session validation).
 * @returns {object|undefined} { id, username, created_at }
 */
function getUserById(id) {
  return findUserById.get(id);
}

// ── Report functions (now require userId) ───────────

/**
 * Save a report linked to a user.
 */
function saveReport(userId, report) {
  const result = insertReport.run(
    userId,
    report.projectName,
    report.language,
    report.setupCmd || '',
    report.runCmd,
    report.expectedResult || '',
    report.status,
    JSON.stringify(report.good),
    JSON.stringify(report.problems),
    JSON.stringify(report.warnings),
    JSON.stringify(report.suggestions),
    JSON.stringify(report.files),
    report.executionStatus || 'Not Run',
    report.executionOutput || '',
    JSON.stringify(report.fileContents || {})
  );
  return Number(result.lastInsertRowid);
}

/**
 * Get recent reports for a specific user.
 */
function getRecent(userId, limit = 20) {
  const rows = getRecentByUser.all(userId, limit);
  return rows.map(parseReportRow);
}

/**
 * Get a single report by ID (only if user owns it).
 */
function getById(reportId, userId) {
  const row = getReportByIdAndUser.get(reportId, userId);
  if (!row) return null;
  return parseReportRow(row);
}

/**
 * Delete a single report by ID (only if user owns it).
 */
function deleteReport(reportId, userId) {
  const result = deleteReportByIdAndUser.run(reportId, userId);
  return result.changes > 0;
}

/**
 * Update the execution results for a pending report.
 */
function updateExecutionResults(reportId, status, output) {
  updateReportExecution.run(status, output, reportId);
}

/**
 * Get dashboard stats for a specific user.
 */
function getStats(userId) {
  const { total } = getReportCountByUser.get(userId);
  const statuses = getStatusCountsByUser.all(userId);

  const stats = { total, passed: 0, mostlyOkay: 0, needsAttention: 0 };
  for (const row of statuses) {
    if (row.status === 'Passed') stats.passed = row.count;
    else if (row.status === 'Mostly Okay') stats.mostlyOkay = row.count;
    else if (row.status === 'Needs Attention') stats.needsAttention = row.count;
  }
  return stats;
}

/** Parse a database row into a clean JS object. */
function parseReportRow(row) {
  return {
    id: row.id,
    projectName: row.project_name,
    language: row.language,
    setupCmd: row.setup_cmd,
    runCmd: row.run_cmd,
    expectedResult: row.expected_result,
    status: row.status,
    good: JSON.parse(row.good),
    problems: JSON.parse(row.problems),
    warnings: JSON.parse(row.warnings),
    suggestions: JSON.parse(row.suggestions),
    files: JSON.parse(row.files),
    executionStatus: row.execution_status,
    executionOutput: row.execution_output,
    fileContents: row.file_contents ? JSON.parse(row.file_contents) : {},
    createdAt: row.created_at,
  };
}

// Export the raw db instance too (needed for session store)
module.exports = {
  db,
  createUser, getUserByUsername, getUserById,
  saveReport, getRecent, getById, deleteReport, getStats,
  updateExecutionResults
};
