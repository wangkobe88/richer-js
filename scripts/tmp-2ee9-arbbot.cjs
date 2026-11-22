'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot');

const ADDR = '0x2ee9458681c134e9c7cd933b7af94be50a1f7777';
const COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const ARB_TAGS = new Set(['arbitrager', 'sandwich_bot', 'wash_trader']);

(async () => {
  const sb = dbManager.getClient();
  // 1) arbBot 钱包集（同 _loadArbBotWallets 分页口径）
  const tagMap = new Map(); let after = null;
  for (;;) {
    let q = sb.from('gmgn_wallet_profiles').select('address,tags').order('address').limit(1000);
    if (after) q = q.gt('address', after);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    for (const r of data) {
      if (Array.isArray(r.tags)) tagMap.set(String(r.address).toLowerCase(), r.tags);
    }
    after = data[data.length - 1].address;
    if (data.length < 1000) break;
  }
  const arbSet = new Set([...tagMap.entries()].filter(([, t]) => t.some((x) => ARB_TAGS.has(x))).map(([a]) => a));
  console.log(`画像库总 wallets=${tagMap.size}，arbBot 集=${arbSet.size}`);

  // 2) 两个锚各复算
  for (const anchorIso of ['2026-10-04T06:50:23Z', '2026-10-04T06:50:31Z']) {
    const { data: rows, error } = await sb.from('wss_price_ticks')
      .select(COLS).eq('token_address', ADDR)
      .lte('block_time', anchorIso)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    const snap = buildSnapshotFromRows(rows || [], { address: ADDR });
    const ws = snap.wallets || [];
    let posTotal = 0, grpNet = 0, grpN = 0;
    for (const e of ws) {
      const net = (e.buyTok || 0) - (e.sellTok || 0);
      if (net > 0) posTotal += net;
      if (arbSet.has(e.w)) { grpNet += net; if (net > 0) grpN++; }
    }
    console.log(`\n===== anchor ${anchorIso} ticks=${rows.length} wallets=${ws.length} =====`);
    console.log(`arbBotHoldCircPct = ${(grpNet / posTotal * 100).toFixed(2)}% (${grpN}户)  Σ正净=${posTotal.toExponential(4)}`);
    // 全体正净持有者排序
    const pos = ws.map((e) => ({ w: e.w, net: (e.buyTok || 0) - (e.sellTok || 0), buyBnb: e.buyBnb, sellBnb: e.sellBnb, buyN: e.buyN, sellN: e.sellN }))
      .filter((e) => e.net > 0).sort((a, b) => b.net - a.net);
    pos.forEach((e, i) => {
      const tags = tagMap.get(e.w);
      const isArb = arbSet.has(e.w);
      console.log(`  #${i + 1} ${e.w} 占${(e.net / posTotal * 100).toFixed(1)}% 买${e.buyBnb.toFixed(3)}B/${e.buyN}笔 卖${e.sellBnb.toFixed(3)}B/${e.sellN}笔${isArb ? '  ←arbBot[' + (tags || []).join(',') + ']' : tags ? '  画像[' + tags.join(',') + ']' : ''}`);
    });
    // 组内负净（已清仓机器）也列一下
    for (const e of ws) {
      const net = (e.buyTok || 0) - (e.sellTok || 0);
      if (arbSet.has(e.w) && net <= 0) console.log(`  (组内已清仓) ${e.w} net=${net.toExponential(3)}`);
    }
  }
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
