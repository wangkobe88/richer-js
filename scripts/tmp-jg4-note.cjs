#!/usr/bin/env node
// 一次性：JG-4 备注同步金狗集合成员 note。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const NOTE = 'JG-4 burst 断流卖出误伤（2026-11-21）：T189 批1「15s 承接 0<0.1B」于 +8.6% 全清（持有 15s），后 10min 峰值 ×7.88（+688%）；burst 4 钱包全 GMGN 生态流量（367/67/17 票 bot + 1761 票职业户），fire 后 15s 成交真空、承接 45s+ 才来=慢热承接形状，15s/30s 观察窗过短。不立法单票，归 T189 余留「确认组大涨误伤」观察面攒批。全档=docs/金狗Case集合台账.md JG-4。';

(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('case_collection_tokens')
    .update({ note: NOTE })
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105')
    .eq('token_address', '0x4509204c4f82dee14352bf7cfafae4138b287777')
    .select('token_address, note');
  if (error) throw new Error(error.message);
  console.log('已更新:', data[0].token_address, '\nnote=', data[0].note);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
