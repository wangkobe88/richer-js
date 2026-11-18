#!/usr/bin/env node
// ============================================================================
// 临时工具：BSC 聪明钱流累积器（/v1/user/smartmoney，对照 /v1/user/kol）
//
//   两端点均只有最近 ~24min 流窗、无翻页（snapshot-kol-stream.cjs 已实测），
//   全局名单只能靠持续快照 union 累积。本脚本按 --interval-min 周期快照，
//   每个 maker 记 {name, twitter, tags, hits, usd, firstSeen, lastSeen}，
//   幂等落盘 data/kol-study/smartmoney-accum.json（tmp+rename 原子写），
//   到 --duration-min 自动退出。
//
// 用法（182）：setsid nohup node scripts/gmgn-kol/tmp-smartmoney-accumulate.cjs \
//              --interval-min 10 --duration-min 240 >> logs/smartmoney-accum.log 2>&1 &
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

const OUT = path.join(__dirname, '../../data/kol-study/smartmoney-accum.json');
const args = process.argv.slice(2);
function argVal(k, dflt) { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt; }
const INTERVAL_MIN = argVal('--interval-min', 10);
const DURATION_MIN = argVal('--duration-min', 240);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function save(db) {
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, OUT);
}

async function main() {
  const { GMGNTrackAPI } = require('../../src/core/gmgn-api');
  const api = new GMGNTrackAPI({ apiKey: process.env.GMGN_API_KEY });
  const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8'))
    : { snapshots: 0, startedAt: new Date().toISOString(), sources: { smartmoney: {}, kol: {} } };
  const deadline = Date.now() + DURATION_MIN * 60 * 1000;
  console.log(`[${new Date().toISOString()}] start interval=${INTERVAL_MIN}min duration=${DURATION_MIN}min snapshots=${db.snapshots}`);

  while (Date.now() < deadline) {
    const now = new Date().toISOString();
    for (const [src, fn] of [['smartmoney', 'getSmartMoneyTrades'], ['kol', 'getKolTrades']]) {
      try {
        const r = await api[fn]('bsc', 200);
        const list = (r && (r.list || r)) || [];
        const store = db.sources[src];
        let usdSum = 0;
        for (const t of list) {
          const info = t.maker_info || {};
          const addr = t.maker || t.base_address;
          if (!addr) continue;
          const usd = Number(t.amount_usd) || 0;
          usdSum += usd;
          const w = store[addr];
          if (!w) store[addr] = {
            name: info.name || null, twitter: info.twitter_username || null,
            tags: Array.isArray(info.tags) ? info.tags : [],
            hits: 1, usd, firstSeen: now, lastSeen: now,
          };
          else {
            w.hits++; w.usd += usd; w.lastSeen = now;
            if (info.name) w.name = info.name;
            if (info.twitter) w.twitter = info.twitter_username || w.twitter;
            if (Array.isArray(info.tags) && info.tags.length) w.tags = info.tags;
          }
        }
        console.log(`${now} ${src}: rows=${list.length} usd=${Math.round(usdSum)} 累计=${Object.keys(store).length}`);
      } catch (e) {
        console.log(`${now} ${src} ERR: ${String(e.message).slice(0, 120)}`);
      }
      await sleep(4000);
    }
    db.snapshots++;
    save(db);
    await sleep(INTERVAL_MIN * 60 * 1000);
  }
  save(db);
  const sm = Object.keys(db.sources.smartmoney).length;
  const ko = Object.keys(db.sources.kol).length;
  console.log(`[${new Date().toISOString()}] done snapshots=${db.snapshots} smartmoney=${sm} kol=${ko}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
