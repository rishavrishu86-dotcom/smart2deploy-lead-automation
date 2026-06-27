/**
 * Smart2Deploy - Lead Enrichment Automation
 * Flow: Google Form submit -> enrich (domain + industry) -> log to Sheet -> notify (Slack / email)
 * Enrichment uses only FREE, key-less sources:
 *   1) Clearbit autocomplete -> company domain + logo
 *   2) A light homepage scrape of that domain -> inferred industry + description
 */

// ============================ CONFIG ============================
var CONFIG = {
  OUTPUT_SHEET: 'Enriched Leads',                 // tab name (auto-created)
  NOTIFY_EMAIL: 'shashank.jamwal24@gmail.com',    // '' to skip email
  SLACK_WEBHOOK_URL: ''                           // optional Slack webhook; '' to skip
};

var FIELD_MAP = {
  name:    ['Name', 'Full Name', 'Your name'],
  email:   ['Email', 'Email Address', 'Your email', 'Work email'],
  company: ['Company', 'Company Name', 'Organization', 'Organisation']
};

var GENERIC_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'icloud.com', 'protonmail.com', 'aol.com', 'live.com'
];

// ====================== MAIN TRIGGER HANDLER ======================
function onFormSubmit(e) {
  var v = (e && e.namedValues) ? e.namedValues : {};
  var lead = {
    timestamp: new Date(),
    name:    getField(v, FIELD_MAP.name),
    email:   getField(v, FIELD_MAP.email),
    company: getField(v, FIELD_MAP.company)
  };

  var enriched = enrichLead(lead.company, lead.email);
  var row = logToSheet(lead, enriched);
  var summary = buildSummary(lead, enriched);

  notifySlack(summary);
  notifyEmail(summary);

  Logger.log('Processed lead: ' + lead.email + ' -> ' + enriched.industry);
  return row;
}

// ========================= ENRICHMENT =========================
function enrichLead(company, email) {
  var out = { domain: '', industry: '', description: '', logo: '', source: '' };
  var domain = '';

  if (company) {
    try {
      var url = 'https://autocomplete.clearbit.com/v1/companies/suggest?query=' +
                encodeURIComponent(company);
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        var arr = JSON.parse(res.getContentText() || '[]');
        if (arr.length) {
          domain     = arr[0].domain || '';
          out.logo   = arr[0].logo || '';
          out.source = 'clearbit-autocomplete';
        }
      }
    } catch (err) { Logger.log('autocomplete failed: ' + err); }
  }

  if (!domain && email && email.indexOf('@') > -1) {
    var d = email.split('@')[1].toLowerCase().trim();
    if (GENERIC_DOMAINS.indexOf(d) === -1) {
      domain = d;
      out.source = out.source || 'email-domain';
    }
  }
  out.domain = domain;

  var title = '';
  if (domain) {
    try {
      var page = UrlFetchApp.fetch('https://' + domain, {
        muteHttpExceptions: true, followRedirects: true
      });
      if (page.getResponseCode() < 400) {
        var html = page.getContentText();
        out.description = extractMeta(html);
        title = extractTitle(html);
      }
    } catch (err) { Logger.log('scrape failed: ' + err); }
  }

  // Infer industry from EVERYTHING we know (company name + domain + scraped text),
  // so it still works when a site blocks scraping or renders only via JavaScript.
  var signal = (company + ' ' + domain + ' ' + out.description + ' ' + title).toLowerCase();
  out.industry = inferIndustry(signal);

  if (!out.industry) out.industry = 'Unknown';
  return out;
}

