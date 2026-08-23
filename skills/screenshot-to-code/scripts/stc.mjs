#!/usr/bin/env node
// stc — drive the standalone screenshot-to-code app headlessly.
//
// Three commands: status, up, run. (`down` is just `docker compose down` in the
// app repo, so it doesn't earn a wrapper.)
//
// Output contract: human prose on stdout, machine-readable KEY: value on stderr,
// matching what the other gstack CLIs emit so the same parsing works everywhere.
//
// Exit codes: 0 ok · 1 generation failed · 2 bad usage · 3 backend unreachable
//             4 missing prerequisite (Docker / ffmpeg / keys)

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const EXIT = { OK: 0, GEN_FAILED: 1, USAGE: 2, UNREACHABLE: 3, PREREQ: 4 };

const STC_HOME = toPosix(process.env.STC_HOME || 'C:/Users/gifma/projects/Screenshot_to_Code');
const PORT = process.env.STC_PORT || '7001';
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_IN = path.join(STC_HOME, 'data', 'inputs');
const DATA_OUT = path.join(STC_HOME, 'data', 'results');

const isTTY = process.stdout.isTTY;

// ---------------------------------------------------------------- utilities

// Docker bind-mount paths and anything we hand to compose must be POSIX-style
// regardless of how STC_HOME was typed. Node handles forward slashes on Windows
// fine, so normalizing once here covers both.
function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function say(msg) {
  process.stdout.write(msg + '\n');
}

// Machine-readable channel. Never interleaved with prose.
function emit(key, value) {
  process.stderr.write(`${key}: ${value}\n`);
}

function die(code, msg, fix) {
  process.stdout.write(msg + '\n');
  if (fix) process.stdout.write(`  ${fix}\n`);
  process.exit(code);
}

