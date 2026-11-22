#!/usr/bin/env node
// 一次性（182 跑）：BP88 真调 Jev——ZKind 主案票新代码下 BP 门综判对拍（烧 1 次配额）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService');
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';

(async () => {
  // 锚=bt-v164 信号时刻（对齐生产 anchorCountAt 口径）
  const { data, error } = await dbManager.getClient().from('strategy_signals')
    .select('created_at').eq('experiment_id', '9e9163de-a677-4d39-9c33-9ec9df05e400')
    .eq('token_address', TOKEN).eq('signal_type', 'BUY').limit(1);
  if (error) throw new Error(error.message);
  const anchorMs = Date.parse(data[0].created_at);
  console.log('anchor =', data[0].created_at, anchorMs);
  const svc = new BuyPointCheckService({ enabled: true, persist: false, timeoutMs: 45000 }, console);
  const r = await svc.gateBuyPoint(TOKEN, { platform: 'flap' },
    { experimentId: 'bp88-jev-parity-offline' }, { anchorMs });
  console.log('=== result ===');
  console.log(JSON.stringify({
    status: r.status,
    bucket: r.assessment && r.assessment.bucket,
    rule: r.assessment && r.assessment.rule,
    entry_shape: r.dimensions && r.dimensions.entry_shape,
    market_pattern: r.dimensions && r.dimensions.market_pattern,
    activity_level: r.dimensions && r.dimensions.activity_level,
    holder_concentration: r.dimensions && r.dimensions.holder_concentration,
  }, null, 1));
  // 关键锚核对（新代码下应为 null）
  const a = (r.anchors) || {};
  console.log('dumpBlockBnb=', a.dumpBlockBnb, 'dump2BlockBnb=', a.dump2BlockBnb,
    'dumpBlockSecToAnchor=', a.dumpBlockSecToAnchor, 'curVsLaunchPct=', a.currentVsLaunchPct);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
