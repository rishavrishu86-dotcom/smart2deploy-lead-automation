# Smart2Deploy — Lead Enrichment Automation

When a new entry hits a **Google Form**, this workflow automatically:

1. **Enriches** the lead with extra data points — the company's **domain** (via Clearbit's free key-less autocomplete) and an inferred **industry + description** (via a light homepage scrape).
2. **Logs** the enriched record to a **Google Sheet** (`Enriched Leads` tab).
3. **Notifies** via **Slack and/or email** with a clean one-glance summary.

Built with **Google Apps Script** — 100% free, no paid tools, no API keys.

```
Google Form  ──submit──▶  Apps Script trigger
                              │
                   ┌──────────┴───────────┐
                   ▼                      ▼
            Enrich (domain,         (Clearbit autocomplete
            industry, about)         + homepage scrape)
                   │
       ┌───────────┼─────────────┐
       ▼                         ▼
  Google Sheet              Slack / Email
 (Enriched Leads)            notification
```

---

## Setup (about 5 minutes)

1. **Create a Google Form** with at least these questions: **Name**, **Email**, **Company**.
2. In the Form: **Responses → Link to Sheets** → create a new spreadsheet.
3. Open that **Sheet → Extensions → Apps Script**.
4. Delete the placeholder code, paste in **`Code.gs`**, and **Save**.
5. Edit the `CONFIG` block at the top:
   - `NOTIFY_EMAIL` — your email (already set).
   - `SLACK_WEBHOOK_URL` — optional; create one at <https://api.slack.com/messaging/webhooks>. Leave `''` to use email only.
6. Run the **`setup`** function once (top toolbar → select `setup` → Run). Approve the permission prompt — this installs the on-form-submit trigger.
7. **Test without the form:** run **`testRun`** — it pushes a sample "Stripe" lead through the whole pipeline so you can confirm the Sheet row + notification appear.
8. Submit the real Form once to see it fire end to end.

> If your Form uses different question wording, add it to `FIELD_MAP` at the top of `Code.gs`.

---

## ROI note

**What it replaces (manual today):** for every lead, someone copies the entry into a tracker, Googles the company, finds the domain/industry, types it back in, then pings the team. Realistically **3–5 minutes per lead**, and it only happens when somebody remembers.

**With the automation:** **~0 seconds of human effort** — it runs the instant the form is submitted, 24/7, with no missed or stale entries.

| | Manual | Automated |
|---|---|---|
| Time per lead | 3–5 min | ~0 (instant) |
| 50 leads/week | ~3.5 hrs/week | 0 |
| Annual | **~180 hrs/year** | 0 |
| Consistency | misses & delays | every lead, immediately |

**Where it saves the most:** at the **top of the funnel** for sales/ops teams handling steady inbound volume. Beyond the raw hours, the bigger win is **speed-to-lead** — the team gets an enriched summary the moment a prospect raises their hand, instead of hours later, which is when follow-ups actually convert.

---

## 2–3 minute demo recording — walkthrough script

1. **Show the Google Form** (10s) — "Here's the lead capture form: Name, Email, Company."
2. **Show `Code.gs`** (40s) — point out the three stages: `enrichLead()` (free Clearbit lookup + homepage scrape), `logToSheet()`, and `notifySlack()/notifyEmail()`. Mention the choice: Apps Script because it's free, key-less, and native to Forms/Sheets.
3. **Submit a real entry** (20s) — fill the form with a real company (e.g. "Stripe", email `someone@stripe.com`) and submit.
4. **Show the Sheet** (30s) — the new row appears with Domain + Industry + Description filled in automatically.
5. **Show the notification** (20s) — the Slack message / email summary lands.
6. **Close with the ROI** (20s) — "This replaces ~3–5 min of manual lookup per lead, ~180 hrs/year at 50 leads/week, and gives instant speed-to-lead."

---

## Files
- `Code.gs` — the full automation (paste into Apps Script).
- `README.md` — this file (setup + ROI + demo script).
