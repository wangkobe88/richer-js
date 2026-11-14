#!/usr/bin/env node
// ============================================================================
// T117 v73 live 实验创建（2026-11-05 用户裁定：开实盘小额度跑门链）
//   clone v72 (edbd5b38) config → 买腿换 signal-source-ladder-v1（copy-in 快照）
//   + buyPointCheck.enabled + buySignalMaxPerToken 2→10；其余（卖腿 16/钱包/
//   cheatCheck/卡牌/stallClose/gmgnEntryCheck/observationSignals）照抄。
//   前置：v72 已停（净持仓 29 token 全零确认过）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const crypto = require('crypto');

const V72_ID = 'edbd5b38-27db-4dd4-8205-4bebfa410ea6';
const LADDER_LIB_ID = '78836359-48f2-4e8b-ab5a-3e81cfcc7d6a';

async function main() {
    const { dbManager } = require('../src/services/dbManager');
    const db = dbManager.getClient();

    // 1. 拉 v72 整行
    const { data: v72, error: e1 } = await db.from('experiments').select('*').eq('id', V72_ID).single();
    if (e1 || !v72) throw new Error('v72 拉取失败: ' + (e1 && e1.message));

    // 2. 拉库条目 ladder legs（copy-in 快照真相源）
    const { data: lib, error: e2 } = await db.from('strategy_library').select('*').eq('id', LADDER_LIB_ID).single();
    if (e2 || !lib) throw new Error('库条目拉取失败: ' + (e2 && e2.message));
    console.log(`[OK] 库条目: ${lib.name} v${lib.version} side=${lib.side} legs=${lib.legs.length}`);

    // 3. 构造新 config
    const config = JSON.parse(JSON.stringify(v72.config));
    config.name = 'v73-实盘-both-T117信号源阶梯-门链-1105';
    config.description = 'T117 买入策略整体调整首跑（2026-11-05）：买腿=signal-source-ladder-v1 七腿阶梯（触发即消耗→作弊门二元版（t1-t3 recheck）→BP2 门 good/neutral 过）；纯盘面无叙事/GMGN 层；buySignalMaxPerToken=10 显式（≥7 腿不截断）；卖腿沿用 v72 十六腿；cheatCheck+buyPointCheck 双开。';
    // 买腿换 ladder 快照（腿对象原样 copy-in）
    config.strategiesConfig.buyStrategies = JSON.parse(JSON.stringify(lib.legs));
    // libraryRefs：去 buy-v2 加 ladder
    config.strategiesConfig.libraryRefs = (config.strategiesConfig.libraryRefs || [])
        .filter(r => r.side !== 'buy');
    config.strategiesConfig.libraryRefs.unshift({
        name: lib.name, side: 'buy', libId: lib.id, version: lib.version,
        legCount: lib.legs.length, snapshotAt: new Date().toISOString(),
    });
    // 三开关
    config.fourmemeWs = config.fourmemeWs || {};
    config.fourmemeWs.buyPointCheck = { enabled: true, gate: { awaitMs: 15000 } };
    config.fourmemeWs.buySignalMaxPerToken = 10;
    // 自检断言：ladder 腿全部带 signalGate 且无七个旧门字段
    const OLD_GATE_FIELDS = ['narrativeTriggerCondition', 'narrativeCallCondition', 'narrativePrefetchCondition', 'preBuyCheckCondition', 'repeatBuyCheckCondition', 'gmgnCheckCondition', 'cheatCheckCondition'];
    for (const l of config.strategiesConfig.buyStrategies) {
        if (!l.signalGate) throw new Error(`买腿 ${l.id || l.priority} 缺 signalGate`);
        for (const f of OLD_GATE_FIELDS) if (l[f]) throw new Error(`买腿 ${l.id || l.priority} 带 ${f}（互斥违规）`);
    }
    if (!config.fourmemeWs.cheatCheck || config.fourmemeWs.cheatCheck.enabled !== true) throw new Error('cheatCheck.enabled 必须 true');
    console.log(`[OK] config 构造: 买腿 ${config.strategiesConfig.buyStrategies.length}（ladder）+ 卖腿 ${config.strategiesConfig.sellStrategies.length}`);
    console.log(`     buySignalMaxPerToken=${config.fourmemeWs.buySignalMaxPerToken} buyPointCheck=${JSON.stringify(config.fourmemeWs.buyPointCheck)} cheatCheck=${JSON.stringify(config.fourmemeWs.cheatCheck)}`);
    console.log(`     wallet=${config.wallet.address} tradeAmount=${config.tradeAmount}`);

    // 4. INSERT 新行
    const newId = crypto.randomUUID();
    const row = {
        id: newId,
        experiment_name: config.name,
        experiment_description: config.description,
        status: 'created',
        config,
        trading_mode: v72.trading_mode,
        strategy_type: v72.strategy_type,
        blockchain: v72.blockchain,
        kline_type: v72.kline_type,
    };
    const { error: e3 } = await db.from('experiments').insert(row);
    if (e3) throw new Error('INSERT 失败: ' + e3.message);
    console.log(`\n[OK] v73 已创建: ${newId}`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
