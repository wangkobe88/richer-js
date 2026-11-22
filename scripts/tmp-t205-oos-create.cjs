#!/usr/bin/env node
// 一次性：建 T205 对拍四臂回测实验（ctrl=FP34 豁免开+T205 三键关 / +①阶段前提 /
// +②量腿 / 全开）。clone bt-v164 整包 config，换 caseCollectionId=6fd0372f（2489 票
// 崩塌域全集）。本地跑（只建行不启动）。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const BASE_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164
const COLLECTION_ID = '781083cd-d1b3-4189-a990-d9b02ab657b2';
const ARMS = [
  { name: 'bt-v175-t205-oos-ctrl', stage: false, vol: false, desc: 'T205 窗外验证对照臂：win1103（冷窗）act_low 族 375 票集合回放，T205 三键关=现行生产行为（FP38，ABC 已撤回）' },
  { name: 'bt-v176-t205-oos-both', stage: true, vol: true, desc: 'T205 窗外验证实验臂：同集合三键全开（阶段前提+量腿）——低活跃放行在标定窗外自然窗的真实期望（增量面=转正终验指标）' },
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
    // FP 段：ctrl 也显式带 tailDipOrganicExempt=true（T204c 转正后现行生产行为，
    // 不依赖 182 default.json 状态=对拍可复现）
    cfg.fourmemeWs = JSON.parse(JSON.stringify(cfg.fourmemeWs || {}));
    cfg.fourmemeWs.buyPointCheck = JSON.parse(JSON.stringify(cfg.fourmemeWs.buyPointCheck || {}));
    cfg.fourmemeWs.buyPointCheck.factorCheck = Object.assign(
      {}, cfg.fourmemeWs.buyPointCheck.factorCheck,
      { enabled: true, tailDipOrganicExempt: true, actStageColdExempt: arm.stage, tailDipVolumeLeg: arm.vol });
    // cheat 段：gate 合并（保留 awaitMs/alwaysRecheck/activityExemptLevels）
    cfg.fourmemeWs.cheatCheck = JSON.parse(JSON.stringify(cfg.fourmemeWs.cheatCheck || {}));
    cfg.fourmemeWs.cheatCheck.gate = Object.assign({}, cfg.fourmemeWs.cheatCheck.gate,
      { actStageColdExempt: arm.stage });
    if (cfg.flapWs) { // both 实验无 flapWs 段（wsSection=fourmemeWs）；有则同键镜像
      cfg.flapWs = JSON.parse(JSON.stringify(cfg.flapWs));
      cfg.flapWs.buyPointCheck = JSON.parse(JSON.stringify(cfg.flapWs.buyPointCheck || {}));
      cfg.flapWs.buyPointCheck.factorCheck = Object.assign({}, cfg.flapWs.buyPointCheck.factorCheck,
        { enabled: true, tailDipOrganicExempt: true, actStageColdExempt: arm.stage, tailDipVolumeLeg: arm.vol });
      cfg.flapWs.cheatCheck = JSON.parse(JSON.stringify(cfg.flapWs.cheatCheck || {}));
      cfg.flapWs.cheatCheck.gate = Object.assign({}, cfg.flapWs.cheatCheck.gate, { actStageColdExempt: arm.stage });
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
    console.log(`${arm.name} → ${inserted.id}（stage=${arm.stage} vol=${arm.vol}）`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
