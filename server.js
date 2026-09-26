/* ═══════════════════════════════════════════════════
   Fresh Computer Test — Backend (with Auth)
   ═══════════════════════════════════════════════════ */

const express = require('express');
const multer  = require('multer');
const AdmZip  = require('adm-zip');
const path    = require('path');
const fs      = require('fs');
const bcrypt  = require('bcrypt');
const session = require('express-session');
const { exec, spawn, execSync } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// Import database (db = raw SQLite instance, rest are helper functions)
const {
  db: sqliteDb,
  createUser, getUserByUsername, getUserById,
  saveReport, getRecent, getById, deleteReport, getStats,
  updateExecutionResults
} = require('./database');

// Session store: saves sessions in SQLite instead of memory
const SqliteStore = require('better-sqlite3-session-store')(session);

const app  = express();
const PORT = process.env.PORT || 3000;

// Parse JSON request bodies (needed for login/register)
app.use(express.json());

/* ═══════════════════════════════════════════════════
   SESSION MIDDLEWARE
   ═══════════════════════════════════════════════════

   A "session" is how the server remembers who you are.

   1. You log in → server creates a session with your userId
   2. Server sends back a cookie (a small token in your browser)
   3. Every future request → browser sends the cookie automatically
   4. Server reads the cookie → knows it's you

   The session data is stored in SQLite (not in memory),
   so it survives server restarts.

   ═══════════════════════════════════════════════════ */

app.use(session({
  store: new SqliteStore({
    client: sqliteDb,
    expired: {
      clear: true,
      intervalMs: 15 * 60 * 1000, // clean up expired sessions every 15 min
    },
  }),
  secret: 'fresh-computer-test-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // Session lasts 1 day
    httpOnly: true,               // JavaScript can't read the cookie (security)
    sameSite: 'lax',
  },
}));

/* ═══════════════════════════════════════════════════
   AUTH MIDDLEWARE
   ═══════════════════════════════════════════════════

   This is a "gatekeeper" function. We put it in front of
   routes that require login. If the user isn't logged in,
   they get a 401 (Unauthorized) error instead of data.

   ═══════════════════════════════════════════════════ */

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  next(); // User is logged in, continue to the actual route
}

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
  limits: { fileSize: 1024 * 1024 * 1024 },
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

/* ═══════════════════════════════════════════════════
   AUTH ROUTES
   ═══════════════════════════════════════════════════

   POST /api/register  → create account
   POST /api/login     → start session
   POST /api/logout    → destroy session
   GET  /api/me        → who am I?

   ═══════════════════════════════════════════════════ */

// ── Register ────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate inputs
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }

    // Hash the password
    // bcrypt.hash(password, 10) → the 10 is "salt rounds"
    // More rounds = slower but more secure. 10 is standard.
    const passwordHash = await bcrypt.hash(password, 10);

    // Save to database
    const userId = createUser(username.trim(), passwordHash);

    // Automatically log them in after registering
    req.session.userId = userId;

    res.json({ message: 'Account created!', user: { id: userId, username: username.trim() } });
  } catch (err) {
    // UNIQUE constraint violation = username already taken
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Username already taken.' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── Login ───────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    // Find the user in the database
    const user = getUserByUsername(username.trim());
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Compare the provided password with the stored hash
    // bcrypt.compare does: hash(password) === stored_hash
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Start a session (save userId in the session)
    req.session.userId = user.id;

    res.json({ message: 'Logged in!', user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── Logout ──────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out.' });
  });
});

// ── Who am I? ───────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }

  const user = getUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found.' });
  }

  res.json({ id: user.id, username: user.username });
});

/* ═══════════════════════════════════════════════════
   CHECK ENDPOINT (now requires login)
   ═══════════════════════════════════════════════════ */

app.post('/api/check', requireLogin, (req, res) => {
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

async function handleCheck(req, res) {
  const zipPath = req.file?.path;

  if (!zipPath) {
    return res.status(400).json({ error: 'No ZIP file uploaded.' });
  }

  try {
    const projectName    = (req.body.projectName || req.file.originalname).trim();
    const language       = (req.body.language || '').toLowerCase();
    const runCmd         = (req.body.runCmd || '').trim();
    const expectedResult = (req.body.expectedResult || '').trim();

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    const files = entries
      .filter(e => !e.isDirectory)
      .map(e => e.entryName);

    const normFiles = normaliseFilePaths(files);

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

    let status;
    if (problems.length > 0) {
      status = 'Needs Attention';
    } else if (warnings.length > 0) {
      status = 'Mostly Okay';
    } else {
      status = 'Passed';
    }

    // Extract file contents for code viewer (max 100KB per file)
    const fileContents = {};
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const ext = path.extname(entry.entryName).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      try {
        const buf = entry.getData();
        if (buf.length <= 100 * 1024) {
          const normName = entry.entryName.replace(/\\/g, '/');
          fileContents[normName] = buf.toString('utf8');
        }
      } catch (e) {}
    }

    const setupCmd = (req.body.setupCmd || '').trim();

    // Save to database — linked to the logged-in user
    const reportId = saveReport(req.session.userId, {
      projectName,
      language,
      setupCmd,
      runCmd,
      expectedResult,
      status,
      good,
      problems,
      warnings,
      suggestions,
      files: normFiles,
      executionStatus: 'Pending',
      executionOutput: '',
      fileContents
    });

    // Rename the zip file so the stream endpoint can find it
    const newZipPath = path.join(UPLOAD_DIR, `report-${reportId}.zip`);
    fs.renameSync(zipPath, newZipPath);

    res.json({ id: reportId, status: 'Pending' });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: 'Failed to analyse the ZIP file.' });
    if (zipPath && fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
  }
}

