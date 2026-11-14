// bt-v111 漏斗补充：唯一票口径 + 门拒→后续成交迁移 + 成交票先拒轮数（182 跑）
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
async function pull(table, cols, eid) {
  const c = await dbManager.getClient();
  const rows = []; let from = 0;
  while (true) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', eid)
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return rows;
}
const sigs = await pull('strategy_signals', 'id,token_address,action,executed,created_at,metadata', EXP);
const buySigs = sigs.filter(s => s.action === 'buy');

// 唯一票口径漏斗
const firedToks = new Set(buySigs.map(s => s.token_address));
const bpToks = new Set(buySigs.filter(s => s.metadata?.buyPoint).map(s => s.token_address));
const execToks = new Set(buySigs.filter(s => s.executed).map(s => s.token_address));
console.log(`漏斗（唯一票）: 触发过信号=${firedToks.size} → cheat门过(到BP)=${bpToks.size} → 成交=${execToks.size}`);

// 门拒 → 后续成交迁移
function laterTransition(rejFilter, label) {
  let laterBought = 0, neverBought = 0;
  const neverList = [];
  for (const addr of firedToks) {
    const seq = buySigs.filter(s => s.token_address === addr);
    const rej = seq.filter(rejFilter);
    if (!rej.length) continue;
    const firstRejAt = Math.min(...rej.map(s => new Date(s.created_at).getTime()));
    const laterExec = seq.some(s => s.executed && new Date(s.created_at).getTime() >= firstRejAt);
    if (laterExec) laterBought++; else { neverBought++; if (neverList.length < 200) neverList.push(addr); }
  }
  console.log(`${label}: 涉及票 后续仍成交=${laterBought} / 从未成交=${neverBought}`);
  return neverList;
}
const cheatRejToks = laterTransition(s => s.metadata?.execution_reason === 'cheat_gate_cheat' || s.metadata?.execution_reason === 'cheat_gate_unhealthy', 'cheat 门拒(任一次)');
const bpPoorToks = laterTransition(s => s.metadata?.execution_reason === 'bp_gate_assessment', 'BP 门拒 poor(任一次)');

// 成交票先拒轮数（首成交信号之前该票被拒次数，按门分）
const roundsDist = new Map();
for (const addr of execToks) {
  const seq = buySigs.filter(s => s.token_address === addr).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const firstExecIdx = seq.findIndex(s => s.executed);
  const prior = seq.slice(0, firstExecIdx);
  const cc = prior.filter(s => (s.metadata?.execution_reason || '').startsWith('cheat_gate')).length;
  const bp = prior.filter(s => (s.metadata?.execution_reason || '').startsWith('bp_gate')).length;
  const k = `cheat拒${cc}次+BP拒${bp}次`;
  roundsDist.set(k, (roundsDist.get(k) || 0) + 1);
}
console.log('成交票前置被拒分布:', JSON.stringify([...roundsDist.entries()].sort((a, b) => b[1] - a[1])));

// BP-poor 拒因 × cheat 豁免类型（204 条信号的构成）
const poorSig = buySigs.filter(s => s.metadata?.execution_reason === 'bp_gate_assessment');
const m = new Map();
for (const s of poorSig) {
  const cc = s.metadata?.cheatCheck;
  const ex = cc?.exempt ? `豁免:${cc.exempt.code}` : (cc?.grade || '?');
  const rule = s.metadata?.buyPoint?.assessment?.rule || '?';
  const mp = s.metadata?.buyPoint?.dimensions?.market_pattern?.bucket || 'null';
  const entry = s.metadata?.buyPoint?.dimensions?.entry_shape?.bucket || 'null';
  for (const k of [`${rule}`, `${rule}|mp=${mp}`, `${rule}|entry=${entry}`, `cheat=${ex}`]) {
    m.set(k, (m.get(k) || 0) + 1);
  }
}
console.log('\nBP-poor 204 条构成:');
for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

// BP-poor 拒票从未成交清单（给 token-ticks 页人工追查用，只列前 40）
const symRows = await pull('experiment_tokens', 'token_address,token_symbol', EXP);
const sym = new Map(symRows.map(r => [r.token_address, r.token_symbol]));
const neverBpSet = new Set(bpPoorToks);
const neverCheatSet = new Set(cheatRejToks);
const onlyBpPoor = [...neverBpSet].filter(a => !neverCheatSet.has(a));
console.log(`\nBP-poor 拒且从未成交、且从未被 cheat 拒的票（=纯 BP 拦下）${onlyBpPoor.length} 个:`);
console.log(onlyBpPoor.slice(0, 40).map(a => `${sym.get(a) || a.slice(0, 8)}(${a.slice(0, 10)})`).join(' '));
const bothBlocked = [...neverBpSet].filter(a => neverCheatSet.has(a));
console.log(`\n两门都拒过且从未成交的票 ${bothBlocked.length} 个`);
process.exit(0);
