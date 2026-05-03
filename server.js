/* ═══════════════════════════════════════════════════
   Fresh Computer Test — Backend
   ═══════════════════════════════════════════════════ */

const express = require('express');
const multer  = require('multer');
const AdmZip  = require('adm-zip');
const path    = require('path');
const fs      = require('fs');

// Import our database module (see database.js for full SQL explanation)
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure uploads dir exists ──────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ── Multer config ──────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' ||
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are accepted.'));
    }
  },
});

// ── Serve static frontend ──────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API endpoint ───────────────────────────────────
app.post('/api/check', (req, res) => {
  upload.single('zip')(req, res, (multerErr) => {
    if (multerErr) {
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 200 MB.' });
      }
      return res.status(400).json({ error: multerErr.message || 'Upload failed.' });
    }

    handleCheck(req, res);
  });
});

function handleCheck(req, res) {
  const zipPath = req.file?.path;

  if (!zipPath) {
    return res.status(400).json({ error: 'No ZIP file uploaded.' });
  }

  try {
    const language       = (req.body.language || '').toLowerCase();
    const runCmd         = (req.body.runCmd || '').trim();
    const expectedResult = (req.body.expectedResult || '').trim();

    // Open ZIP and list entries
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    // Build flat file list (skip directories, strip leading folder if present)
    const files = entries
      .filter(e => !e.isDirectory)
      .map(e => e.entryName);

    // Normalise paths: remove a common single top-level folder prefix
    const normFiles = normaliseFilePaths(files);

    // ── Run all checks ──────────────────────────────
    const good        = [];
    const problems    = [];
    const warnings    = [];
    const suggestions = [];

    checkReadme(normFiles, good, warnings, suggestions);
    checkRunCommandFile(runCmd, normFiles, good, problems);
    checkDependencies(language, normFiles, good, warnings, suggestions);
    checkEnvFile(normFiles, problems, suggestions);
    checkHardcodedPaths(zip, entries, normFiles, problems, suggestions);
    checkExpectedResult(expectedResult, warnings, suggestions);

    // ── Determine status ────────────────────────────
    let status;
    if (problems.length > 0) {
      status = 'Needs Attention';
    } else if (warnings.length > 0) {
      status = 'Mostly Okay';
    } else {
      status = 'Passed';
    }

    const report = { status, good, problems, warnings, suggestions, files: normFiles };

    // ── Save to database ────────────────────────────
    // req.file.originalname = the filename the user uploaded (e.g. "csc111-project-2.zip")
    const reportId = db.saveReport({
      projectName: req.file.originalname,
      language,
      setupCmd: (req.body.setupCmd || '').trim(),
      runCmd,
      expectedResult,
      status,
      good,
      problems,
      warnings,
      suggestions,
      files: normFiles,
    });

    // Include the report ID in the response so the frontend can link to it
    report.id = reportId;
    res.json(report);
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: 'Failed to analyse the ZIP file.' });
  } finally {
    // Clean up uploaded file
    fs.unlink(zipPath, () => {});
  }
}

/* ═══════════════════════════════════════════════════
   CHECKS
   ═══════════════════════════════════════════════════ */

// ── Check 1: README / instructions ─────────────────
function checkReadme(files, good, warnings, suggestions) {
  const targets = ['readme.md', 'readme.txt', 'readme', 'instructions.txt', 'run.txt'];
  const found = files.find(f => {
    const base = path.basename(f).toLowerCase();
    return targets.includes(base);
  });

  if (found) {
    good.push(`Found project instructions (${path.basename(found)}).`);
  } else {
    warnings.push('No README or instruction file found.');
    suggestions.push('Add a README.md explaining setup and run steps.');
  }
}

// ── Check 2: Run-command file exists ───────────────
function checkRunCommandFile(runCmd, files, good, problems) {
  if (!runCmd) return;

  const target = extractTargetFile(runCmd);
  if (!target) return;

  const exists = files.some(f => {
    const norm = f.replace(/\\/g, '/');
    return norm === target || norm.endsWith('/' + target) || path.basename(norm) === target;
  });

  if (exists) {
    good.push(`Run command file (${target}) exists.`);
  } else {
    problems.push(`Run command mentions ${target}, but that file was not found.`);
  }
}

/**
 * Extract the target file from a run command.
 * Handles: python main.py, node src/index.js, java Main, etc.
 */
function extractTargetFile(cmd) {
  const parts = cmd.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const runner = parts[0].toLowerCase();
  // Skip flags (start with -)
  const args = parts.slice(1).filter(p => !p.startsWith('-'));
  if (args.length === 0) return null;

  let file = args[0];

  // For java, append .java if no extension
  if (runner === 'java' && !path.extname(file)) {
    file += '.java';
  }

  return file;
}

