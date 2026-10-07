# Job Autopilot

A Windows desktop app that reads your resume, watches company career pages for new openings that fit you, and **applies automatically** –
within limits you control. Everything (your resume, answers, history) stays on your PC.

## Get it (no terminal needed)
1. GitHub → **Actions → Build Job Autopilot → Run workflow** (it also runs on every push).
2. Download **JobAutopilot-windows** from the finished run, unzip, and run `JobAutopilot-Setup-1.2.0.exe` (installer) or the portable `.exe`.
3. Windows SmartScreen may say “Windows protected your PC” (the app is unsigned): **More info → Run anyway**.

## Using it
1. **Profile** → drop in your resume PDF. Check what was read (name, phone, skills, years of experience) and fill in *notice period* and *expected CTC*.
2. **Today** → switch **Autopilot** on. It starts in **Dry run**: it finds jobs and fills real application forms, saves a screenshot of each, but **does not submit**.
3. Look at a few dry-run screenshots under **Pipeline → History**. When they look right, switch to **Live**.
4. Anything it cannot finish honestly (a captcha, a question only you can answer) lands in **Needs you** – “Open & finish for me” opens the form pre-filled so you only press Submit.

New openings are picked up on every check (default: every 10 minutes while the PC is on – the app can start with Windows and keep running in the tray).

## What's new in 1.2 – fills what it never saw before
* **Answers screen** – a built-in list of **105 question types** (identity, contact, address, links, skills, current work, notice/CTC, work-mode, shifts, travel, eligibility, education incl. 10th/12th, referral, demographics, written answers). Answer them once; every application reuses them. Questions are recognised by *meaning*, not exact words ("Would you be open to night/rotational shifts?" ≈ "Are you willing to work night shifts?").
* **Answers fit the field** – the same answer becomes `30 days`, `30`, `Within 1 month`, `2026-11-06` or `Hybrid` depending on whether the field is text, a number, a date or a drop-down with its own wording; experience / notice / CTC are matched to the right numeric bucket ("1-3 years", "5-8 LPA"); yes/no questions work with any phrasing ("I do not require sponsorship" for No).
* **It never gets stuck silently** – a question it can't answer honestly is saved as *pending*; answer it once on the Answers screen and the waiting applications are retried automatically. Claude's reusable answers are saved for you to review. `{company}` and `{role}` placeholders work in your written answers.
* **Universal form filler** – sees through web-component (shadow DOM) forms, multi-step wizards (Next → Next → Submit), custom drop-downs, button-style radios, rich-text boxes, address autocompletes, forms embedded in iframes, and detects account/sign-in walls. SmartRecruiters is now filled automatically; other employer pages are tried (turn off under Settings → *sites never tested*).
* **Watch it fill** – the **Watch** button opens the application in a visible window, fills it, and leaves it for you (it never submits by itself in watch mode). Settings → *Show the application window* lets you watch every automatic application too.
* **Clear dry-run wording** – Dry run now says plainly that nothing is sent, and the buttons say *Rehearse* instead of *Apply*.
* **Fixed matching** – “RBAI Engineer / Maintenance” is no longer mistaken for an AI role (whole-word matching), plant/mechanical roles and SDE III/IV+ are skipped, tidier locations, SmartRecruiters descriptions are fetched so scores are accurate.

