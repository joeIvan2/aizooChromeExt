# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Multi-Chat Assistant is a Chrome Extension (Manifest V3) that enables simultaneous chatting with 4 AI platforms: Grok, Gemini, Claude, and ChatGPT. The extension displays all four platforms side-by-side in iframes, allows unified input, and coordinates question submission across all platforms.

**Language Context**: This is a bilingual project (Chinese/English). Code comments are primarily in Chinese, while technical elements use English conventions.

## Development Commands

### Load Extension in Chrome
1. Navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `chrome-extension` directory

### Reload After Changes
- For manifest.json, background.js, or content scripts changes:
  - Click reload button in `chrome://extensions/` for this extension
- For popup.html, popup.js, popup.css:
  - Close and reopen the extension popup (changes apply immediately)

### Debug
- **Background Service Worker**: `chrome://extensions/` → Click "service worker" link under extension
- **Popup Page**: Right-click extension icon → "Inspect popup"
- **Content Scripts in iframes**: Open extension → Right-click iframe → "Inspect"

All debugging logs are prefixed with `[platform-name]` or `[AI Multi-Chat]` for easy filtering.

## Architecture Overview

### Core Communication Flow

```
popup.js (Main Controller)
    ↓ postMessage({type: 'AI_SUBMIT_QUESTION'})
iframe (e.g., grok.com)
    ↓ Received by content script
injection-core.js (submitQuestion)
    ↓ DOM manipulation: fillQuestion() → clickButton()
AI Website
    ↓ Network request intercepted
injection-core.js (setupFetchMonitor/setupXHRMonitor)
    ↓ postMessage({type: 'AI_RESPONSE_RECEIVED'})
popup.js (handleMessage)
    ↓ updateStatus()
UI Status Indicator
```

### Three-Layer Architecture

**Layer 1: Extension Infrastructure**
- `manifest.json`: Chrome extension configuration, permissions, content script injection rules
- `background.js`: Service worker (currently minimal, reserved for future features)
- `rules.json`: declarativeNetRequest rules to remove security headers (X-Frame-Options, CSP)

**Layer 2: Main UI Controller**
- `popup.html/css/js`: Main extension page, 4-iframe layout, unified input control, message routing

**Layer 3: Platform Injection System**
- `platforms-config.js`: Platform-specific configurations (selectors, API patterns, response parsers)
- `injection-core.js`: Core injection logic (network monitoring, DOM automation, retry mechanisms)
- `{platform}-script.js`: Platform-specific initialization (Grok, Gemini, Claude, ChatGPT)
- `google-oauth-handler.js`: OAuth detection and login flow handling

### Key Design Patterns

**1. Platform Configuration System**
Each platform in `PLATFORM_CONFIGS` defines:
- `detectTextarea()`: Function to detect if input field is ready
- `detectButton()`: Function to detect if submit button is ready (with anti-spam logic)
- `fillQuestion(q)`: Function to fill question into input field
- `clickButton()`: Function to click submit button
- `responseType`: 'fetch_stream' or 'xhr_stream' (determines which monitor to use)
- `responseApiPattern`: URL pattern to intercept
- `parseResponse(rawText)`: Platform-specific response parser

**2. Network Interception Strategy**
- **Fetch API Interception** (Grok, Claude, ChatGPT): Overwrites `window.fetch` to intercept streaming responses
- **XMLHttpRequest Interception** (Gemini): Hooks into `XMLHttpRequest.prototype.open/send` for XHR-based APIs
- Both approaches clone response streams to avoid breaking original functionality

**3. Retry Mechanism with Intelligent Waiting**
Instead of fixed delays, `submitQuestion()` uses intelligent polling:
1. Wait for textarea (max 30 retries × 1s)
2. Fill question immediately when textarea ready
3. Poll for button availability (max 30 retries × 1s)
4. Click button as soon as it's enabled (no fixed wait after fill)

This design minimizes submission latency while handling dynamic UI states.

**4. OAuth Login Flow Handling**
- **Grok**: Manual guided flow - detects login need, shows overlay with instructions, opens new tab
- **ChatGPT**: Automatic flow - detects login need, auto-opens popup window, auto-reloads iframe when closed
- **Gemini/Claude**: User handles login directly in iframe (no automation)

Detection happens in platform-specific scripts by monitoring URL patterns (e.g., `accounts.x.ai`, `auth.openai.com`).

**5. Message Protocol**
All iframe ↔ popup communication uses `postMessage` with typed messages:
- `AI_SUBMIT_QUESTION`: popup → content script (initiate question submission)
- `AI_QUESTION_SENT`: content script → popup (question sent successfully)
- `AI_RESPONSE_START`: content script → popup (response streaming started)
- `AI_RESPONSE_RECEIVED`: content script → popup (complete response parsed)
- `AI_ERROR`: content script → popup (error occurred)
- `AI_URL_CHANGED`: content script → popup (URL changed, save to localStorage)
- `AI_NEW_CHAT`: popup → content script (reset to new conversation)

