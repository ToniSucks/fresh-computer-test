/* ═══════════════════════════════════════════════════
   DATABASE SETUP — Teaching Guide
   ═══════════════════════════════════════════════════

   SQL = Structured Query Language
   It's how you talk to a database. Think of it like
   a spreadsheet that you control with text commands.

   SQLite stores everything in ONE file (reports.db).
   No username, no password, no server to install.
   Perfect for learning and small projects.

   ═══════════════════════════════════════════════════ */

const Database = require('better-sqlite3');
const path = require('path');

// This creates (or opens) a file called "reports.db" in your project folder.
// All your data lives in this single file.
const DB_PATH = path.join(__dirname, 'reports.db');
const db = new Database(DB_PATH);

// WAL mode = faster for web apps (allows reading while writing)
db.pragma('journal_mode = WAL');

/* ═══════════════════════════════════════════════════
   STEP 1: CREATE THE TABLE
   ═══════════════════════════════════════════════════

   A "table" is like a spreadsheet tab.
   Each "column" is a category (like a spreadsheet column).
   Each "row" is one record (one scan report).

   SQL command: CREATE TABLE
   
   Column types:
     INTEGER  = whole number (1, 2, 3...)
     TEXT     = string ("hello", "python"...)
     DATETIME = date and time

   Special keywords:
     PRIMARY KEY    = unique ID for each row (like a row number)
     AUTOINCREMENT  = the database assigns the ID automatically
     NOT NULL       = this field can't be empty
     DEFAULT        = value to use if none is provided

   ═══════════════════════════════════════════════════ */

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name  TEXT    NOT NULL,
    language      TEXT    NOT NULL,
    setup_cmd     TEXT    DEFAULT '',
    run_cmd       TEXT    NOT NULL,
    expected_result TEXT  DEFAULT '',
    status        TEXT    NOT NULL,
    good          TEXT    DEFAULT '[]',
    problems      TEXT    DEFAULT '[]',
    warnings      TEXT    DEFAULT '[]',
    suggestions   TEXT    DEFAULT '[]',
    files         TEXT    DEFAULT '[]',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

/*
   "IF NOT EXISTS" means: only create the table if it doesn't
   already exist. This way you can restart the server without
   losing your data or getting an error.

   We store arrays (good, problems, etc.) as JSON strings
   because SQLite doesn't have a native array type.
   So ["item1", "item2"] is stored as the text '["item1","item2"]'
*/

/* ═══════════════════════════════════════════════════
   STEP 2: PREPARE SQL STATEMENTS
   ═══════════════════════════════════════════════════

   "Prepared statements" are pre-compiled SQL commands.
   The ? marks are placeholders — you fill them in later.
   This is IMPORTANT for security (prevents SQL injection).

   Never do this:  `INSERT INTO reports VALUES ('${userInput}')`
   Always do this: `INSERT INTO reports VALUES (?)`  + pass userInput separately

   ═══════════════════════════════════════════════════ */

// INSERT = add a new row to the table
// Each ? will be replaced with actual values when we call .run()
const insertReport = db.prepare(`
  INSERT INTO reports (project_name, language, setup_cmd, run_cmd, expected_result, status, good, problems, warnings, suggestions, files)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// SELECT = read data from the table
// ORDER BY created_at DESC = newest first
// LIMIT ? = only return this many rows
const getRecentReports = db.prepare(`
  SELECT * FROM reports
  ORDER BY created_at DESC
  LIMIT ?
`);

// Get one specific report by its ID
const getReportById = db.prepare(`
  SELECT * FROM reports
  WHERE id = ?
`);

// COUNT = how many rows match
const getReportCount = db.prepare(`
  SELECT COUNT(*) as total FROM reports
`);

// Get counts grouped by status (how many Passed, Mostly Okay, Needs Attention)
const getStatusCounts = db.prepare(`
  SELECT status, COUNT(*) as count
  FROM reports
  GROUP BY status
`);

/* ═══════════════════════════════════════════════════
   STEP 3: EXPORT FUNCTIONS
   ═══════════════════════════════════════════════════

   We wrap the SQL statements in normal JavaScript functions
   so the rest of our code doesn't need to know SQL.

   ═══════════════════════════════════════════════════ */

/**
 * Save a scan report to the database.
 *
 * @param {object} report - The report data
 * @returns {number} The ID of the saved report
 *
 * Example:
 *   const id = saveReport({
 *     projectName: 'my-app.zip',
 *     language: 'python',
 *     setupCmd: 'pip install -r requirements.txt',
 *     runCmd: 'python main.py',
 *     expectedResult: 'GUI opens',
 *     status: 'Passed',
 *     good: ['Found README.md'],
 *     problems: [],
 *     warnings: [],
 *     suggestions: [],
 *     files: ['main.py', 'README.md']
 *   });
 *   // id = 1 (first report), 2 (second), etc.
 */
function saveReport(report) {
  const result = insertReport.run(
    report.projectName,
    report.language,
    report.setupCmd || '',
    report.runCmd,
    report.expectedResult || '',
    report.status,
    JSON.stringify(report.good),        // Convert array → JSON string
    JSON.stringify(report.problems),
    JSON.stringify(report.warnings),
    JSON.stringify(report.suggestions),
    JSON.stringify(report.files)
  );

  // result.lastInsertRowid = the auto-generated ID
  return Number(result.lastInsertRowid);
}

/**
 * Get recent reports from the database.
 *
 * @param {number} limit - How many reports to return (default 20)
 * @returns {Array} Array of report objects
 */
function getRecent(limit = 20) {
  const rows = getRecentReports.all(limit);

  // Parse JSON strings back into arrays
  return rows.map(parseReportRow);
}

/**
 * Get a single report by ID.
 *
 * @param {number} id - The report ID
 * @returns {object|null} The report, or null if not found
 */
function getById(id) {
  const row = getReportById.get(id);
  if (!row) return null;
  return parseReportRow(row);
}

/**
 * Get dashboard statistics.
 *
 * @returns {object} { total, passed, mostlyOkay, needsAttention }
 */
function getStats() {
  const { total } = getReportCount.get();
  const statuses = getStatusCounts.all();

  const stats = { total, passed: 0, mostlyOkay: 0, needsAttention: 0 };
  for (const row of statuses) {
    if (row.status === 'Passed') stats.passed = row.count;
    else if (row.status === 'Mostly Okay') stats.mostlyOkay = row.count;
    else if (row.status === 'Needs Attention') stats.needsAttention = row.count;
  }

  return stats;
}

/**
 * Helper: convert a database row back into a nice object.
 * Parses JSON strings back into arrays.
 */
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
    createdAt: row.created_at,
  };
}

// Export everything so server.js can use it
module.exports = { saveReport, getRecent, getById, getStats };
