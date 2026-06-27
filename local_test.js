/**
 * Local test harness for Code.gs
 * ------------------------------------------------------------
 * Apps Script runs inside Google, but the logic is plain JS. This harness
 * stubs the Google services (UrlFetchApp / SpreadsheetApp / MailApp / Logger /
 * ScriptApp) so we can run the FULL pipeline locally on Node.
 *
 *   - UrlFetchApp.fetch  → real network calls via `curl` (keeps the synchronous
 *                          semantics Apps Script uses), so the Clearbit lookup
 *                          and homepage scrape actually execute.
 *   - SpreadsheetApp     → captures the rows that would be written.
 *   - MailApp            → captures the email that would be sent.
 *
 * Run:  node local_test.js
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------- capture buffer ----------------
const CAP = { rows: [], email: null, sheetCreated: false };

// ---------------- Google service stubs ----------------
global.Logger = { log: (m) => console.log('   · log:', m) };

function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

global.UrlFetchApp = {
  fetch(url, opts = {}) {
    let cmd = 'curl -s -L -A "Mozilla/5.0 (Macintosh)" --max-time 25 -w "\\n__HTTP__%{http_code}" ';
    if (opts.method && String(opts.method).toLowerCase() === 'post') {
      cmd += '-X POST ';
      if (opts.contentType) cmd += '-H ' + shq('Content-Type: ' + opts.contentType) + ' ';
      if (opts.payload) cmd += '--data ' + shq(opts.payload) + ' ';
    }
    cmd += shq(url);
    let out = '';
    try { out = execSync(cmd, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); }
    catch (e) { out = (e.stdout || '').toString(); }
    const i = out.lastIndexOf('__HTTP__');
    let body = out, code = 0;
    if (i > -1) { body = out.slice(0, i); code = parseInt(out.slice(i + 8), 10) || 0; }
    return { getResponseCode: () => code, getContentText: () => body };
  },
};

const sheetObj = {
  appendRow: (r) => CAP.rows.push(r),
  getRange: () => ({ setFontWeight: () => {} }),
  setFrozenRows: () => {},
};
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getSheetByName: () => (CAP.sheetCreated ? sheetObj : null),
    insertSheet: (n) => { CAP.sheetCreated = true; return sheetObj; },
  }),
};

global.MailApp = { sendEmail: (o) => { CAP.email = o; } };
global.ScriptApp = {
  getProjectTriggers: () => [],
  newTrigger: () => ({ forSpreadsheet: () => ({ onFormSubmit: () => ({ create: () => {} }) }) }),
  deleteTrigger: () => {},
};

// ---------------- load Code.gs + drive it in one eval scope ----------------
const code = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');

const cases = [
  { label: 'Company match (Stripe)', namedValues: { Name: ['Rishav Jamwal'], Email: ['contact@stripe.com'], Company: ['Stripe'] } },
  { label: 'No company, work email (Shopify)', namedValues: { Name: ['A Lead'], Email: ['hello@shopify.com'], Company: [''] } },
  { label: 'Generic Gmail only', namedValues: { Name: ['Casual Visitor'], Email: ['someone@gmail.com'], Company: [''] } },
  { label: 'Scrape-blocked site (edena)', namedValues: { Name: ['shashank'], Email: ['shashank.jamwal24@gmail.com'], Company: ['edena'] } },
];

const driver = `
(function () {
  var __cases = ${JSON.stringify(cases)};
  for (var c of __cases) {
    console.log('\\n=== CASE: ' + c.label + ' ===');
    onFormSubmit({ namedValues: c.namedValues });
  }
})();
`;

eval(code + '\n' + driver);

// ---------------- report ----------------
console.log('\n========================================');
console.log('RESULTS');
console.log('========================================');
console.log('Header written:', CAP.rows[0]);
CAP.rows.slice(1).forEach((r, i) => {
  console.log('\nRow ' + (i + 1) + ':');
  console.log('  Name:        ' + r[1]);
  console.log('  Email:       ' + r[2]);
  console.log('  Company:     ' + r[3]);
  console.log('  Domain:      ' + r[4]   + '   <-- enriched');
  console.log('  Industry:    ' + r[5]   + '   <-- enriched');
  console.log('  Description: ' + (r[6] || '').slice(0, 90));
  console.log('  Source:      ' + r[8]);
});
console.log('\nLast email notification that would be sent:');
console.log('  to:      ' + (CAP.email && CAP.email.to));
console.log('  subject: ' + (CAP.email && CAP.email.subject));

// basic assertions
let ok = true;
function assert(cond, msg) { if (!cond) { ok = false; console.log('  ❌ ' + msg); } else { console.log('  ✅ ' + msg); } }
console.log('\nChecks:');
assert(CAP.rows.length === cases.length + 1, 'one sheet row per submission (+ header)');
assert(CAP.rows[1][4] === 'stripe.com', 'Stripe enriched to domain stripe.com');
assert(CAP.rows[1][5] === 'Finance / Fintech', 'Stripe inferred as Finance / Fintech');
assert(CAP.rows[2][4] === 'shopify.com', 'Shopify resolved from work email domain');
assert(CAP.rows[2][5] === 'E-commerce / Retail', 'Shopify inferred as E-commerce / Retail');
assert(CAP.rows[3][4] === '', 'Gmail-only lead left without a company domain (correct)');
assert(CAP.rows[4][5] === 'Automotive', 'edena/edenauto inferred as Automotive even though the site blocks scraping');
assert(!!CAP.email, 'an email notification was produced');
console.log('\n' + (ok ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'));
process.exit(ok ? 0 : 1);
