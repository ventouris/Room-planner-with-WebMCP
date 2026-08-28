#!/usr/bin/env node
/**
 * floorplan-shot — render a Room Planner floor plan to an image file.
 *
 * Opens the app in headless Chrome, optionally applies a sequence of WebMCP
 * tool calls, then captures the floor plan *only* (clipped to the plan itself,
 * no app chrome) and writes it to disk.
 *
 * Zero dependencies: it drives Chrome over the DevTools protocol using Node's
 * built-in WebSocket (Node 22+).
 *
 *   node tools/floorplan-shot.mjs --room demo --out plan.png
 *   node tools/floorplan-shot.mjs --room demo \
 *        --call move_object '{"objectId":"desk-1","xCm":180,"yCm":40}' \
 *        --call 'highlight_objects {"objectIds":["desk-1"],"message":"Moved to the light"}' \
 *        --out desk-by-the-window.png
 *   node tools/floorplan-shot.mjs --plan my-layout.json --format svg --out plan.svg
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');

/* ----------------------------------------------------------------- args */

function parseArgs(argv) {
  const opts = {
    out: 'floorplan.png', format: null, room: null, plan: null, calls: [],
    scale: 2, window: '1440x900', url: null, background: 'paper',
    savePlan: null, quiet: false, timeout: 20000
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    switch (arg) {
      case '--out': case '-o': opts.out = next(); break;
      case '--format': opts.format = next(); break;
      case '--room': opts.room = next(); break;
      case '--plan': opts.plan = next(); break;
      case '--scale': opts.scale = Number(next()); break;
      case '--window': opts.window = next(); break;
      case '--url': opts.url = next(); break;
      case '--background': opts.background = next(); break;
      case '--save-plan': opts.savePlan = next(); break;
      case '--timeout': opts.timeout = Number(next()); break;
      case '--quiet': case '-q': opts.quiet = true; break;
      case '--help': case '-h': opts.help = true; break;
      case '--call': {
        /* --call name '{json}'  or  --call 'name {json}' */
        const first = next();
        const spaced = first.match(/^(\S+)\s+([\s\S]+)$/);
        if (spaced) {
          opts.calls.push({ name: spaced[1], args: JSON.parse(spaced[2]) });
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          opts.calls.push({ name: first, args: JSON.parse(argv[++i]) });
        } else {
          opts.calls.push({ name: first, args: {} });
        }
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!opts.format) opts.format = extname(opts.out).toLowerCase() === '.svg' ? 'svg' : 'png';
  return opts;
}

const HELP = `floorplan-shot — render a Room Planner floor plan to an image

  --out, -o <file>       output file (default floorplan.png; .svg selects SVG)
  --format png|svg       override the format inferred from --out
  --room <name>          demo | bedroom | office | living
  --plan <file.json>     import a layout JSON before capturing
  --call <tool> <json>   apply a WebMCP tool call first (repeatable)
  --scale <n>            PNG pixel density, default 2
  --window <WxH>         browser viewport, default 1440x900 (sets plan size)
  --background <mode>    paper | transparent
  --save-plan <file>     also write the resulting layout JSON
  --url <url>            app URL (default: the index.html next to this script)
  --quiet, -q            only print the output path
`;

/* --------------------------------------------------------------- chrome */

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  for (const path of candidates) if (existsSync(path)) return path;
  throw new Error('Chrome not found. Set CHROME_PATH to the browser binary.');
}

async function launchChrome({ width, height, timeout }) {
  const binary = findChrome();
  const profile = await mkdtemp(join(tmpdir(), 'floorplan-'));
  const child = spawn(binary, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--remote-debugging-port=0',
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const endpoint = await new Promise((res, rej) => {
    let buffer = '';
    const timer = setTimeout(() => rej(new Error('Chrome did not report a debugging endpoint')), timeout);
    child.stderr.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); res(match[1]); }
    });
    child.on('exit', (code) => { clearTimeout(timer); rej(new Error(`Chrome exited early (${code})`)); });
  });

  return {
    endpoint,
    async close() {
      try { child.kill(); } catch { /* already gone */ }
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/* ------------------------------------------------------------------ cdp */

class CDP {
  constructor(socket, timeout) {
    this.socket = socket;
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.waiters = this.waiters.filter((w) => {
          if (w.method !== msg.method) return true;
          w.resolve(msg.params);
          return false;
        });
      }
    });
  }

  static async connect(endpoint, timeout) {
    const socket = new WebSocket(endpoint);
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('Timed out connecting to Chrome')), timeout);
      socket.addEventListener('open', () => { clearTimeout(timer); res(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); rej(new Error('Could not connect to Chrome')); }, { once: true });
    });
    return new CDP(socket, timeout);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.socket.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, this.timeout);
    });
  }

  once(method) {
    return new Promise((resolve, reject) => {
      const waiter = { method, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`Timed out waiting for ${method}`));
      }, this.timeout);
    });
  }

  close() { try { this.socket.close(); } catch { /* ignore */ } }
}

