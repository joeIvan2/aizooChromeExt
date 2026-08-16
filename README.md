# AI Multi-Chat Assistant

Chrome Extension 擴充功能，可同時與 4 個 AI 平台聊天：Grok、Gemini、Claude、ChatGPT。

A Chrome Extension that enables simultaneous chatting with 4 AI platforms: Grok, Gemini, Claude, and ChatGPT.

---

## 專案狀態

- **正式上架**：[AI Zoo - Chrome Web Store](https://chromewebstore.google.com/detail/ai-zoo/lfjmcgadcijkapkfhliebaojgmjbnmid?hl=zh-TW)
- **目前安裝數**：410 位使用者
- **專案類型**：開源 Chrome Extension / Manifest V3
- **核心用途**：讓使用者在同一個工作區同步比較多個主流 AI 平台的回答，減少重複輸入、切換分頁與人工整理成本。

## Project Status

- **Published**: [AI Zoo - Chrome Web Store](https://chromewebstore.google.com/detail/ai-zoo/lfjmcgadcijkapkfhliebaojgmjbnmid?hl=zh-TW)
- **Current installs**: 410 users
- **Project type**: Open-source Chrome Extension / Manifest V3
- **Core purpose**: Help users compare responses from multiple leading AI platforms in one workspace, reducing repeated typing, tab switching, and manual synthesis work.

---

## 功能特點

- ✅ **4 個 AI 同時顯示**：Grok、Gemini、Claude、ChatGPT 並排顯示
- ✅ **統一輸入框**：一次輸入，一鍵發送到所有 AI
- ✅ **即時狀態更新**：每個 AI 的狀態一目了然
- ✅ **可靠的登入與就緒狀態**：Grok、ChatGPT、Claude 會確認登入狀態；Gemini 會等待可用輸入框
- ✅ **自動繞過限制**：自動移除 X-Frame-Options，允許 iframe 載入
- ✅ **重用現有邏輯**：90% 程式碼來自 React Native App
- ✅ **快捷鍵**：Ctrl+Enter 快速發送問題

## Features

- ✅ **4 AIs Displayed Simultaneously**: Grok, Gemini, Claude, ChatGPT side by side
- ✅ **Unified Input Box**: Type once, send to all AIs with one click
- ✅ **Real-time Status Updates**: Each AI's status at a glance
- ✅ **Reliable Login and Ready States**: Grok, ChatGPT, and Claude confirm login state; Gemini waits for a usable composer
- ✅ **Automatic Bypass**: Automatically removes X-Frame-Options to allow iframe loading
- ✅ **Code Reuse**: 90% of code from React Native App
- ✅ **Keyboard Shortcut**: Ctrl+Enter to quickly send questions

---

## 維護與安全重點

AI Zoo 會與多個第三方 AI 平台的網頁介面互動，因此需要持續維護 selectors、OAuth/login 流程、串流回應解析與跨 iframe 通訊。這類外掛特別需要安全審查，避免 XSS、DOM injection、不安全的 `postMessage` 來源驗證、content script 權限濫用、token/data leakage，以及 CSP/header 規則設定錯誤。

## Maintenance and Security Focus

AI Zoo interacts with several third-party AI web interfaces, so it requires ongoing maintenance for selectors, OAuth/login flows, streaming response parsing, and cross-iframe communication. This kind of extension needs careful security review to prevent XSS, DOM injection, unsafe `postMessage` origin handling, content script permission abuse, token/data leakage, and mistakes in CSP/header rules.

---

## 安裝方式

### 方法 1：從 Chrome Web Store 安裝（推薦）

1. 前往 [AI Zoo Chrome Web Store 頁面](https://chromewebstore.google.com/detail/ai-zoo/lfjmcgadcijkapkfhliebaojgmjbnmid?hl=zh-TW)
2. 點擊「加到 Chrome」
3. 完成！擴充功能已安裝

### 方法 2：開發者模式載入

1. 打開 Chrome 瀏覽器
2. 進入 `chrome://extensions/`
3. 啟用右上角的「開發者模式」
4. 點擊「載入未封裝項目」
5. 選擇此資料夾
6. 完成！擴充功能已安裝

### 方法 3：打包成 .crx 檔案

```bash
# 在 chrome://extensions/ 點擊「封裝擴充功能」
# 選擇 chrome-extension 資料夾
# 生成 .crx 檔案
```

## Installation

### Method 1: Chrome Web Store (Recommended)

1. Visit the [AI Zoo Chrome Web Store page](https://chromewebstore.google.com/detail/ai-zoo/lfjmcgadcijkapkfhliebaojgmjbnmid?hl=zh-TW)
2. Click "Add to Chrome"
3. Done! Extension installed

### Method 2: Developer Mode

1. Open Chrome browser
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked"
5. Select this folder
6. Done! Extension installed

### Method 3: Pack as .crx File

```bash
# In chrome://extensions/, click "Pack extension"
# Select chrome-extension folder
# Generate .crx file
```

---

## 使用方法

1. 點擊瀏覽器工具列的擴充圖示
2. 會開啟一個頁面，顯示 4 個 AI iframe
3. 在頂部輸入框輸入問題
4. 點擊「發送到所有 AI」或按 `Ctrl+Enter`
5. 觀看 4 個 AI 同時回應

## Usage

1. Click the extension icon in the browser toolbar
2. A page will open showing 4 AI iframes
3. Enter your question in the top input box
4. Click "Send to All AIs" or press `Ctrl+Enter`
5. Watch all 4 AIs respond simultaneously

---

## 狀態指示器

每個 AI 的右上角會顯示狀態：

- ⏳ **載入中**：iframe 正在載入
- ✅ **準備就緒**：AI 已準備好接收問題
- 🔄 **處理中**：正在發送問題或等待回應
- 🔐 **需要登入**：需要完成 OAuth 驗證（見下方說明）
- ❌ **錯誤**：發生錯誤（點擊查看詳情）

## Status Indicators

Each AI displays status in the top right corner:

- ⏳ **Loading**: iframe is loading
- ✅ **Ready**: AI is ready to receive questions
- 🔄 **Processing**: Sending question or waiting for response
- 🔐 **Login Required**: OAuth authentication needed (see below)
- ❌ **Error**: An error occurred (click for details)

---

## AI 平台登入處理

Grok、ChatGPT 與 Claude 會在 iframe 中確認目前瀏覽器 session 是否可用；偵測到需要登入時，會在 iframe 顯示登入引導。基於瀏覽器與供應商的安全限制，實際登入仍在供應商官方來源開啟的新分頁或視窗中完成。Gemini 由使用者登入，擴充功能在可用輸入框出現後才顯示「準備就緒」。

### 支援的平台

- **Grok**：登入狀態確認與新分頁登入引導
- **ChatGPT**：登入狀態確認與彈出視窗登入引導
- **Claude**：登入狀態確認與新視窗登入引導
- **Gemini**：由使用者登入；在偵測到可用輸入框後標示為準備就緒

### Grok 登入引導

1. **檢測登入需求**：當 Grok iframe 需要登入時，會顯示登入提示
2. **點擊登入按鈕**：點擊「在新分頁中登入 Grok」按鈕
3. **新分頁登入**：在新分頁中開啟 `https://accounts.x.ai/sign-in?redirect=grok-com`
4. **完成登入**：在 Grok 的官方登入頁完成登入
5. **回到首頁檢查**：回到 AI Multi-Chat，點擊已登入按鈕後返回 Grok 首頁
6. **開始使用**：Grok 重新確認 session，成功後顯示已登入狀態

### ChatGPT 登入引導

1. **檢測登入需求**：當 ChatGPT iframe 無法確認可用 session 時，顯示登入提示
2. **開啟登入視窗**：點擊提示中的登入按鈕，在小視窗（500x700）開啟 `https://auth.openai.com/log-in`
3. **完成登入**：在彈出視窗中使用 OpenAI 帳號登入
4. **返回聊天頁**：完成後回到 AI Multi-Chat，點擊已登入按鈕返回 ChatGPT 首頁
5. **開始使用**：ChatGPT 重新確認 session，成功後顯示準備就緒

### Claude 登入引導

1. **檢測登入需求**：當 Claude iframe 無法確認可用 session 時，顯示登入提示
2. **開啟登入視窗**：點擊提示中的登入按鈕，開啟 `https://claude.ai/login`
3. **完成登入**：在 Claude 的官方登入頁完成登入
4. **返回聊天頁**：回到 AI Multi-Chat，點擊已登入按鈕返回 Claude 新對話頁
5. **開始使用**：Claude 重新確認 session，成功後顯示準備就緒

### Gemini 登入與就緒狀態

- 由使用者在 Gemini iframe 或 Gemini 官方頁面完成登入。
- 擴充功能會等待可用輸入框出現後再顯示「準備就緒」，最長等待 30 秒。
- 供應商端介面、登入限制或網路狀態變動時，可能仍需要重新整理或重新登入。

### 登入提示界面（Grok、ChatGPT、Claude）

當這些平台需要登入時，iframe 會顯示：
- 🔐 圖示
- **需要登入** 的平台標題
- **在新視窗或分頁中登入** 按鈕（主要操作）
- **我已完成登入** 按鈕（登入完成後返回聊天首頁）
- 💡 操作提示說明

### 狀態提示

**Grok、ChatGPT、Claude**：
- 🔐 **需要登入驗證**：無法確認可用 session 時顯示登入界面
- ✅ **準備就緒**：確認現有瀏覽器 session 可用後即可使用
- 初始載入後會檢查一次，之後每 30 秒重新檢查；網路逾時本身不會直接判定為登出

**Gemini**：
- 由使用者在 iframe 中直接完成登入
- 偵測到可用輸入框後才顯示準備就緒

## AI Platform Login Handling

Grok, ChatGPT, and Claude check whether the current browser session is usable inside the iframe and show guided login when it is not. Due to browser and provider security restrictions, the actual sign-in still happens in a new tab or window at the provider's official origin. Gemini is signed in by the user and is marked ready only after a usable composer appears.

### Supported Platforms

- **Grok**: Login-state confirmation and guided sign-in in a new tab
- **ChatGPT**: Login-state confirmation and guided sign-in in a popup window
- **Claude**: Login-state confirmation and guided sign-in in a new window
- **Gemini**: User signs in; the extension marks it ready after a usable composer is detected

### Grok Guided Login

1. **Detection**: When Grok iframe requires login, a login prompt appears
2. **Click Login**: Click "Login to Grok in New Tab" button
3. **New Tab Login**: Opens `https://accounts.x.ai/sign-in?redirect=grok-com` in new tab
4. **Complete Login**: Sign in at Grok's official login page
5. **Return to Home**: Return to AI Multi-Chat and use the signed-in button to go back to the Grok home page
6. **Start Using**: Grok confirms the session again and shows the signed-in state

### ChatGPT Guided Login

1. **Detect Login Requirement**: When the ChatGPT iframe cannot confirm a usable session, it displays a login prompt
2. **Open Login Window**: Click the prompt's login button to open `https://auth.openai.com/log-in` in a 500x700 popup window
3. **Complete Login**: Sign in with an OpenAI account in the popup window
4. **Return to Chat**: Return to AI Multi-Chat and use the signed-in button to go back to the ChatGPT home page
5. **Start Using**: ChatGPT confirms the session again and then shows Ready

### Claude Guided Login

1. **Detect Login Requirement**: When the Claude iframe cannot confirm a usable session, it displays a login prompt
2. **Open Login Window**: Click the prompt's login button to open `https://claude.ai/login`
3. **Complete Login**: Sign in at Claude's official login page
4. **Return to Chat**: Return to AI Multi-Chat and use the signed-in button to go back to Claude's new-chat page
5. **Start Using**: Claude confirms the session again and then shows Ready

### Gemini Login and Ready State

- Sign in directly in the Gemini iframe or on Gemini's official page.
- The extension waits for a usable composer before showing Ready, for up to 30 seconds.
- Provider UI changes, login restrictions, or network conditions may still require a refresh or a new login.

### Login Prompt Interface (Grok, ChatGPT, and Claude)

When these platforms need login, the iframe displays:
- 🔐 Icon
- A platform-specific **Login Required** title
- A **Sign in in a new tab or window** button (primary action)
- An **I'm signed in** button to return to the chat home page
- 💡 Operation hints

### Status Messages

**Grok, ChatGPT, and Claude**:
- 🔐 **Login Required**: Shown when a usable session cannot be confirmed
- ✅ **Ready**: Shown after the existing browser session is confirmed as usable
- The extension checks once after initial load and then every 30 seconds; a network timeout alone does not mark the user as signed out

**Gemini**:
- The user signs in directly in the iframe
- Ready is shown only after a usable composer is detected

---

## 圖標生成

擴充功能需要 3 個尺寸的圖標：

- `icons/icon16.png` - 16x16 像素
- `icons/icon48.png` - 48x48 像素
- `icons/icon128.png` - 128x128 像素

### 自動生成圖標（推薦）

使用線上工具生成：

1. 前往 https://www.favicon-generator.org/
2. 上傳您的 logo 或圖片
3. 選擇「Chrome Extension」格式
4. 下載並解壓縮到 `icons/` 資料夾

### 手動創建

```bash
# 使用 ImageMagick
convert -size 128x128 xc:#4285f4 -gravity center \
  -pointsize 60 -fill white -annotate +0+0 "AI" \
  icons/icon128.png

convert icons/icon128.png -resize 48x48 icons/icon48.png
convert icons/icon128.png -resize 16x16 icons/icon16.png
```

### 臨時占位符

如果暫時沒有圖標，可以使用任何 PNG 圖片作為占位符：

```bash
# 複製任何圖片作為臨時圖標
cp /path/to/any-image.png icons/icon128.png
cp /path/to/any-image.png icons/icon48.png
cp /path/to/any-image.png icons/icon16.png
```

## Icon Generation

Extension requires 3 icon sizes:

- `icons/icon16.png` - 16x16 pixels
- `icons/icon48.png` - 48x48 pixels
- `icons/icon128.png` - 128x128 pixels

### Auto-Generate Icons (Recommended)

Use online tools:

1. Visit https://www.favicon-generator.org/
2. Upload your logo or image
3. Select "Chrome Extension" format
4. Download and extract to `icons/` folder

### Manual Creation

```bash
# Using ImageMagick
convert -size 128x128 xc:#4285f4 -gravity center \
  -pointsize 60 -fill white -annotate +0+0 "AI" \
  icons/icon128.png

convert icons/icon128.png -resize 48x48 icons/icon48.png
convert icons/icon128.png -resize 16x16 icons/icon16.png
```

### Temporary Placeholder

If icons are temporarily unavailable, use any PNG image:

```bash
# Copy any image as temporary icon
cp /path/to/any-image.png icons/icon128.png
cp /path/to/any-image.png icons/icon48.png
cp /path/to/any-image.png icons/icon16.png
```

---

## 技術架構

### 檔案結構

```
chrome-extension/
├── manifest.json                 # Extension 配置
├── background.js                 # HTTP 標頭攔截
├── popup.html                    # 主頁面
├── popup.css                     # 樣式
├── popup.js                      # 控制邏輯
├── content-scripts/
│   ├── platforms-config.js       # 平台配置
│   ├── injection-core.js         # 核心注入邏輯
│   ├── grok-script.js           # Grok 專用腳本
│   ├── gemini-script.js         # Gemini 專用腳本
│   ├── claude-script.js         # Claude 專用腳本
│   └── chatgpt-script.js        # ChatGPT 專用腳本
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### 核心功能

**1. background.js**
- 攔截 HTTP 響應標頭
- 移除 `X-Frame-Options` 和 `Content-Security-Policy`
- 允許 iframe 載入 AI 網站

**2. content-scripts/**
- 自動注入到每個 AI 平台
- 監聽網路請求（Fetch/XHR）
- 自動填寫問題和點擊發送按鈕
- 擷取 AI 回應並解析

**3. popup.html/css/js**
- 主頁面 UI
- 4 個 iframe 佈局
- 統一輸入控制
- 消息處理和狀態更新

### 通訊流程

```
popup.js
  ↓ postMessage (AI_SUBMIT_QUESTION)
iframe (grok.com)
  ↓ content-script (grok-script.js)
injection-core.js
  ↓ 填入問題、點擊按鈕
AI 網站
  ↓ 網路請求攔截
injection-core.js
  ↓ postMessage (AI_RESPONSE_RECEIVED)
popup.js
  ↓ 更新狀態
UI 顯示
```

## Technical Architecture

### File Structure

```
chrome-extension/
├── manifest.json                 # Extension configuration
├── background.js                 # HTTP header interception
├── popup.html                    # Main page
├── popup.css                     # Styles
├── popup.js                      # Control logic
├── content-scripts/
│   ├── platforms-config.js       # Platform configuration
│   ├── injection-core.js         # Core injection logic
│   ├── grok-script.js           # Grok-specific script
│   ├── gemini-script.js         # Gemini-specific script
│   ├── claude-script.js         # Claude-specific script
│   └── chatgpt-script.js        # ChatGPT-specific script
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### Core Features

**1. background.js**
- Intercepts HTTP response headers
- Removes `X-Frame-Options` and `Content-Security-Policy`
- Allows AI websites to load in iframes

**2. content-scripts/**
- Auto-injected into each AI platform
- Monitors network requests (Fetch/XHR)
- Auto-fills questions and clicks send buttons
- Captures and parses AI responses

**3. popup.html/css/js**
- Main page UI
- 4 iframe layout
- Unified input control
- Message handling and status updates

### Communication Flow

```
popup.js
  ↓ postMessage (AI_SUBMIT_QUESTION)
iframe (grok.com)
  ↓ content-script (grok-script.js)
injection-core.js
  ↓ Fill question, click button
AI Website
  ↓ Network request interception
injection-core.js
  ↓ postMessage (AI_RESPONSE_RECEIVED)
popup.js
  ↓ Update status
UI Display
```

---

## 常見問題

### Q: iframe 顯示空白？

**A: 請確認**：
1. `background.js` 正常運行（查看 console）
2. 擴充功能有正確的權限
3. 嘗試重新載入擴充功能

### Q: 問題無法發送？

**A: 可能原因**：
1. AI 網站更新了 DOM 結構（需要更新 content-script）
2. Cloudflare 驗證中（等待驗證完成）
3. 查看 iframe 的 console 錯誤訊息

### Q: 回應無法擷取？

**A: 檢查**：
1. 網路監聽是否正常（查看 console）
2. API 端點是否改變
3. 回應格式是否更新

### Q: 如何調試？

**A**：
1. 右鍵點擊擴充圖示 → 「檢查彈出式視窗」
2. 在 popup 頁面中，右鍵點擊 iframe → 「檢查」
3. 查看 Console 的日誌訊息

## FAQ

### Q: iframe shows blank?

**A: Please check**:
1. `background.js` is running (check console)
2. Extension has correct permissions
3. Try reloading the extension

### Q: Question cannot be sent?

**A: Possible reasons**:
1. AI website updated DOM structure (need to update content-script)
2. Cloudflare verification in progress (wait for completion)
3. Check iframe console for error messages

### Q: Response cannot be captured?

**A: Check**:
1. Network monitoring is working (check console)
2. API endpoint has changed
3. Response format has been updated

### Q: How to debug?

**A**:
1. Right-click extension icon → "Inspect popup"
2. In popup page, right-click iframe → "Inspect"
3. Check Console for log messages

---

## 更新日誌

### v1.2.6 (2026-07-24)
- ✅ 改善 Grok 對話還原：若儲存的對話目前無法使用，會清除舊連結並回到 Grok 首頁。
- ✅ 改善 Grok、ChatGPT 與 Claude 的登入狀態判定，減少已登入時誤顯示登入提示的情況。
- ✅ 將上述平台的登入檢查調整為初始檢查後每 30 秒執行，降低不必要的頁面活動。
- ✅ Gemini 只會在可用輸入框出現後顯示「準備就緒」。
- ✅ 未新增擴充功能權限；版本由 1.2.5 升至 1.2.6。

### v1.0.0 (2025-12-19)
- ✅ 初始版本
- ✅ 支援 4 個 AI 平台
- ✅ 統一輸入和發送
- ✅ 即時狀態更新
- ✅ 自動繞過 iframe 限制

## Changelog

### v1.2.6 (2026-07-24)
- ✅ Improved Grok conversation restoration: unavailable saved conversations are cleared and fall back to the Grok home page.
- ✅ Improved login-state handling for Grok, ChatGPT, and Claude to reduce false login-required prompts.
- ✅ Login-state checks now run on initialization and every 30 seconds, reducing unnecessary page activity.
- ✅ Gemini reports Ready only after a usable composer is available.
- ✅ No new extension permissions; version bumped from 1.2.5 to 1.2.6.

### v1.0.0 (2025-12-19)
- ✅ Initial release
- ✅ Support for 4 AI platforms
- ✅ Unified input and sending
- ✅ Real-time status updates
- ✅ Automatic iframe restriction bypass

---

## 授權

MIT License

## License

MIT License

---

## 貢獻

歡迎提交 Issue 和 Pull Request！

## Contributing

Issues and Pull Requests are welcome!

---

## 支援

如有問題，請查看：
1. Console 錯誤訊息
2. 本 README 的常見問題
3. 提交 GitHub Issue

## Support

If you have questions:
1. Check Console error messages
2. Review FAQ in this README
3. Submit a GitHub Issue
