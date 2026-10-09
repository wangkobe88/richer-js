// 新建 v4 实跑虚拟实验：复制 8aca25e2 config → buy 腿升 buy-v2 v4（加 router 门）
'use strict';
require('dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const crypto = require('crypto');
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const SRC = '8aca25e2-7baf-421d-9a6a-6698d85d977d';
const PREBUY_V3 = '(narrativeRating == 2 OR narrativeRating == 3) AND earlyTradesTop1BuySharePct < 60 AND earlyTradesTop1BuyCovered == 1';
const PREBUY_V4 = PREBUY_V3 + ' AND earlyTradesRouterPct < 60';

async function main() {
  const c = dbManager.getClient();
  const { data: src, error } = await c.from('experiments').select('*').eq('id', SRC).single();
  if (error) throw new Error(error.message);

  const cfg = structuredClone(src.config);
  const now = new Date().toISOString();
  cfg.name = '9-双平台虚拟-V2策略+router门-0930';
  cfg.description = 'buy-v2 v4 实跑（0x1de460 GMGN 案 A 方案）：90s 窗 + top1 门 + 冷档门 + router 门（earlyTradesRouterPct<60，GMGN 主导盘拦截）+ sender 真实买家口径引擎；卖侧 17 腿与引擎段整包继承 8aca25e2；配对回测 R1 验证净效应 +1.808 BNB';
  const buys = cfg.strategiesConfig.buyStrategies;
  for (const l of buys) {
    if (l.preBuyCheckCondition === PREBUY_V3) l.preBuyCheckCondition = PREBUY_V4;
  }
  cfg.strategiesConfig.libraryRefs = (cfg.strategiesConfig.libraryRefs || []).map(r =>
    r.name === 'buy-v2' ? { ...r, version: 4, snapshotAt: now } : r);

  const id = crypto.randomUUID();
  const { error: insErr } = await c.from('experiments').insert({
    id,
    experiment_name: '9-双平台虚拟-V2策略+router门-0930',
    experiment_description: cfg.description,
    status: 'created', trading_mode: 'virtual',
    blockchain: src.blockchain, config: cfg,
  });
  if (insErr) throw new Error(insErr.message);

  // 校验落库形状
  const { data: chk } = await c.from('experiments').select('config->strategiesConfig->buyStrategies->0->preBuyCheckCondition').eq('id', id).single();
  console.log('NEW_ID=' + id);
  console.log('preBuy 落库校验:', chk.preBuyCheckCondition === PREBUY_V4 ? '✅ v4' : '❌ ' + chk.preBuyCheckCondition);
  process.exit(0);
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