## Important Implementation Details

### Header Removal Strategy
`rules.json` uses Chrome's `declarativeNetRequest` API to remove iframe-blocking headers. This is necessary because all four AI platforms set `X-Frame-Options` or CSP headers that prevent iframe embedding. Rules also modify `Referer` and `Origin` headers for Gemini to bypass additional restrictions.

### Button Detection Anti-Spam Logic (Grok Specific)
Grok's UI reuses the same button for "Send" and "Stop generating". `detectButton()` explicitly checks for stop button presence:
```javascript
const stopBtn = document.querySelector('button[aria-label*="Stop"]');
if (stopBtn) return false; // Don't allow submission while generating
```

This prevents accidentally clicking "Stop" when trying to submit a new question.

### Response Parsing Complexity
Each platform has different API response formats:
- **Grok**: Newline-delimited JSON with `result.token` streaming
- **Gemini**: Nested JSON array with path `outer[0][2] → inner[4][0][1]`
- **Claude**: Full response object with `chat_messages` array, recursively extracts all `text` fields
- **ChatGPT**: Server-sent events format with `data: {...}` lines

See `parseResponse()` in `platforms-config.js` for platform-specific parsing logic.

### URL Monitoring and Session Persistence
`injection-core.js` intercepts History API (`pushState`, `replaceState`) and browser events (`popstate`, `hashchange`) to track URL changes. When URLs change (e.g., new conversation started), they're saved to `localStorage` and restored on next extension open. This maintains conversation continuity across sessions.

### Content Script Injection Timing
All content scripts use `"run_at": "document_start"` and `"all_frames": true` to ensure:
1. Scripts run before page JavaScript executes (necessary for fetch/XHR interception)
2. Scripts run in both main frames and nested iframes (handles OAuth flows)

### Draggable Input Section
The unified input box in `popup.js` is draggable to avoid blocking iframe content. Uses pointer events with pointer capture for reliable dragging (handles fast mouse movement and dragging over iframes). Position is saved to localStorage.

## Common Modification Scenarios

### Adding a New AI Platform
1. Add platform configuration to `PLATFORM_CONFIGS` in `platforms-config.js`
2. Create platform-specific script `{platform}-script.js` (follow existing patterns)
3. Add content script entry in `manifest.json`
4. Add host permission in `manifest.json`
5. Add header removal rule in `rules.json`
6. Add platform to `platforms` array in `popup.js`
7. Add iframe HTML in `popup.html`

### Updating Selectors (When AI Platform Updates UI)
1. Inspect the AI platform's new DOM structure
2. Update selector functions in `platforms-config.js`:
   - `detectTextarea()`: Find new input field selector
   - `detectButton()`: Find new submit button selector
   - Update `fillQuestion()` and `clickButton()` if interaction method changed

### Updating Response API Patterns
1. Open browser DevTools on the AI platform
2. Submit a question and observe Network tab
3. Identify the API endpoint that returns responses
4. Update `responseApiPattern` and `parseResponse()` in `platforms-config.js`

### Modifying Login Flow
Edit platform-specific script (e.g., `grok-script.js`, `chatgpt-script.js`):
1. Update URL pattern detection in `window.addEventListener('load')`
2. Modify login detection logic and UI overlay
3. Update message types sent to popup
4. Adjust popup message handler in `handleLoginMessage()`

## Testing Considerations

### Test After Major Platform Updates
AI platforms frequently update their UIs and APIs. Test these areas after updates:
1. Input field detection (can extension find the textarea?)
2. Button detection (can extension find and click send button?)
3. Response interception (is the API endpoint still the same?)
4. Response parsing (has the response format changed?)

### Cross-Browser Compatibility
This extension uses Manifest V3 and Chrome-specific APIs. It will NOT work in Firefox without modifications. Key Chrome-specific features:
- `declarativeNetRequest` (header modification)
- `chrome.tabs` API (login flow)
- Manifest V3 service worker

### Security and Privacy
The extension modifies security headers to enable iframe embedding. This is necessary for functionality but reduces security isolation. Users should only use this extension with trusted AI platforms and understand the security trade-offs.

## Known Limitations

1. **OAuth in iframes**: Some platforms require OAuth login which cannot complete in iframes. The extension provides workarounds (new tab/window) but this is inherently limited by browser security.

2. **Dynamic UI Changes**: AI platforms frequently update their UIs. Selector-based automation is fragile and requires maintenance when platforms update.

3. **Rate Limiting**: Sending questions to all 4 platforms simultaneously may trigger rate limits on some platforms.

4. **Response Display**: Currently, the extension only shows status indicators. Displaying full responses inline would require additional UI implementation.

5. **Cloudflare/Bot Detection**: Some platforms may show Cloudflare verification or bot detection when loaded in iframes. User must complete verification manually in iframe.
