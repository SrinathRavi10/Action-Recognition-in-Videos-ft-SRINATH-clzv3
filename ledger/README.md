# Paisa Ledger

A private, offline-first money app: **bank-statement analyser**, **bill & subscription tracker**, **tax helper** and **planner**.
It ships as a **desktop app** (Windows / macOS / Linux) and also runs as an installable web app.
There is no server and no account — everything stays on your device, and the app blocks all outside network connections.

## Get the desktop app (no terminal needed)

1. On GitHub open the repository → **Actions** → **Build desktop apps** → **Run workflow** (it also runs automatically on every push).
2. When it finishes (~5–10 minutes) open the run and download the artifact for your system:
   * **PaisaLedger-windows** – `PaisaLedger-Setup-x.y.z.exe` (installer) and `PaisaLedger-Portable-x.y.z.exe` (no install)
   * **PaisaLedger-macos** – `.dmg`   ·   **PaisaLedger-linux** – `.AppImage`
3. Install and open it. The installers are **unsigned**, so Windows SmartScreen shows “Windows protected your PC”: click **More info → Run anyway**. (Code-signing certificates cost money; that is the only reason for the warning.)

## Run from source

```bash
cd ledger
npm install
npm run desktop        # desktop app window
npm start              # or serve the web app at http://localhost:8080 (needs Python 3)
npm test               # unit tests
npm run dist:win       # build the installer yourself (on Windows); dist:mac / dist:linux likewise
```

## What it does

| Area | Features |
|---|---|
| **Import** | PDF (incl. password-protected), **scanned PDFs & photos via offline OCR**, Excel `.xlsx`, CSV. Auto-detects Date / Debit / Credit / Balance columns, verifies every row against the running balance, manual column mapper (remembered), duplicate-safe re-imports, statement-gap warnings. |
| **Categories** | ~30 India-centric categories, learns from your edits, your own keyword/regex rules with preview, merchant merging, tags, split transactions, shared-expense tracking (“who owes me”), foreign-currency entries. |
| **Home** | Animated summary, smart insights (spikes, unusually large payments, double charges, year-over-year), month-by-month and category charts with hover details, spending calendar, budgets, 30-day outlook. |
| **Bills** | Detects OTT, mobile, SIP, insurance, EMI, rent and utility payments; **price-hike alerts**, renewal reminders (desktop notifications + calendar `.ics`), cancel guides. |
| **Plan** | Savings goals, net worth over time, 30-day cash-flow forecast, owed-to-you ledger. |
| **Tax** | Old vs new regime (slabs, 87A, surcharge, HRA, 80C/80D/NPS/24b…), **capital gains** (20% / 12.5%), let-out property, presumptive business income (44AD/44ADA), advance-tax calendar, year-end saving ideas, ITR summary, Form 16 reader, rent-receipt generator. **Estimates only – not filing advice.** |
| **Reports** | Printable monthly/yearly report → PDF, plus Excel workbook export. |
| **Security** | Optional **app lock with AES-256-GCM encryption at rest**, idle auto-lock, encrypted backups, separate profiles, backup reminders. |
| **App feel** | Command palette (Ctrl K), keyboard shortcuts, dark mode, English + Hindi, larger text & high-contrast modes, phone-friendly layout. |

## Layout

```
index.html styles.css sw.js manifest.webmanifest
js/            app + logic (parser, categorize, recurring, insights, tax, db, ocr, xlsx …)
js/views/      screens
desktop/       Electron main + preload (secure app:// origin, no network)
vendor/        pdf.js, Tesseract OCR + English data, Inter font — all bundled for offline use
tests/         npm test
```

## Honest limits

* Scanned statements rely on OCR – always check the numbers before importing.
* Only synthetic and Chromium-generated statement layouts were tested; an unusual bank layout may need the column mapper.
* FY 2026-27 tax rules assume FY 2025-26 slabs are unchanged – edit `js/tax.js` after each Budget.
* Hindi covers navigation and key screens only. No phone app yet (the installable web app works on phones).
