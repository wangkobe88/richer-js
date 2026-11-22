#!/usr/bin/env node
/**
 * 一次性脚本：近期回测实验中被 malicious_dump（BP 桶⑤恶意砸盘，entry_gate）阻挡的票统计。
 * 182 跑（jsonb 路径过滤跨多实验，本地 VPN 必超时）。
 * 口径：metadata.buyPoint.dimensions.entry_shape.bucket='malicious_dump' 的信号全集
 *       → 按 assessment.rule 分组（entry_gate=真被恶意砸盘臂拦；pattern/stuffing=更前门先认领；
 *         gates_passed/activity=BP78 20B 豁免或未被 entry 门拦）。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const SINCE = process.argv[2] || '2026-11-14T00:00:00Z'; // 近 7 天缺省

async function fetchAllPages(from, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await from.range(offset, offset + pageSize - 1);
    if (page.error) throw new Error(page.error.message);
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
    offset += pageSize;
  }
}

(async () => {
  const db = dbManager.getClient();

  // 1) 近期回测实验清单
  const exps = await fetchAllPages(
    db.from('experiments').select('id,experiment_name,created_at')
      .eq('trading_mode', 'backtest')
      .gte('created_at', SINCE)
      .order('created_at', { ascending: true })
  );
  console.log(`回测实验（created_at >= ${SINCE}）：${exps.length} 个`);
  for (const e of exps) console.log(`  ${e.experiment_name}  ${e.id}  ${e.created_at}`);
  if (!exps.length) return;

  const expName = new Map(exps.map((e) => [e.id, e.experiment_name]));

  // 2) 逐实验单值 .eq 拉取（.in 多值 planner 弃索引超时——红线 #5 同族）
  const BP = 'metadata->buyPoint';
  const rows = [];
  for (const e of exps) {
    const part = await fetchAllPages(
      db.from('strategy_signals')
        .select(`experiment_id,token_address,created_at,${BP},exec_status:metadata->>execution_status`)
        .eq('experiment_id', e.id)
        .eq(`${BP}->dimensions->entry_shape->>bucket`, 'malicious_dump')
    );
    console.log(`  ${e.experiment_name}: ${part.length} 条 malicious_dump 信号`);
    rows.push(...part);
  }

  // 3) 分组统计
  const byRule = new Map(); // rule -> {signals, tokens:Set}
  const perExp = new Map(); // expId -> {signals, tokens:Set}
  const blockedDetail = []; // entry_gate 拦截明细
  for (const r of rows) {
    const rule = r.buyPoint?.assessment?.rule ?? '(rule缺失)';
    const bucket = r.buyPoint?.assessment?.bucket ?? null;
    if (!byRule.has(rule)) byRule.set(rule, { signals: 0, tokens: new Set() });
    byRule.get(rule).signals++;
    byRule.get(rule).tokens.add((r.token_address || '').toLowerCase());
    if (!perExp.has(r.experiment_id)) perExp.set(r.experiment_id, { signals: 0, tokens: new Set() });
    perExp.get(r.experiment_id).signals++;
    perExp.get(r.experiment_id).tokens.add((r.token_address || '').toLowerCase());
    if (rule === 'entry_gate') {
      blockedDetail.push({
        exp: expName.get(r.experiment_id) || r.experiment_id,
        token: r.token_address,
        status: r.exec_status,
        bucket,
        exempt: r.buyPoint?.assessment?.exempt?.code ?? null,
        at: r.created_at,
      });
    }
  }

  console.log(`\nentry_shape=malicious_dump 信号总数：${rows.length}（唯一 token ${new Set(rows.map((r) => (r.token_address || '').toLowerCase())).size}）`);
  console.log('\n按最终拦截 rule 分组（signalGate 门链只留最前命中）：');
  for (const [rule, v] of [...byRule.entries()].sort((a, b) => b[1].signals - a[1].signals)) {
    console.log(`  ${rule.padEnd(14)} ${String(v.signals).padStart(4)} 信号 / ${v.tokens.size} token`);
  }

  console.log('\n按实验分组：');
  for (const [expId, v] of [...perExp.entries()].sort((a, b) => b[1].signals - a[1].signals)) {
    console.log(`  ${expName.get(expId) || expId}  ${v.signals} 信号 / ${v.tokens.size} token`);
  }

  const eg = byRule.get('entry_gate');
  console.log(`\n★被 malicious_dump 阻挡（rule=entry_gate）：${eg ? eg.signals : 0} 信号 / ${eg ? eg.tokens.size : 0} 唯一 token`);
  for (const d of blockedDetail) {
    console.log(`  [${d.exp}] ${d.token} status=${d.status} exempt=${d.exempt} at=${d.at}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
