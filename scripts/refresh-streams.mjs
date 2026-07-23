#!/usr/bin/env node
/**
 * 解析各頻道目前的直播影片 ID，產生 streams.json。
 *
 * YouTube 已不支援用頻道網址嵌入「該頻道目前的直播」，每一場直播都有各自的
 * 影片 ID，換場次就會變。這支腳本負責把那些 ID 找出來寫進 streams.json，
 * 由 GitHub Actions 定期執行。
 *
 * 兩種取得方式：
 *
 *   1. YouTube Data API（設了環境變數 YT_API_KEY 就走這條）
 *      官方管道，任何網路環境都可用，CI 上也正確。
 *
 *   2. 抓 /live 頁面的 canonical（沒有金鑰時的退路）
 *      免金鑰，但只在一般網路環境可信 —— 從資料中心 IP（例如 GitHub Actions
 *      runner）請求時，YouTube 回的頁面 canonical 會指向推薦區塊裡不相干的
 *      影片。實測 9 路有 8 路解析錯誤，所以這條路只適合在本機手動執行。
 *
 * 兩條路的結果都會經過同一套歸屬驗證，確認影片真的屬於該頻道才採用。
 * 解析不出來或驗證不過，一律沿用 streams.json 裡的舊值並標記 stale，
 * 絕不用空值或別人的影片覆蓋還能播的那一路。
 *
 * 用法：
 *   node scripts/refresh-streams.mjs                  # 走網頁解析
 *   YT_API_KEY=xxxx node scripts/refresh-streams.mjs  # 走官方 API
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'streams.json');

const API_KEY = process.env.YT_API_KEY || '';
const API = 'https://www.googleapis.com/youtube/v3/';

// 頻道清單與展示用中繼資料的唯一真實來源。
// channelId 是頻道的永久識別碼，不會變，寫死可以省下查詢的配額。
// host 必須與 YouTube 上的頻道顯示名稱一致 —— 網頁解析路徑用它做歸屬驗證。
const SOURCES = [
  { handle: 'SkyNews',          channelId: 'UCoMdktPbSTixAyNGwb-UYkQ', host: 'Sky News',           title: '24 小時英國與國際即時新聞', tag: '新聞' },
  { handle: 'AlJazeeraEnglish', channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', host: 'Al Jazeera English', title: '中東與全球局勢英文直播',     tag: '新聞' },
  { handle: 'DWNews',           channelId: 'UCknLrEdhRCp1aegoMqRaCZg', host: 'DW News',            title: '德國之聲 24 小時英文新聞',   tag: '新聞' },
  { handle: 'euronews',         channelId: 'UCSrZ3UV4jOidv8ppoVuvW9Q', host: 'euronews',           title: '歐洲即時新聞連線',           tag: '新聞' },
  { handle: 'NBCNews',          channelId: 'UCeY0bbntWzzVIaj2z3QigXg', host: 'NBC News',           title: '美國每日焦點新聞直播',       tag: '新聞' },
  { handle: 'ABCNews',          channelId: 'UCBi2mrWuNuyYy4gbM6fU18Q', host: 'ABC News',           title: '突發新聞與現場連線',         tag: '新聞' },
  { handle: 'trtworld',         channelId: 'UC7fWeaHhqgM4Ry-RMpM2YYw', host: 'TRT World',          title: '國際視角的深度新聞',         tag: '新聞' },
  { handle: 'NASA',             channelId: 'UCLA_DiR1FfKNvjuUpBHmylQ', host: 'NASA',               title: '太空任務與地球實況畫面',     tag: '知識' },
  { handle: 'LofiGirl',         channelId: 'UCSJ4gkVC6NrvII8umztf0Ow', host: 'Lofi Girl',          title: '放鬆用 lofi 電台，讀書工作都適合', tag: '音樂' }
];

// 與兩個頁面裡的 VIDEO_ID 規則一致
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* =========================================================
   YouTube Data API
   ========================================================= */

async function api(endpoint, params) {
  const url = new URL(API + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', API_KEY);

  const res = await fetch(url);
  const body = await res.json().catch(function () { return null; });

  if (!res.ok) {
    const reason = body && body.error && body.error.errors && body.error.errors[0]
      ? body.error.errors[0].reason : ('HTTP ' + res.status);
    const msg = body && body.error ? body.error.message : '';
    throw new Error(reason + (msg ? '：' + msg : ''));
  }
  return body;
}

/**
 * 批次確認哪些影片還在直播中。
 * videos.list 一次最多吃 50 個 ID，而且**整批只花 1 配額單位** —— 這是這支
 * 腳本省配額的關鍵：穩定狀態下每輪只需要這一次呼叫。
 * 回傳仍在直播中的影片 ID 集合。
 */
async function stillLive(ids) {
  const alive = new Set();
  if (!ids.length) return alive;

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await api('videos', { part: 'snippet', id: batch.join(',') });
    for (const item of (data.items || [])) {
      if (item.snippet && item.snippet.liveBroadcastContent === 'live') alive.add(item.id);
    }
  }
  return alive;
}

