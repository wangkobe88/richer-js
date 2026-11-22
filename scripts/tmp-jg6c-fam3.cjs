#!/usr/bin/env node
// JG-6c 用户五判据验证：JG6 面 85 张的 famous 三键（参与额/即时跟单额/同块跟单人头）
// + 捆绑直线下跌案例键。锚=首拦时刻。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const FAM = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8')).wallets.map(w => w.toLowerCase()));

(async () => {
  const sb = dbManager.getClient();
  const rows = JSON.parse(fs.readFileSync('/tmp/jg6c-rows.json', 'utf8')).filter(r => r.d);
  const JG6 = d => (d.washPairCount ?? 0) === 0 && (d.noBuySellPct ?? 100) < 10 && (d.holderHHI ?? 1) < 0.2 && d.totalBuyBnb >= 3 && (d.routerEntryBuyPct ?? 0) >= 60 && (d.top1BuyPct ?? 100) < 15 && d.totalBuyBnb <= 8 && (d.sameBlockHoldCircPct ?? 100) <= 60;
  const jg6 = rows.filter(r => JG6(r.d));
  console.log('JG6 面:', jg6.length);

  async function loadTicks(addr) {
    const t = []; let f = 0;
    while (f <= 3000) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select('block_time,block_number,trade_type,bnb_amount,trader_address,sender_address,price_bnb')
        .eq('token_address', addr).order('id', { ascending: true }).range(f, f + 999);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      t.push(...data); if (data.length < 1000) break; f += 1000;
    }
    for (const r of t) r.bt = new Date(r.block_time).getTime();
    t.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    return t;
  }

  const CASES = new Set(['0xd5919f9e884cb1f82a65675c03dcb550e6b67777', '0xb42a4d2d2ea70a098d426f76dbd45896c5f67777', '0x63de6e31ce1cc19678dc3c8b3967e20a85a67777', '0x68101ea0caf1436e8d50fba569a046082a8f7777', '0xc59e10d906722c5f978ed24387226c7a4d4c7777']);
  const out = [];
  for (const r of jg6) {
    const t0 = new Date(r.t0).getTime();
    const ticks = (await loadTicks(r.addr)).filter(x => x.bt <= t0);
    const W = x => ((x.sender_address || x.trader_address) || '').toLowerCase();
    // famous 三键
    let groupBuy = 0, groupSell = 0;
    const famBuyBlocks = new Map();
    const buyWByBlock = new Map();
    let famFirstBlock = null;
    for (const x of ticks) {
      const isB = (x.trade_type || '').toUpperCase() === 'BUY';
      const w = W(x);
      if (isB) {
        const s = buyWByBlock.get(x.block_number) || new Set();
        s.add(w); buyWByBlock.set(x.block_number, s);
        if (FAM.has(w)) {
          groupBuy += x.bnb_amount || 0;
          if (x.block_number != null && (famFirstBlock === null || x.block_number < famFirstBlock)) famFirstBlock = x.block_number;
          const arr = famBuyBlocks.get(x.block_number) || [];
          arr.push(x); famBuyBlocks.set(x.block_number, arr);
        }
      } else if (FAM.has(w)) groupSell += x.bnb_amount || 0;
    }
    let cohortMax = 0;
    for (const b of famBuyBlocks.keys()) {
      let c = 0;
      for (const w of (buyWByBlock.get(b) || new Set())) if (!FAM.has(w)) c++;
      if (c > cohortMax) cohortMax = c;
    }
    // famousFollowBnb（FP31 口径：群体首买 block 起 3 slot 内非 famous 买合计）
    let followBnb = null;
    if (famFirstBlock !== null) {
      let fb = 0;
      for (const x of ticks) {
        if ((x.trade_type || '').toUpperCase() !== 'BUY' || x.block_number == null) continue;
        const d = x.block_number - famFirstBlock;
        if (d < 0 || d > 2) continue;
        if (W(x) && FAM.has(W(x))) continue;
        fb += x.bnb_amount || 0;
      }
      followBnb = +fb.toFixed(3);
    }
    const rec = { addr: r.addr, rPeak: r.rPeak, groupBuy: +groupBuy.toFixed(2), groupSell: +groupSell.toFixed(2),
      famSellPct: r.d.sellBnb > 0 ? +(groupSell / r.d.sellBnb * 100).toFixed(0) : null,
      cohortMax, followBnb, d: r.d };
    out.push(rec);
    if (CASES.has(r.addr)) {
      console.log('[案例] ' + r.addr.slice(0, 8), '峰' + (r.rPeak ?? '?') + '%', '| fam买' + rec.groupBuy + 'B 卖' + rec.groupSell + 'B(占' + rec.famSellPct + '%)', '跟单额' + followBnb + 'B 人头max' + cohortMax, '| sameBlkHold' + r.d.sameBlockHoldCircPct?.toFixed(0) + '% totalBuy' + r.d.totalBuyBnb?.toFixed(1) + 'B');
    }
  }
  fs.writeFileSync('/tmp/jg6c-fam.json', JSON.stringify(out));
  // 分布对照：右尾 vs 死透
  const q = (arr, f, p) => { const v = arr.map(f).filter(x => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length * p)] : NaN; };
  const R = out.filter(r => r.rPeak >= 100), D = out.filter(r => r.rPeak != null && r.rPeak < 10);
  console.log('\n=== 右尾(' + R.length + ') vs 死透(' + D.length + ') 三键分位 ===');
  for (const [name, f] of [['fam买', r => r.groupBuy], ['跟单额', r => r.followBnb], ['跟单人头', r => r.cohortMax], ['fam卖占%', r => r.famSellPct]]) {
    console.log(name.padEnd(8), '右尾 p25/p50/p75:', q(R, f, .25).toFixed(2), q(R, f, .5).toFixed(2), q(R, f, .75).toFixed(2), '| 死透 p25/p50/p75:', q(D, f, .25).toFixed(2), q(D, f, .5).toFixed(2), q(D, f, .75).toFixed(2));
  }
  // 候选新腿网格
  const leg = (name, fn) => {
    const kept = out.filter(fn);
    const rr = kept.filter(r => r.rPeak >= 100).length, dd = kept.filter(r => r.rPeak != null && r.rPeak < 10).length, mm = kept.filter(r => r.rPeak >= 10 && r.rPeak < 100).length;
    console.log(name.padEnd(36), '留', String(kept.length).padStart(3), '| 右尾', rr, '中间', mm, '死透', dd, '| 剔除案例:', out.filter(r => !fn(r) && CASES.has(r.addr)).map(r => r.addr.slice(0, 6)).join(',') || '无');
  };
  console.log('\n=== 新腿网格（叠加在 JG6 八腿上）===');
  leg('JG6 现状', () => true);
  leg('+跟单额<0.2（FP31 U线）', r => r.followBnb === null || r.followBnb < 0.2);
  leg('+跟单额<0.15', r => r.followBnb === null || r.followBnb < 0.15);
  leg('+fam买≥0.3', r => r.groupBuy >= 0.3);
  leg('+fam买≥0.4', r => r.groupBuy >= 0.4);
  leg('+fam卖占<15%', r => r.famSellPct === null || r.famSellPct < 15);
  leg('+跟单额<0.2 ∧ fam买≥0.3', r => (r.followBnb === null || r.followBnb < 0.2) && r.groupBuy >= 0.3);
  leg('+跟单额<0.2 ∧ fam买≥0.3 ∧ 卖占<15%', r => (r.followBnb === null || r.followBnb < 0.2) && r.groupBuy >= 0.3 && (r.famSellPct === null || r.famSellPct < 15));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
