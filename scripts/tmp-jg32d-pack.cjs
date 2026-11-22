#!/usr/bin/env node
// JG-32d：建 jg32c-b24-nofp 临时策略包（=库 v2 definition 减 modules.factorCheck）并把 B 臂 strategyId 指过去
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const SRC = '479f3109-41ac-4424-bb2b-5309c47ee88a'; // trading-standard-v1
const ARM_B = 'ef2f5af0-5ab7-4577-8028-4ea9a51b889f';
const NAME = 'jg32c-b24-nofp';
(async () => {
  const sb = dbManager.getClient();
  const { data: cur, error: e0 } = await sb.from('strategy_library').select('name').eq('name', NAME).limit(1);
  let packId;
  if (cur && cur.length) { packId = (await sb.from('strategy_library').select('id').eq('name', NAME).limit(1)).data[0].id; console.log('已存在', packId); }
  else {
    const { data: src, error: e1 } = await sb.from('strategy_library').select('definition,version').eq('id', SRC).limit(1);
    if (e1 || !src.length) throw new Error('源包读取失败');
    const def = JSON.parse(JSON.stringify(src[0].definition));
    if (!def.modules || !('factorCheck' in def.modules)) throw new Error('modules.factorCheck 缺失？形状意外');
    delete def.modules.factorCheck;
    const { data: ins, error: e2 } = await sb.from('strategy_library')
      .insert({ name: NAME, description: 'JG-32d B 臂临时包：trading-standard-v1 v' + src[0].version + ' 原样仅去 modules.factorCheck（FP 因子门关）——验证 FP32 豁免后 AF1/cheat/BP 拦截率；勿用于生产', definition: def })
      .select('id').single();
    if (e2) throw new Error('插入失败: ' + e2.message);
    packId = ins.id;
    console.log('新包', packId, NAME, '（源 v' + src[0].version + '，modules=' + Object.keys(def.modules).join(',') + '）');
  }
  const { error: e3 } = await sb.from('experiments').update({ config: { strategyId: packId } }).eq('id', ARM_B);
  if (e3) throw new Error('实验更新失败: ' + e3.message);
  // config 是 jsonb 整替换——用 SQL jsonb_set 更稳：重读-合并-写回
  const { data: exp } = await sb.from('experiments').select('config').eq('id', ARM_B).limit(1);
  const cfg = exp[0].config;
  if (cfg.strategyId !== packId) {
    cfg.strategyId = packId;
    const { error: e4 } = await sb.from('experiments').update({ config: cfg }).eq('id', ARM_B);
    if (e4) throw new Error('重写失败: ' + e4.message);
  }
  console.log('B 臂 strategyId →', packId, '✓');
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
