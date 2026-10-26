#!/usr/bin/env node
/** 0x2fe5…7777 可疑前期钱包跨票验证（182 跑）：同批钱包在多少票上协同出现 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

// 嫌疑钱包（等额簇成员/同秒对/三胞胎/纯卖 96s 批/SYBIL 命中）
const SUSPECTS = [
  // 等额 ~0.0987 × 9
  '0x77813931e4f1', '0xd5155c791edf', '0x00c60c5a5228', '0x488db018e00e', '0x90e16cff92',
  '0x1feeee5e39', '0xcf3aa2e7b9', '0x8728bf942d', '0xc02250ed29',
  // 等额 ~0.1973 × 8
  '0xefb1dc1ba3', '0x9219b2cca3', '0x24a57cb992', '0x5c338e1824', '0xbfa0dc8b8f',
  '0x66666baabb', '0x9667b10748', '0xf944f5b7f9',
  // 同秒对/三胞胎
  '0x27ac03fe76', '0x0fcf388ec0', '0x617f2b6aae', '0xdaf656398d', '0x24593a77d9',
  '0xcd95d68d8b', '0x8a2a9d7b11',
  // 纯卖 @96s 批
  '0x7154c02022', '0xfe5130eab2', '0x30f2f80acc', '0x81364b8ec0', '0x6b6df649eb',
  '0xc299cd75f7', '0xeb64740aff', '0xf205c591f9', '0x04a5352815', '0xa8fd5b9fb8',
  // SYBIL 名单命中
  '0x06f0a61cfc',
  // 首 tick 大单
  '0x0fd35eb464',
].map(p => p.startsWith('0x') && p.length === 42 ? p.toLowerCase() : p);

async function main() {
  const db = dbManager.getClient();
  // 全量前缀拉不行（in 需全地址）——先按前缀补全：用 like? 不行。改成从 ticks 里捞本票全地址再前缀匹配
  const { data: tks } = await db.from('wss_price_ticks')
    .select('sender_address, trader_address')
    .eq('token_address', '0x2fe5328cf2ea8cd632161564464c1e6c2e347777')
    .limit(1000);
  const pool = new Set();
  for (const r of tks || []) {
    if (r.sender_address) pool.add(r.sender_address.toLowerCase());
    if (r.trader_address) pool.add(r.trader_address.toLowerCase());
  }
  const addrs = [];
  for (const p of SUSPECTS) {
    const hit = [...pool].find(a => a.startsWith(p.slice(0, 8)) && a.endsWith(p.slice(-4)));
    if (hit) addrs.push(hit); else console.log('未匹配:', p);
  }
  console.log(`匹配到 ${addrs.length}/${SUSPECTS.length} 个全地址`);
  if (!addrs.length) process.exit(0);

  // keyset 分页拉这些钱包的全部 ticks（只留 token/wallet/时间）
  const rows = [];
  let cursor = 0;
  for (const batch of [addrs]) {
    for (;;) {
      const { data, error } = await db.from('wss_price_ticks')
        .select('id, block_time, token_address, sender_address, trader_address, trade_type')
        .in('sender_address', batch)
        .gt('id', cursor)
        .order('id', { ascending: true })
        .limit(1000);
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      cursor = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
  }
  console.log(`跨票 ticks 总行数: ${rows.length}`);

  // per-wallet: distinct tokens + 最早/最晚
  const stat = new Map();
  for (const r of rows) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    if (!addrs.includes(w)) continue;
    const e = stat.get(w) || { tokens: new Map(), first: r.block_time, last: r.block_time };
    e.tokens.set(r.token_address, (e.tokens.get(r.token_address) || 0) + 1);
    if (r.block_time < e.first) e.first = r.block_time;
    if (r.block_time > e.last) e.last = r.block_time;
    stat.set(w, e);
  }
  console.log('\n-- per-wallet 跨票统计 --');
  const sorted = [...stat.entries()].sort((a, b) => b[1].tokens.size - a[1].tokens.size);
  for (const [w, e] of sorted) {
    console.log(`${w.slice(0, 8)}…${w.slice(-4)}: ${e.tokens.size} 票, ${e.first.slice(0, 16)} → ${e.last.slice(0, 16)}`);
  }

  // 协同矩阵：两两钱包共现票数（找 ≥3 票共现的对）
  console.log('\n-- 钱包对共现（共同出现 ≥3 票，截 20）--');
  const tokenSets = new Map([...stat.entries()].map(([w, e]) => [w, new Set(e.tokens.keys())]));
  const pairs = [];
  const ws = [...tokenSets.keys()];
  for (let i = 0; i < ws.length; i++) {
    for (let j = i + 1; j < ws.length; j++) {
      let co = 0;
      for (const t of tokenSets.get(ws[i])) if (tokenSets.get(ws[j]).has(t)) co++;
      if (co >= 3) pairs.push([ws[i], ws[j], co]);
    }
  }
  pairs.sort((a, b) => b[2] - a[2]);
  for (const [a, b, co] of pairs.slice(0, 20)) {
    console.log(`${a.slice(0, 8)}…${a.slice(-4)} × ${b.slice(0, 8)}…${b.slice(-4)}: ${co} 票共现`);
  }

  // 本票之外的最近共演票（团伙作业线）：取共现最多的 12 票（非本票），列参与嫌疑钱包数
  console.log('\n-- 嫌疑钱包聚集的其它票（按参与嫌疑钱包数排序，截 12）--');
  const tokenWallets = new Map();
  for (const [w, e] of stat) {
    for (const t of e.tokens.keys()) {
      if (t === '0x2fe5328cf2ea8cd632161564464c1e6c2e347777') continue;
      const s = tokenWallets.get(t) || new Set();
      s.add(w);
      tokenWallets.set(t, s);
    }
  }
  const topTokens = [...tokenWallets.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 12);
  for (const [t, s] of topTokens) {
    console.log(`${t.slice(0, 8)}…${t.slice(-4)}: ${s.size}/${stat.size} 个嫌疑钱包参与`);
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
