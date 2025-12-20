# AI Multi-Chat Assistant

Chrome Extension 擴充功能,可同時與 4 個 AI 平台聊天:Grok、Gemini、Claude、ChatGPT。

A Chrome Extension that enables simultaneous chatting with 4 AI platforms: Grok, Gemini, Claude, and ChatGPT.

---

## 功能特點 | Features

- ✅ **4 個 AI 同時顯示**:Grok、Gemini、Claude、ChatGPT 並排顯示
- ✅ **統一輸入框**:一次輸入,一鍵發送到所有 AI
- ✅ **即時狀態更新**:每個 AI 的狀態一目了然
- ✅ **自動繞過限制**:自動移除 X-Frame-Options,允許 iframe 載入
- ✅ **重用現有邏輯**:90% 程式碼來自 React Native App
- ✅ **快捷鍵**:Ctrl+Enter 快速發送問題

- ✅ **4 AIs Displayed Simultaneously**: Grok, Gemini, Claude, ChatGPT side by side
- ✅ **Unified Input Box**: Type once, send to all AIs with one click
- ✅ **Real-time Status Updates**: Each AI's status at a glance
- ✅ **Automatic Bypass**: Automatically removes X-Frame-Options to allow iframe loading
- ✅ **Code Reuse**: 90% of code from React Native App
- ✅ **Keyboard Shortcut**: Ctrl+Enter to quickly send questions

---

## 安裝方式 | Installation

### 方法 1:開發者模式載入(推薦) | Method 1: Developer Mode (Recommended)

1. 打開 Chrome 瀏覽器
2. 進入 `chrome://extensions/`
3. 啟用右上角的「開發者模式」
4. 點擊「載入未封裝項目」
5. 選擇此資料夾
6. 完成!擴充功能已安裝

1. Open Chrome browser
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked"
5. Select this folder
6. Done! Extension installed

### 方法 2:打包成 .crx 檔案 | Method 2: Pack as .crx File

```bash
# 在 chrome://extensions/ 點擊「封裝擴充功能」
# 選擇 chrome-extension 資料夾
# 生成 .crx 檔案

# In chrome://extensions/, click "Pack extension"
# Select chrome-extension folder
# Generate .crx file
```

---

## 使用方法 | Usage

1. 點擊瀏覽器工具列的擴充圖示
2. 會開啟一個頁面,顯示 4 個 AI iframe
3. 在頂部輸入框輸入問題
4. 點擊「發送到所有 AI」或按 `Ctrl+Enter`
5. 觀看 4 個 AI 同時回應

1. Click the extension icon in the browser toolbar
2. A page will open showing 4 AI iframes
3. Enter your question in the top input box
4. Click "Send to All AIs" or press `Ctrl+Enter`
5. Watch all 4 AIs respond simultaneously

---

## 狀態指示器 | Status Indicators

每個 AI 的右上角會顯示狀態:

Each AI displays status in the top right corner:

- ⏳ **載入中** | **Loading**:iframe 正在載入 | iframe is loading
- ✅ **準備就緒** | **Ready**:AI 已準備好接收問題 | AI is ready to receive questions
- 🔄 **處理中** | **Processing**:正在發送問題或等待回應 | Sending question or waiting for response
- 🔐 **需要登入** | **Login Required**:需要完成 OAuth 驗證(見下方說明) | OAuth authentication needed (see below)
- ❌ **錯誤** | **Error**:發生錯誤(點擊查看詳情) | An error occurred (click for details)

---

## AI 平台登入處理 | AI Platform Login Handling

部分 AI 平台(如 Grok、ChatGPT)使用 OAuth 進行登入。由於安全限制,OAuth 流程不能在 iframe 中完成。本擴充功能針對不同平台提供不同的登入處理方式。

Some AI platforms (like Grok, ChatGPT) use OAuth for login. Due to security restrictions, OAuth flows cannot complete within iframes. This extension provides different login handling for different platforms.

### 支援的平台 | Supported Platforms

- **Grok**:使用 Google OAuth (`accounts.x.ai`) - 手動引導登入 | Uses Google OAuth (`accounts.x.ai`) - Manual guided login
- **ChatGPT**:使用 OpenAI Auth (`auth.openai.com`) - 自動開啟登入視窗 | Uses OpenAI Auth (`auth.openai.com`) - Automatic popup window
- **Gemini**:由使用者自行處理登入 | User handles login directly
- **Claude**:由使用者自行處理登入 | User handles login directly

### Grok 手動登入 | Grok Manual Login

1. **檢測登入需求**:當 Grok iframe 需要登入時,會顯示登入提示
2. **點擊登入按鈕**:點擊「在新分頁中登入 Grok」按鈕
3. **新分頁登入**:在新分頁中開啟 `https://accounts.x.ai/sign-in?redirect=grok-com`
4. **完成登入**:使用 Google 帳號完成登入
5. **重新載入**:回到 AI Multi-Chat,點擊「我已完成登入,重新載入」按鈕
6. **開始使用**:Grok iframe 重新載入並顯示已登入狀態

