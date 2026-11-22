#!/usr/bin/env node
// 一次性：JG-6 备注同步金狗集合成员 note。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const NOTE = 'JG-6 famous 快闪砸出黄金坑（2026-11-21）：쿠우타 02:30:40~02:33:46 五次触发被 T182 tail_dip×2/T192 lifecycle_sell×3 拦（判据当时成立拦得对）；低点=末次被拦后 9s，随后 342 新钱包 61.9B 纯散户传播拉 ×10.8 毕业（famous/smart 第二波零参与、崩塌非 famous 所砸=第一波大户获利了结）。真正死因=02:33:49~02:34:02 的 13 秒企稳金窗（FP 门本会放行）被机制错过：P4 被 T110 3s 冷却吞、P4~P9 holders 9→8 灭、P11+ 在 02:34:02 fire 时 actTotalBnb=0（10s 窗空）全灭，急拉喂入后 02:34:28 fire 价格已 +47% 出 28.5 位置门=结构性盲区。归 T203 fpRetry 生效面（P10 拒后 30s 地平线内重评即买）。全档=docs/金狗Case集合台账.md JG-6。';

(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('case_collection_tokens')
    .update({ note: NOTE })
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105')
    .eq('token_address', '0xc0e896ddec43881055a25786c17fa5d5d6337777')
    .select('token_address, note');
  if (error) throw new Error(error.message);
  console.log('已更新:', data[0].token_address);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
