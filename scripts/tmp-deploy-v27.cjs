#!/usr/bin/env node
/**
 * 2026-10-20 单块占比门批次（用户裁定：阈值 25）：v26 → v27
 *   买腿：condition 追加 AND maxBlockBuyCircPct < 25
 *        （maxBlockBuyCircPct 同日改为「全史最大单块买入 token ÷ 当前流通」口径——
 *         滚动 10s 版在大块滑出窗后归零，只能当冷却；乌龟案 0xb2782a4a…fe7777
 *         同块 4 钱包 0.59BNB/7.70e7 token，fire 真值 29.0%，X=25 可整段拦截）
 *   库：buy-v2 v23 → v24（与 v27 买腿逐字同语义）
 * 用法：node scripts/tmp-deploy-v27.cjs [--commit]（缺省 dry-run 只打印 diff）
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const V26_ID = '05222b30-0272-4278-975e-169964683987';
const LIB_ID = '57d0dd71-6bae-47bf-8b74-4cc0bc1084e4';
const LIB_FROM = 23;
const LIB_TO = 24;

const BUY_APPEND = ' AND maxBlockBuyCircPct < 25';
const BUY_DESC_APPEND = ' | 2026-10-20 乌龟案（0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777）：maxBlockBuyCircPct 口径由「10s 滚动窗最大单块」改为「全史最大单块买入 token ÷ 当前流通」，买腿加 maxBlockBuyCircPct < 25——该票 fire 真值 29.0%（block 128584437 同块 4 钱包 0.591BNB/7.70e7 token），X=25 整段拦截；112 票回放：X=25 过 3 张、拦 20 张（被拦原 net -0.0160），代价是入场进一步变晚（平均入场倍率 1.635）与 FREEMAN/反弹猫等盈利票被拦——用户裁定先上 25 观察';

async function main() {
    const commit = process.argv.includes('--commit');
    const db = dbManager.getClient();

    const { data: exps } = await db.from('experiments').select('*').eq('id', V26_ID);
    if (!exps || !exps.length) throw new Error('v26 行不存在');
    const v26 = exps[0];
    const { data: libs } = await db.from('strategy_library').select('*').eq('id', LIB_ID);
    const lib = libs[0];
    if (!lib) throw new Error('库行不存在');
    if (lib.version !== LIB_FROM) throw new Error(`库 version=${lib.version} != ${LIB_FROM}，中止防错基底`);

    // ---- 构造 v27 config（v26 深克隆 + 两处改动）----
    const cfg = JSON.parse(JSON.stringify(v26.config));
    const buyLeg = cfg.strategiesConfig.buyStrategies[0];
    if (!buyLeg.condition.endsWith('AND buyVolumeBnb >= 1.25 AND holders >= 10')) {
        throw new Error('v26 买腿 condition 尾部形状与预期不符，中止防错基底: ...' + buyLeg.condition.slice(-80));
    }
    if (buyLeg.condition.includes('maxBlockBuyCircPct')) throw new Error('买腿已含 maxBlockBuyCircPct，中止防重复');
    buyLeg.condition = buyLeg.condition + BUY_APPEND;
    buyLeg.description = buyLeg.description + BUY_DESC_APPEND;
    cfg.strategiesConfig.libraryRefs[0].version = LIB_TO;
    cfg.strategiesConfig.libraryRefs[0].snapshotAt = new Date().toISOString();
    cfg.name = 'v27-实盘-both-人气门buyVol1.25holders10-全史单块25-1020';
    cfg.description = `2026-10-20 单块占比门批次：买腿加 maxBlockBuyCircPct < 25（maxBlockBuyCircPct 同日改为全史口径——滚动 10s 版大块滑出窗即归零只能当冷却）；乌龟案 0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777 fire 真值 29.0%、X=25 拦截；112 票回放 X=25 过 3 拦 20（被拦原 net -0.0160，平均入场倍率 1.635，FREEMAN/反弹猫被拦=已知代价）；其余与 v26 逐字相同（buy-v2 库同步 v24=本实验买腿同语义）`;

    // ---- 构造库 v24 legs（与 v27 买腿逐字同语义）----
    const libLegs = JSON.parse(JSON.stringify(lib.legs));
    libLegs[0].condition = buyLeg.condition;
    libLegs[0].description = buyLeg.description;

    console.log('=== BUY condition 尾部（新增段）===');
    console.log('...' + buyLeg.condition.slice(-160));
    console.log('\nlibraryRefs ->', JSON.stringify(cfg.strategiesConfig.libraryRefs));
    console.log('v27 name:', cfg.name);
    console.log('wallet:', JSON.stringify(cfg.wallet));
    if (!commit) { console.log('\n[DRY-RUN] 未写入。加 --commit 执行：库 v23→v24 + INSERT v27 行（status=created）'); process.exit(0); }

    // ---- 写入 1：库乐观锁 UPDATE v23 → v24 ----
    const { data: upd, error: updErr } = await db.from('strategy_library')
        .update({ legs: libLegs, version: LIB_TO, updated_at: new Date().toISOString() })
        .eq('id', LIB_ID).eq('version', LIB_FROM)
        .select('id, version');
    if (updErr) throw new Error('库更新失败: ' + updErr.message);
    if (!upd || !upd.length) throw new Error(`库乐观锁冲突（version != ${LIB_FROM}），未写入——重查后重试`);
    console.log('\n[OK] strategy_library buy-v2 -> version', upd[0].version);

    // ---- 写入 2：INSERT v27 实验行 ----
    const newId = crypto.randomUUID();
    const row = {
        id: newId,
        experiment_name: cfg.name,
        experiment_description: cfg.description,
        status: 'created',
        trading_mode: v26.trading_mode,
        strategy_type: v26.strategy_type,
        blockchain: v26.blockchain,
        kline_type: v26.kline_type,
        started_at: null,
        stopped_at: null,
        config: cfg,
    };
    const { data: ins, error: insErr } = await db.from('experiments').insert(row).select('id, experiment_name, status');
    if (insErr) throw new Error('实验行插入失败: ' + insErr.message);
    console.log('[OK] experiments INSERT:', ins[0].id, '|', ins[0].experiment_name, '|', ins[0].status);
    console.log('\nNEXT: 182 停 v26 (' + V26_ID + ') -> main.js start-experiment -e ' + newId + ' --force');
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
