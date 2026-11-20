#!/usr/bin/env node
// 二段：P13 腿条件文本 + 放行信号完整 metadata + trades 列名
const { dbManager } = require('../src/services/dbManager');
const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0x5fb747c626da99bf83b01ac367832de3fb3e7777';

async function main() {
  const sb = dbManager.getClient();

  // 1) ladder v28 库条目腿定义
  const { data: lib, error: e0 } = await sb.from('strategy_library')
    .select('id,name,version,legs,updated_at')
    .eq('name', 'signal-source-ladder-v1').order('version', { ascending: false }).limit(2);
  if (e0) throw new Error(e0.message);
  for (const l of lib) {
    console.log(`\n=== library ${l.name} v${l.version} (id=${l.id}) legs=${Array.isArray(l.legs) ? l.legs.length : '?'}`);
    if (l.version === 28 || (lib.length === 1)) {
      const legs = Array.isArray(l.legs) ? l.legs : [];
      legs.forEach((leg, i) => {
        const id = leg.id || leg.strategyId || `buy_${i}_${i + 1}`;
        console.log(`\n-- leg#${i} id=${id} name=${leg.name || leg.strategyName || '-'} priority=${leg.priority}`);
        console.log(`   cond=${leg.condition}`);
        if (leg.signalGate) console.log(`   signalGate=${JSON.stringify(leg.signalGate)}`);
      });
    }
  }

  // 2) 放行信号（08:04:43）完整 metadata
  const { data: sigs, error: e2 } = await sb.from('strategy_signals')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN)
    .gte('created_at', '2026-10-12T08:04:40').lte('created_at', '2026-10-12T08:04:50').limit(2);
  if (e2) throw new Error(e2.message);
  for (const s of sigs) {
    console.log(`\n=== 放行信号 [${s.created_at}] 完整 metadata`);
    const md = s.metadata || {};
    for (const k of Object.keys(md)) {
      const v = JSON.stringify(md[k]);
      console.log(`[${k}] ${v.length > 2600 ? v.slice(0, 2600) + '…<trunc>' : v}`);
    }
  }

  // 3) trades 列名 + 该票成交
  const { data: trs, error: e4 } = await sb.from('trades')
    .select('*').eq('experiment_id', EXP).eq('token_address', TOKEN).limit(5);
  if (e4) throw new Error(e4.message);
  if (trs.length) {
    console.log(`\n=== trades 列名: ${Object.keys(trs[0]).join(',')}`);
    for (const t of trs) console.log(JSON.stringify(t).slice(0, 800));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
