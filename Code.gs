/**
 * Smart2Deploy — Lead Enrichment Automation
 * ------------------------------------------------------------
 * Flow:  Google Form submit  →  enrich (domain + industry)  →  log to Sheet  →  notify (Slack / email)
 *
 * This is a container-bound Apps Script: attach it to the Google Sheet that
 * collects your Form responses (Form → Responses → link to Sheets, then
 * Extensions → Apps Script from that Sheet).
 *
 * Enrichment uses only FREE, key-less sources:
 *   1) Clearbit autocomplete  (https://autocomplete.clearbit.com)  → company domain + logo
 *   2) A light homepage scrape of that domain                       → inferred industry + description
 */

// ============================ CONFIG ============================
const CONFIG = {
  // Tab the enriched rows are written to (created automatically if missing)
  OUTPUT_SHEET: 'Enriched Leads',

  // Email to notify. Leave '' to skip email.
  NOTIFY_EMAIL: 'shashank.jamwal24@gmail.com',

  // Slack Incoming Webhook URL. Leave '' to skip Slack.
  // Create one at https://api.slack.com/messaging/webhooks
  SLACK_WEBHOOK_URL: '',
};

// Map your Form's question titles to internal fields.
// Add any alternate spellings you used in your Form.
const FIELD_MAP = {
  name:    ['Name', 'Full Name', 'Your name'],
  email:   ['Email', 'Email Address', 'Your email', 'Work email'],
  company: ['Company', 'Company Name', 'Organization', 'Organisation'],
};

// Generic mailbox providers we should NOT treat as a company domain.
const GENERIC_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'icloud.com', 'protonmail.com', 'aol.com', 'live.com',
];

// ====================== MAIN TRIGGER HANDLER ======================
/**
 * Runs on every Form submission.
 * Install via setup() once, or Triggers → Add Trigger → onFormSubmit → "On form submit".
 */
function onFormSubmit(e) {
  const v = (e && e.namedValues) ? e.namedValues : {};
  const lead = {
    timestamp: new Date(),
    name:    getField(v, FIELD_MAP.name),
    email:   getField(v, FIELD_MAP.email),
    company: getField(v, FIELD_MAP.company),
  };

  const enriched = enrichLead(lead.company, lead.email);
  const row = logToSheet(lead, enriched);
  const summary = buildSummary(lead, enriched);

  notifySlack(summary);
  notifyEmail(summary);

  Logger.log('Processed lead: ' + lead.email + '  →  ' + enriched.industry);
  return row;
}

// ========================= ENRICHMENT =========================
/**
 * Returns { domain, industry, description, logo, source } using free sources only.
 */
function enrichLead(company, email) {
  const out = { domain: '', industry: '', description: '', logo: '', source: '' };
  let domain = '';

  // 1) Look the company up by name (free, key-less) to get its real domain + logo.
  if (company) {
    try {
      const url = 'https://autocomplete.clearbit.com/v1/companies/suggest?query=' +
                  encodeURIComponent(company);
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        const arr = JSON.parse(res.getContentText() || '[]');
        if (arr.length) {
          domain    = arr[0].domain || '';
          out.logo  = arr[0].logo || '';
          out.source = 'clearbit-autocomplete';
        }
      }
    } catch (err) { Logger.log('autocomplete failed: ' + err); }
  }

  // 2) Fall back to the email's domain (skip Gmail/Yahoo/etc).
  if (!domain && email && email.indexOf('@') > -1) {
    const d = email.split('@')[1].toLowerCase().trim();
    if (GENERIC_DOMAINS.indexOf(d) === -1) {
      domain = d;
      out.source = out.source || 'email-domain';
    }
  }
  out.domain = domain;

  // 3) Scrape the homepage for an industry signal + a one-line description.
  if (domain) {
    try {
      const page = UrlFetchApp.fetch('https://' + domain, {
        muteHttpExceptions: true, followRedirects: true,
      });
      if (page.getResponseCode() < 400) {
        const html = page.getContentText();
        out.description = extractMeta(html);
        out.industry = inferIndustry((out.description + ' ' + extractTitle(html)).toLowerCase());
      }
    } catch (err) { Logger.log('scrape failed: ' + err); }
  }

  if (!out.industry) out.industry = 'Unknown';
  return out;
}

