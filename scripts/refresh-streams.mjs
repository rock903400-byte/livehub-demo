#!/usr/bin/env node
/**
 * 解析各頻道目前的直播影片 ID，產生 streams.json。
 *
 * YouTube 已不支援用頻道網址嵌入「該頻道目前的直播」，每一場直播都有各自的
 * 影片 ID，換場次就會變。這支腳本去讀每個頻道的 /live 頁面，把 canonical 網址
 * 裡的影片 ID 挑出來寫進 streams.json，由 GitHub Actions 定期執行。
 *
 * 原則：解析不出來就沿用舊值並標記 stale，絕不用空值或垃圾覆蓋能用的 ID。
 *
 * 用法：node scripts/refresh-streams.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'streams.json');

// 頻道清單與展示用中繼資料的唯一真實來源。
// 只有 ref（影片 ID）是自動解析的，其餘欄位在這裡維護。
const SOURCES = [
  { handle: 'SkyNews',          host: 'Sky News',           title: '24 小時英國與國際即時新聞', tag: '新聞' },
  { handle: 'AlJazeeraEnglish', host: 'Al Jazeera English', title: '中東與全球局勢英文直播',     tag: '新聞' },
  { handle: 'DWNews',           host: 'DW News',            title: '德國之聲 24 小時英文新聞',   tag: '新聞' },
  { handle: 'euronews',         host: 'euronews',           title: '歐洲即時新聞連線',           tag: '新聞' },
  { handle: 'NBCNews',          host: 'NBC News',           title: '美國每日焦點新聞直播',       tag: '新聞' },
  { handle: 'ABCNews',          host: 'ABC News',           title: '突發新聞與現場連線',         tag: '新聞' },
  { handle: 'trtworld',         host: 'TRT World',          title: '國際視角的深度新聞',         tag: '新聞' },
  { handle: 'NASA',             host: 'NASA',               title: '太空任務與地球實況畫面',     tag: '知識' },
  { handle: 'LofiGirl',         host: 'Lofi Girl',          title: '放鬆用 lofi 電台，讀書工作都適合', tag: '音樂' }
];

// 與兩個頁面裡的 VIDEO_ID 規則一致
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** 從 /live 頁面的 HTML 取出影片 ID，取不到回傳 null。 */
function extractVideoId(html) {
  // 主要方式：canonical 連結。實測 9/9 命中。
  const canonical = html.match(/<link\s+rel="canonical"\s+href="[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
  if (canonical && VIDEO_ID.test(canonical[1])) return canonical[1];

  // 退路：頁面 JSON 裡的第一個 videoId
  const embedded = html.match(/"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/);
  if (embedded && VIDEO_ID.test(embedded[1])) return embedded[1];

  return null;
}

async function resolve(handle) {
  const url = 'https://www.youtube.com/@' + handle + '/live';
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return extractVideoId(await res.text());
}

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
  const streams = [];
  let resolved = 0, kept = 0, changed = 0;

  for (const src of SOURCES) {
    let ref = null;
    try {
      ref = await resolve(src.handle);
    } catch (e) {
      console.error('  ! ' + src.handle + ' 請求失敗：' + e.message);
    }

    const old = previous.get(src.handle) || null;
    const stale = !ref;

    if (stale) {
      // 解析不出來就沿用舊值 —— 寧可用可能過期的 ID，也不要把能播的那一路弄成空的
      ref = old;
      kept++;
      console.error('  ! ' + src.handle + ' 解析不到直播 ID，沿用舊值 ' + (old || '(無)'));
    } else {
      resolved++;
      if (old && old !== ref) {
        changed++;
        console.log('  ~ ' + src.handle + ' ' + old + ' -> ' + ref);
      } else if (!old) {
        console.log('  + ' + src.handle + ' ' + ref);
      }
    }

    if (!ref) {
      // 既沒解析到、也沒有舊值可用，只能略過這一路
      console.error('  x ' + src.handle + ' 無可用 ID，本次略過');
      continue;
    }

    streams.push({
      handle: src.handle,
      ref: ref,
      host: src.host,
      title: src.title,
      tag: src.tag,
      stale: stale
    });

    await sleep(400);
  }

  if (!streams.length) {
    console.error('全部解析失敗且無舊值可用，不覆寫 streams.json。');
    process.exit(1);
  }

  // 比對時忽略 updatedAt，避免每次排程都產生一筆沒有實質變化的 commit
  const signature = JSON.stringify(streams);
  let unchanged = false;
  try {
    const parsed = JSON.parse(await readFile(OUT, 'utf8'));
    unchanged = JSON.stringify(parsed.streams) === signature;
  } catch { /* 檔案不存在或壞掉，就當作有變動 */ }

  console.log('解析成功 ' + resolved + ' 路，沿用舊值 ' + kept + ' 路，ID 有變動 ' + changed + ' 路。');

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
