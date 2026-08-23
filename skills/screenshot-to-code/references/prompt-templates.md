# Upstream user prompts

Source: `backend/prompts/` in abi/screenshot-to-code @ `d026163` (MIT). The Python
builders are flattened into their rendered text here. Substitutions:
`{stack}`, `{design_system}`, `{image_policy}`, `{text_prompt}`.

## Policy blocks

Injected into every prompt below.

**Selected stack** (`policies.py`):

```
Selected stack: {stack}.
```

Valid values: `html_css`, `html_tailwind`, `react_tailwind`, `bootstrap`,
`ionic_tailwind`, `vue_tailwind`.

**Image policy** (`policies.py`) — enabled:

```
Image generation is enabled for this request. Use generate_images for missing
assets when needed.
```

Disabled (the default in this port, since there is no image-gen tool):

```
Image generation is disabled for this request. Do not call generate_images.
Use provided media, CSS effects, or placeholder URLs (https://placehold.co).
```

**Design system** (`design_system.py`) — omitted entirely when empty:

```
## Design system

If the design system conflicts with other instructions, prioritize the design system.

<design_system>
{design_system}
</design_system>
```

In this repo the design system is `docs/architecture/brand-system.md`. Load it into
this block whenever the output is meant to look like ProData Analytics rather than
like the screenshot's original brand.

## Create from image (`create/image.py`)

Images are attached first, then this text:

```
Generate code for a web page that looks exactly like the provided screenshot(s).

{selected_stack}
{design_system_block}

## Replication instructions

- Make sure the web page looks exactly like the screenshot.
- Use the exact text from the screenshot.
- Since our goal is to make the web page look as close to the screenshot as possible, we need to extract the exact image assets where possible and generate images for the assets that are not extractable.
- Extracting assets can be done with the extract_assets tool. After extracting assets, make sure to inspect the extracted image closely to ensure that it is what we want.
- When available, use edit_images for asset edits such as removing unwanted elements, batching independent edits into one call.
- If an extracted or supplied asset is visibly low-resolution or pixelated and must render larger, upscale it with edit_images—not CSS stretching or generate_images.
- If an asset in the original screenshot is not extractable (for example, occluded by other objects or is the background), when available, use generate_images to create image URLs from prompts (you may pass multiple prompts).

- {image_policy}

## Multiple screenshots

If multiple screenshots are provided, organize them meaningfully:

- If they appear to be different pages in a website, make them distinct pages and link them.
- If they look like different tabs or views in an app, connect them with appropriate navigation.
- If they appear unrelated, create a scaffold that separates them into "Screenshot 1", "Screenshot 2", "Screenshot 3", etc. so it is easy to navigate.
- For mobile screenshots, do not include the device frame or browser chrome; focus only on the actual UI mockups.
```

Any extra user instructions are appended as `Additional instructions: {text_prompt}`.

## Create from text (`create/text.py`)

```
Generate UI for {text_prompt}.
{selected_stack}
{design_system_block}

# Instructions

- Make sure to make it look modern and sleek.
- Use modern, professional fonts and colors.
- Follow UX best practices.
- {image_policy}
```

## Create from video (`create/video.py`)

Upstream passes the video as a data URL. In this port, supply ordered frames
instead and keep the instructions:

```
You have been given a video of a user interacting with a web app. You need to
re-create the same app exactly such that the same user interactions will produce
the same results in the app you build.

- Watch the entire video carefully and understand all the user interactions and UI state changes.
- Make sure the app looks exactly like what you see in the video.
- Pay close attention to background color, text color, font size, font family,
  padding, margin, border, etc. Match the colors and sizes exactly.
- {image_policy}
- If some functionality requires a backend call, just mock the data instead.
- MAKE THE APP FUNCTIONAL using JavaScript. Allow the user to interact with the app and get the same behavior as shown in the video.
- Use SVGs and interactive 3D elements if needed to match the functionality shown in the video.

Analyze this video and generate the code.

{selected_stack}
{design_system_block}
```

## Updates

`plan.py` picks one of two strategies, never both:

- **`update_from_history`** — a conversation already exists. Replay it, prefixing
  the *first* user message with the stack + image policy + design system blocks.
  This is the natural path in Claude Code: the earlier turns are already in context.
- **`update_from_file_snapshot`** — no history, only the current file on disk.

Snapshot form (`update/from_file_snapshot.py`):

```
{selected_stack}

{image_policy}

{design_system_block}

You are editing an existing file.

<current_file path="{path}">
{file_contents}
</current_file>

<change_request>
{request_text}
</change_request>
```

`path` defaults to `index.html`. When the user has selected an element in a preview,
`request_text` carries that element's `outerHTML` — handle it per the
"Targeted element edits" section of `system-prompt.md`.

Either way the rule from the system prompt holds: **exact string replacements, never
a full-file regeneration.**