1. **Detection**: When Grok iframe requires login, a login prompt appears
2. **Click Login**: Click "Login to Grok in New Tab" button
3. **New Tab Login**: Opens `https://accounts.x.ai/sign-in?redirect=grok-com` in new tab
4. **Complete Login**: Sign in with Google account
5. **Reload**: Return to AI Multi-Chat and click "Login Complete, Reload" button
6. **Start Using**: Grok iframe reloads showing logged-in state

### ChatGPT 自動登入 | ChatGPT Automatic Login

1. **自動檢測**:當 ChatGPT iframe 需要登入時自動檢測
2. **自動開啟視窗**:自動開啟小視窗(500x700)到 `https://auth.openai.com/log-in`
3. **完成登入**:在彈出視窗中使用 OpenAI 帳號登入
4. **關閉視窗**:登入完成後關閉視窗
5. **自動重載**:ChatGPT iframe 自動重新載入(延遲 2 秒)
6. **開始使用**:直接開始使用,無需手動操作

1. **Auto-Detection**: Automatically detects when ChatGPT iframe needs login
2. **Auto-Open Window**: Automatically opens popup window (500x700) to `https://auth.openai.com/log-in`
3. **Complete Login**: Sign in with OpenAI account in popup window
4. **Close Window**: Close window after login completes
5. **Auto-Reload**: ChatGPT iframe automatically reloads (2 second delay)
6. **Start Using**: Ready to use immediately, no manual action needed

**特色** | **Features**:
- ✨ 完全自動化,無需點擊按鈕 | Fully automated, no button clicks needed
- 🪟 小視窗彈出,不會打擾主視窗 | Small popup window, doesn't disturb main window
- 🔄 關閉登入視窗後自動重載 | Auto-reload after closing login window
- ⚡ 快速便捷的登入體驗 | Fast and convenient login experience

### 登入提示界面(僅 Grok) | Login Prompt Interface (Grok Only)

當 Grok 需要登入時,iframe 會顯示:

When Grok needs login, iframe displays:

