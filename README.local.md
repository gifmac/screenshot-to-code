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
docker compose up -d          # override file is auto-loaded, no -f flags needed
docker compose logs -f backend
docker compose down
```

Backend on <http://localhost:7001>, browser UI on <http://localhost:5173>.

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
