#!/usr/bin/env node
/**
 * 2026-10-19 人气门批次落地（用户裁定）：v25 → v26
 *   买腿：condition 追加 AND buyVolumeBnb >= 1.25 AND holders >= 10（等冲破门）
 *   卖腿：新增死票清仓臂 holdDuration > 120 AND buyVolumeBnb < 2
 *   库：buy-v2 v22（旧形状残留）同步为 v26 同语义 → v23
 * 用法：node scripts/tmp-deploy-v26.cjs [--commit]（缺省 dry-run 只打印 diff）
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const V25_ID = 'ce61e332-77c3-40bd-be9c-099c36b5f4fa';
const LIB_ID = '57d0dd71-6bae-47bf-8b74-4cc0bc1084e4';

const BUY_APPEND = ' AND buyVolumeBnb >= 1.25 AND holders >= 10';
const BUY_DESC_APPEND = ' | 2026-10-19 人气门（等冲破门分析 v22+v23+v24 111 票裁定）：买条件加 buyVolumeBnb >= 1.25 AND holders >= 10——per-tick 等冲破语义（好票持续有人买自然破 1.25/10，烂票终态到不了=不买；v19 删的是静态 buyVolumeBnb>=1.0 门，本门为等冲破重加）；发起门 0.1 < 1.25 量轴序保持；回放 sim：buyVolume X=1.5 +0.0305、holders H=10 +0.0214（买 28 张）；对倒票（先真买拉盘再出货）三门全失效为已知盲区';

const SELL_NEW_LEG = {
    cards: 'all',
    priority: 4,
    condition: 'holdDuration > 120 AND buyVolumeBnb < 2',
    cooldownSec: null,
    description: '死票清仓臂-120s（2026-10-19 用户裁定「卖腿增加 holdDuration > 120 AND buyVolumeBnb < 2」）：持有超 120s 且全盘累计买入量 buyVolumeBnb < 2（FA state.totalBuyBnb 出生累计、只增不减）= 买入后无人接盘的死票全清；买入时刻 buyVolumeBnb >= 1.25（买门），持有 120s 仍 < 2 ⇒ 期间新买 < 0.75 BNB；v22-v24 111 票回放 sim +0.0373（全量入场保留口径）；holdDuration=fire 时刻信号口径（同 P13 时间止损腿口径）；与 P4 族（<4000 快跑 / <3500 底部等待）互补=覆盖 marketCap >= 4000 但人气已死的票；sellPercentage=1 全清；maxExecutions 刻意不设（卖出失败每轮重试直到清仓）；bypass=false 走 3.5s+5tick 双门（断流死票由 30s 持仓卖腿兜底扫描评估）',
    bypassDebounce: false,
    sellPercentage: 1,
};

async function main() {
    const commit = process.argv.includes('--commit');
    const db = dbManager.getClient();

    const { data: exps } = await db.from('experiments').select('*').eq('id', V25_ID);
    if (!exps || !exps.length) throw new Error('v25 行不存在');
    const v25 = exps[0];
    const { data: libs } = await db.from('strategy_library').select('*').eq('id', LIB_ID);
    const lib = libs[0];

    // ---- 构造 v26 config（v25 深克隆 + 三处改动）----
    const cfg = JSON.parse(JSON.stringify(v25.config));
    const buyLeg = cfg.strategiesConfig.buyStrategies[0];
    if (!buyLeg.condition.endsWith('famousCopyWalletCircPct < 15)')) {
        throw new Error('v25 买腿 condition 尾部形状与预期不符，中止防错基底: ...' + buyLeg.condition.slice(-80));
    }
    buyLeg.condition = buyLeg.condition + BUY_APPEND;
    buyLeg.description = buyLeg.description + BUY_DESC_APPEND;
    cfg.strategiesConfig.sellStrategies.push(JSON.parse(JSON.stringify(SELL_NEW_LEG)));
    cfg.strategiesConfig.libraryRefs[0].version = 23;
    cfg.strategiesConfig.libraryRefs[0].snapshotAt = new Date().toISOString();
    cfg.name = 'v26-实盘-both-人气门buyVol1.25holders10-卖120s死票-1019';
    cfg.description = `2026-10-19 人气门批次（v22+v23+v24 111 票等冲破门分析）：买腿加 buyVolumeBnb >= 1.25 AND holders >= 10（per-tick 等冲破：好票持续有人买自然破门，烂票终态到不了=不买）；卖腿新增死票清仓臂 holdDuration > 120 AND buyVolumeBnb < 2（sim +0.0373）；其余与 v25 逐字相同（buy-v2 库同步 v23=本实验买腿同语义）；叙事 C104-C110 批次机制延续`;

    // ---- 构造库 v23 legs（与 v26 买腿逐字同语义）----
    const libLegs = JSON.parse(JSON.stringify(lib.legs));
    libLegs[0].condition = buyLeg.condition;
    libLegs[0].description = buyLeg.description;

    // ---- dry-run 报告 ----
    console.log('=== BUY condition 尾部（新增段）===');
    console.log('...' + buyLeg.condition.slice(-120));
    console.log('\n=== SELL legs:', cfg.strategiesConfig.sellStrategies.length, '(v25=15)===');
    console.log('NEW:', SELL_NEW_LEG.condition, '| prio', SELL_NEW_LEG.priority, '| pct', SELL_NEW_LEG.sellPercentage, '| cards', SELL_NEW_LEG.cards, '| bypass', SELL_NEW_LEG.bypassDebounce);
    console.log('\nlibraryRefs ->', JSON.stringify(cfg.strategiesConfig.libraryRefs));
    console.log('\nv26 name:', cfg.name);
    console.log('experiment_name:', cfg.name);
    if (!commit) { console.log('\n[DRY-RUN] 未写入。加 --commit 执行：库 v22→v23 + INSERT v26 行（status=created）'); process.exit(0); }

    // ---- 写入 1：库乐观锁 UPDATE v22 → v23 ----
    const { data: upd, error: updErr } = await db.from('strategy_library')
        .update({ legs: libLegs, version: 23, updated_at: new Date().toISOString() })
        .eq('id', LIB_ID).eq('version', 22)
        .select('id, version');
    if (updErr) throw new Error('库更新失败: ' + updErr.message);
    if (!upd || !upd.length) throw new Error('库乐观锁冲突（version != 22），未写入——重查后重试');
    console.log('\n[OK] strategy_library buy-v2 -> version', upd[0].version);

    // ---- 写入 2：INSERT v26 实验行 ----
    const newId = crypto.randomUUID();
    const row = {
        id: newId,
        experiment_name: cfg.name,
        experiment_description: cfg.description,
        status: 'created',
        trading_mode: v25.trading_mode,
        strategy_type: v25.strategy_type,
        blockchain: v25.blockchain,
        kline_type: v25.kline_type,
        started_at: null,
        stopped_at: null,
        config: cfg,
    };
    const { data: ins, error: insErr } = await db.from('experiments').insert(row).select('id, experiment_name, status');
    if (insErr) throw new Error('实验行插入失败: ' + insErr.message);
    console.log('[OK] experiments INSERT:', ins[0].id, '|', ins[0].experiment_name, '|', ins[0].status);
    console.log('\nNEXT: 182 停 v25 (ce61e332) -> main.js start-experiment -e ' + newId + ' --force');
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
