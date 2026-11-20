#!/usr/bin/env node
// CD422 收紧行为验证（零 DB 纯函数）：四形状对拍
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot');
let blk = 4000, log = 0;
const mk = (sec, type, bnb, w) => ({ block_time: new Date(sec * 1000).toISOString(), block_number: blk++, log_index: log++, trade_type: type, bnb_amount: bnb, price_bnb: 1e-9, price_outlier: false, trader_address: w || `0xw${sec}${log}`, sender_address: null, token_amount: null, quote_token: null });

// Case1 0xc71a 复刻：波前一波 → 33s 断流 → 出口孤笔 0.1 → 6s 后 0.33 流量 → 锚
const c1 = [
  mk(0, 'buy', 0.37), mk(0, 'buy', 0.31), mk(3, 'sell', 0.29),
  mk(25, 'buy', 0.10), mk(26, 'buy', 0.079), mk(26, 'buy', 0.0396), mk(26, 'buy', 0.0544), mk(26, 'buy', 0.0782),
  mk(59, 'buy', 0.10),
  mk(65, 'buy', 0.13), mk(65, 'buy', 0.0994), mk(69, 'buy', 0.099),
  mk(77, 'buy', 0.0994), mk(78, 'sell', 0.0605), mk(82, 'sell', 0.435),
];
// Case2 正例：静默 58s → 出口行起 3s 内 11 钱包 0.77
const c2 = [mk(0, 'buy', 0.2), mk(60, 'buy', 0.07), ...Array.from({ length: 10 }, (_, i) => mk(61 + Math.floor(i / 4), 'buy', 0.07))];
// Case3 出口起 5s 内只有卖跟随
const c3 = [mk(0, 'buy', 0.5), mk(50, 'sell', 0.1), mk(51, 'sell', 0.2)];
// Case4 无 ≥30s 段
const c4 = [mk(0, 'buy', 0.1), mk(10, 'buy', 0.1), mk(20, 'buy', 0.1), mk(29, 'buy', 0.1)];

const meta = { platform: 'fourmeme', tokenAddress: '0xt', createdAtSec: 0, totalSupply: 1e9, creatorAddress: null };
for (const [name, rows] of [['C1 0xc71a复刻', c1], ['C2 出口即涌入', c2], ['C3 出口卖跟随', c3], ['C4 无段', c4]]) {
  const d = buildSnapshotFromRows(rows, meta).derived;
  const pick = {};
  for (const k of Object.keys(d)) if (/burst(LastGap|ExitWave|WaveNet|WaveWallet|SecSinceWave)/.test(k)) pick[k] = d[k];
  console.log(`\n== ${name}`);
  for (const [k, v] of Object.entries(pick)) console.log(`  ${k} = ${v}`);
}