function fmtElapsed(startMs) {
  const s = Math.round((Date.now() - startMs) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

function slugify(s) {
  return path.basename(s, path.extname(s)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'output';
}

function have(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0;
}

// ------------------------------------------------------------- prerequisites

function checkAppHome() {
  if (!existsSync(path.join(STC_HOME, 'docker-compose.yml'))) {
    die(EXIT.PREREQ,
      `No screenshot-to-code checkout at ${STC_HOME}.`,
      'Set STC_HOME, or clone: git clone https://github.com/abi/screenshot-to-code');
  }
}

function checkDocker() {
  if (!have('docker')) {
    die(EXIT.PREREQ, 'Docker is not installed or not on PATH.', 'Install Docker Desktop, then: stc up');
  }
  // `docker info` fails fast and unambiguously when the daemon isn't running,
  // which on Windows means Docker Desktop is closed. Without this check compose
  // fails later with a pipe error that names nothing useful.
  const info = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (info.status !== 0) {
    die(EXIT.PREREQ, "DOWN — Docker Desktop isn't running.", 'Start Docker Desktop, then: stc up');
  }
}

// Which provider keys are actually filled in. Drives the DEGRADED verdict:
// no Gemini means no extract_assets, which means placeholder output, which
// means this tool bought you nothing over doing it inline.
function readKeys() {
  const envPath = path.join(STC_HOME, '.env');
  const keys = { gemini: false, replicate: false, openai: false, anthropic: false };
  if (!existsSync(envPath)) return keys;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!m || !m[2].trim()) continue;
    if (m[1] === 'GEMINI_API_KEY') keys.gemini = true;
    if (m[1] === 'REPLICATE_API_KEY') keys.replicate = true;
    if (m[1] === 'OPENAI_API_KEY') keys.openai = true;
    if (m[1] === 'ANTHROPIC_API_KEY') keys.anthropic = true;
  }
  return keys;
}

async function fetchModels(timeoutMs = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/models`, { signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------- status

async function cmdStatus({ json }) {
  checkAppHome();
  const keys = readKeys();
  const models = await fetchModels();
  const anyKey = keys.gemini || keys.openai || keys.anthropic;

  let verdict;
  if (!models) verdict = 'DOWN';
  else if (!anyKey) verdict = 'DEGRADED';
  else if (!keys.gemini) verdict = 'DEGRADED';
  else verdict = 'READY';

  if (json) {
    say(JSON.stringify({ verdict, home: STC_HOME, port: PORT, keys, models: models?.models ?? [], stacks: models?.stacks ?? [] }, null, 2));
    return verdict === 'DOWN' ? EXIT.UNREACHABLE : EXIT.OK;
  }

  // Three things, in the order that matters: is it up, do I have extraction,
  // what do I type next.
  if (verdict === 'DOWN') {
    say(`DOWN — backend not responding on :${PORT}.`);
    say('  Run: stc up');
    emit('STC_READY', `backend=down models=0 extraction=no`);
    return EXIT.UNREACHABLE;
  }

  const n = models.models?.length ?? 0;
  if (!anyKey) {
    say('DEGRADED — backend is up but no provider keys are set.');
    say(`  Add at least GEMINI_API_KEY to ${path.join(STC_HOME, '.env')}, then: docker compose restart backend`);
  } else if (!keys.gemini) {
    say('DEGRADED — no GEMINI_API_KEY. Output will be placeholders, not real extracted assets.');
    say(`  Add GEMINI_API_KEY to ${path.join(STC_HOME, '.env')}, then: docker compose restart backend`);
  } else {
    say(`READY — ${n} models available, asset extraction on.`);
    say('  Run: stc run <screenshot.png>');
  }
  if (keys.gemini && !keys.replicate) {
    say('  Note: no REPLICATE_API_KEY — image generation and background removal are off.');
  }
  emit('STC_READY', `backend=up models=${n} extraction=${keys.gemini ? 'yes' : 'no'}`);
  return EXIT.OK;
}

// ----------------------------------------------------------------------- up

// Backend only by default: the frontend is the browser UI on :5173 and nothing
// here talks to it, so starting it costs a container for nothing in headless
// use. --with-ui adds it, for video input (the one thing this driver cannot do)
// and for interactive work.
function cmdUp(args = {}) {
  checkAppHome();
  checkDocker();

  const services = args['with-ui'] ? ['backend', 'frontend'] : ['backend'];

  const firstBuild = spawnSync('docker', ['compose', 'images', '-q', ...services], { cwd: STC_HOME, encoding: 'utf-8' });
  const cold = !firstBuild.stdout || !firstBuild.stdout.trim();
  if (cold) {
    // backend/Dockerfile runs `poetry install` then
    // `playwright install --with-deps chromium`. That is a genuinely long build
    // and silence here is what makes people kill it.
    say('Building images (first run only). This installs Python deps plus a full');
    say('Chromium for screenshot previews — expect 5-15 minutes on a cold cache.');
  }
  say(`Starting ${services.join(' and ')}...`);

  const started = Date.now();
  const ticker = setInterval(() => {
    emit('STC_PROGRESS', `phase=${cold ? 'build' : 'start'} elapsed=${fmtElapsed(started)}`);
    if (!isTTY) return;
    say(`  still working — ${fmtElapsed(started)}`);
  }, 10000);

  const res = spawnSync('docker', ['compose', 'up', '-d', ...services], { cwd: STC_HOME, stdio: 'inherit' });
  clearInterval(ticker);

  if (res.status !== 0) {
    die(EXIT.PREREQ,
      'docker compose up failed.',
      'If the error mentions mounts or file sharing, share this drive in Docker Desktop > Settings > Resources > File Sharing.');
  }
  say(`Up in ${fmtElapsed(started)}. Backend :${PORT}.${args['with-ui'] ? ` Browser UI :5173.` : ''}`);
  say('  Check it: stc status');
  return EXIT.OK;
}

// ---------------------------------------------------------------------- run

// The backend filters inputs on the .png extension (backend/evals/runner.py:51),
// so anything else has to be converted first. Node has no built-in image
// conversion; ffmpeg is the dependency we already have via the /watch skill.
function ensurePng(input) {
  if (path.extname(input).toLowerCase() === '.png') return input;
  if (!have('ffmpeg')) {
    die(EXIT.PREREQ,
      `The backend accepts PNG only, and ffmpeg isn't installed to convert ${path.basename(input)}.`,
      'Convert it to PNG and retry, or install ffmpeg.');
  }
  const out = path.join(DATA_IN, `${slugify(input)}.png`);
  say(`Converting ${path.basename(input)} -> PNG...`);
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, out], { stdio: 'inherit' });
  if (res.status !== 0) die(EXIT.GEN_FAILED, `ffmpeg could not convert ${path.basename(input)}.`);
  return out;
}

