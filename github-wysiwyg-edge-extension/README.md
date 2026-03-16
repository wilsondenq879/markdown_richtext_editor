# GitHub WYSIWYG + Wide View (Edge / Chromium)

這個 Edge extension 會在 GitHub 上幫你做兩件事：

1. 在 GitHub 的 Markdown 編輯區提供 **Markdown / WYSIWYG** 切換。
2. 在畫面右下角提供 **寬版閱讀：開/關** 按鈕。

## 目前涵蓋的場景

- 新增 Issue 的編輯視窗
- Project 內 Issue 側邊窗中的內文與 comment 編輯區
- 一般 Issue / comment 的 Markdown textarea
- repo 內 Markdown 檔案的 web edit 模式（偵測 `.md` / `.markdown` / `.mdx`）
- 動態載入的 comment editor / dialog / side panel

## 功能

- Markdown / WYSIWYG 可互相切換
- WYSIWYG 模式支援：
  - 粗體、斜體、刪除線
  - 行內程式碼、程式碼區塊
  - 連結
  - 表格插入
  - 表格欄列調整（+Col / -Col / +Row / -Row）
  - 清單、Task List、引用
  - H1 / H2 / H3
  - 分隔線
- 右下角固定顯示精簡版「寬版：開 / 關」按鈕，版本號保留在滑鼠提示中
- 透過 `MutationObserver` 自動處理 GitHub 動態載入編輯器
- 透過 `chrome.storage.sync` 記住寬版閱讀狀態

## 截圖


## 安裝方式（Edge）

1. 打開 `edge://extensions`
2. 開啟右上角 **開發人員模式**
3. 點 **載入解壓縮**
4. 選擇這個資料夾 `github-wysiwyg-edge-extension`

## 封裝成 zip 後安裝

如果你要保留一份壓縮包，也可以直接載入解壓後的 zip 內容。

## 注意

這是針對 GitHub 前端介面做的內容腳本增強版。GitHub 未來如果更改編輯器 DOM 結構、改用不同型態的編輯元件，可能需要微調 selector 或轉換邏輯。

目前這版偏向實用型 v1，已盡量覆蓋你指定的幾種 GitHub 編輯場景。
