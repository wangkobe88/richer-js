#!/usr/bin/env node
// 误伤票角色取证:名单钱包在头部误伤票里是「同秒等额做局」还是「分散跟场」(182 跑)
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const R = p => path.join(__dirname, '..', p);
const lc = s => (s || '').toLowerCase();
const ALL13 = new Set([
  '0x9d41e99374e4bceebb4c0bd070e814e72b7e7ace', '0xd80bf2b4d8158b21da727c3a510284a5f73747c3',
  '0xf7a934528d38e2f2865a7cd30c335c6d115928b8', '0xf90026d86fb41f02a2be73345a8904d0b003ff6d',
  '0x9a213971f8749e087c6f8d5f5d1daabef0e14191', '0xc8c2c361142fda8a8ee5a807972fbfa9eb4f5a51',
  '0xa44039d10d4883a7353ee729a48fda88fa5d2333',
  '0x06f0a63c7f3df29d855c84c6cbfc55f35abc1cfc', '0x0b2259e10d494f848ea1458acb39152ad9865424',
  '0x727864fad9aef9b1049b1a724c66d2f91ecc0bf2', '0x27ac0351e225a15fb13d6b84a8dc31d799d0fe76',
  '0x66c81cf68a6bfb01a1885be28f01a588be477231', '0x1bd3c9ac6f9a4204aa7ededcf3a7afe16b3f644e',
].map(lc));
const TOKENS = process.argv.slice(2);
const fmt = ms => new Date(ms).toISOString().slice(5, 19);

(async () => {
  for (const tok of TOKENS) {
    const T = lc(tok);
    const rows = [];
    for (const f of ['fourmeme.jsonl.gz', 'flap.jsonl.gz']) {
      const fp = R('data/tick-cache/backtest/win-20261012t000000000z_20261013t120000000z/' + f);
      if (!fs.existsSync(fp)) continue;
      const rl = readline.createInterface({ input: fs.createReadStream(fp).pipe(zlib.createGunzip()) });
      for await (const line of rl) {
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (lc(r.token_address) !== T) continue;
        rows.push(r);
      }
    }
    rows.sort((a, b) => (a.block_number - b.block_number) || ((a.log_index ?? 0) - (b.log_index ?? 0)));
    rows.forEach(r => { r.dt = Date.parse(r.block_time); r.w = lc(r.sender_address) || lc(r.trader_address); });
    console.log(`\n===== ${T} 全 ${rows.length} 行 ${fmt(rows[0]?.dt || 0)} → ${fmt(rows[rows.length - 1]?.dt || 0)} =====`);
    const first = rows[0]?.dt || 0;
    let lastCrewDt = 0;
    for (const r of rows) {
      const isCrew = ALL13.has(r.w);
      const tag = isCrew ? ' ◀◀CREW' : '';
      const rel = ((r.dt - first) / 1000).toFixed(0);
      console.log(`${rel.padStart(5)}s ${fmt(r.dt)} ${r.trade_type === 'buy' ? 'B' : 'S'} [${r.block_number}] ${(Number(r.bnb_amount) || 0).toFixed(4)}B ${r.w.slice(0, 12)}${tag}`);
      if (isCrew && r.trade_type === 'buy') lastCrewDt = Math.max(lastCrewDt, r.dt);
    }
    // crew 组织性小结:买入时刻聚集度/等额
    const crewBuys = rows.filter(r => ALL13.has(r.w) && r.trade_type === 'buy');
    if (crewBuys.length) {
      const dts = crewBuys.map(r => r.dt).sort((a, b) => a - b);
      const span = (dts[dts.length - 1] - dts[0]) / 1000;
      const amts = crewBuys.map(r => (Number(r.bnb_amount) || 0).toFixed(3));
      const uniq = new Set(amts);
      console.log(`→ CREW 买 ${crewBuys.length} 笔 跨度 ${span.toFixed(0)}s 金额档 [${[...uniq].slice(0, 6).join(',')}] ${span <= 5 ? '同秒聚集=做局形状' : '分散=跟场形状'}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
