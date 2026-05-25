# AI Zoo v1.1.0 Update Log / 更新日誌

**Version**: 1.0.0 → 1.1.0
**Date**: 2026-04-20

---

## 🇺🇸 English

### New Features
- **Per-platform ON/OFF toggles**: Each AI platform (Grok, Gemini, Claude, ChatGPT) now has an individual ON/OFF toggle button in the header bar. Disabled platforms will not receive questions or trigger new chat resets. Toggle state is persisted across sessions.
- **Claude sidebar persistence in iframe**: Claude's sidebar now stays visible when embedded in the extension's iframe. A CSS injection + DOM hook system prevents Claude's own code from hiding or removing the sidebar. Includes open/collapse toggle buttons overlaid on the iframe.
- **Claude page-world hook script** (`claude-page-hook.js`): New web-accessible resource injected into Claude's page context to intercept DOM removal, attribute changes, and CSS style changes that would hide the sidebar.
- **Grok cookie banner auto-hide**: The OneTrust cookie consent banner on grok.com is now automatically hidden via CSS injection and MutationObserver, preventing it from blocking the chat interface.
- **Claude diagnostics tools** (developer-only, hidden by default): Added Protect (P), Breakpoint (B), and Diagnose (D) buttons for Claude, along with a diagnostics panel to inspect sidebar state. These are hidden via CSS (`display: none !important`) and only accessible for debugging.

### Bug Fixes
- **Claude React hydration fix**: Delayed overlay injection and login check by 2 seconds to avoid React hydration mismatch errors on Claude's pages. Removed CSP header rules for Claude subdomains that caused hydration issues.
- **Login overlay click-through fix**: Fixed issues where login overlays were intercepting clicks meant for the underlying iframe.
- **Grok login flow improvement**: Fixed login button to open the correct sign-in URL.

### Technical Changes
- **Manifest**: `claude.ai` host permission changed to `*.claude.ai` to support subdomains. Added `web_accessible_resources` for `claude-page-hook.js`.
- **Rules**: Claude URL filter changed from `*://claude.ai/*` to `||claude.ai` with added `xmlhttprequest` resource type for broader header removal coverage.
- **Removed unused `storage` permission** to comply with Chrome Web Store policy.

---

## 🇹🇼 中文

### 新功能
- **各平台獨立 ON/OFF 開關**：每個 AI 平台（Grok、Gemini、Claude、ChatGPT）的標題列現在都有獨立的 ON/OFF 切換按鈕。停用的平台不會接收問題或觸發新對話重置。切換狀態會跨 session 保存。
- **Claude 側邊欄在 iframe 中持久顯示**：Claude 的側邊欄在嵌入擴充功能的 iframe 時，現在會保持可見狀態。透過 CSS 注入 + DOM Hook 系統，防止 Claude 自身的程式碼隱藏或移除側邊欄。包含覆蓋在 iframe 上的展開/收合切換按鈕。
- **Claude 頁面世界 Hook 腳本**（`claude-page-hook.js`）：新增 web-accessible 資源，注入 Claude 的頁面上下文，攔截會隱藏側邊欄的 DOM 移除、屬性變更和 CSS 樣式變更。
- **Grok Cookie 橫幅自動隱藏**：grok.com 上的 OneTrust Cookie 同意橫幅現在會透過 CSS 注入和 MutationObserver 自動隱藏，防止其擋住聊天介面。
- **Claude 診斷工具**（僅開發者用，預設隱藏）：新增 Claude 的保護(P)、斷點(B)和診斷(D)按鈕，以及診斷面板用於檢查側邊欄狀態。這些按鈕透過 CSS（`display: none !important`）隱藏，僅供除錯使用。

### 錯誤修復
- **Claude React Hydration 修復**：延遲覆蓋層注入和登入檢查 2 秒，以避免 Claude 頁面上的 React hydration 不匹配錯誤。移除了導致 hydration 問題的 Claude 子域名 CSP 標頭規則。
- **登入覆蓋層點擊穿透修復**：修復登入覆蓋層攔截了本應點擊底層 iframe 的問題。
- **Grok 登入流程改善**：修復登入按鈕以開啟正確的登入 URL。

### 技術變更
- **Manifest**：`claude.ai` 主機權限改為 `*.claude.ai` 以支援子域名。新增 `web_accessible_resources` 用於 `claude-page-hook.js`。
- **Rules**：Claude URL 過濾器從 `*://claude.ai/*` 改為 `||claude.ai`，並新增 `xmlhttprequest` 資源類型以擴大標頭移除覆蓋範圍。
- **移除未使用的 `storage` 權限**，以符合 Chrome Web Store 政策。

---

## Files Changed / 變更檔案

| File / 檔案 | Changes / 變更 |
|---|---|
| `manifest.json` | Version bump, subdomain support, web_accessible_resources |
| `rules.json` | Broader Claude URL matching + xmlhttprequest |
| `content-scripts/claude-page-hook.js` | **NEW** - Page-world sidebar protection hook |
| `content-scripts/claude-script.js` | +500 lines: sidebar persistence, diagnostics, delayed login |
| `content-scripts/grok-script.js` | +70 lines: cookie banner suppression |
| `popup.html` | Platform toggle buttons, diagnostics panel |
| `popup.js` | +240 lines: toggle logic, diagnostics, breakpoint/protection |
| `popup.css` | +120 lines: toggle styles, sidebar overlay, diagnostics panel |