/** Keyword → industry inference from the scraped text. */
function inferIndustry(text) {
  // Specific verticals are checked BEFORE the generic "software" bucket,
  // because words like "platform/app/cloud" appear on almost every site.
  const rules = [
    ['Finance / Fintech',      ['bank', 'finance', 'financial', 'fintech', 'payment', 'invoice', 'lending', 'insurance']],
    ['E-commerce / Retail',    ['shop', 'store', 'ecommerce', 'e-commerce', 'commerce', 'retail', 'cart', 'checkout']],
    ['Healthcare',             ['health', 'medical', 'clinic', 'patient', 'pharma', 'hospital']],
    ['Education',              ['education', 'learning', 'course', 'student', 'school', 'university', 'edtech']],
    ['Real Estate',            ['real estate', 'property', 'realty', 'mortgage']],
    ['Manufacturing',          ['manufactur', 'factory', 'industrial', 'machinery', 'supply chain']],
    ['Marketing / Agency',     ['marketing', 'agency', 'brand', 'advertis', 'seo', 'campaign']],
    ['Media / Content',        ['media', 'news', 'publish', 'streaming']],
    ['SaaS / Software',        ['software', 'saas', 'platform', 'api', 'developer', 'cloud', 'app']],
    ['Consulting / Services',  ['consult', 'advisory', 'solutions']],
  ];
  for (const [industry, kws] of rules) {
    if (kws.some(k => text.indexOf(k) > -1)) return industry;
  }
  return '';
}

function extractMeta(html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].trim().slice(0, 200) : '';
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

// ========================= SHEET LOG =========================
function logToSheet(lead, enriched) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.OUTPUT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.OUTPUT_SHEET);
    sh.appendRow([
      'Timestamp', 'Name', 'Email', 'Company',
      'Domain', 'Industry (enriched)', 'Description (enriched)', 'Logo', 'Source',
    ]);
    sh.getRange('A1:I1').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const row = [
    lead.timestamp, lead.name, lead.email, lead.company,
    enriched.domain, enriched.industry, enriched.description, enriched.logo, enriched.source,
  ];
  sh.appendRow(row);
  return row;
}

// ========================= NOTIFICATIONS =========================
function buildSummary(lead, enriched) {
  return {
    title: 'New enriched lead: ' + (lead.company || lead.name || lead.email),
    lines: [
      'Name:     ' + (lead.name || '—'),
      'Email:    ' + (lead.email || '—'),
      'Company:  ' + (lead.company || '—'),
      'Domain:   ' + (enriched.domain || '—'),
      'Industry: ' + enriched.industry + '   (enriched)',
      enriched.description ? 'About:    ' + enriched.description : '',
      'Source:   ' + (enriched.source || '—'),
    ].filter(Boolean),
  };
}

function notifySlack(summary) {
  if (!CONFIG.SLACK_WEBHOOK_URL) return;
  const payload = {
    text: '*' + summary.title + '*\n```' + summary.lines.join('\n') + '```',
  };
  try {
    UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (err) { Logger.log('Slack notify failed: ' + err); }
}

function notifyEmail(summary) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  try {
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_EMAIL,
      subject: summary.title,
      body: summary.lines.join('\n'),
    });
  } catch (err) { Logger.log('Email notify failed: ' + err); }
}

// ========================= HELPERS / SETUP =========================
function getField(namedValues, keys) {
  for (const k of keys) {
    if (namedValues[k] && namedValues[k][0]) return String(namedValues[k][0]).trim();
  }
  return '';
}

/** Run ONCE to install the form-submit trigger programmatically. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // remove old copies so we don't double-fire
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onFormSubmit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  Logger.log('✅ onFormSubmit trigger installed.');
}

/** Run to test the whole pipeline WITHOUT submitting the form. */
function testRun() {
  onFormSubmit({
    namedValues: {
      Name:    ['Rishav Jamwal'],
      Email:   ['contact@stripe.com'],
      Company: ['Stripe'],
    },
  });
}
