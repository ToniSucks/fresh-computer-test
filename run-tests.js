/**
 * Automated test: Sends all test ZIPs to the server and verifies reports.
 * Run: node run-tests.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const TESTS = [
  {
    name: 'Good Project',
    zip: 'good-project.zip',
    fields: { language: 'python', setupCmd: 'pip install -r requirements.txt', runCmd: 'python main.py', expectedResult: 'prints Hello World' },
    expectedStatus: 'Passed',
  },
  {
    name: 'Missing README',
    zip: 'missing-readme.zip',
    fields: { language: 'python', runCmd: 'python main.py', expectedResult: 'prints hello' },
    expectedStatus: 'Mostly Okay',
  },
  {
    name: 'Wrong Run Command',
    zip: 'wrong-run-cmd.zip',
    fields: { language: 'python', runCmd: 'python app.py', expectedResult: 'runs' },
    expectedStatus: 'Needs Attention',
  },
  {
    name: 'Unsafe Project (.env)',
    zip: 'unsafe-project.zip',
    fields: { language: 'python', runCmd: 'python main.py', expectedResult: 'runs' },
    expectedStatus: 'Needs Attention',
  },
  {
    name: 'Hardcoded Paths',
    zip: 'hardcoded-paths.zip',
    fields: { language: 'python', runCmd: 'python main.py', expectedResult: 'shows data' },
    expectedStatus: 'Needs Attention',
  },
];

async function sendTest(test) {
  const zipPath = path.join(__dirname, 'test-zips', test.zip);
  const zipData = fs.readFileSync(zipPath);
  const boundary = '----TestBoundary' + Date.now();

  let body = '';
  // Add fields
  for (const [key, val] of Object.entries(test.fields)) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    body += `${val}\r\n`;
  }

  // Add file
  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="zip"; filename="${test.zip}"\r\nContent-Type: application/zip\r\n\r\n`;
  const fileFooter = `\r\n--${boundary}--\r\n`;

  const headerBuf = Buffer.from(body + fileHeader, 'utf8');
  const footerBuf = Buffer.from(fileFooter, 'utf8');
  const fullBody = Buffer.concat([headerBuf, zipData, footerBuf]);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/check',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON: ' + data));
        }
      });
    });
    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Fresh Computer Test — Automated Tests');
  console.log('═══════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  for (const test of TESTS) {
    try {
      const report = await sendTest(test);

      const statusOk = report.status === test.expectedStatus;
      const icon = statusOk ? '✅' : '❌';

      console.log(`${icon} ${test.name}`);
      console.log(`   Status: ${report.status} (expected: ${test.expectedStatus})`);
      console.log(`   Good: ${report.good.join('; ')}`);
      if (report.problems.length) console.log(`   Problems: ${report.problems.join('; ')}`);
      if (report.warnings.length) console.log(`   Warnings: ${report.warnings.join('; ')}`);
      if (report.suggestions.length) console.log(`   Suggestions: ${report.suggestions.join('; ')}`);
      console.log(`   Files: ${report.files.join(', ')}`);
      console.log();

      if (statusOk) passed++; else failed++;
    } catch (err) {
      console.log(`❌ ${test.name} — ERROR: ${err.message}\n`);
      failed++;
    }
  }

  console.log('═══════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

main();