// Count what actually came back. This is the whole point of the tool: if every
// image is a placehold.co URL then extract_assets never fired and the output is
// no better than doing it inline, so the run has to say so every single time.
function countAssets(html) {
  const srcs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const imgs = srcs.filter((s) => /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(s) || s.startsWith('data:image'));
  let placeholder = 0, generated = 0, extracted = 0;
  for (const s of imgs) {
    if (/placehold\.co|placeholder\.com|via\.placeholder/i.test(s)) placeholder++;
    else if (/replicate\.delivery|pbxt\.replicate/i.test(s)) generated++;
    else extracted++;
  }
  return { extracted, generated, placeholder };
}

// Extracted crops are served by the backend at
// `${LOCAL_ASSET_BASE_URL}/local-assets/<name>` (backend/uploaded_assets/store.py:40),
// so HTML copied out of here renders only while the container is up and only on
// this machine. Copy the files next to the HTML and point at them relatively, so
// what lands in the user's project is a directory they can move anywhere.
function localizeAssets(html, outDir) {
  const srcDir = path.join(STC_HOME, 'data', 'local_assets');
  const assetDir = path.join(outDir, 'assets');
  let localized = 0, missing = 0;

  const out = html.replace(/(?:https?:\/\/[^"'()\s]+)?\/local-assets\/([A-Za-z0-9._-]+)/g, (whole, name) => {
    // This name comes out of model-generated HTML, so it is untrusted. The
    // character class already bars "/", but "." and ".." still resolve to
    // directories, and copyFileSync on a directory throws EPERM — which would
    // crash the run through the top-level catch *after* the generation was paid
    // for. Anything that is not a plain file is left alone as a missing asset.
    if (name === '.' || name === '..') { missing++; return whole; }
    const from = path.join(srcDir, name);
    if (!existsSync(from) || !statSync(from).isFile()) { missing++; return whole; }
    try {
      mkdirSync(assetDir, { recursive: true });
      copyFileSync(from, path.join(assetDir, name));
    } catch {
      missing++;
      return whole;
    }
    localized++;
    return `assets/${name}`;
  });

  return { html: out, localized, missing };
}

function newestResultFiles(sinceMs) {
  if (!existsSync(DATA_OUT)) return [];
  const out = [];
  for (const dir of readdirSync(DATA_OUT)) {
    const full = path.join(DATA_OUT, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const f of readdirSync(full)) {
      if (!f.endsWith('.html')) continue;
      const p = path.join(full, f);
      if (statSync(p).mtimeMs >= sinceMs) out.push({ path: p, folder: dir });
    }
  }
  return out;
}

// A run where every task failed still returns HTTP 200 with an empty list
// (backend/routes/evals.py:226 collects successes and never raises), so the
// empty list is the only thing the caller sees. The actual provider error is
// written to failed_tasks.txt next to where the HTML would have gone. Read it:
// "check the logs" is not an answer when the answer is sitting in a file.
function readFailureReason(sinceMs) {
  if (!existsSync(DATA_OUT)) return null;
  // Take the newest log, not the first in directory order. Result folders are
  // named by model, so directory order is alphabetical by model — with logs
  // from more than one model on disk, "first" reliably picks the wrong run and
  // the advice inverts (a pro-tier "limit: 0" message for a flash failure).
  const logs = readdirSync(DATA_OUT)
    .map((dir) => path.join(DATA_OUT, dir, 'failed_tasks.txt'))
    .filter((log) => existsSync(log) && statSync(log).mtimeMs >= sinceMs)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const log of logs) {
    const m = readFileSync(log, 'utf-8').match(/Error:\s*(.+)/);
    if (!m) continue;
    // The line is "<headline>. {<provider JSON blob>}". The headline before the
    // first brace is the part worth printing; the blob is hundreds of chars of
    // escaped JSON that tells the user nothing they can act on.
    const raw = m[1];
    const headline = (raw.split('{')[0] || raw).trim().replace(/[.\s]+$/, '');
    let fix = `Full log: ${log}`;
    if (/429|quota|RESOURCE_EXHAUSTED/i.test(raw)) {
      // 429 covers two completely different situations and the advice inverts
      // between them, so read which quota actually tripped rather than guessing.
      // "limit: 0" means the key may never run this model (free-tier Gemini on
      // any gemini-*-pro); a non-zero limit means a cap that resets, and telling
      // someone to retry the model that just failed is worse than saying nothing.
      const limit = raw.match(/limit:\s*(\d+)/)?.[1];
      const retry = raw.match(/Please retry in ([\d.]+)s/)?.[1];
      if (limit === '0') {
        fix = 'Your key has no quota for that model at all — free-tier Gemini is limit: 0 on every gemini-*-pro. Pick a flash model (stc status --json lists them) or enable billing.';
      } else if (/PerDay/i.test(raw)) {
        fix = `The per-day cap for this model is used up${limit ? ` (limit: ${limit} requests)` : ''}. Use a different model until it resets, or enable billing — retrying now will just fail again.`;
      } else if (/PerMinute/i.test(raw)) {
        fix = `The per-minute cap is used up. Wait ${retry ? `${Math.ceil(Number(retry))}s` : 'a minute'} and run the same command again.`;
      } else {
        fix = 'The provider refused on quota, not on anything the input did. Try another model (stc status --json) or enable billing.';
      }
    } else if (/503|UNAVAILABLE|overload|high demand/i.test(raw)) {
      // The backend already burned MAX_EVAL_RETRIES (backend/evals/runner.py:17)
      // on this, so there is nothing to tune — the provider is just busy.
      fix = 'Transient provider overload, already retried twice inside the backend. Run the same command again.';
    } else if (/Writing to file failed/i.test(raw)) {
      // The model produced the page and the backend could not write it, so this
      // is the mount or the disk, never the input or the key.
      fix = `The backend generated the page but could not write it under ${DATA_OUT}. Check the ./data bind mount and free disk: docker compose config`;
    } else if (/401|403|PERMISSION_DENIED|UNAUTHENTICATED|invalid.{0,10}api.{0,3}key/i.test(raw)) {
      fix = `The provider rejected the key. Check it in ${path.join(STC_HOME, '.env')}, then: docker compose restart backend`;
    }
    return { headline, fix };
  }
  return null;
}