/* ═══════════════════════════════════════════════════
   CHECKS (same as before)
   ═══════════════════════════════════════════════════ */

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

function extractTargetFile(cmd) {
  const parts = cmd.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const runner = parts[0].toLowerCase();
  const args = parts.slice(1).filter(p => !p.startsWith('-'));
  if (args.length === 0) return null;

  let file = args[0];
  if (runner === 'java' && !path.extname(file)) {
    file += '.java';
  }
  return file;
}

function checkDependencies(language, files, good, warnings, suggestions) {
  const rules = {
    python: { expected: ['requirements.txt', 'pipfile', 'pyproject.toml'], label: 'requirements.txt (or Pipfile)', langLabel: 'Python' },
    node:   { expected: ['package.json'], label: 'package.json', langLabel: 'Node.js' },
    java:   { expected: ['.java'], label: '.java source files', langLabel: 'Java', matchExt: true },
  };

  const rule = rules[language];
  if (!rule) return;

  let found = false;
  if (rule.matchExt) {
    found = files.some(f => f.toLowerCase().endsWith(rule.expected[0]));
  } else {
    found = files.some(f => rule.expected.includes(path.basename(f).toLowerCase()));
  }

  if (found) {
    good.push(`Found ${rule.label}.`);
  } else {
    warnings.push(`No ${rule.label} found.`);
    suggestions.push(`Add ${rule.label} if your project uses ${rule.langLabel} packages.`);
  }
}

function checkEnvFile(files, problems, suggestions) {
  if (files.some(f => path.basename(f).toLowerCase() === '.env')) {
    problems.push('.env file found. This may expose API keys or passwords.');
    suggestions.push('Remove .env and include .env.example instead.');
  }
}

const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp', '.h', '.hpp',
  '.html', '.css', '.rb', '.go', '.rs', '.sh', '.bat', '.ps1',
]);

const PATH_PATTERNS = [
  /[A-Z]:\\Users\\/gi, /[A-Z]:\/Users\//gi,
  /\/Users\/[a-zA-Z]/g, /\/home\/[a-zA-Z]/g,
  /OneDrive/g, /[\/\\]Desktop[\/\\]/g,
];

function checkHardcodedPaths(zip, entries, normFiles, problems, suggestions) {
  const flaggedFiles = new Set();

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const ext = path.extname(entry.entryName).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    let content;
    try {
      const buf = entry.getData();
      if (buf.length > 500 * 1024) continue;
      content = buf.toString('utf8');
    } catch { continue; }

    for (const pattern of PATH_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(content);
      if (match) {
        const normName = normFiles.find(f => entry.entryName.endsWith(f)) || entry.entryName;
        if (!flaggedFiles.has(normName)) {
          flaggedFiles.add(normName);
          const start = Math.max(0, match.index - 10);
          const end   = Math.min(content.length, match.index + match[0].length + 30);
          const snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
          problems.push(`Hardcoded path found in ${normName}: "${snippet}"`);
        }
        break;
      }
    }
  }

  if (flaggedFiles.size > 0) {
    suggestions.push('Use relative paths instead of absolute computer-specific paths.');
  }
}

function checkExpectedResult(expectedResult, warnings, suggestions) {
  if (!expectedResult) {
    warnings.push('No expected result provided.');
    suggestions.push('Explain what should happen when the project runs.');
  }
}

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
   REPORT ROUTES (now require login + filter by user)
   ═══════════════════════════════════════════════════ */

app.get('/api/reports', requireLogin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const reports = getRecent(req.session.userId, limit);
  res.json(reports);
});

app.get('/api/reports/:id', requireLogin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid report ID.' });

  const report = getById(id, req.session.userId);
  if (!report) return res.status(404).json({ error: 'Report not found.' });

  res.json(report);
});

