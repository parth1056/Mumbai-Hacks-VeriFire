# VeriFire

Browser extension implementation with:
- `src/background.js` — background/service worker logic.
- `src/contentScript.js` — in-page scanning/DOM integration.
- `src/panel.css` — styles for the in-page panel.
- `manifest.json` — WebExtension manifest.

This README only describes what’s actually in the repo and how to run it.

## What it does (based on code present)

- Injects a content script on supported pages to render a minimal panel (styled via `panel.css`) and interact with the DOM.
- Uses a background script to coordinate tasks, messaging, and any network/search orchestration defined in `background.js`.
- No transcript highlighting is implemented in the UI layers here.
- The YouTube transcript extraction and headline checks (if present) are handled within `contentScript.js` and/or `background.js`. Fact checking for transcripts is currently not functioning.

## File Overview

- `src/contentScript.js`
  - Attaches UI elements to the page.
  - Listens/sends messages to the background script.
  - Scans visible content (e.g., headlines or page sections) and renders signals or a panel when applicable.

- `src/background.js`
  - Handles extension lifecycle events and message routing.
  - Performs async operations (e.g., searches, fetches) as implemented.
  - Central place for verification orchestration if enabled in code.

- `src/panel.css`
  - Styles for the small in-page panel and any badges/icons the content script renders.

- `manifest.json`
  - Declares permissions, content scripts, and background/service worker entry.
  - Defines what pages the extension is allowed to run on.

## Install (Load Unpacked)

Chrome/Edge:
1. Go to `chrome://extensions` or `edge://extensions`.
2. Enable Developer Mode.
3. Click “Load unpacked” and select the repository root (the folder containing `manifest.json`).

Firefox (temporary):
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click “Load Temporary Add-on.”
3. Select any file inside the repo (Firefox will load the manifest).

## Development

- Edit `src/contentScript.js` for in-page logic and UI panel behavior.
- Edit `src/background.js` for message handling and async processing.
- Adjust `manifest.json` for permissions, matches, and entry points.
- Use the browser’s devtools:
  - Page devtools for `contentScript.js` logs.
  - Extension background/service worker console for `background.js` logs.
- After changes, reload the extension from the extensions page.

## Current Status

- News headline verification: implemented in content/background scripts (as available in code).
- YouTube transcript extraction: implemented; fact checking of transcripts not functioning.
- No transcript highlighting in the UI.

## Tech

- JavaScript for background and content scripts.
- HTML/CSS for the injected panel (styled via `panel.css`).


