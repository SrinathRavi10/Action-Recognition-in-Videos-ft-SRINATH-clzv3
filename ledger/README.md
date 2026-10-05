# Paisa Ledger

An offline-first personal finance app: **bank-statement analyser**, **bill & subscription tracker** and **tax helper**
in one installable web app. Everything runs in your browser; there is no server and no network access
(the Content-Security-Policy blocks outside connections).

## Run

```bash
cd ledger
python3 serve.py          # or: npm start      → http://localhost:8080
```

Open it once, then use your browser's **Install app** option. After that it works with no connection at all
(a service worker caches the app; pdf.js is vendored in `vendor/`). Click **Try with demo data** to explore.

## Features

| Area | What it does |
|---|---|
| Import | PDF (incl. password-protected) and CSV statements from any bank. Finds Date / Debit / Credit / Balance columns itself, copes with wrapped and vertically-centred narrations, newest-first statements, and verifies every row against the running balance. Re-importing overlapping statements never double-counts. |
| Categories | ~30 India-centric categories (UPI, SIP, EMI, OTT…). Fix a merchant once and choose "all" – it is remembered for future imports. Undo supported. |
| Dashboard | Income / spent / invested / savings rate, category donut, 12-month stacked trend with income line, top merchants, month-over-month movers, budgets. |
| Bills & subscriptions | Detects recurring payments (OTT, mobile, SIPs, insurance, EMIs, rent, utilities), shows monthly/yearly cost, **price-hike alerts** and **renewal reminders**, lets you mark cancelled / not-a-subscription. |
| Tax helper | Old vs new regime for FY 2025-26 / 2026-27 (slabs, 87A rebate + marginal relief, surcharge, HRA, 80C/80D/80CCD/24b…), break-even deductions, balance payable / refund. Stores Form 16, interest certificates and rent receipts, reads figures from Form 16 PDFs, and suggests figures from your statements. **Estimates only – not filing advice.** |
| Data | IndexedDB storage, CSV export, AES-256-GCM encrypted backup/restore, manual cash expenses, dark mode, mobile layout. |

## Layout

```
index.html  styles.css  sw.js  manifest.webmanifest
js/parser.js      statement PDF/CSV → rows (pure, unit-tested)
js/categorize.js  merchant normalisation + category rules
js/recurring.js   subscription / renewal / price-hike detection
js/tax.js         tax engine (slabs live in one table)
js/store.js db.js state + IndexedDB + encrypted backup
js/views/*        UI screens          js/charts.js  SVG charts
tests/            npm test
```

## Tests

```bash
npm test
```

## Limits

* Scanned (image-only) PDFs need OCR, which is not included – use the bank's CSV or a text PDF.
* Tax slabs are kept in `js/tax.js`; FY 2026-27 assumes the FY 2025-26 rules – update after each Budget.
* Credit-card statements work best as CSV.