function inferIndustry(text) {
  var rules = [
    ['Finance / Fintech',     ['bank', 'finance', 'financial', 'fintech', 'payment', 'invoice', 'lending', 'insurance']],
    ['E-commerce / Retail',   ['shop', 'store', 'ecommerce', 'e-commerce', 'commerce', 'retail', 'cart', 'checkout']],
    ['Healthcare',            ['health', 'medical', 'clinic', 'patient', 'pharma', 'hospital']],
    ['Education',             ['education', 'learning', 'course', 'student', 'school', 'university', 'edtech']],
    ['Real Estate',           ['real estate', 'property', 'realty', 'mortgage']],
    ['Automotive',            ['automotive', 'dealership', 'dealer', 'vehicle', 'automobile', 'motors', 'voiture', 'edenauto', 'auto']],
    ['Manufacturing',         ['manufactur', 'factory', 'industrial', 'machinery', 'supply chain']],
    ['Marketing / Agency',    ['marketing', 'agency', 'brand', 'advertis', 'seo', 'campaign']],
    ['Media / Content',       ['media', 'news', 'publish', 'streaming']],
    ['SaaS / Software',       ['software', 'saas', 'platform', 'api', 'developer', 'cloud', 'app']],
    ['Consulting / Services', ['consult', 'advisory', 'solutions']]
  ];
  for (var i = 0; i < rules.length; i++) {
    var industry = rules[i][0], kws = rules[i][1];
    for (var j = 0; j < kws.length; j++) {
      if (text.indexOf(kws[j]) > -1) return industry;
    }
  }
  return '';
}

function extractMeta(html) {
  var m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
       || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].trim().slice(0, 200) : '';
}

function extractTitle(html) {
  var m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

// ========================= SHEET LOG =========================
function logToSheet(lead, enriched) {
  var ss = SpreadsheetApp.getActiveSpreadsheet() ||
           SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SS_ID'));
  var sh = ss.getSheetByName(CONFIG.OUTPUT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.OUTPUT_SHEET);
    sh.appendRow([
      'Timestamp', 'Name', 'Email', 'Company',
      'Domain', 'Industry (enriched)', 'Description (enriched)', 'Logo', 'Source'
    ]);
    sh.getRange('A1:I1').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var row = [
    lead.timestamp, lead.name, lead.email, lead.company,
    enriched.domain, enriched.industry, enriched.description, enriched.logo, enriched.source
  ];
  sh.appendRow(row);
  return row;
}

// ========================= NOTIFICATIONS =========================
function buildSummary(lead, enriched) {
  return {
    title: 'New enriched lead: ' + (lead.company || lead.name || lead.email),
    lines: [
      'Name:     ' + (lead.name || '-'),
      'Email:    ' + (lead.email || '-'),
      'Company:  ' + (lead.company || '-'),
      'Domain:   ' + (enriched.domain || '-'),
      'Industry: ' + enriched.industry + '   (enriched)',
      enriched.description ? 'About:    ' + enriched.description : '',
      'Source:   ' + (enriched.source || '-')
    ].filter(function (x) { return x; })
  };
}

function notifySlack(summary) {
  if (!CONFIG.SLACK_WEBHOOK_URL) return;
  var payload = { text: '*' + summary.title + '*\n```' + summary.lines.join('\n') + '```' };
  try {
    UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) { Logger.log('Slack notify failed: ' + err); }
}

function notifyEmail(summary) {
  if (!CONFIG.NOTIFY_EMAIL) return;
  try {
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_EMAIL,
      subject: summary.title,
      body: summary.lines.join('\n')
    });
  } catch (err) { Logger.log('Email notify failed: ' + err); }
}

// ========================= HELPERS / SETUP =========================
function getField(namedValues, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (namedValues[k] && namedValues[k][0]) return String(namedValues[k][0]).trim();
  }
  return '';
}

/**
 * ONE-CLICK SETUP - run this once. Creates Form + Sheet + trigger + a test run.
 */
function bootstrap() {
  var form = FormApp.create('Smart2Deploy - Lead Capture');
  form.setDescription('Lead capture form (auto-enriched on submit).');
  form.addTextItem().setTitle('Name').setRequired(true);
  form.addTextItem().setTitle('Email').setRequired(true);
  form.addTextItem().setTitle('Company').setRequired(false);

  var ss = SpreadsheetApp.create('Smart2Deploy - Leads');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();

  testRun();

  Logger.log('DONE');
  Logger.log('Fill out the form here:  ' + form.getPublishedUrl());
  Logger.log('Edit the form here:      ' + form.getEditUrl());
  Logger.log('Enriched leads sheet:    ' + ss.getUrl());
}

/** Install trigger only (for Sheet-bound projects). */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onFormSubmit') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  Logger.log('onFormSubmit trigger installed.');
}

/** Test the whole pipeline WITHOUT submitting the form. */
function testRun() {
  onFormSubmit({
    namedValues: {
      Name:    ['Rishav Jamwal'],
      Email:   ['contact@stripe.com'],
      Company: ['Stripe']
    }
  });
}
