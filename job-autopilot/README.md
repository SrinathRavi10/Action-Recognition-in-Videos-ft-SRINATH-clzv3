# Job Autopilot

A Windows desktop app that reads your resume, watches company career pages for new openings that fit you, and **applies automatically** –
within limits you control. Everything (your resume, answers, history) stays on your PC.

## Get it (no terminal needed)
1. GitHub → **Actions → Build Job Autopilot → Run workflow** (it also runs on every push).
2. Download **JobAutopilot-windows** from the finished run, unzip, and run `JobAutopilot-Setup-1.0.0.exe` (installer) or the portable `.exe`.
3. Windows SmartScreen may say “Windows protected your PC” (the app is unsigned): **More info → Run anyway**.

## Using it
1. **Profile** → drop in your resume PDF. Check what was read (name, phone, skills, years of experience) and fill in *notice period* and *expected CTC*.
2. **Today** → switch **Autopilot** on. It starts in **Dry run**: it finds jobs and fills real application forms, saves a screenshot of each, but **does not submit**.
3. Look at a few dry-run screenshots under **Applications**. When they look right, switch to **Live**.
4. Anything it cannot finish honestly (a captcha, a question only you can answer) lands in **Needs you** – “Open & finish for me” opens the form pre-filled so you only press Submit.

New openings are picked up on every check (default: every 10 minutes while the PC is on – the app can start with Windows and keep running in the tray).

## How it decides
* **Eligibility & score (0–100):** role fit with your target roles, experience demanded vs. yours (skips “5+ years”), location (your cities, remote-India, or relocation within India), skills overlap with your resume, freshness. Seniors/leads/managers are skipped. Every decision lists its reasons.
* **Guard-rails:** daily cap (15), max 2 per company per 60 days, no duplicate roles, pauses between applications, active-hours window, Dry-run default, live mode blocked until your profile is complete.
* **Honesty:** only facts from your resume/profile are ever entered. Demographic questions are declined where possible; unknown required questions are left for you (or answered by Claude *only* from your resume and only when it is confident). It never submits a half-filled form.

## Where jobs come from
Company career boards on **Greenhouse, Lever, Ashby and Workable** (checked directly, so you see postings immediately), plus RemoteOK, Remotive and Adzuna India (optional key).
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
* Some large employers (Workday, SuccessFactors, their own portals) use account-based flows that are not automated.

## Develop
```bash
npm install
npm test             # unit + browser tests against local mock sites
npm run mock         # start the mock job site on :4010
npm run desktop      # run the app
```
