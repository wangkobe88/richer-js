#!/usr/bin/env node
// ============================================================================
// KOL 研究·流快照采集器（/v1/user/kol + /v1/user/smartmoney 各 limit 100）
//
//   两端点均只有最近 ~24min 窗口、无翻页（offset 无效、tag 参数无效——已实测），
//   全局 KOL 名单只能靠持续快照累积：本脚本每次运行提取流内 tags 含 kol 的
//   maker 钱包，合并进 data/kol-study/kol-stream-wallets.json（union、带首见/
//   末见时间与出现次数），供 cron 周期调用。
//
//   用法（182，建议 cron */10min）：node scripts/gmgn-kol/snapshot-kol-stream.cjs
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../config/.env') });

const OUT = path.join(__dirname, '../../data/kol-study/kol-stream-wallets.json');

async function main() {
  const { GMGNTrackAPI } = require('../../src/core/gmgn-api');
  const api = new GMGNTrackAPI({ apiKey: process.env.GMGN_API_KEY });
  const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { snapshots: 0, wallets: {} };
  const now = new Date().toISOString();
  const seen = new Map(); // addr -> {name, tags, twitter}
  for (const [src, fn] of [['kol', 'getKol'], ['smartmoney', 'getSmartMoneyTrades']]) {
    try {
      const r = await api[fn]('bsc', 100);
      for (const t of (r && (r.list || r)) || []) {
        const info = t.maker_info || {};
        if (!(Array.isArray(info.tags) && info.tags.includes('kol'))) continue;
        seen.set(t.maker || t.base_address, { name: info.name || null, twitter: info.twitter_username || null, tags: info.tags, src });
      }
      await new Promise((r2) => setTimeout(r2, 4000));
    } catch (e) {
      console.log(`${src} ERR: ${e.message.slice(0, 90)}`);
    }
  }
  let added = 0;
  for (const [addr, info] of seen) {
    const w = db.wallets[addr];
    if (!w) { db.wallets[addr] = { ...info, firstSeen: now, lastSeen: now, hits: 1 }; added++; }
    else { w.lastSeen = now; w.hits++; if (info.name) w.name = info.name; if (info.twitter) w.twitter = info.twitter; }
  }
  db.snapshots++;
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, OUT);
  console.log(`${now} snapshot#${db.snapshots}: 流内 kol=${seen.size} 新增=${added} 累计=${Object.keys(db.wallets).length}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