- 🔐 圖示 | Icon
- **Grok 需要登入** 標題 | **Grok Login Required** title
- **在新分頁中登入 Grok** 按鈕(主要操作) | **Login to Grok in New Tab** button (primary action)
- **我已完成登入,重新載入** 按鈕(登入完成後使用) | **Login Complete, Reload** button (after login)
- 💡 操作提示說明 | Operation hints
- 紫色漸層主題 (#667eea → #764ba2) | Purple gradient theme (#667eea → #764ba2)

### 狀態提示 | Status Messages

**Grok**:
- 🔐 **需要登入驗證** | **Login Required**:檢測到需要登入,顯示登入界面 | Detected login needed, showing login interface
- 🔐 **請在新分頁中完成登入** | **Please Complete Login in New Tab**:已開啟登入分頁 | Login tab opened
- 🔄 **重新載入中...** | **Reloading...**:正在重新載入 Grok | Reloading Grok
- ✅ **準備就緒** | **Ready**:登入完成,可以使用 | Login complete, ready to use

**ChatGPT**:
- 🔐 **需要登入驗證** | **Login Required**:檢測到需要登入,自動開啟視窗 | Detected login needed, auto-opening window
- 🔐 **登入視窗已開啟** | **Login Window Opened**:登入視窗已彈出 | Login window popped up
- 🔄 **重新載入中...** | **Reloading...**:登入視窗關閉後自動重載 | Auto-reload after login window closed
- ✅ **準備就緒** | **Ready**:自動完成,可以使用 | Auto-completed, ready to use

**其他平台(Gemini、Claude)** | **Other Platforms (Gemini, Claude)**:
- 由使用者在 iframe 中直接完成登入 | User handles login directly in iframe
- 無自動登入檢測或引導 | No automatic login detection or guidance
- 登入後即可正常使用 | Ready to use after login

---

## 圖標生成 | Icon Generation

擴充功能需要 3 個尺寸的圖標:

Extension requires 3 icon sizes:

- `icons/icon16.png` - 16x16 像素 | pixels
- `icons/icon48.png` - 48x48 像素 | pixels
- `icons/icon128.png` - 128x128 像素 | pixels

### 自動生成圖標(推薦) | Auto-Generate Icons (Recommended)

使用線上工具生成:

Use online tools:

1. 前往 https://www.favicon-generator.org/ | Visit https://www.favicon-generator.org/
2. 上傳您的 logo 或圖片 | Upload your logo or image
3. 選擇「Chrome Extension」格式 | Select "Chrome Extension" format
4. 下載並解壓縮到 `icons/` 資料夾 | Download and extract to `icons/` folder

### 手動創建 | Manual Creation

```bash
# 使用 ImageMagick | Using ImageMagick
convert -size 128x128 xc:#4285f4 -gravity center \
  -pointsize 60 -fill white -annotate +0+0 "AI" \
  icons/icon128.png

convert icons/icon128.png -resize 48x48 icons/icon48.png
convert icons/icon128.png -resize 16x16 icons/icon16.png
```

### 臨時占位符 | Temporary Placeholder

如果暫時沒有圖標,可以使用任何 PNG 圖片作為占位符:

If icons are temporarily unavailable, use any PNG image:

```bash
# 複製任何圖片作為臨時圖標 | Copy any image as temporary icon
cp /path/to/any-image.png icons/icon128.png
cp /path/to/any-image.png icons/icon48.png
cp /path/to/any-image.png icons/icon16.png
```

---

## 技術架構 | Technical Architecture

### 檔案結構 | File Structure

```
chrome-extension/
├── manifest.json                 # Extension 配置 | Extension configuration
├── background.js                 # HTTP 標頭攔截 | HTTP header interception
├── popup.html                    # 主頁面 | Main page
├── popup.css                     # 樣式 | Styles
├── popup.js                      # 控制邏輯 | Control logic
├── content-scripts/
│   ├── platforms-config.js       # 平台配置 | Platform configuration
│   ├── injection-core.js         # 核心注入邏輯 | Core injection logic
│   ├── grok-script.js           # Grok 專用腳本 | Grok-specific script
│   ├── gemini-script.js         # Gemini 專用腳本 | Gemini-specific script
│   ├── claude-script.js         # Claude 專用腳本 | Claude-specific script
│   └── chatgpt-script.js        # ChatGPT 專用腳本 | ChatGPT-specific script
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### 核心功能 | Core Features

**1. background.js**
- 攔截 HTTP 響應標頭 | Intercepts HTTP response headers
- 移除 `X-Frame-Options` 和 `Content-Security-Policy` | Removes `X-Frame-Options` and `Content-Security-Policy`
- 允許 iframe 載入 AI 網站 | Allows AI websites to load in iframes

**2. content-scripts/**
- 自動注入到每個 AI 平台 | Auto-injected into each AI platform
- 監聽網路請求(Fetch/XHR) | Monitors network requests (Fetch/XHR)
- 自動填寫問題和點擊發送按鈕 | Auto-fills questions and clicks send buttons
- 擷取 AI 回應並解析 | Captures and parses AI responses

**3. popup.html/css/js**
- 主頁面 UI | Main page UI
- 4 個 iframe 佈局 | 4 iframe layout
- 統一輸入控制 | Unified input control
- 消息處理和狀態更新 | Message handling and status updates

### 通訊流程 | Communication Flow

```
popup.js
  ↓ postMessage (AI_SUBMIT_QUESTION)
iframe (grok.com)
  ↓ content-script (grok-script.js)
injection-core.js
  ↓ 填入問題、點擊按鈕 | Fill question, click button
AI 網站 | AI Website
  ↓ 網路請求攔截 | Network request interception
injection-core.js
  ↓ postMessage (AI_RESPONSE_RECEIVED)
popup.js
  ↓ 更新狀態 | Update status
UI 顯示 | UI Display
```

---

## 常見問題 | FAQ

### Q: iframe 顯示空白? | Q: iframe shows blank?

**A: 請確認** | **A: Please check**:
1. `background.js` 正常運行(查看 console) | `background.js` is running (check console)
2. 擴充功能有正確的權限 | Extension has correct permissions
3. 嘗試重新載入擴充功能 | Try reloading the extension

### Q: 問題無法發送? | Q: Question cannot be sent?

**A: 可能原因** | **A: Possible reasons**:
1. AI 網站更新了 DOM 結構(需要更新 content-script) | AI website updated DOM structure (need to update content-script)
2. Cloudflare 驗證中(等待驗證完成) | Cloudflare verification in progress (wait for completion)
3. 查看 iframe 的 console 錯誤訊息 | Check iframe console for error messages

### Q: 回應無法擷取? | Q: Response cannot be captured?

**A: 檢查** | **A: Check**:
1. 網路監聽是否正常(查看 console) | Network monitoring is working (check console)
2. API 端點是否改變 | API endpoint has changed
3. 回應格式是否更新 | Response format has been updated

### Q: 如何調試? | Q: How to debug?

**A**:
1. 右鍵點擊擴充圖示 → 「檢查彈出式視窗」 | Right-click extension icon → "Inspect popup"
2. 在 popup 頁面中,右鍵點擊 iframe → 「檢查」 | In popup page, right-click iframe → "Inspect"
3. 查看 Console 的日誌訊息 | Check Console for log messages

---

## 更新日誌 | Changelog

### v1.0.0 (2025-12-19)
- ✅ 初始版本 | Initial release
- ✅ 支援 4 個 AI 平台 | Support for 4 AI platforms
- ✅ 統一輸入和發送 | Unified input and sending
- ✅ 即時狀態更新 | Real-time status updates
- ✅ 自動繞過 iframe 限制 | Automatic iframe restriction bypass

---

## 授權 | License

MIT License

---

## 貢獻 | Contributing

歡迎提交 Issue 和 Pull Request!

Issues and Pull Requests are welcome!

---

## 支援 | Support

如有問題,請查看:

If you have questions:

1. Console 錯誤訊息 | Check Console error messages
2. 本 README 的常見問題 | Review FAQ in this README
3. 提交 GitHub Issue | Submit a GitHub Issue
