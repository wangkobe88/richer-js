#!/usr/bin/env node
// 一次性：建 JG-6 对拍两臂回测实验（FP33 豁免关=基线 / 开=实验）。
// clone bt-v164 整包 config，换 caseCollectionId=6fd0372f（112 票）。本地跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const BASE_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164
const COLLECTION_ID = '6fd0372f-48eb-494d-890b-5fa652127609';
const ARMS = [
  { name: 'bt-v168-jg6c-fp34-ctrl', exempt: false, desc: 'JG-6c 对拍对照臂（FP34 豁免关=FP32 行为）：崩塌域门族全集 2489 票回放，门链真调' },
  { name: 'bt-v169-jg6c-fp34-exempt', exempt: true, desc: 'JG-6c 对拍实验臂（FP34 tailDipOrganicExempt=true 两臂族豁免）：同包同集合——JG6 面 85 张 FP 放行 80 张、右尾成交与损耗面真实 PnL=定案指标' },
];

(async () => {
  const db = dbManager.getClient();
  const { data: base, error } = await db.from('experiments').select('*').eq('id', BASE_ID).single();
  if (error || !base) throw new Error('基底实验不存在: ' + error.message);

  for (const arm of ARMS) {
    const { data: dup } = await db.from('experiments').select('id').eq('experiment_name', arm.name).maybeSingle();
    if (dup) { console.log(`${arm.name} 已存在 ${dup.id}，跳过`); continue; }
    const cfg = JSON.parse(JSON.stringify(base.config || {}));
    delete cfg.strategyResolved;
    cfg.backtest = {
      caseCollectionId: COLLECTION_ID,
      maxTickRows: base.config?.backtest?.maxTickRows ?? 2000000,
      signalGateReal: true,
    };
    cfg.platform = base.config?.platform || 'both';
    // FP33 豁免灰度（fourmemeWs.buyPointCheck.factorCheck 段；flap 经 _mergedWsConfig 同键）
    cfg.fourmemeWs = JSON.parse(JSON.stringify(cfg.fourmemeWs || {}));
    cfg.fourmemeWs.buyPointCheck = JSON.parse(JSON.stringify(cfg.fourmemeWs.buyPointCheck || {}));
    cfg.fourmemeWs.buyPointCheck.factorCheck = JSON.parse(JSON.stringify(cfg.fourmemeWs.buyPointCheck.factorCheck || {}));
    cfg.fourmemeWs.buyPointCheck.factorCheck.enabled = true; // 基底形状（有 FP 拒行=已开）
    cfg.fourmemeWs.buyPointCheck.factorCheck.tailDipOrganicExempt = arm.exempt;
    if (cfg.flapWs) {
      cfg.flapWs = JSON.parse(JSON.stringify(cfg.flapWs));
      cfg.flapWs.buyPointCheck = JSON.parse(JSON.stringify(cfg.flapWs.buyPointCheck || {}));
      cfg.flapWs.buyPointCheck.factorCheck = JSON.parse(JSON.stringify(cfg.flapWs.buyPointCheck.factorCheck || {}));
      cfg.flapWs.buyPointCheck.factorCheck.enabled = true;
      cfg.flapWs.buyPointCheck.factorCheck.tailDipOrganicExempt = arm.exempt;
    }
    cfg.name = arm.name;
    const row = {
      experiment_name: arm.name,
      experiment_description: arm.desc,
      status: 'stopped',
      trading_mode: 'backtest',
      strategy_type: base.strategy_type,
      blockchain: base.blockchain || 'bsc',
      kline_type: base.kline_type || '1m',
      config: cfg,
    };
    const { data: inserted, error: ie } = await db.from('experiments').insert(row).select('id, experiment_name').single();
    if (ie) throw new Error(`${arm.name} 创建失败: ` + ie.message);
    console.log(`${arm.name} → ${inserted.id}（豁免=${arm.exempt}）`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
