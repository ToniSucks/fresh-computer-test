/**
 * Creates 4 test ZIP files to verify the checker.
 * Run: node create-test-zips.js
 */
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'test-zips');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

// ── 1. Good project (should PASS) ──────────────────
(() => {
  const zip = new AdmZip();
  zip.addFile('good-project/main.py', Buffer.from('print("Hello World")\n'));
  zip.addFile('good-project/README.md', Buffer.from('# My Project\n\nRun: python main.py\n'));
  zip.addFile('good-project/requirements.txt', Buffer.from('requests==2.31.0\n'));
  zip.writeZip(path.join(OUT, 'good-project.zip'));
  console.log('✅ good-project.zip');
})();

// ── 2. Missing README (should be MOSTLY OKAY) ──────
(() => {
  const zip = new AdmZip();
  zip.addFile('no-readme/main.py', Buffer.from('print("Hello")\n'));
  zip.addFile('no-readme/requirements.txt', Buffer.from('flask==3.0\n'));
  zip.writeZip(path.join(OUT, 'missing-readme.zip'));
  console.log('✅ missing-readme.zip');
})();

// ── 3. Wrong run command (should NEED ATTENTION) ────
(() => {
  const zip = new AdmZip();
  zip.addFile('wrong-cmd/main.py', Buffer.from('print("Hello")\n'));
  zip.addFile('wrong-cmd/README.md', Buffer.from('# Project\n'));
  zip.addFile('wrong-cmd/requirements.txt', Buffer.from('numpy==1.26\n'));
  zip.writeZip(path.join(OUT, 'wrong-run-cmd.zip'));
  console.log('✅ wrong-run-cmd.zip (run: python app.py → app.py missing)');
})();

// ── 4. Unsafe project with .env (should NEED ATTENTION) ──
(() => {
  const zip = new AdmZip();
  zip.addFile('unsafe/main.py', Buffer.from('import os\napi_key = os.getenv("KEY")\n'));
  zip.addFile('unsafe/README.md', Buffer.from('# Unsafe\n'));
  zip.addFile('unsafe/.env', Buffer.from('API_KEY=sk-secret-12345\n'));
  zip.addFile('unsafe/requirements.txt', Buffer.from('openai==1.0\n'));
  zip.writeZip(path.join(OUT, 'unsafe-project.zip'));
  console.log('✅ unsafe-project.zip');
})();

// ── 5. Hardcoded paths project (should NEED ATTENTION) ──
(() => {
  const zip = new AdmZip();
  zip.addFile('hardcoded/main.py', Buffer.from(
    'import pandas as pd\n' +
    'data = pd.read_csv("C:\\\\Users\\\\Tony\\\\Desktop\\\\project\\\\data.csv")\n' +
    'print(data.head())\n'
  ));
  zip.addFile('hardcoded/README.md', Buffer.from('# Hardcoded Path Project\n'));
  zip.addFile('hardcoded/requirements.txt', Buffer.from('pandas==2.1\n'));
  zip.writeZip(path.join(OUT, 'hardcoded-paths.zip'));
  console.log('✅ hardcoded-paths.zip');
})();

console.log('\nAll test ZIPs created in:', OUT);
