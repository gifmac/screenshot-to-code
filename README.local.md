# Local setup notes

This is a clone of [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code)
(MIT, Abi Raja) kept as a standalone tool. Upstream code is unmodified; everything we
added is listed below.

- **Forked from:** `d026163f586dfa8c5c10d28c36edd59a9d3b0e88` (2026-07-22)
- **Cloned:** 2026-08-18
- **Remote:** upstream only. `git fetch upstream && git merge upstream/main` pulls
  improvements. There is no `origin` unless you add one.

## What we added

| File | Why |
|---|---|
| `docker-compose.override.yml` | Upstream declares no volumes, so generated results die with the container. Sets `EVALS_DIR=/data` and bind-mounts `./data`. |
| `.env` | Provider keys. Gitignored by upstream's own `.gitignore:17`. |
| `data/` | Bind-mounted work dir: `inputs/` (PNG in), `results/` (HTML out). Gitignored. |
| `README.local.md` | This file. |

Nothing under `backend/` or `frontend/` is touched, so merges stay clean.

## Running it

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
(`packageManager: pnpm@10.32.1`), which is the one edit in this repo outside the
override and this file — expect a conflict there if upstream fixes it too.

**The first `up` builds the images and that takes a while** — `backend/Dockerfile`
runs `poetry install` and then `playwright install --with-deps chromium`, which pulls
a full Chromium plus its system libraries. Expect 5-15 minutes on a cold cache. This is
a build-time cost, not a per-run one; subsequent starts are fast. Watch it with
`docker compose logs -f backend` rather than assuming it hung.

Docker Desktop must be running first, and the drive holding this repo must be shared in
Docker Desktop → Settings → Resources → File Sharing, or the `./data` bind mount fails
at container start rather than at compose parse.

## Headless use

Normally you drive this through the `screenshot-to-code` skill
(`~/.claude/skills/screenshot-to-code/`), which wraps the REST API below via
`scripts/stc.mjs`. Direct calls, for reference:

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
