# Local setup notes

This is a clone of [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code)
(MIT, Abi Raja) kept as a standalone tool. Upstream code is left alone wherever it can
be; exactly two upstream files are edited, and both are listed below along with
everything we added.

- **Forked from:** `d026163f586dfa8c5c10d28c36edd59a9d3b0e88` (2026-07-22)
- **Cloned:** 2026-08-18
- **Remotes:** `origin` is the fork at <https://github.com/gifmac/screenshot-to-code>
  (where local work is pushed); `upstream` is abi/screenshot-to-code.
  `git fetch upstream && git merge upstream/main` pulls improvements.

## Contents

| Section | Read it when |
|---|---|
| [Using it](#using-it) | You want to turn a screenshot into code. **Start here.** |
| [Command reference](#command-reference) | You know the basics and want every flag. |
| [Troubleshooting](#troubleshooting) | Something failed and you want the fix. |
| [What we added](#what-we-added) | You want to know how this fork differs from upstream. |
| [Running it with Docker Compose directly](#running-it-with-docker-compose-directly) | You are bypassing the driver. |
| [Headless use and the REST API](#headless-use-and-the-rest-api) | You are scripting against the backend yourself. |

## Using it

### What this actually does

You give it a **PNG screenshot of a web page**. It gives you back **working HTML** that
looks like that screenshot. It also lifts the real logos and photos out of the image and
saves them next to the HTML, so you get the actual assets rather than grey placeholder
boxes.

It runs entirely on your machine. The only things that leave your computer are the
screenshot and the prompt, sent to whichever AI provider you configured.

### Before you start

You need three things. Check all three before running anything.

1. **Docker Desktop, running.** Not just installed — the whale icon must be present and
   the engine responsive. Verify with `docker ps`. If that command hangs or errors, fix
   Docker before going further; nothing here works without it.
2. **At least one AI provider API key**, in a file called `.env` in the repo root. See
   [API keys](#api-keys) below.
3. **Node.js**, to run the driver script. Verify with `node --version`.

You do **not** need Python, Poetry, or pnpm installed. Those live inside the container.

### API keys

Create `.env` in the repo root. You need **at least one** of these:

```ini
GEMINI_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here
OPENAI_API_KEY=your-key-here
REPLICATE_API_KEY=your-key-here
```

Which key you set changes what you get:

| Key | What it unlocks |
|---|---|
| `GEMINI_API_KEY` | **The important one.** Drives asset extraction — pulling real logos and photos out of the screenshot. Without it you get placeholders, and `stc status` reports `DEGRADED`. |
| `ANTHROPIC_API_KEY` | Claude models for page generation. |
| `OPENAI_API_KEY` | GPT models for page generation. |
| `REPLICATE_API_KEY` | Optional. Generates or edits assets that cannot be extracted, such as an occluded logo or the background itself. |

`.env` is gitignored, so your keys are never committed.

### One-time setup

Nothing to install. The first time you start the backend, Docker builds the image, and
**that build takes 5–15 minutes** on a cold cache — it installs Python dependencies and
downloads a full Chromium with its system libraries. This is a one-time cost, not
per-run. Watch it rather than assuming it hung:

```bash
docker compose logs -f backend
```

If the repo lives on a drive Docker cannot see, the `./data` bind mount fails when the
container starts. Fix it in Docker Desktop → Settings → Resources → File Sharing.

### The three commands

The driver is a Node script. **It is not installed on your PATH** — there is no `stc`
command. Every invocation looks like this, run from the repo root:

```bash
node skills/screenshot-to-code/scripts/stc.mjs <command>
```

The rest of this section abbreviates that prefix as `stc`. Substitute the full path when
you actually type it.

| Command | What it does |
|---|---|
| `stc status` | Is the backend up, which models can I use, is asset extraction working. |
| `stc up` | Start the backend. Add `--with-ui` to also start the browser UI. |
| `stc run <image>` | Turn a screenshot into code. |

### Your first run, step by step

**1. Start the backend.**

```bash
node skills/screenshot-to-code/scripts/stc.mjs up
```

**2. Confirm it is ready.** Wait a few seconds first — see the warning below.

```bash
node skills/screenshot-to-code/scripts/stc.mjs status
```

You want to see:

```
READY — 47 models available, asset extraction on.
STC_READY: backend=up models=47 extraction=yes
```

> **Do not trust a `status` run immediately after `up`.** `up` reports success when the
> *container* starts, which is a second or two before the web server inside it finishes
> binding to the port. Checking too early prints `DOWN — backend not responding on :7001`
> even though everything is fine. Wait about five seconds and check again.

If it says `DEGRADED`, the backend is up but `GEMINI_API_KEY` is missing, so you will get
placeholder assets instead of real ones.

**3. Generate a page.** Point it at any PNG:

```bash
node skills/screenshot-to-code/scripts/stc.mjs run data/inputs/prodata-home.png
```

You will see progress every ten seconds, then a result:

```
Generating html_tailwind from prodata-home.png with gemini-3.6-flash...
STC_PROGRESS: model=gemini-3.6-flash elapsed=10s
...
STC_ASSETS: extracted=1 generated=0 placeholder=0 localized=1
STC_OUTPUT: C:\...\stc-out\prodata-home\index.html
Done in 1m20s.
```

**Expect 80–95 seconds.** That is normal, not a hang. Every run measured on this repo has
landed between 1m 20s and 1m 32s regardless of model or stack.

**4. Open the result.** The path is printed on the `STC_OUTPUT:` line.

```powershell
start stc-out\prodata-home\index.html      # Windows
open  stc-out/prodata-home/index.html      # macOS
```

### Reading the command examples

Documentation here writes optional and placeholder parts like this:

```
stc run <image> [--stack S] [--models a,b]
```

- `<image>` means **substitute your own value**. Do not type the angle brackets.
- `[...]` marks an **optional** part. Do not type the square brackets.

So the real command is `stc run data/inputs/shot.png --stack html_css`, not
`stc run <shot.png> [--stack S]`. In PowerShell, typing the angle brackets literally
fails with `The '<' operator is reserved for future use`, because `<` is a reserved
PowerShell operator.

### Choosing a stack

A **stack** is the flavour of front-end code you want out. Pass it with `--stack`:

| Stack | Output | Use when |
|---|---|---|
| `html_tailwind` | HTML with Tailwind utility classes, loaded from a CDN | Default. Fastest to skim and tweak. |
| `html_css` | HTML with plain hand-written CSS, no dependencies | **You want a file that works offline** and survives the CDN going away. |
| `react_tailwind` | A React component | You are dropping it into a React app. |
| `vue_tailwind` | A Vue component | You are dropping it into a Vue app. |
| `bootstrap` | HTML with Bootstrap classes | Your project already uses Bootstrap. |
| `ionic_tailwind` | Ionic components | You are building a mobile-style UI. |

Practical note: the Tailwind and React stacks reference `cdn.tailwindcss.com` (and React
plus Babel) at runtime, and the browser console warns against using those CDN builds in
production. Only `html_css` gives you a genuinely self-contained file.

```bash
node skills/screenshot-to-code/scripts/stc.mjs run shot.png --stack html_css
```

### Choosing a model

Leave `--models` off and the driver picks the newest Gemini **flash** model for you. That
default is deliberate: asset extraction always runs on `gemini-3.6-flash` regardless of
which model writes the page, so flash is the tier this tool is built around.

To pick your own, or to compare several at once:

```bash
# one specific model
node skills/screenshot-to-code/scripts/stc.mjs run shot.png --models claude-sonnet-4-6

# two models, same screenshot, for side-by-side comparison
node skills/screenshot-to-code/scripts/stc.mjs run shot.png --models claude-sonnet-4-6,gemini-3.6-flash
```

Passing several models produces one output file per model in the same folder, which is
how you compare them. `stc status --json` lists every valid model id.

> **Free-tier Gemini cannot use any `gemini-*-pro` model.** Google reports `limit: 0` for
> those on a free key, so every attempt returns 429 immediately. This is a quota of zero,
> not a temporary rate limit, and waiting does not help. Use a flash model, or enable
> billing on your Google account.

### Where the output goes

| Path | What is in it |
|---|---|
| `stc-out/<name>/index.html` | **Your result.** Default location, named after the input file. |
| `stc-out/<name>/assets/` | Logos and photos lifted out of the screenshot, referenced by relative path from the HTML. |
| `data/results/<date>_<model>_<stack>/` | The backend's own raw output, before the driver copies assets and rewrites paths. |
| `data/local_assets/` | The shared pool of extracted assets on the bind mount. |

Change the destination with `--out`:

```bash
node skills/screenshot-to-code/scripts/stc.mjs run shot.png --out ./my-page
```

The assets matter more than they look. Straight from the backend, generated HTML points
at `http://127.0.0.1:7001/local-assets/...`, which only resolves while the backend is
running. `stc run` copies those files next to your HTML and rewrites the `src`
attributes to relative paths, so the folder keeps working after you shut everything down.

### Video input

Video is the one thing the headless driver cannot do. It only goes through the browser
UI:

```bash
node skills/screenshot-to-code/scripts/stc.mjs up --with-ui
```

Then open <http://localhost:5173> and drop in an MP4, MOV, or WebM of **up to 30
seconds**. Recording a scroll-through of a page this way captures sections a single
screenshot cannot reach.

### Shutting down

```bash
docker compose down
```

Generated output lives on disk outside the containers, so nothing you made is lost.

## Command reference

```
stc status                 is it up, do I have asset extraction, what next
stc up [--with-ui]         build (first time) and start the backend
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
```

`STC_HOME` overrides which checkout the driver drives; it defaults to this repo.

**Exit codes.** Useful if you are scripting around it:

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Generation failed — the backend ran but produced nothing usable. |
| `2` | Bad usage — you passed a flag or argument it did not understand. |
| `3` | Backend unreachable — it is not running, or not on the expected port. |
| `4` | Missing prerequisite — Docker, a key, or a required file. |

**Machine-readable markers.** Every run prints `STC_`-prefixed lines designed to be
grepped rather than read: `STC_READY`, `STC_PROGRESS`, `STC_ASSETS`, `STC_OUTPUT`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `The '<' operator is reserved for future use` | You typed a documentation placeholder literally in PowerShell. Drop the `<>` and `[]` and substitute a real path. |
| `stc: The term 'stc' is not recognized` | There is no `stc` command. Use `node skills/screenshot-to-code/scripts/stc.mjs ...`. |
| `DOWN — backend not responding on :7001` right after `up` | Almost always checked too early. Wait five seconds and run `status` again. If it persists, `docker compose logs -f backend`. |
| `DEGRADED` in `status` | `GEMINI_API_KEY` is missing from `.env`. The tool runs but emits placeholder assets. |
| `429` / `RESOURCE_EXHAUSTED` naming a `gemini-*-pro` model | Free-tier Gemini has zero quota for pro models. Switch to a flash model or enable billing. Waiting will not clear it. |
| Run returns HTTP 200 but no HTML appears | A run where every task failed still reports success with an empty list. The real error is in `failed_tasks.txt` inside the output folder under `data/results/`. |
| Images show as broken after you shut the backend down | You are looking at the backend's raw output in `data/results/`, which links to `127.0.0.1:7001`. Use the `stc-out/` copy, which has relative paths. |
| Backend will not start; `docker ps` hangs or reports no engine | Docker itself is broken, not this project. If the daemon is running but unresponsive, `wsl -t docker-desktop` forces a clean VM restart on Windows — then give it time, since restoring many containers can take 20+ minutes before the engine answers. |
| First `up` seems frozen | The initial image build takes 5–15 minutes. `docker compose logs -f backend` to watch actual progress. |
| Input rejected | The REST path filters on file extension and accepts `.png` only. Convert JPEGs first. |

## What we added

| File | Why |
|---|---|
| `docker-compose.override.yml` | Upstream declares no volumes, so generated results die with the container. Sets `EVALS_DIR=/data` and bind-mounts `./data`. |
| `.env` | Provider keys. Gitignored by upstream's own `.gitignore:17`. |
| `data/` | Bind-mounted work dir: `inputs/` (PNG in), `results/` (HTML out). Gitignored. |
| `skills/screenshot-to-code/` | The Claude skill and its `stc.mjs` driver. Versioned here so the work is backed up; see below. |
| `README.local.md` | This file. |

Everything above is additive, so merges stay clean apart from two upstream files this
fork does edit:

| File | Why | Conflicts if |
|---|---|---|
| `frontend/Dockerfile` | Upstream moved the frontend to pnpm but left the Dockerfile copying a `yarn.lock` that no longer exists, so the image would not build. Details [below](#running-it-with-docker-compose-directly). | Upstream fixes it too. |
| `backend/prompts/system_prompt.py` | The React scaffolding listed which scripts to load but never said how to mount, so generated pages called `ReactDOM.createRoot` from the UMD build and logged a console error on every load. Now specifies an importmap plus a real `react-dom/client` import. | Upstream changes the same React block. |

## Running it with Docker Compose directly

Everything below bypasses the `stc` driver and talks to Docker and the backend yourself.
If you just want to turn a screenshot into code, use [Using it](#using-it) instead — the
driver handles asset copying and path rewriting that you would otherwise do by hand.

```bash
docker compose up -d backend  # override file is auto-loaded, no -f flags needed
docker compose up -d          # both, when you want the browser UI too
docker compose logs -f backend
docker compose down
```

Backend on <http://localhost:7001>, browser UI on <http://localhost:5173>.

The headless driver only ever talks to the backend's HTTP API, so `stc up` starts
`backend` alone and `stc up --with-ui` adds the UI. Reach for the UI when you want
video input: it takes MP4/MOV/WebM up to 30s, and nothing else does.

`frontend/Dockerfile` had to be repaired to get there. Upstream moved the frontend to
pnpm in 2c35fb1 but left the Dockerfile copying a `yarn.lock` that no longer exists, so
the target failed to build and a bare `docker compose up -d` took the backend down with
it. It now enables corepack and installs the version pinned in `package.json`
(`packageManager: pnpm@10.32.1`). It is one of the two upstream files this fork edits
(see [What we added](#what-we-added)) — expect a conflict here if upstream fixes it too.

**The first `up` builds the images and that takes a while** — `backend/Dockerfile`
runs `poetry install` and then `playwright install --with-deps chromium`, which pulls
a full Chromium plus its system libraries. Expect 5-15 minutes on a cold cache. This is
a build-time cost, not a per-run one; subsequent starts are fast. Watch it with
`docker compose logs -f backend` rather than assuming it hung.

Docker Desktop must be running first, and the drive holding this repo must be shared in
Docker Desktop → Settings → Resources → File Sharing, or the `./data` bind mount fails
at container start rather than at compose parse.

## Headless use and the REST API

Normally you drive this through the `screenshot-to-code` skill, which wraps the REST API
below via `skills/screenshot-to-code/scripts/stc.mjs`. The skill is versioned in this
repo and surfaced to Claude through a directory junction, so there is one copy on disk:

```powershell
# once, from an empty ~/.claude/skills/screenshot-to-code:
cmd /c mklink /J "$env:USERPROFILE\.claude\skills\screenshot-to-code" `
  "$PWD\skills\screenshot-to-code"
```

Direct calls, for reference:

```bash
curl -s localhost:7001/models                       # available models + stacks
cp shot.png data/inputs/
curl -s -X POST localhost:7001/run_evals \
  -H 'Content-Type: application/json' \
  -d '{"models":["<model-id>"],"stack":"html_tailwind","files":["shot.png"]}'
```

`POST /run_evals` runs the **full agent** with the complete tool set — `extract_assets`,
`generate_images`, `edit_images`, `remove_backgrounds`, `screenshot_preview` — with
image generation enabled (`backend/evals/core.py:82-105`). It just does not stream to a
frontend. Passing several models in one call gives the variant grid headlessly.

Inputs must be `.png`; the backend filters on the extension (`backend/evals/runner.py:51`).
Results land in `data/results/{Mon_DD_YYYY}_{model}_{stack}/{stem}_{attempt}.html`.

Three things about that response that the shape of the API does not advertise:

- **It returns bare filenames, not paths** (`backend/evals/runner.py:353`), so you cannot
  locate the output from the response alone. The folder date is the *container's* clock —
  UTC, a day ahead of a US host most evenings — so recomputing it locally is also wrong.
  Scan `data/results` by mtime instead.
- **A run where every task failed still returns HTTP 200 with `[]`.** The real error is in
  `failed_tasks.txt` inside the output folder.
- **Extracted crops are served, not embedded.** The generated HTML points at
  `http://127.0.0.1:7001/local-assets/<name>`, which only resolves while the backend is up.
  `LOCAL_ASSET_DIR=/data/local_assets` in the override puts the files on the bind mount;
  `stc run` then copies them next to the HTML and rewrites the `src` to relative paths.

A free-tier Gemini key has `limit: 0` for every `gemini-*-pro` model — those 429 on every
attempt. The flash models work. `stc run` defaults to the newest flash for that reason,
and because `extract_assets` always runs on `gemini-3.6-flash` anyway
(`backend/asset_extraction.py:18`).
