# AI Multi-Chat Assistant

Chrome Extension 擴充功能，可同時與 4 個 AI 平台聊天：Grok、Gemini、Claude、ChatGPT。

## 功能特點

- ✅ **4 個 AI 同時顯示**：Grok、Gemini、Claude、ChatGPT 並排顯示
- ✅ **統一輸入框**：一次輸入，一鍵發送到所有 AI
- ✅ **即時狀態更新**：每個 AI 的狀態一目了然
- ✅ **自動繞過限制**：自動移除 X-Frame-Options，允許 iframe 載入
- ✅ **重用現有邏輯**：90% 程式碼來自 React Native App
- ✅ **快捷鍵**：Ctrl+Enter 快速發送問題

## 安裝方式

### 方法 1：開發者模式載入（推薦）

1. 打開 Chrome 瀏覽器
2. 進入 `chrome://extensions/`
3. 啟用右上角的「開發者模式」
4. 點擊「載入未封裝項目」
5. 選擇此資料夾
6. 完成！擴充功能已安裝

### 方法 2：打包成 .crx 檔案

```bash
# 在 chrome://extensions/ 點擊「封裝擴充功能」
# 選擇 chrome-extension 資料夾
# 生成 .crx 檔案
```

## 使用方法

1. 點擊瀏覽器工具列的擴充圖示
2. 會開啟一個頁面，顯示 4 個 AI iframe
3. 在頂部輸入框輸入問題
4. 點擊「發送到所有 AI」或按 `Ctrl+Enter`
5. 觀看 4 個 AI 同時回應

## 狀態指示器

每個 AI 的右上角會顯示狀態：

- ⏳ **載入中**：iframe 正在載入
- ✅ **準備就緒**：AI 已準備好接收問題
- 🔄 **處理中**：正在發送問題或等待回應
- 🔐 **需要登入**：需要完成 OAuth 驗證（見下方說明）
- ❌ **錯誤**：發生錯誤（點擊查看詳情）

## AI 平台登入處理

部分 AI 平台（如 Grok、ChatGPT）使用 OAuth 進行登入。由於安全限制，OAuth 流程不能在 iframe 中完成。本擴充功能針對不同平台提供不同的登入處理方式。

### 支援的平台

- **Grok**：使用 Google OAuth (`accounts.x.ai`) - 手動引導登入
- **ChatGPT**：使用 OpenAI Auth (`auth.openai.com`) - 自動開啟登入視窗
- **Gemini**：由使用者自行處理登入
- **Claude**：由使用者自行處理登入

### Grok 手動登入

1. **檢測登入需求**：當 Grok iframe 需要登入時，會顯示登入提示
2. **點擊登入按鈕**：點擊「在新分頁中登入 Grok」按鈕
3. **新分頁登入**：在新分頁中開啟 `https://accounts.x.ai/sign-in?redirect=grok-com`
4. **完成登入**：使用 Google 帳號完成登入
5. **重新載入**：回到 AI Multi-Chat，點擊「我已完成登入，重新載入」按鈕
6. **開始使用**：Grok iframe 重新載入並顯示已登入狀態

### ChatGPT 自動登入

1. **自動檢測**：當 ChatGPT iframe 需要登入時自動檢測
2. **自動開啟視窗**：自動開啟小視窗（500x700）到 `https://auth.openai.com/log-in`
3. **完成登入**：在彈出視窗中使用 OpenAI 帳號登入
4. **關閉視窗**：登入完成後關閉視窗
5. **自動重載**：ChatGPT iframe 自動重新載入（延遲 2 秒）
6. **開始使用**：直接開始使用，無需手動操作

**特色**：
- ✨ 完全自動化，無需點擊按鈕
- 🪟 小視窗彈出，不會打擾主視窗
- 🔄 關閉登入視窗後自動重載
- ⚡ 快速便捷的登入體驗

### 登入提示界面（僅 Grok）

