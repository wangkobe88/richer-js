#!/usr/bin/env node
// ============================================================================
// 双实验并集回测容器创建（2026-10-02，用户指令：基于 50442571/02c60e50 的数据
// 回测、策略跟 50442571 一致、叙事重新跑）
//
// 背景：sourceExperimentId 单值只取一个实验的 experiment_tokens 作 token 集合，
// 而 50442571（10-01 14:53→running）与 02c60e50（09-30 11:06→10-01 14:51 stopped）
// 时间上几乎无缝衔接、token 集合交集仅 9（SharedTickConsumer 首拉水位对齐只消费
// 启动后新行）——单 source 必然丢半窗。本脚本造「并集容器」：
//   1. 以 50442571 config 为基底（策略原样）createFromConfig('backtest') 建容器 B
//   2. 流式拉两源 experiment_tokens 全行，token_address 小写去重，改挂 B 名下插入
//   3. updateConfig：backtest.sourceExperimentId = B.id（自指——_loadTokenMetadata
//      拉 B 自己名下的并集；BacktestTickCache 缓存粒度键 (B.id, platform) 全新无冲突）
//   4. 失效并集内 token_narrative is_valid=true 行（旧代码产，182 重启前分析）——
//      回测叙事直调 miss → 182 新代码（J1.25/P1.9 + C41-C53）全量重析
//
// 用法（182 上跑；重数据操作按准则不本地跑）：
//   node scripts/create-union-backtest.cjs
//     [--base <expId>]              策略基底，默认 50442571
//     [--union <id1,id2>]           token 集合并集源，默认 02c60e50,50442571
//     [--start <ISO>]               默认 2026-09-30T11:00:00.000Z（02c 创建前，W 系列同款）
//     [--end <ISO>]                 默认脚本执行时刻（与 token 快照同时刻自洽）
//     [--skip-invalidate]           只建容器不失效叙事行
// ============================================================================
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const DEFAULT_BASE = '50442571-967e-4537-875d-df7d0ceca01d';
const DEFAULT_UNION = '02c60e50-1f99-4279-b71b-3d192a5018a4,50442571-967e-4537-875d-df7d0ceca01d';
const DEFAULT_START = '2026-09-30T11:00:00.000Z';

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
}
const BASE = argVal('--base', DEFAULT_BASE);
const UNION = argVal('--union', DEFAULT_UNION).split(',').map(s => s.trim()).filter(Boolean);
const START = argVal('--start', DEFAULT_START);
const END = argVal('--end', new Date().toISOString());
const SKIP_INVALIDATE = args.includes('--skip-invalidate');

if (UNION.length < 1) { console.error('--union 至少一个实验 id'); process.exit(1); }

const PAGE = 1000;    // 源行拉取分页
const INSERT_BATCH = 500;  // 插入批
const NARR_BATCH = 100;    // token_narrative in 查询/更新批

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const factory = ExperimentFactory.getInstance();

  const base = await factory.load(BASE);
  if (!base) throw new Error(`基底实验不存在: ${BASE}`);

  // ── 1. 建容器（backtest 段占位 source=BASE，步骤 3 改自指）──
  const cfg = JSON.parse(JSON.stringify(base.config));
  cfg.name = `回测-504策略-双窗并集-叙事重跑`;
  cfg.description = `策略=50442571 整包（buy-v2 v5 + 17 卖腿）；token 集合=${UNION.map(u => u.slice(0, 8)).join('+')} 并集；窗 ${START}→${END}；叙事旧行已失效全量重析（182 新代码 J1.25/P1.9+C41-C53）`;
  cfg.backtest = {
    initialBalance: 100,
    sourceExperimentId: BASE, // 占位，插完 token 行后 updateConfig 改自指
    minMaxChangePercent: 0,
    startTime: START,
    endTime: END,
  };
  const container = await factory.createFromConfig(cfg, 'backtest');
  const B = container.id;
  console.log(`\n容器实验: ${B}`);

  // ── 2. 流式插并集 token 行（token_address 小写去重，行数据不落内存攒全量）──
  const seen = new Set();       // 并集地址（小写）
  let inserted = 0, skippedDup = 0;
  for (const srcId of UNION) {
    let from = 0;
    for (;;) {
      const { data, error } = await db.from('experiment_tokens').select('*')
        .eq('experiment_id', srcId).range(from, from + PAGE - 1);
      if (error) throw new Error(`拉取源 ${srcId} 失败: ${error.message}`);
      if (!data || data.length === 0) break;

      const rows = [];
      for (const r of data) {
        const key = (r.token_address || '').toLowerCase();
        if (!key || seen.has(key)) { skippedDup++; continue; }
        seen.add(key);
        const { id, experiment_id, ...rest } = r; // eslint-disable-line no-unused-vars
        rows.push({ id: crypto.randomUUID(), experiment_id: B, ...rest });
      }
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const chunk = rows.slice(i, i + INSERT_BATCH);
        const { error: insErr } = await db.from('experiment_tokens').insert(chunk);
        if (insErr) throw new Error(`插入失败（源 ${srcId.slice(0, 8)} 行 ${from + i}）: ${insErr.message}`);
        inserted += chunk.length;
      }
      console.log(`  源 ${srcId.slice(0, 8)}: 累计插入 ${inserted}（本页 ${data.length} 行）`);
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`并集 token 行插入完成: ${inserted}（跨源去重跳过 ${skippedDup}）`);
  if (inserted < 1000) throw new Error(`插入量异常（${inserted} < 1000），疑似源实验 id 错误——容器 ${B} 请人工核查后删除`);

  // ── 3. 自指 sourceExperimentId ──
  cfg.backtest.sourceExperimentId = B;
  const upd = await factory.updateConfig(B, cfg);
  if (!upd || upd.success !== true) throw new Error(`updateConfig 失败: ${JSON.stringify(upd)}`);
  console.log(`backtest.sourceExperimentId 已自指 → ${B}`);

  // ── 4. 失效并集内叙事缓存行（旧代码产，重析走 182 新代码）──
  if (SKIP_INVALIDATE) {
    console.log('--skip-invalidate：跳过叙事行失效');
  } else {
    const addrs = [...seen];
    let invalidated = 0, scanned = 0;
    for (let i = 0; i < addrs.length; i += NARR_BATCH) {
      const chunk = addrs.slice(i, i + NARR_BATCH);
      const { data: narr, error: qErr } = await db.from('token_narrative')
        .select('token_address,is_valid')
        .in('token_address', chunk).eq('is_valid', true);
      if (qErr) throw new Error(`查 token_narrative 失败: ${qErr.message}`);
      scanned += chunk.length;
      if (!narr || narr.length === 0) continue;
      const hitAddrs = narr.map(r => r.token_address);
      const { error: uErr } = await db.from('token_narrative')
        .update({ is_valid: false }).in('token_address', hitAddrs);
      if (uErr) throw new Error(`失效失败: ${uErr.message}`);
      invalidated += hitAddrs.length;
    }
    console.log(`叙事行失效完成: ${invalidated} 行（扫描 ${scanned} 地址）`);
  }

  console.log('\n========================================');
  console.log('UNION_BACKTEST_ID=' + B);
  console.log('========================================');
  console.log(`窗口: ${START} → ${END}`);
  console.log(`启动（182）: node main.js start-experiment -e ${B}`);
  console.log('回测进程内叙事直调 enrichSocialByGmgn=true；重析结果 upsert 回 is_valid=true（全局缓存，50442571 实跑后续遇同 token 亦用新评级——期望行为）');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