async function cmdRun(args) {
  checkAppHome();
  const input = args._[0];
  if (!input) die(EXIT.USAGE, 'Usage: stc run <image> [--stack S] [--models a,b] [--out DIR]');
  if (!existsSync(input)) die(EXIT.USAGE, `Not found: ${input}`);

  let models = await fetchModels();
  if (!models) {
    if (!args['auto-up']) {
      die(EXIT.UNREACHABLE,
        `DOWN — backend not responding on :${PORT}.`,
        'Run: stc up   (or pass --auto-up to start it automatically)');
    }
    cmdUp(args);
    // `docker compose up -d` returns as soon as the container is started, not
    // when uvicorn is accepting requests, so the model list is not there yet.
    // Without this poll `models` stays null, the model list stays empty, and the
    // run dies claiming there are no models — blaming the keys for a race.
    say('Waiting for the backend to accept requests...');
    for (let i = 0; i < 30 && !models; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      models = await fetchModels(2000);
    }
    if (!models) {
      die(EXIT.UNREACHABLE,
        `Started the backend but it never answered on :${PORT}.`,
        'Check: docker compose logs -f backend');
    }
  }

  const keys = readKeys();
  if (!keys.gemini) {
    say('Warning: no GEMINI_API_KEY — asset extraction is off, expect placeholder images.');
  }

  const stack = args.stack || 'html_tailwind';
  const available = (models?.models) ?? [];
  // Default to a Gemini *flash*, not the pro tier. Two reasons: extract_assets
  // runs on gemini-3.6-flash no matter which model generates the page
  // (backend/asset_extraction.py:18), so flash is the tier this tool's whole
  // premise already depends on; and free-tier Gemini keys get `limit: 0` for
  // gemini-*-pro, so a pro default 429s on every attempt for anyone who has not
  // enabled billing. Pass --models to pick pro when the key can run it.
  // Prefer "medium thinking" — high roughly doubles the wall clock for a page
  // this size without visibly changing the markup.
  // /models lists oldest-first, so take the highest version number rather than
  // the first match: 3.6 sits behind 3.5 and 3.0 in that list.
  const flash = available
    .filter((m) => /gemini-[\d.]+-flash/i.test(m))
    .sort((a, b) => parseFloat(b.match(/gemini-([\d.]+)-flash/i)[1]) - parseFloat(a.match(/gemini-([\d.]+)-flash/i)[1]));
  const newest = flash.filter((m) => m.startsWith(flash[0]?.split(' ')[0] ?? ''));
  const chosen = args.models
    ? args.models.split(',').map((s) => s.trim()).filter(Boolean)
    : [newest.find((m) => /medium thinking/i.test(m)) || newest[0] || available.find((m) => /gemini/i.test(m)) || available[0]].filter(Boolean);
  if (!chosen.length) die(EXIT.PREREQ, 'No models available. Check your keys with: stc status');

  // A model id the backend does not know blows up at `Llm(model)`
  // (backend/evals/runner.py:224) before any per-task error handling, so it
  // comes back as a bare HTTP 500 with "Internal Server Error" as the body —
  // nothing the user can act on. The ids are long and carry a parenthesised
  // suffix ("gemini-3.6-flash (medium thinking)"), so typos are the normal case,
  // not the exotic one. We already hold the real list; check against it here.
  const unknown = chosen.filter((m) => !available.includes(m));
  if (unknown.length && available.length) {
    const near = available.filter((m) => unknown.some((u) => m.toLowerCase().startsWith(u.toLowerCase().split(' ')[0])));
    die(EXIT.USAGE,
      `Not a model this backend offers: ${unknown.join(', ')}`,
      near.length
        ? `Did you mean one of:\n    ${near.slice(0, 6).map((m) => `"${m}"`).join('\n    ')}`
        : 'Full list: stc status --json');
  }

  mkdirSync(DATA_IN, { recursive: true });
  const png = ensurePng(input);
  const staged = path.join(DATA_IN, path.basename(png));
  if (toPosix(png) !== toPosix(staged)) copyFileSync(png, staged);

  const outDir = args.out || path.join(process.cwd(), 'stc-out', slugify(input));
  mkdirSync(outDir, { recursive: true });

  say(`Generating ${stack} from ${path.basename(staged)} with ${chosen.join(', ')}...`);
  const started = Date.now();
  const ticker = setInterval(() => {
    emit('STC_PROGRESS', `model=${chosen[0]} elapsed=${fmtElapsed(started)}`);
    if (isTTY) say(`  working — ${fmtElapsed(started)}`);
  }, 10000);

  let produced = [];
  try {
    const res = await fetch(`${BASE}/run_evals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: chosen, stack, files: [path.basename(staged)] }),
    });
    if (!res.ok) {
      clearInterval(ticker);
      const body = await res.text().catch(() => '');
      if (/budget/i.test(body)) {
        die(EXIT.GEN_FAILED, 'Aborted: model budget ceiling hit. Not retried.');
      }
      die(EXIT.GEN_FAILED, `Generation failed (HTTP ${res.status}). ${body.slice(0, 300)}`);
    }
    produced = await res.json();
  } catch (e) {
    clearInterval(ticker);
    die(EXIT.UNREACHABLE, `Lost the backend mid-run: ${e.message}`, 'Check: docker compose logs -f backend');
  }
  clearInterval(ticker);

  // /run_evals returns bare filenames, not paths (backend/evals/runner.py:353
  // appends `final_output_html_filename`), so the response alone cannot locate
  // anything on disk. The folder is `{Mon_DD_YYYY}_{model}_{stack}` and that
  // date is the *container's* — UTC here, one day ahead of the host most
  // evenings — so recomputing it host-side is wrong too. Scan the bind mount
  // for HTML newer than this run and keep the names the backend claimed.
  const claimed = new Set(produced.map((p) => path.basename(p)));
  const scanned = newestResultFiles(started - 1000);
  const files = claimed.size ? scanned.filter((f) => claimed.has(path.basename(f.path))) : scanned;
  if (!files.length) {
    if (claimed.size) {
      die(EXIT.GEN_FAILED,
        `The backend wrote ${claimed.size} file(s) but none are visible under ${DATA_OUT}.`,
        'The ./data bind mount is not working. Check: docker compose config');
    }
    const why = readFailureReason(started - 1000);
    emit('STC_ASSETS', 'extracted=0 generated=0 placeholder=0');
    die(EXIT.GEN_FAILED,
      why ? `Every task failed. ${why.headline}.` : 'The run returned no output files.',
      why ? why.fix : 'Check: docker compose logs -f backend');
  }
  // One output file per model per attempt, so a short list means a model failed
  // while others succeeded. Say which count, and why if the log knows.
  if (produced.length < chosen.length) {
    const why = readFailureReason(started - 1000);
    say(`${produced.length} of ${chosen.length} models succeeded.${why ? ` ${why.headline}.` : ' Check backend logs for the rest.'}`);
  }

  const totals = { extracted: 0, generated: 0, placeholder: 0 };
  const copied = [];
  let totalLocalized = 0, totalMissingAssets = 0;
  for (const f of files) {
    const local = f.path;
    if (!existsSync(local)) continue;
    const raw = readFileSync(local, 'utf-8');
    const { html, localized, missing } = localizeAssets(raw, outDir);
    totalLocalized += localized; totalMissingAssets += missing;
    const c = countAssets(html);
    totals.extracted += c.extracted; totals.generated += c.generated; totals.placeholder += c.placeholder;
    const dest = path.join(outDir, files.length > 1 ? `${f.folder}.html` : 'index.html');
    writeFileSync(dest, html);
    copied.push(dest);
  }
  if (!copied.length) die(EXIT.GEN_FAILED, 'Generated files were not readable on the host.', 'Confirm the ./data bind mount is working: docker compose config');

  emit('STC_ASSETS', `extracted=${totals.extracted} generated=${totals.generated} placeholder=${totals.placeholder} localized=${totalLocalized}`);
  if (totalMissingAssets) {
    // Only happens when LOCAL_ASSET_DIR is still the in-image default, i.e. the
    // override file did not take. Those <img> tags die the moment the container does.
    say(`${totalMissingAssets} extracted asset(s) are not on the host and still point at the backend.`);
    say('  Add LOCAL_ASSET_DIR=/data/local_assets to docker-compose.override.yml, then: docker compose up -d backend');
  }
  if (totals.extracted === 0) {
    say(`assets: 0 extracted — output is placeholder-only.`);
    say('  Without real extracted assets this is no better than generating the page inline.');
    if (!keys.gemini) say('  Cause: no GEMINI_API_KEY.');
  } else {
    say(`assets: ${totals.extracted} extracted, ${totals.generated} generated, ${totals.placeholder} placeholder`);
  }

  for (const c of copied) {
    say(c);
    emit('STC_OUTPUT', c);
  }
  say(`Done in ${fmtElapsed(started)}.`);
  return EXIT.OK;
}

// ---------------------------------------------------------------- arg parsing

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

const HELP = `stc — drive the standalone screenshot-to-code app

  stc status                 is it up, do I have asset extraction, what next
  stc up [--with-ui]         build (first time) and start the backend
                             (--with-ui also starts the :5173 browser UI, which
                              is the only path that accepts video)
  stc run <image> [flags]    screenshot -> HTML

Flags for run:
  --stack S      html_tailwind (default), html_css, react_tailwind,
                 vue_tailwind, bootstrap, ionic_tailwind
  --models a,b   comma-separated model ids; several = variant comparison
  --out DIR      output dir (default ./stc-out/<slug>/)
  --auto-up      start the backend if it isn't running

Global:
  --json         machine-readable output (status)
  --help         this

App location: STC_HOME (currently ${STC_HOME})
Exit codes: 0 ok, 1 generation failed, 2 bad usage, 3 backend unreachable,
            4 missing prerequisite`;

const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);

if (!cmd || cmd === '--help' || cmd === '-h' || args.help) {
  say(HELP);
  process.exit(cmd ? EXIT.OK : EXIT.USAGE);
}

const run = { status: () => cmdStatus({ json: !!args.json }), up: () => cmdUp(args), run: () => cmdRun(args) }[cmd];
if (!run) {
  say(`Unknown command: ${cmd}`);
  say(HELP);
  process.exit(EXIT.USAGE);
}

Promise.resolve(run())
  .then((code) => process.exit(code ?? EXIT.OK))
  .catch((e) => { say(`Unexpected failure: ${e.message}`); process.exit(EXIT.GEN_FAILED); });