/* ----------------------------------------------------------------- main */

async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true
  }, sessionId);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(d.exception?.description || d.text || 'Page evaluation failed');
  }
  return res.result.value;
}

async function run(opts) {
  const [width, height] = opts.window.split('x').map(Number);
  if (!width || !height) throw new Error('--window must look like 1440x900');

  /* view=plan strips the app chrome, so the plan fills the window and nothing
     but the plan can end up in the frame. */
  const params = new URLSearchParams({ view: 'plan' });
  if (opts.room) params.set('room', opts.room);
  if (opts.background === 'transparent') params.set('background', 'transparent');
  const base = opts.url || pathToFileURL(join(APP_ROOT, 'index.html')).href;
  const url = `${base}${base.includes('?') ? '&' : '?'}${params}`;

  const say = (...args) => { if (!opts.quiet) console.error(...args); };

  const chrome = await launchChrome({ width, height, timeout: opts.timeout });
  let cdp;
  try {
    cdp = await CDP.connect(chrome.endpoint, opts.timeout);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    }, sessionId);
    if (opts.background === 'transparent') {
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 }
      }, sessionId);
    }

    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url }, sessionId);
    await loaded;
    say(`· opened ${url}`);

    /* Wait for the app to finish booting and for webfonts to settle. */
    await evaluate(cdp, sessionId, `
      new Promise((res, rej) => {
        const started = Date.now();
        (function poll(){
          if (window.roomPlanner && document.getElementById('plan')?.getAttribute('width')) return res(true);
          if (Date.now() - started > 8000) return rej(new Error('The planner did not start'));
          setTimeout(poll, 50);
        })();
      }).then(() => document.fonts ? document.fonts.ready : null)
    `);

    if (opts.plan) {
      const json = await readFile(resolve(opts.plan), 'utf8');
      await evaluate(cdp, sessionId, `window.RP.store.importPlan(${JSON.stringify(JSON.parse(json))}), true`);
      say(`· imported ${opts.plan}`);
    }

    for (const call of opts.calls) {
      const result = await evaluate(cdp, sessionId,
        `window.roomPlanner.callTool(${JSON.stringify(call.name)}, ${JSON.stringify(call.args)})`);
      if (result && result.error) throw new Error(`${call.name}: ${result.error}`);
      const v = result && result.validation;
      say(`· ${call.name}${v ? ` → ${v.valid ? 'layout valid' : `${v.collisions.length} collision(s), ${v.violations.length} violation(s)`}` : ' → ok'}`);
    }

    /* Let the pending render land before we photograph it. */
    await evaluate(cdp, sessionId, 'new Promise(r => setTimeout(() => requestAnimationFrame(r), 80))');

    const outPath = resolve(opts.out);
    let bytes;

    if (opts.format === 'svg') {
      const svg = await evaluate(cdp, sessionId,
        `window.RP.exporter.serializeSvg({ background: ${JSON.stringify(opts.background)} }).svg`);
      bytes = Buffer.from(svg, 'utf8');
    } else {
      const box = await evaluate(cdp, sessionId, `
        (() => {
          const r = document.getElementById('plan').getBoundingClientRect();
          return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
        })()
      `);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: Math.max(0, Math.floor(box.x)),
          y: Math.max(0, Math.floor(box.y)),
          width: Math.ceil(box.width),
          height: Math.ceil(box.height),
          scale: opts.scale
        }
      }, sessionId);
      bytes = Buffer.from(shot.data, 'base64');
    }

    await writeFile(outPath, bytes);

    if (opts.savePlan) {
      const plan = await evaluate(cdp, sessionId, 'window.roomPlanner.getPlan()');
      await writeFile(resolve(opts.savePlan), JSON.stringify(plan, null, 2));
      say(`· layout written to ${opts.savePlan}`);
    }

    say(`· ${(bytes.length / 1024).toFixed(1)} KB`);
    console.log(outPath);
  } finally {
    cdp?.close();
    await chrome.close();
  }
}

try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); process.exit(0); }
  await run(opts);
} catch (err) {
  console.error(`floorplan-shot: ${err.message}`);
  process.exit(1);
}
