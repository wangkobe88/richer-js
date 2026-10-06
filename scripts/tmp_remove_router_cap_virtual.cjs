#!/usr/bin/env node
// ============================================================================
// 36a2c12a 虚拟实验 router 门去上限（2026-10-04，一次性脚本）：
//   与回测 1d363b19 同款改动——preBuyCheckCondition 里
//   (earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80) → (>= 50)
//   直接读改写 experiments.config 原始 jsonb（不经 Experiment.fromConfig 规范化，
//   保真整包零副作用）。需先停进程，改完重启才生效（策略启动时加载内存）。
// 用法：node scripts/tmp_remove_router_cap_virtual.cjs [--commit]（默认 dry-run）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const TARGET = '36a2c12a-a7d6-47ec-ba7e-7f007562fdb4';
const OLD = 'earlyTradesRouterPct >= 50 AND earlyTradesRouterPct < 80';
const NEW = 'earlyTradesRouterPct >= 50';
const COMMIT = process.argv.slice(2).includes('--commit');

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  const { data: row, error } = await db.from('experiments')
    .select('id, status, config').eq('id', TARGET).single();
  if (error) throw error;
  if (row.status !== 'running' && row.status !== 'stopped') {
    throw new Error('实验状态异常: ' + row.status + '（应先停进程）');
  }

  const cfg = row.config; // 原始 jsonb 对象，读改写保真
  let hits = 0;
  for (const leg of (cfg.strategiesConfig.buyStrategies || [])) {
    const c = leg.preBuyCheckCondition;
    if (typeof c !== 'string' || !c.includes(OLD)) continue;
    leg.preBuyCheckCondition = c.split(OLD).join(NEW);
    hits++;
    console.log('改写买腿:');
    console.log('  OLD:', c);
    console.log('  NEW:', leg.preBuyCheckCondition);
  }
  if (hits === 0) throw new Error('未找到含 router 区间门的买腿');
  if (JSON.stringify(cfg.strategiesConfig).includes('earlyTradesRouterPct < 80')) {
    throw new Error('仍有 earlyTradesRouterPct < 80 残留');
  }

  if (!COMMIT) { console.log('\n[dry-run] 未写；加 --commit 真写（进程须已停）'); process.exit(0); }

  const { error: upErr } = await db.from('experiments')
    .update({ config: cfg }).eq('id', TARGET);
  if (upErr) throw upErr;

  // 回读校验
  const { data: back } = await db.from('experiments')
    .select('config->strategiesConfig->buyStrategies->0->preBuyCheckCondition as cond').eq('id', TARGET).single();
  console.log('\n回读:', back && back.cond);
  if (!back || !back.cond || back.cond.includes('< 80')) throw new Error('回读校验失败');
  console.log('OK 已写入');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
