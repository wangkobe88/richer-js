'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0x2ee9458681c134e9c7cd933b7af94be50a1f7777';
const BOTS = [
  '0xedcbcc3173a69c86b5c67f75b5656cd70b65399c',
  '0x073c01e779677c6ce5085840794d3647ac183efb',
];

(async () => {
  const sb = dbManager.getClient();

  // 1) GMGN 画像全字段
  const { data: profiles, error: pErr } = await sb.from('gmgn_wallet_profiles')
    .select('*').in('address', BOTS);
  if (pErr) throw new Error(pErr.message);
  for (const p of profiles || []) {
    console.log('===== 画像', p.address, '=====');
    console.log(JSON.stringify(p, null, 1));
  }

  // 2) 本票全程行为（不截锚，票生命尽头）
  for (const b of BOTS) {
    const { data: ticks, error } = await sb.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,tx_hash,sender_address,trader_address')
      .eq('token_address', ADDR)
      .or(`sender_address.eq.${b},trader_address.eq.${b}`)
      .limit(500);
    if (error) throw new Error(error.message);
    ticks.sort((x, y) => x.block_number - y.block_number || x.log_index - y.log_index);
    console.log(`\n===== ${b} 本票全部成交（${ticks.length} 行）=====`);
    for (const t of ticks) {
      console.log(`${t.block_time} blk=${t.block_number}:${t.log_index} ${t.trade_type} ${t.bnb_amount}B @${t.price_bnb && t.price_bnb.toExponential(3)} via=${t.sender_address === b ? 'sender' : 'trader'} tx=${t.tx_hash}`);
    }
  }

  // 3) 全库活动量（这两址参与的票数/行数——判断是否高频机器）
  for (const b of BOTS) {
    const c1 = await sb.from('wss_price_ticks').select('id', { count: 'exact', head: true })
      .eq('sender_address', b);
    const c2 = await sb.from('wss_price_ticks').select('id', { count: 'exact', head: true })
      .eq('trader_address', b);
    console.log(`\n${b} 全库行数: sender=${c1.count} trader=${c2.count}`);
  }
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
