# GitHub Markdown WYSIWYG Editor (Edge / Chromium)

## v0.4.0 Improvements
- Adds a dedicated `WYSIWYG` tab beside GitHub `Write` / `Preview`
- Keeps GitHub layout intact by hiding the source textarea off-screen instead of collapsing containers
- Better table editing with add/remove row and column actions
- Supports task lists with clickable checkboxes
- Paste tab-separated data to create a Markdown table
- Keyboard shortcuts for bold / italic and tab navigation between table cells
- Syncs changes back into GitHub original textarea on every edit

## Supported Markdown (best effort)
- headings
- paragraphs
- bold / italic / inline code
- bullet / numbered lists
- task lists
- blockquotes
- fenced code blocks
- links
- markdown tables
- horizontal rules

## Install
1. Open `edge://extensions`
2. Enable Developer mode
3. Load unpacked
4. Select this folder


## v0.5.3
- 保留 GitHub 原生 Write/Preview 模式
- 新增 WYSIWYG 工具列中的「Markdown 原始碼」按鈕
- Alt+Shift+M 可快速切回原始 Markdown 編輯器
- 預覽分頁不會把偏好模式卡在 WYSIWYG
