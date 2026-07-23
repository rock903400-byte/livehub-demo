# LiveHub — 多路直播展示原型

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

- [`scripts/refresh-streams.mjs`](scripts/refresh-streams.mjs) 讀每個頻道的 `youtube.com/@帳號/live`，從 canonical 網址取出目前的直播 ID，寫進 [`streams.json`](streams.json)。零依賴，用 Node 內建 `fetch`。
- [`.github/workflows/refresh-streams.yml`](.github/workflows/refresh-streams.yml) 每 6 小時跑一次，有變動才 commit，Pages 隨即重建。也可在 Actions 頁面手動觸發。
- 兩個 Demo 頁在**首次繪製之後**才非同步抓 `streams.json` 套用，所以第一畫面不會被網路拖慢；抓不到就沿用檔案裡寫死的離線清單。
- **使用者自己新增／移除／拖曳過清單後就不再被覆蓋**（localStorage 的 `*.touched` 標記）。沒動過的展示機才會持續收到更新。

要增減頻道，改 `scripts/refresh-streams.mjs` 裡的 `SOURCES` 即可，那是頻道清單與中繼資料的唯一來源。

手動跑一次：

```bash
node scripts/refresh-streams.mjs
```

解析失敗時會沿用 `streams.json` 裡的舊 ID 並標記 `stale: true`，不會用空值覆蓋還能播的那一路。

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
3. **預設清單的影片 ID 會失效**，但已由排程自動更新（見上節），一般情況不需要人工介入。兩種情況仍會漏接：排程間隔內（最長 6 小時）剛好換場次，或 YouTube 改版導致解析失效。此時該路會顯示錯誤與換法，手動貼上新網址即可。
   自動更新是靠讀取 `/live` 頁面的 canonical 取得 ID，依賴 YouTube 的頁面結構；若要走官方管道可改接 YouTube Data API（需申請金鑰，且 `search.list` 每次耗 100 配額單位）。
4. **觀看數與讚數是示意數字**，依影片 ID 產生的固定假資料，非真實數據。
5. **直播廣場的直式卡片會裁掉畫面左右兩側**（16:9 塞進 3:4）。點進大畫面看的是未裁切的完整畫面。
6. 品牌名稱為中性佔位，非任何實際企業。

## 授權

MIT