## What's new in 1.1
* **Approvals** – optional approval mode: in Live mode the app prepares jobs and waits for your one-click *Approve* (or *Approve all*). Preview the cover letter first.
* **Pipeline board** – Applied → Heard back → Interview → Offer → Closed. Drag cards, add interview dates (and export them to your calendar as `.ics`), notes, and a timeline.
* **Follow-ups** – after 7 days without a reply it drafts a polite follow-up for you to send.
* **Inbox reading (optional)** – read-only IMAP: interview invitations, offers and rejections move your cards automatically.
* **Interview prep** – a brief for each application (Claude writes it from your resume if you added a key; otherwise a checklist from the posting vs your skills).
* **Insights** – response rate, funnel, weekly activity, which systems reply, score vs replies, skills employers ask for.
* **Smarter matching** – duplicates across sites collapsed, stale postings ignored, posted pay compared with your expectation, and it **learns** from the jobs you ♥ or ✕.
* **Teach it once** – answer a question under *Needs you* and it is remembered for every future form.
* Workday postings (an account per employer) are found and flagged *Apply yourself* (one click to open, one click to record).
* **Safety** – API keys / passwords are encrypted with your Windows account; pauses a site after repeated captchas; one automatic retry on transient failures; CSV export of every application; one-click problem report.
* **Interface** – command palette (**Ctrl+K**), remembered dark/light theme, “Get ready” checklist, grouped navigation.

## How it decides
* **Eligibility & score (0–100):** role fit with your target roles, experience demanded vs. yours (skips “5+ years”), location (your cities, remote-India, or relocation within India), skills overlap with your resume, freshness. Seniors/leads/managers are skipped. Every decision lists its reasons.
* **Guard-rails:** daily cap (15), max 2 per company per 60 days, no duplicate roles, pauses between applications, active-hours window, Dry-run default, live mode blocked until your profile is complete.
* **Honesty:** only facts from your resume/profile are ever entered. Demographic questions are declined where possible; unknown required questions are left for you (or answered by Claude *only* from your resume and only when it is confident). It never submits a half-filled form.

## Where jobs come from
Company career boards on **Greenhouse, Lever, Ashby and Workable** (checked directly, so you see postings immediately; applied to automatically), plus **SmartRecruiters** (filled by the universal form filler – experimental), plus RemoteOK, Remotive and Adzuna India (optional key).
Postings that ask you to **email** your resume can be sent from your Gmail (app password).
On first run it probes a list of candidate company boards and keeps the ones that exist and have India/remote openings; add any company by pasting its careers link under **Sources**.

**LinkedIn, Naukri and Indeed are intentionally not automated.** Their terms forbid bots, they detect and ban them, and they would put your main accounts at risk.

## Optional: Claude
Add an Anthropic API key in **Settings** to let the app answer screening questions and write cover letters (grounded in your resume; low-confidence answers are never used). Default model `claude-opus-5-5` (changeable). Server-side refusal fallback is enabled.

## If it does not open (Windows)
Task Manager → end any “Job Autopilot” process → start again. Errors are written to `%APPDATA%\Job Autopilot\startup.log`.

## Honest limits
* Tested end-to-end against **mock** Greenhouse / Lever / Ashby-style job boards and forms in a real browser (and inside the packaged Electron app). It has **not** been run against live sites from the build environment, so selectors/flows on real career pages may need tweaks – use Dry run first and read the screenshots.
* Captchas cannot be bypassed (and shouldn’t be); those applications go to *Needs you*.
* It only works while your PC is on and the app is running.
* Some large employers (Workday, SuccessFactors, their own portals) use account-based flows that are not automated – SmartRecruiters/Workday matches are listed for you to apply to yourself.
* Not built: auto-update, code signing (needs a paid certificate), a phone companion app, Hindi interface, per-job resume rewriting, Workday (account wall).
* The universal filler, the answer bank and the SmartRecruiters flow are tested against realistic **mock** forms (shadow DOM, multi-step, custom widgets, 20+ unusual questions) in a real browser and in the Electron app – not against live SmartRecruiters / employer sites, which this build environment cannot reach. Real sites will have surprises: use **Watch** and Dry run first; anything unclear stops in *Needs you* instead of guessing.
* The inbox reader is tested against a stubbed IMAP client and its classifier on sample emails; it has not been run against a real mailbox from the build environment.

## Develop
```bash
npm install
npm test             # unit + browser + UI tests against local mock sites
npm run test:e2e     # drives the real Electron app (needs xvfb on Linux)
npm run mock         # start the mock job site on :4010
npm run desktop      # run the app
```
