'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const ADDR = '0x0bba00ba64c147a6477fd18720b782a640357777';
const FLOOR = 5.546337995470633e-9; // flap FL 常量
(async () => {
  const sb = dbManager.getClient();
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time, block_number, trade_type, bnb_amount, price_bnb, sender_address, trader_address')
    .eq('token_address', ADDR)
    .gte('block_time', '2026-10-03T11:26:50Z')
    .lt('block_time', '2026-10-03T11:30:00Z')
    .order('block_time', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  console.log('ticks in 190s:', ticks.length);
  const t0 = new Date('2026-10-03T11:26:50Z');
  const firstPrice = ticks[0].price_bnb;
  const DUST_TOKENS = 0.015 / firstPrice; // holdersExDust 首可靠价折算
  let tradeCount = 0, cumBuy = 0;
  const hold = new Map(); // wallet -> net tokens
  const blockWallets = new Map(); // block -> wallets (开盘首块)
  let reported = {};
  const keyMoments = [];
  for (const t of ticks) {
    tradeCount++;
    const amt = Number(t.bnb_amount);
    const tokens = amt / t.price_bnb;
    const w = (t.sender_address || t.trader_address || '?').toLowerCase();
    if (t.trade_type === 'BUY') { cumBuy += amt; hold.set(w, (hold.get(w) || 0) + tokens); }
    else { hold.set(w, (hold.get(w) || 0) - tokens); }
    const age = (new Date(t.block_time) - t0) / 1000;
    const curVs = (t.price_bnb / FLOOR - 1) * 100;
    const holders = [...hold.values()].filter(v => v >= DUST_TOKENS).length;
    // 记录 age 15s 之后每 5s 的状态快照
    if (age >= 13) {
      const k = Math.floor(age / 5);
      if (!reported[k]) {
        reported[k] = 1;
        keyMoments.push(`age${age.toFixed(0)}s n${tradeCount} cumBuy${cumBuy.toFixed(2)}B holders${holders} price${t.price_bnb.toExponential(3)} curVs${curVs.toFixed(1)}% ${curVs <= 28.5 ? '域内' : '★穿域'}`);
      }
    }
  }
  console.log('首可靠价:', firstPrice.toExponential(4), 'dust 门(代币数):', DUST_TOKENS.toExponential(3));
  console.log(keyMoments.join('\n'));
  // 全程价格何时首次穿出 +28.5 域
  let firstOut = ticks.find(t => t.price_bnb > FLOOR * 1.285);
  console.log('首次穿出+28.5域:', firstOut ? `${firstOut.block_time} age${((new Date(firstOut.block_time)-t0)/1000).toFixed(1)}s` : '未穿出');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
