# LiveHub — 多路直播展示原型

[![Refresh Streams](https://github.com/rock903400-byte/livehub-demo/actions/workflows/refresh-streams.yml/badge.svg)](https://github.com/rock903400-byte/livehub-demo/actions/workflows/refresh-streams.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

同時播放多路 YouTube 直播的網頁原型，提案／客戶展示用。單一自足 HTML 檔，無建置流程、無外部函式庫。

## 線上版本

https://rock903400-byte.github.io/livehub-demo/

| 頁面 | 版面 |
|---|---|
| [`index.html`](index.html) | **產品說明頁** — 對外行銷落地頁，站台首頁。使用情境、核心能力、導入方式與適用邊界 |
| [`demo.html`](demo.html) | **Demo 導覽頁** — 兩種版面的入口 |
| [`live-wall-xhs.html`](live-wall-xhs.html) | **直播廣場** — 小紅書風格。淺色卡片瀑布流、分類分頁與搜尋，點卡片展開大畫面 |
| [`live-wall.html`](live-wall.html) | **多路直播牆** — 深色監看牆。2×2 / 3×3 / 4×4 切換、單格全螢幕、拖曳排序 |

## 功能

- 多路 YouTube 直播同時播放
- **音訊獨佔**：同一時間只有一路有聲音，點喇叭切換
- 貼上網址即可新增／移除直播，設定存在瀏覽器 localStorage
- 匯出／匯入 JSON，設定可搬到其他電腦
- 自動偵測嵌入被封鎖（錯誤碼 101／150）並顯示原因
- 直播廣場版本：捲出畫面的卡片自動暫停，避免同時跑太多播放器
- **預設清單自動更新**：排程定期重新解析各頻道目前的直播 ID，見下節

## 預設清單自動更新

直播影片 ID 每換一場就會變，寫死的清單會逐漸失效。因此：

- [`scripts/refresh-streams.mjs`](scripts/refresh-streams.mjs) 查詢各頻道目前的直播 ID，寫進 [`streams.json`](streams.json)。零依賴，用 Node 內建 `fetch`。
- [`.github/workflows/refresh-streams.yml`](.github/workflows/refresh-streams.yml) 每 6 小時跑一次，有變動才 commit，並主動觸發 Pages 重建。也可在 Actions 頁面手動觸發。
- 兩個 Demo 頁在**首次繪製之後**才非同步抓 `streams.json` 套用，所以第一畫面不會被網路拖慢；抓不到就沿用檔案裡寫死的離線清單。
- **使用者自己新增／移除／拖曳過清單後就不再被覆蓋**（localStorage 的 `*.touched` 標記）。沒動過的展示機才會持續收到更新。

要增減頻道，改 `scripts/refresh-streams.mjs` 裡的 `SOURCES` 即可，那是頻道清單與中繼資料的唯一來源（含 `channelId`，可從該頻道任一頁面的 HTML 取得）。

### 設定 API 金鑰（排程必需）

排程需要 repository secret `YT_API_KEY`：

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立專案
2. 啟用 **YouTube Data API v3**
3. 建立 API 金鑰（建議限制只能呼叫 YouTube Data API v3）
4. 到 repo 的 **Settings → Secrets and variables → Actions → New repository secret**，名稱填 `YT_API_KEY`

沒設定的話 workflow 會直接失敗並說明原因，不會寫入錯誤資料。

### 配額

免費額度一天 10,000 單位，本腳本的用法遠低於此：

| 情況 | 呼叫 | 配額 |
|---|---|---|
| 九路都還在播（常態） | `videos.list` 批次一次 | **1** |
| 一路換場次 | 再加一次 `search.list` | 101 |
| 九路全換（最壞） | 九次 `search.list` | 901 |

`videos.list` 一次可查 50 支影片而且整批只算 1 單位，所以常態下每 6 小時一輪只花 1 單位，一天 4 單位。

### 手動執行

```bash
# 走官方 API（與排程相同行為）
YT_API_KEY=你的金鑰 node scripts/refresh-streams.mjs

# 沒有金鑰時退回網頁解析
node scripts/refresh-streams.mjs
```

網頁解析**只適合在一般網路環境的本機執行**。從資料中心 IP（例如 GitHub Actions runner）執行時，YouTube 回的頁面 canonical 會指向推薦區塊裡不相干的影片 —— 實測 9 路有 8 路解析錯誤，且 NBC News 與 TRT World 會被解析成同一支節目。腳本會用 oEmbed 的 `author_name` 驗證影片歸屬並擋下這類結果。

查詢失敗時一律沿用 `streams.json` 裡的舊 ID 並標記 `stale: true`；若九路全數失敗則完全不寫檔並以非零碼結束，不會用空值或別人的影片覆蓋還能播的那一路。

## 本機執行

**不能直接雙擊 HTML 檔。** `file://` 不會送出 Referer，YouTube 的嵌入播放器一律回錯誤碼 153 拒絕播放。

請改用：

```
啟動直播廣場.cmd
```

會起一個本機伺服器（需要 Python）並自動開啟瀏覽器。或自行執行：

```bash
python -m http.server 8777
```

線上版本走 https，沒有這個問題。

## 已知限制

1. **小紅書、抖音的直播無法嵌入。** 播放網址是簽章 token 加 Referer 鎖定，沒有公開的嵌入方式。內容來源只能是 YouTube。
2. **頻道網址（`/@帳號`、`/channel/UC…`）不能用。** YouTube 已不支援「自動播出該頻道目前直播」的嵌入方式，需要每一場直播各自的 `watch?v=` 網址。
3. **預設清單的影片 ID 會失效**，但已由排程透過 YouTube Data API 自動更新（見上節），一般情況不需要人工介入。仍會漏接的情況：排程間隔內（最長 6 小時）剛好換場次。此時該路會顯示錯誤與換法，手動貼上新網址即可。需先設定 `YT_API_KEY` secret，否則排程不會執行。
4. **觀看數與讚數是示意數字**，依影片 ID 產生的固定假資料，非真實數據。
5. **直播廣場的直式卡片會裁掉畫面左右兩側**（16:9 塞進 3:4）。點進大畫面看的是未裁切的完整畫面。
6. 品牌名稱為中性佔位，非任何實際企業。

## 授權

MIT