app.delete('/api/reports/:id', requireLogin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid report ID.' });

  const success = deleteReport(id, req.session.userId);
  if (!success) return res.status(404).json({ error: 'Report not found or not authorized.' });

  res.json({ message: 'Report deleted successfully.' });
});

app.get('/api/stats', requireLogin, (req, res) => {
  const stats = getStats(req.session.userId);
  res.json(stats);
});

app.get('/api/stream/:id', requireLogin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).send('Invalid ID');

  const report = getById(id, req.session.userId);
  if (!report) return res.status(404).send('Not found');
  if (report.executionStatus !== 'Pending') {
    return res.status(400).send('Execution already finished');
  }

  // Setup SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const zipPath = path.join(UPLOAD_DIR, `report-${id}.zip`);
  if (!fs.existsSync(zipPath)) {
    sendEvent('error', 'ZIP file not found.');
    sendEvent('done', { status: 'Failed', output: 'ZIP file missing.' });
    updateExecutionResults(id, 'Failed', 'ZIP file missing.');
    return res.end();
  }

  const tempDirName = `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const tempDirPath = path.join(UPLOAD_DIR, tempDirName);

  let fullOutput = '';
  let finalStatus = 'Passed';

  try {
    sendEvent('status', 'Extracting files...');
    fs.mkdirSync(tempDirPath);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tempDirPath, true);

    const imageMap = { node: 'node:20', python: 'python:3.11', java: 'openjdk:17' };
    const dockerImage = imageMap[report.language] || 'ubuntu:latest';

    let containerCmd = report.runCmd;
    if (report.setupCmd) {
      containerCmd = `${report.setupCmd} && ${report.runCmd}`;
    }

    sendEvent('status', 'Running in Docker...');
    const containerName = `fresh-comp-${id}`;
    const dockerArgs = [
      'run', '--rm', '--name', containerName, '-v', `${tempDirPath}:/app`, '-w', '/app',
      dockerImage, 'sh', '-c', containerCmd
    ];

    const child = spawn('docker', dockerArgs);
    let isPulling = false;
    let killed = false;

    // Timeout logic
    const timeoutTimer = setTimeout(() => {
      killed = true;
      child.kill();
      try {
        execSync(`docker rm -f ${containerName}`, { stdio: 'ignore' });
      } catch (e) {
        // Ignore if already gone
      }
      
      const lowerOutput = fullOutput.toLowerCase();
      const hasError = lowerOutput.includes('traceback') || 
                       lowerOutput.includes('error:') || 
                       lowerOutput.includes('exception:') ||
                       lowerOutput.includes('npm err!');
                       
      if (!hasError && fullOutput.trim().length > 0) {
        const msg = '\n\n[SUCCESS] Execution timed out (Likely infinite loop / GUI app).';
        sendEvent('stderr', msg);
        fullOutput += msg;
        finalStatus = 'Passed (Infinite Loop / GUI)';
      } else {
        const msg = '\n\n[ERROR] Execution timed out after 120 seconds.';
        sendEvent('stderr', msg);
        fullOutput += msg;
        finalStatus = 'Failed';
      }
    }, 120000);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      fullOutput += text;
      sendEvent('stdout', text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      if (text.includes('Pulling from library')) {
        if (!isPulling) {
          isPulling = true;
          sendEvent('status', `Downloading ${dockerImage} image...`);
        }
      } else if (isPulling && text.includes('Downloaded newer image')) {
        isPulling = false;
        sendEvent('status', 'Running in Docker...');
      }
      
      fullOutput += text;
      sendEvent('stderr', text);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (code !== 0 && !killed) {
        finalStatus = 'Failed';
      }
      const finalOutput = fullOutput.trim() || '[No output]';
      updateExecutionResults(id, finalStatus, finalOutput);
      sendEvent('done', { status: finalStatus, output: finalOutput });
      res.end();

      // Cleanup
      try {
        if (fs.existsSync(tempDirPath)) fs.rmSync(tempDirPath, { recursive: true, force: true });
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch(e){}
    });

  } catch (err) {
    console.error("Execution error:", err);
    finalStatus = 'Failed';
    const errorMsg = `\nSystem Error: ${err.message}`;
    fullOutput += errorMsg;
    sendEvent('stderr', errorMsg);
    updateExecutionResults(id, finalStatus, fullOutput.trim());
    sendEvent('done', { status: finalStatus, output: fullOutput.trim() });
    res.end();
    
    // Cleanup
    try {
      if (fs.existsSync(tempDirPath)) fs.rmSync(tempDirPath, { recursive: true, force: true });
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch(e){}
  }
});

/* ═══════════════════════════════════════════════════
   START SERVER
   ═══════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n  🖥️  Fresh Computer Test running at http://localhost:${PORT}\n`);
});
