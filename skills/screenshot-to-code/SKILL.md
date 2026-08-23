---
name: screenshot-to-code
description: Convert a screenshot, mockup, design comp, Figma export, or screen recording into working front-end code that visually replicates the input. Two modes — inline (Claude writes the HTML directly, no setup) and app mode (drives the standalone screenshot-to-code Docker app for real asset extraction, lifting the actual logos and photos out of the screenshot, plus multi-model comparison and video-to-prototype). Triggers on "screenshot to code", "turn this mockup into HTML", "rebuild this design", "recreate this page from an image", "code this screenshot", "clone this UI", "extract the assets from this screenshot", or whenever an image or video of a UI arrives with a request to build the markup. Also covers iterating on generated output ("update the hero", "change the button color") and stack selection (HTML+Tailwind, HTML+CSS, React, Vue, Bootstrap, Ionic).
---

# Screenshot to Code

Replicate a visual input as working code. Two modes, and **you must say which one you
are using and why** before generating anything.

## Choosing the mode

**Inline mode** — you read the image and write the HTML yourself, guided by
`references/system-prompt.md`. No Docker, no API keys, no waiting. This is the default.

**App mode** — drive the standalone app at `C:\Users\gifma\projects\Screenshot_to_Code`
via `scripts/stc.mjs`. Slower and needs keys, but it can do four things inline mode
cannot:

1. **Asset extraction** — lifts the real logos, photos, and icons out of the screenshot
   as image files. Inline mode can only approximate them or use placeholders. This is
   the main reason app mode exists.
2. **Image generation / editing / background removal** for assets that can't be lifted.
3. **Multi-model comparison** — the same screenshot through several models at once,
   via `--models a,b`.

Batch is **not** available: the backend accepts a list of input files, but `stc.mjs`
takes exactly one image per run. Loop it, or use inline mode.

Use app mode when the request depends on the *real* imagery from the source, or when the
user asks for variants. Use inline mode for everything else, and whenever Docker is down
and the job doesn't need extraction.

Overrides: `--force-app` / `--force-inline` in the user's request.

## App mode

```bash
node ~/.claude/skills/screenshot-to-code/scripts/stc.mjs status
node ~/.claude/skills/screenshot-to-code/scripts/stc.mjs up          # first run builds, 5-15 min
node ~/.claude/skills/screenshot-to-code/scripts/stc.mjs run shot.png --out ./stc-out/hero/
```

`status` first, always — it reports `READY`, `DEGRADED` (up but no Gemini key, so output
will be placeholders), or `DOWN`. Exit codes: `0` ok, `1` generation failed, `2` bad
usage, `3` backend unreachable, `4` missing prerequisite. The `STC_*` lines on stderr are
the machine-readable channel; parse those rather than the prose.

`run` defaults to stack `html_tailwind`, the newest Gemini *flash* model, and
`./stc-out/<slug>/`. Flags override: `--stack`, `--models a,b` (several = variant
comparison), `--out`, `--auto-up`. The default is flash, not pro, because
`extract_assets` runs on `gemini-3.6-flash` regardless of the generating model
(`backend/asset_extraction.py:18`) and because free-tier Gemini keys get zero
`gemini-*-pro` quota. Pass `--models` for pro on a billed key. One page takes two to
five minutes depending on provider load; tell the user that before starting, and expect
the occasional `503` when Gemini is busy (the fix line says to just run it again).

The output directory is self-contained: `index.html` plus an `assets/` folder holding
the extracted crops, with `src` rewritten to relative paths. Move it anywhere; it does
not need the container running. Report the real path to the user.

**Read the `STC_ASSETS` line and report it to the user.** `extracted=0` means asset
extraction never fired and the output is placeholder-only — say so plainly, because at
that point app mode bought nothing over inline mode and the user should know.
`localized=N` is how many crops were copied out; a `localized` short of `extracted`
means some images still point at the backend and will break when it stops.

App location is `STC_HOME` (default `C:/Users/gifma/projects/Screenshot_to_Code`); see
that repo's `README.local.md` for setup. `stc.mjs` handles images only. For video
input, start the browser UI with `stc up --with-ui` and drive it at
<http://localhost:5173> — it takes MP4/MOV/WebM up to 30s and is the only path that
does.

## Inline mode

### 1. Read the input

Use the Read tool on the image — it renders visually. Read all of them before writing
any code. For video, ask for extracted frames (or pull them with ffmpeg) and treat them
as an ordered sequence, following the video guidance in `references/prompt-templates.md`.

### 2. Pick the stack

Ask only if it isn't obvious. `html_tailwind` (default), `html_css`, `react_tailwind`,
`vue_tailwind`, `bootstrap`, `ionic_tailwind`. Exact CDN snippets per stack are in
`references/system-prompt.md` — use them verbatim so the file runs standalone.

### 3. Decide the image policy

State which applies before writing code: real assets available (reference their paths),
or none (use `https://placehold.co/<w>x<h>` plus CSS effects). Never embed the whole
screenshot as a background to fake the layout — build real markup.

### 4. Generate

One self-contained `index.html`, written in a single pass. Use the **exact text** from
the screenshot. Match background color, text color, font size, font family, padding,
margin, and borders precisely. Drop device frames and browser chrome from mobile shots.
Multiple screenshots: distinct pages get linked, tabs get navigation, unrelated ones get
a scaffold separating "Screenshot 1", "Screenshot 2", etc.

### 5. Verify visually

Render the result with the `/browse` skill at desktop and mobile widths, compare against
the source, fix what's off with Edit, re-render. Do not claim it matches until you have
looked at a rendering. This applies to app mode output too.

Use `goto file:///C:/absolute/path/index.html` — three slashes, then the drive letter.
`file://C:/...` is rejected as a UNC host and `file:///c/...` as a non-absolute path.

### 6. Iterate

Exact string replacements, never a full regeneration. If the user names a selected
element and gives its `outerHTML`, treat it as a locator — it comes from the live DOM so
it may differ from source (JSX `className`, Vue directives, runtime-injected classes).
Find the code that produces it and change only that.

## Host-project etiquette

This skill loads in every project, so it obeys whatever project it lands in. Read the
host project's `AGENTS.md` / `CLAUDE.md` before writing anything into the repo, and
default to writing under an ignored or scratch path rather than into source.

In `prodatanalytics-rebuild` specifically: output is **reference-only**. Never write
into `wordpress/` or `handoff/`, never push generated markup to the live site, and route
any production change through that repo's `prodata-mcp-rules` skill. Its brand system
(`docs/architecture/brand-system.md`) outranks whatever the screenshot shows.

## Reference files

- `references/system-prompt.md` — upstream system prompt verbatim: tone, all six stacks
  with exact CDN tags, targeted-element edit rules, plus a tool-mapping table.
- `references/prompt-templates.md` — create-from-image/text/video prompts, both update
  strategies, and the design-system and image-policy blocks.
- `references/upstream.md` — provenance, pinned commit, re-sync instructions.
