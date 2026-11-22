#!/usr/bin/env node
// 一次性（182 跑）：BP88 时间隔断对拍——71 票新旧 snapshot dump 锚对比
// 新旧两份模块：旧=当前 git 态 buy-point-snapshot.js；新=/tmp/bp88-snapshot.cjs（同目录放置）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const snapOld = require('../src/market-analysis/buy-point-snapshot');
const snapNew = require('../src/market-analysis/buy-point-snapshot-bp88');

(async () => {
  const db = dbManager.getClient();
  const { fwd } = JSON.parse(require('fs').readFileSync('/tmp/mdump-full.json', 'utf8'));
  const meta = { platform: 'fourmeme', launchPriceBnb: 5.546337995470633e-09, totalSupply: 1e9 };
  const out = [];
  for (const t of fwd) {
    const anchorIso = new Date(t.at).toISOString();
    const { data, error } = await db.from('wss_price_ticks')
      .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token')
      .eq('token_address', t.token)
      .lte('block_time', anchorIso)
      .order('block_number', { ascending: false })
      .order('log_index', { ascending: false })
      .limit(3000);
    if (error) throw new Error(error.message);
    const rows = (data || []).slice().reverse();
    const dOld = snapOld.buildBuyPointSnapshot(rows, meta).buyDerived;
    const dNew = snapNew.buildBuyPointSnapshot(rows, meta).buyDerived;
    const k = (d) => d ? { blk: d.block, b2: d.block2, bnb: d.sellBnb, drop: d.dropPct, sec: d.secToAnchor } : null;
    out.push({
      token: t.token, sym: t.sym, at: t.at, sigSec: [t.dumpSec, t.d2Sec],
      oldD: k(dOld.dumpBlock), oldD2: k(dOld.dump2Block),
      newD: k(dNew.dumpBlock), newD2: k(dNew.dump2Block),
    });
    process.stdout.write('.');
  }
  console.log('');
  require('fs').writeFileSync('/tmp/bp88-parity.json', JSON.stringify(out, null, 1));
  // 汇总
  let nChg = 0, nNull = 0, nKeep = 0, nRecur = 0;
  for (const r of out) {
    const hadOld = r.oldD || r.oldD2, hasNew = r.newD || r.newD2;
    if (JSON.stringify([r.oldD, r.oldD2]) !== JSON.stringify([r.newD, r.newD2])) {
      nChg++;
      if (hadOld && !hasNew) nNull++;
      else if (hadOld && hasNew) nRecur++;
    } else if (hasNew) nKeep++;
  }
  console.log(`对拍 ${out.length} 票：锚变化 ${nChg}（全隔断 ${nNull} + 限窗递补 ${nRecur}）| 近锚锚保持 ${nKeep}`);
  for (const r of out) {
    if (JSON.stringify([r.oldD, r.oldD2]) !== JSON.stringify([r.newD, r.newD2])) {
      console.log(`\n${r.token.slice(0, 10)}… (${r.sym}) ${r.at?.slice(5, 16)} 信号锚 sec=${r.sigSec}`);
      console.log(`  old: D=${JSON.stringify(r.oldD)} D2=${JSON.stringify(r.oldD2)}`);
      console.log(`  new: D=${JSON.stringify(r.newD)} D2=${JSON.stringify(r.newD2)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