當 Grok 需要登入時，iframe 會顯示：
- 🔐 圖示
- **Grok 需要登入** 標題
- **在新分頁中登入 Grok** 按鈕（主要操作）
- **我已完成登入，重新載入** 按鈕（登入完成後使用）
- 💡 操作提示說明
- 紫色漸層主題 (#667eea → #764ba2)

### 狀態提示

**Grok**：
- 🔐 **需要登入驗證**：檢測到需要登入，顯示登入界面
- 🔐 **請在新分頁中完成登入**：已開啟登入分頁
- 🔄 **重新載入中...**：正在重新載入 Grok
- ✅ **準備就緒**：登入完成，可以使用

**ChatGPT**：
- 🔐 **需要登入驗證**：檢測到需要登入，自動開啟視窗
- 🔐 **登入視窗已開啟**：登入視窗已彈出
- 🔄 **重新載入中...**：登入視窗關閉後自動重載
- ✅ **準備就緒**：自動完成，可以使用

**其他平台（Gemini、Claude）**：
- 由使用者在 iframe 中直接完成登入
- 無自動登入檢測或引導
- 登入後即可正常使用

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

1. **background.js**
   - 攔截 HTTP 響應標頭
   - 移除 `X-Frame-Options` 和 `Content-Security-Policy`
   - 允許 iframe 載入 AI 網站

2. **content-scripts/**
   - 自動注入到每個 AI 平台
   - 監聽網路請求（Fetch/XHR）
   - 自動填寫問題和點擊發送按鈕
   - 擷取 AI 回應並解析

3. **popup.html/css/js**
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

## 常見問題

### Q: iframe 顯示空白？
A: 請確認：
1. `background.js` 正常運行（查看 console）
2. 擴充功能有正確的權限
3. 嘗試重新載入擴充功能

### Q: 問題無法發送？
A: 可能原因：
1. AI 網站更新了 DOM 結構（需要更新 content-script）
2. Cloudflare 驗證中（等待驗證完成）
3. 查看 iframe 的 console 錯誤訊息

### Q: 回應無法擷取？
A: 檢查：
1. 網路監聽是否正常（查看 console）
2. API 端點是否改變
3. 回應格式是否更新

### Q: 如何調試？
A:
1. 右鍵點擊擴充圖示 → 「檢查彈出式視窗」
2. 在 popup 頁面中，右鍵點擊 iframe → 「檢查」
3. 查看 Console 的日誌訊息

## 更新日誌

### v1.0.0 (2025-12-19)
- ✅ 初始版本
- ✅ 支援 4 個 AI 平台
- ✅ 統一輸入和發送
- ✅ 即時狀態更新
- ✅ 自動繞過 iframe 限制

## 授權

MIT License

## 貢獻

歡迎提交 Issue 和 Pull Request！

## 支援

如有問題，請查看：
1. Console 錯誤訊息
2. 本 README 的常見問題
3. 提交 GitHub Issue

---

# AI Multi-Chat Assistant (English)

A Chrome Extension that enables simultaneous chatting with 4 AI platforms: Grok, Gemini, Claude, and ChatGPT.

## Features

- ✅ **4 AIs Displayed Simultaneously**: Grok, Gemini, Claude, ChatGPT side by side
- ✅ **Unified Input Box**: Type once, send to all AIs with one click
- ✅ **Real-time Status Updates**: Each AI's status at a glance
- ✅ **Automatic Bypass**: Automatically removes X-Frame-Options to allow iframe loading
- ✅ **Code Reuse**: 90% of code from React Native App
- ✅ **Keyboard Shortcut**: Ctrl+Enter to quickly send questions

## Installation

### Method 1: Developer Mode (Recommended)

1. Open Chrome browser
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked"
5. Select this folder
6. Done! Extension installed

### Method 2: Pack as .crx File

```bash
# In chrome://extensions/, click "Pack extension"
# Select chrome-extension folder
# Generate .crx file
```

## Usage

1. Click the extension icon in the browser toolbar
2. A page will open showing 4 AI iframes
3. Enter your question in the top input box
4. Click "Send to All AIs" or press `Ctrl+Enter`
5. Watch all 4 AIs respond simultaneously

## Status Indicators

Each AI displays status in the top right corner:

- ⏳ **Loading**: iframe is loading
- ✅ **Ready**: AI is ready to receive questions
- 🔄 **Processing**: Sending question or waiting for response
- 🔐 **Login Required**: OAuth authentication needed (see below)
- ❌ **Error**: An error occurred (click for details)

## AI Platform Login Handling

Some AI platforms (like Grok, ChatGPT) use OAuth for login. Due to security restrictions, OAuth flows cannot complete within iframes. This extension provides different login handling for different platforms.

### Supported Platforms

- **Grok**: Uses Google OAuth (`accounts.x.ai`) - Manual guided login
- **ChatGPT**: Uses OpenAI Auth (`auth.openai.com`) - Automatic popup window
- **Gemini**: User handles login directly
- **Claude**: User handles login directly

### Grok Manual Login

1. **Detection**: When Grok iframe requires login, a login prompt appears
2. **Click Login**: Click "Login to Grok in New Tab" button
3. **New Tab Login**: Opens `https://accounts.x.ai/sign-in?redirect=grok-com` in new tab
4. **Complete Login**: Sign in with Google account
5. **Reload**: Return to AI Multi-Chat and click "Login Complete, Reload" button
6. **Start Using**: Grok iframe reloads showing logged-in state

### ChatGPT Automatic Login

1. **Auto-Detection**: Automatically detects when ChatGPT iframe needs login
2. **Auto-Open Window**: Automatically opens popup window (500x700) to `https://auth.openai.com/log-in`
3. **Complete Login**: Sign in with OpenAI account in popup window
4. **Close Window**: Close window after login completes
5. **Auto-Reload**: ChatGPT iframe automatically reloads (2 second delay)
6. **Start Using**: Ready to use immediately, no manual action needed

**Features**:
- ✨ Fully automated, no button clicks needed
- 🪟 Small popup window, doesn't disturb main window
- 🔄 Auto-reload after closing login window
- ⚡ Fast and convenient login experience

### Login Prompt Interface (Grok Only)

When Grok needs login, iframe displays:
- 🔐 Icon
- **Grok Login Required** title
- **Login to Grok in New Tab** button (primary action)
- **Login Complete, Reload** button (after login)
- 💡 Operation hints
- Purple gradient theme (#667eea → #764ba2)

### Status Indicators

**Grok**:
- 🔐 **Login Required**: Detected login needed, showing login interface
- 🔐 **Please Complete Login in New Tab**: Login tab opened
- 🔄 **Reloading...**: Reloading Grok
- ✅ **Ready**: Login complete, ready to use

**ChatGPT**:
- 🔐 **Login Required**: Detected login needed, auto-opening window
- 🔐 **Login Window Opened**: Login window popped up
- 🔄 **Reloading...**: Auto-reload after login window closed
- ✅ **Ready**: Auto-completed, ready to use

**Other Platforms (Gemini, Claude)**:
- User handles login directly in iframe
- No automatic login detection or guidance
- Ready to use after login

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

1. **background.js**
   - Intercepts HTTP response headers
   - Removes `X-Frame-Options` and `Content-Security-Policy`
   - Allows AI websites to load in iframes

2. **content-scripts/**
   - Auto-injected into each AI platform
   - Monitors network requests (Fetch/XHR)
   - Auto-fills questions and clicks send buttons
   - Captures and parses AI responses

3. **popup.html/css/js**
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

## FAQ

### Q: iframe shows blank?
A: Please check:
1. `background.js` is running (check console)
2. Extension has correct permissions
3. Try reloading the extension

### Q: Question cannot be sent?
A: Possible reasons:
1. AI website updated DOM structure (need to update content-script)
2. Cloudflare verification in progress (wait for completion)
3. Check iframe console for error messages

### Q: Response cannot be captured?
A: Check:
1. Network monitoring is working (check console)
2. API endpoint has changed
3. Response format has been updated

### Q: How to debug?
A:
1. Right-click extension icon → "Inspect popup"
2. In popup page, right-click iframe → "Inspect"
3. Check Console for log messages

## Changelog

### v1.0.0 (2025-12-19)
- ✅ Initial release
- ✅ Support for 4 AI platforms
- ✅ Unified input and sending
- ✅ Real-time status updates
- ✅ Automatic iframe restriction bypass

## License

MIT License

## Contributing

Issues and Pull Requests are welcome!

## Support

If you have questions:
1. Check Console error messages
2. Review FAQ in this README
3. Submit a GitHub Issue
