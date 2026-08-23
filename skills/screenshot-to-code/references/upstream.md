# Upstream provenance

- **Repo:** https://github.com/abi/screenshot-to-code
- **License:** MIT, Copyright (c) 2023 Abi Raja
- **Ported from commit:** `d026163f586dfa8c5c10d28c36edd59a9d3b0e88` (2026-07-22)
- **Ported on:** 2026-08-18
- **What was copied:** the prompt system only — `backend/prompts/` (system prompt,
  create/update builders, stack policies, design-system block). No application code.

Upstream is a React/Vite frontend plus a FastAPI backend that runs an agent loop
against OpenAI / Anthropic / Gemini / Replicate. This skill reuses its prompt
engineering and lets Claude Code play the agent directly, so there is nothing to
run and no API key to hold.

## Re-syncing

Upstream changes its prompts as models change. To refresh:

```bash
git clone --depth 1 https://github.com/abi/screenshot-to-code /tmp/stc
diff -r /tmp/stc/backend/prompts <what this skill's references say>
```

Then update `system-prompt.md` / `prompt-templates.md` and bump the commit hash above.

## Dropped in this port

| Upstream capability | Why dropped |
|---|---|
| `extract_assets` — pulls real logos/photos out of the screenshot (Gemini) | Needs a Gemini key and the backend's asset pipeline |
| `generate_images` (Replicate z-image-turbo), `edit_images`, `remove_backgrounds` | Needs a Replicate key |
| Multi-model variant grid + `retrieve_option` | Needs several provider keys; this port generates one option |
| Native video input | Claude Code reads images, not video — supply frames |
| Eval harness (`backend/evals/`), cost tracking, debug file writer | Product infrastructure, not prompt logic |

## The app is installed locally

The "dropped" column above describes **inline mode only**. App mode restores all of
it. The checkout lives at `C:\Users\gifma\projects\Screenshot_to_Code` (override with
`STC_HOME`), tracking upstream via a remote named `upstream`. See its
`README.local.md` for what was added on top of upstream.

```bash
node ~/.claude/skills/screenshot-to-code/scripts/stc.mjs status
node ~/.claude/skills/screenshot-to-code/scripts/stc.mjs up
node ~/.claude/skills/screenshot-to-code/scripts/stc.mjs run shot.png
```

Keys go in that repo's `.env`. At least one of `OPENAI_API_KEY` /
`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` is required; **Gemini is the one that
matters** — it is what makes `extract_assets` work, and without it the output is
placeholders, which inline mode already gives you for free. Replicate adds image
generation, editing, and background removal.

The headless path is `POST /run_evals` (`backend/routes/evals.py:225`), which runs
the full agent with the complete tool set (`backend/evals/core.py:82-105`) without
streaming to a frontend. That is the only path `stc.mjs` uses.

The browser UI at :5173 is the only path that accepts video. Upstream's
`frontend/Dockerfile` was stale at d026163 — the repo moved to pnpm (commit 2c35fb1,
`frontend/pnpm-lock.yaml`) while the Dockerfile still ran `COPY package.json yarn.lock`
against a `yarn.lock` that no longer exists, so the target could not build. It now
installs the pinned pnpm through corepack instead. Two env vars in the override make
the container actually reach the backend: `PROXY_CODEGEN_BACKEND=http://backend:7001`
for the Vite proxy (its default `127.0.0.1:7001` is the frontend container itself), and
`VITE_HTTP_BACKEND_URL` for the eval pages, which call the backend directly from the
browser rather than through the proxy.

`stc up` still starts `backend` alone, since nothing headless needs the UI;
`stc up --with-ui` starts both.

A hosted version exists at https://screenshottocode.com.

Generated output is a prototype artifact. In any project with production rules —
`prodatanalytics-rebuild` above all — it stays reference-only until those rules say
otherwise.
