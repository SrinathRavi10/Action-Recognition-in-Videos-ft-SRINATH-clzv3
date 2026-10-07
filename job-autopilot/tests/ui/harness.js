// Serves ui/ over HTTP and gives each page a stubbed `window.api` backed by fixture data, so the real UI code can be driven in Chromium.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ui');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

export async function startUi() {
  const server = http.createServer((req, res) => {
    const f = path.join(UI, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html');
    const file = fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(UI, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const exe = ['/opt/pw-browsers/chromium', undefined].find((p) => !p || fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    browser,
    async open(data, { width = 1360, height = 900, dark = false, route = 'today', respond = {} } = {}) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript(({ data, respond }) => {
        window.__calls = [];
        window.api = {
          platform: 'win32', pathForFile: () => '', on: () => {},
          call: async (name, payload) => {
            window.__calls.push([name, payload]);
            if (name in respond) return respond[name];
            switch (name) {
              case 'state': return data.state; case 'jobs:list': return data.jobs; case 'apps:list': return data.apps; case 'companies:list': return data.companies; case 'log:list': return data.log; case 'health': return data.health; case 'insights': return data.insights; case 'qa:state': return data.qa; case 'qa:save': return { ok: true, pending: 1 }; case 'qa:bank': return { ok: true, pending: 2 }; case 'qa:retry': return { ok: true, count: 1 };
              case 'job:detail': return { ...data.jobs.find((j) => j.id === payload), description: 'We are looking for a machine learning engineer.\nPython, PyTorch, NLP. 0-2 years of experience.' };
              case 'app:followup:draft': return { subject: 'Following up – application', body: 'Hello team,\n\nI applied last week…', to: '' };
              case 'app:prep': return { text: '## What the role needs\n- Python\n- PyTorch\n\n## Likely questions\n- Tell me about **a project**.', source: 'template' };
              case 'cover:preview': return 'Hello Postman team,\n\nI am applying for…';
              case 'shot:read': return null;
              default: return { ok: true };
            }
          },
        };
      }, { data, respond });
      await page.goto(`${this.url}/index.html#/${route}`);
      await page.waitForSelector('#view > *', { timeout: 8000 });
      return { page, errors, close: () => ctx.close() };
    },
    async close() { await browser.close(); server.close(); },
  };
}
