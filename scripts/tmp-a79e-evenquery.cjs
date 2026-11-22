#!/usr/bin/env node
// bt-v177 全 BUY 信号拒因分布 + even_split_crew 拒行票的 fire 快照关键维度
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP = '4d74f39e-4055-4adb-afa3-de8a22bb9f49';

(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('token_address,token_symbol,reason,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('signal_type', 'BUY')
    .limit(500);
  if (error) throw new Error(error.message);
  console.log(`BUY 信号共 ${data.length} 行`);
  const byArm = new Map();
  const evenRows = [];
  for (const r of data) {
    const md = r.metadata || {};
    const arms = md.factorCheck?.arms || [];
    const exec = md.executionStatus || md.signalGate?.executionStatus || '';
    const execReason = md.executionReason || md.signalGate?.executionReason || '';
    if (arms.length) for (const a of arms) byArm.set(a, (byArm.get(a) || 0) + 1);
    else if (exec.includes('act') || execReason) byArm.set('门链:' + (execReason || exec), (byArm.get('门链:' + (execReason || exec)) || 0) + 1);
    if (arms.includes('even_split_crew')) {
      const tf = md.trendFactors || {};
      evenRows.push({
        sym: r.token_symbol, tok: r.token_address.slice(0, 8),
        t: r.created_at.slice(11, 19),
        hhi: md.factorCheck?.chip?.holderHHI ?? null,
        circ: md.factorCheck?.chip?.circSupplyPct ?? null,
        quiet: tf.quietSpanMs, surge: tf.quietSurgeBuyBnb,
        chg5: tf.chg5Pct, curVs: tf.currentVsLaunchPct,
        bundle: tf.bundleClusterSize, evenGrp: tf.evenClusterGroups,
        router: tf.tradesRouterPct, posH: md.factorCheck?.chip?.posHolderCount ?? null,
        top1: tf.top1HolderCircPct,
      });
    }
  }
  console.log('--- 拒因分布（FP armHits） ---');
  for (const [k, v] of [...byArm.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log(`--- even_split_crew 拒行票（${evenRows.length}）---`);
  for (const e of evenRows) console.log(JSON.stringify(e));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