// ── Check 3: Dependency file ───────────────────────
function checkDependencies(language, files, good, warnings, suggestions) {
  const rules = {
    python: {
      expected: ['requirements.txt', 'pipfile', 'pyproject.toml'],
      label: 'requirements.txt (or Pipfile)',
      langLabel: 'Python',
    },
    node: {
      expected: ['package.json'],
      label: 'package.json',
      langLabel: 'Node.js',
    },
    java: {
      expected: ['.java'],
      label: '.java source files',
      langLabel: 'Java',
      matchExt: true,
    },
  };

  const rule = rules[language];
  if (!rule) return;

  let found = false;
  if (rule.matchExt) {
    found = files.some(f => f.toLowerCase().endsWith(rule.expected[0]));
  } else {
    found = files.some(f => {
      const base = path.basename(f).toLowerCase();
      return rule.expected.includes(base);
    });
  }

  if (found) {
    good.push(`Found ${rule.label}.`);
  } else {
    warnings.push(`No ${rule.label} found.`);
    suggestions.push(`Add ${rule.label} if your project uses ${rule.langLabel} packages.`);
  }
}

// ── Check 4: .env file ─────────────────────────────
function checkEnvFile(files, problems, suggestions) {
  const envFound = files.some(f => path.basename(f).toLowerCase() === '.env');
  if (envFound) {
    problems.push('.env file found. This may expose API keys or passwords.');
    suggestions.push('Remove .env and include .env.example instead.');
  }
}

// ── Check 5: Hardcoded paths ───────────────────────
const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx',
  '.java', '.c', '.cpp', '.h', '.hpp',
  '.html', '.css', '.rb', '.go', '.rs',
  '.sh', '.bat', '.ps1',
]);

const PATH_PATTERNS = [
  /[A-Z]:\\Users\\/gi,
  /[A-Z]:\/Users\//gi,
  /\/Users\/[a-zA-Z]/g,
  /\/home\/[a-zA-Z]/g,
  /OneDrive/g,
  /[\/\\]Desktop[\/\\]/g,
];

function checkHardcodedPaths(zip, entries, normFiles, problems, suggestions) {
  const flaggedFiles = new Set();

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const ext = path.extname(entry.entryName).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    // Read file content (limit to first 500KB to avoid memory issues)
    let content;
    try {
      const buf = entry.getData();
      if (buf.length > 500 * 1024) continue; // skip very large files
      content = buf.toString('utf8');
    } catch {
      continue;
    }

    for (const pattern of PATH_PATTERNS) {
      pattern.lastIndex = 0; // reset regex
      const match = pattern.exec(content);
      if (match) {
        const normName = normFiles.find(f => entry.entryName.endsWith(f)) || entry.entryName;
        if (!flaggedFiles.has(normName)) {
          flaggedFiles.add(normName);
          // Get a short snippet around the match
          const start = Math.max(0, match.index - 10);
          const end   = Math.min(content.length, match.index + match[0].length + 30);
          const snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
          problems.push(`Hardcoded path found in ${normName}: "${snippet}"`);
        }
        break; // one hit per file is enough
      }
    }
  }

  if (flaggedFiles.size > 0) {
    suggestions.push('Use relative paths instead of absolute computer-specific paths.');
  }
}

// ── Check 6: Expected result ───────────────────────
function checkExpectedResult(expectedResult, warnings, suggestions) {
  if (!expectedResult) {
    warnings.push('No expected result provided.');
    suggestions.push('Explain what should happen when the project runs.');
  }
}

/* ═══════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════ */

/**
 * If every file starts with the same single folder prefix, strip it
 * so the listing looks cleaner (e.g. "my-project/main.py" → "main.py").
 */
function normaliseFilePaths(files) {
  if (files.length === 0) return files;

  const firstSlash = files[0].indexOf('/');
  if (firstSlash === -1) return files;

  const prefix = files[0].slice(0, firstSlash + 1);
  const allShare = files.every(f => f.startsWith(prefix));
  if (!allShare) return files;

  return files.map(f => f.slice(prefix.length)).filter(f => f.length > 0);
}

/* ═══════════════════════════════════════════════════
   API ROUTES — Reading from the database
   ═══════════════════════════════════════════════════

   These routes let you READ saved reports.
   The main /api/check route WRITES (INSERT).
   These routes READ (SELECT).

   REST API pattern:
     GET  /api/reports      → list of recent reports
     GET  /api/reports/:id  → one specific report
     GET  /api/stats        → summary statistics

   ═══════════════════════════════════════════════════ */

// Get recent scan history
// Example: GET /api/reports?limit=10
app.get('/api/reports', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const reports = db.getRecent(limit);
  res.json(reports);
});

// Get one report by ID
// Example: GET /api/reports/3
app.get('/api/reports/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid report ID.' });

  const report = db.getById(id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });

  res.json(report);
});

// Get dashboard stats
// Example: GET /api/stats
app.get('/api/stats', (req, res) => {
  const stats = db.getStats();
  res.json(stats);
});

/* ═══════════════════════════════════════════════════
   START SERVER
   ═══════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n  🖥️  Fresh Computer Test running at http://localhost:${PORT}\n`);
});
