#!/usr/bin/env node
/** 一次性渲染：B 组三票信号页面内容（终端版）——每行=信号行+五层门+gates 全量值+chips */
'use strict';
const FILES = [
  ['Maricarmen 0xb2648689…f8c7777', '/tmp/sig-0xb2648689a76b542e49f9054d28935b5fdf8c7777.json'],
  ['HI 0x88b5c4f6…09e7777', '/tmp/sig-0x88b5c4f6e51379077d0f53c17fe50609209e7777.json'],
  ['万锅共酱会 0x2893a796…5747777', '/tmp/sig-0x2893a7961216a58ce2051dbd9cd4f2d515747777.json'],
];
const f8 = (iso) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().replace('T', ' ').slice(5, 19);
for (const [name, file] of FILES) {
  const d = require(file);
  console.log(`\n════════ ${name} ════════`);
  for (const s of d.signals) {
    const m = s.metadata || {};
    const fc = m.factorCheck || {};
    const sg = m.signalGate || {};
    console.log(`\n▶ ${f8(s.created_at)} ${s.signal_type} ${s.reason} conf=${s.confidence} executed=${s.executed}`);
    console.log(`  腿=${sg.legId || m.strategyId} 触发${sg.triggerNo}/${sg.maxTriggers} 价=${(m.price || 0).toExponential(3)}`);
    console.log(`  ①信号触发 ✅ → ②因子检查 ${fc.pass ? '✅过' : '❌拒'}（${fc.reason || ''} FP${(fc.version || '').replace('FP', '')}）→ ③活跃度 ㊟未到达 → ④作弊 ㊟未到达 → ⑤BP ㊟未到达`);
    if (Array.isArray(fc.gates)) {
      for (const g of fc.gates) {
        console.log(`     ${g.hit ? '🔴' : '·'} ${g.label || g.id}  [${g.line || ''}]  ${g.value || ''}`);
      }
    }
    const tf = m.trendFactors || {};
    const chips = ['tokenAgeSec', 'actTotalBnb', 'actBuyBnb', 'actSellBnb', 'actNetBnb', 'actTrades', 'actBuyers', 'buyWallets', 'holders', 'chg5Pct', 'chg10Pct', 'chg30Pct', 'currentVsLaunchPct', 'athVsLaunchPct', 'launchBigBuyBnb', 'sinceFirstTradeSec', 'tradesRouterPct', 'tradesNetBuyRatioLongWin', 'tradesNetBuyRatioShortWin'];
    console.log('  chips: ' + chips.filter(k => tf[k] !== undefined && tf[k] !== null).map(k => `${k}=${typeof tf[k] === 'number' ? +tf[k].toFixed(2) : tf[k]}`).join(' · '));
    if (fc.trace) console.log(`  pvp trace: ${JSON.stringify(fc.trace)}`);
  }
}