/**
 * 找出某頻道目前的直播。search.list 每次 100 配額單位，所以只在該頻道
 * 原本的 ID 已經停播時才呼叫。
 * API 直接依 channelId 過濾，結果的歸屬是 API 保證的，不需另外驗證。
 */
async function findLiveByApi(channelId) {
  const data = await api('search', {
    part: 'id',
    channelId: channelId,
    eventType: 'live',
    type: 'video',
    maxResults: '1'
  });
  const item = (data.items || [])[0];
  const id = item && item.id ? item.id.videoId : null;
  return (id && VIDEO_ID.test(id)) ? id : null;
}

/* =========================================================
   網頁解析（沒有 API 金鑰時的退路）
   ========================================================= */

/** 從 /live 頁面的 HTML 取出影片 ID，取不到回傳 null。 */
function extractVideoId(html) {
  const canonical = html.match(/<link\s+rel="canonical"\s+href="[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
  if (canonical && VIDEO_ID.test(canonical[1])) return canonical[1];

  const embedded = html.match(/"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/);
  if (embedded && VIDEO_ID.test(embedded[1])) return embedded[1];

  return null;
}

async function findLiveByScrape(handle) {
  const res = await fetch('https://www.youtube.com/@' + handle + '/live', {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return extractVideoId(await res.text());
}

/**
 * 確認這支影片真的屬於預期的頻道。
 *
 * 網頁解析路徑必要，不是保險：從資料中心 IP 請求 /live 時，YouTube 回的頁面
 * canonical 可能指向推薦區塊裡毫不相干的影片。實測曾把 NBC News 與 TRT World
 * 同時解析成 Jon Stewart 的節目、把 Lofi Girl 解析成別的音樂頻道。
 */
async function verifyOwner(ref, expectedHost) {
  const url = 'https://www.youtube.com/oembed?url=' +
              encodeURIComponent('https://www.youtube.com/watch?v=' + ref) + '&format=json';
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error('oEmbed HTTP ' + res.status);
  const author = String((await res.json()).author_name || '').trim();
  return {
    ok: author.toLowerCase() === String(expectedHost).trim().toLowerCase(),
    author: author
  };
}

/**
 * 確認這支影片此刻真的在直播中。
 *
 * 光驗歸屬不夠：頻道沒在直播時 /live 會導向該頻道最近的一支普通影片，
 * 那支影片的擁有者當然是對的，卻不是直播 —— 驗歸屬會放行，牆上就會出現
 * 一段錄影。API 路徑由 eventType=live 保證，這裡是網頁解析路徑的對應檢查。
 */
async function isLiveNow(ref) {
  const res = await fetch('https://www.youtube.com/watch?v=' + ref, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }
  });
  if (!res.ok) throw new Error('watch HTTP ' + res.status);
  return /"isLiveNow"\s*:\s*true/.test(await res.text());
}

/* =========================================================
   主流程
   ========================================================= */

/** 讀既有的 streams.json，供解析失敗時沿用舊 ID。讀不到就當空的。 */
async function readPrevious() {
  try {
    const parsed = JSON.parse(await readFile(OUT, 'utf8'));
    const map = new Map();
    for (const s of parsed.streams || []) {
      if (s && s.handle && VIDEO_ID.test(String(s.ref || ''))) map.set(s.handle, s.ref);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function main() {
  const previous = await readPrevious();
  const useApi = Boolean(API_KEY);

  console.log(useApi
    ? '模式：YouTube Data API'
    : '模式：網頁解析（未設定 YT_API_KEY）—— 從資料中心 IP 執行會解析錯誤，僅適合本機使用');

  // API 模式先批次確認哪些還活著，只有停播的才需要花 100 單位去搜尋
  let alive = new Set();
  if (useApi) {
    const known = SOURCES.map(function (s) { return previous.get(s.handle); }).filter(Boolean);
    try {
      alive = await stillLive(known);
      console.log('批次檢查：' + known.length + ' 支既有 ID 中，' + alive.size + ' 支仍在直播（1 配額單位）');
    } catch (e) {
      console.error('批次檢查失敗（' + e.message + '），改為逐一搜尋');
    }
  }

  const streams = [];
  const claimed = new Map();   // ref -> handle，擋掉多個頻道解析到同一支影片
  let resolved = 0, kept = 0, changed = 0, rejected = 0, searches = 0;

  for (const src of SOURCES) {
    const old = previous.get(src.handle) || null;
    let ref = null;

    if (useApi && old && alive.has(old)) {
      // 原本那支還在播，完全不必動它
      ref = old;
      resolved++;
    } else {
      try {
        if (useApi) {
          ref = await findLiveByApi(src.channelId);
          searches++;
        } else {
          ref = await findLiveByScrape(src.handle);
        }
      } catch (e) {
        console.error('  ! ' + src.handle + ' 查詢失敗：' + e.message);
      }

      // 網頁解析的結果必須通過歸屬驗證；API 的結果由 channelId 保證，不需再驗
      if (ref && !useApi) {
        if (claimed.has(ref)) {
          console.error('  ! ' + src.handle + ' 解析結果 ' + ref +
                        ' 與 ' + claimed.get(ref) + ' 重複，判定為誤判，捨棄');
          ref = null;
          rejected++;
        } else {
          try {
            const owner = await verifyOwner(ref, src.host);
            if (!owner.ok) {
              console.error('  ! ' + src.handle + ' 解析到 ' + ref +
                            ' 但該影片屬於「' + owner.author + '」，不是「' + src.host + '」，捨棄');
              ref = null;
              rejected++;
            } else if (!await isLiveNow(ref)) {
              console.error('  ! ' + src.handle + ' 解析到 ' + ref +
                            ' 但該影片目前不是直播中（可能是頻道沒開播時導向的普通影片），捨棄');
              ref = null;
              rejected++;
            }
          } catch (e) {
            console.error('  ! ' + src.handle + ' 無法驗證（' + e.message + '），捨棄');
            ref = null;
            rejected++;
          }
        }
      }

      if (ref) {
        resolved++;
        if (old && old !== ref) {
          changed++;
          console.log('  ~ ' + src.handle + ' ' + old + ' -> ' + ref);
        } else if (!old) {
          console.log('  + ' + src.handle + ' ' + ref);
        }
      }
    }

    const stale = !ref;
    if (stale) {
      ref = old;
      kept++;
      console.error('  ! ' + src.handle + ' 找不到進行中的直播，沿用舊值 ' + (old || '(無)'));
    }

    if (!ref) {
      console.error('  x ' + src.handle + ' 無可用 ID，本次略過');
      continue;
    }

    claimed.set(ref, src.handle);
    streams.push({
      handle: src.handle,
      ref: ref,
      host: src.host,
      title: src.title,
      tag: src.tag,
      stale: stale
    });

    if (!useApi) await sleep(400);
  }

  if (!streams.length) {
    console.error('全部查詢失敗且無舊值可用，不覆寫 streams.json。');
    process.exit(1);
  }

  console.log('可用 ' + resolved + ' 路，驗證不通過 ' + rejected +
              ' 路，沿用舊值 ' + kept + ' 路，ID 有變動 ' + changed + ' 路。' +
              (useApi ? '（本次搜尋 ' + searches + ' 次，約 ' + (1 + searches * 100) + ' 配額單位）' : ''));

  // 一路都沒查到，代表這次執行整體失敗（金鑰無效、配額用完、沒網路…），
  // 而不是九個頻道剛好同時停播。這種情況不能寫檔 —— 否則只會把每一路都
  // 標成 stale 送出一筆毫無意義的 commit，還讓 CI 顯示成功。
  if (resolved === 0) {
    console.error('錯誤：九路全數查詢失敗，本次結果不可信，維持既有 streams.json 不變。');
    process.exit(1);
  }

  // 網頁解析模式下幾乎全被擋掉，通常代表 YouTube 對這個來源 IP 回了不同的頁面
  // 結構，而不是九個頻道剛好同時出問題。
  if (!useApi && rejected >= SOURCES.length - 1) {
    console.error('警告：' + rejected + '/' + SOURCES.length +
                  ' 路驗證失敗，本次解析結果整體不可信，維持既有 streams.json 不變。');
    process.exit(1);
  }

  // 比對時忽略 updatedAt，避免每次排程都產生一筆沒有實質變化的 commit
  const signature = JSON.stringify(streams);
  let unchanged = false;
  try {
    const parsed = JSON.parse(await readFile(OUT, 'utf8'));
    unchanged = JSON.stringify(parsed.streams) === signature;
  } catch { /* 檔案不存在或壞掉，就當作有變動 */ }

  if (unchanged) {
    console.log('內容與現有 streams.json 相同，不寫檔。');
    return;
  }

  await writeFile(OUT, JSON.stringify({
    updatedAt: new Date().toISOString(),
    note: '由 scripts/refresh-streams.mjs 自動產生，請勿手改。頻道清單在該腳本的 SOURCES。',
    streams: streams
  }, null, 2) + '\n', 'utf8');

  console.log('已寫入 ' + OUT);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
