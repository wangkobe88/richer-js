// 一次性：bt-v81（a5b43ad1）全窗结果分析——门链分布/episode 盈亏/BP41 豁免首例/CD380 六判例
// 182 跑（重查询走远程）。用法：node scripts/tmp-btv81-analyze.cjs
const { dbManager } = require('../src/services/dbManager.js');

const EXP = 'a5b43ad1-78b0-450e-bd9d-3dde74fbf713';
const SIX = [
  '0xcb70708ebe85cd4de4735776feef20d9c3654444',
  '0x94ea754b80bbafd776accf85d0df7f92dd73ffff',
  '0xb788e63b15c2dfa508bb9c52b34d287d07f47777',
  '0xd0fbcc7be56f6e8eb1e9be01f456de0093ee7777',
  '0x4b3f1f7a70fbc09b54c4ca209749c5124055ffff',
  '0x06810806709ae1082214624d447669e9014a7777',
];
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '-');
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };
const key2 = (o, k) => (o && o[k] != null ? `${k}=${o[k]}` : '');

async function pullSignals(c) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,token_address,signal_type,created_at,metadata')
      .eq('experiment_id', EXP).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

(async () => {
  const c = await dbManager.getClient();
  const sigs = await pullSignals(c);
  console.log(`===== 信号总览：${sigs.length} 行 =====`);
  const byType = {}, byExec = {};
  let cheatGrades = {}, bpBuckets = {}, bpRules = {}, bpPatterns = {}, cross = {}, exemptCodes = {}, denyReasons = {};
  let bpExempt41 = [], sixRows = [];
  for (const s of sigs) {
    byType[s.signal_type] = (byType[s.signal_type] || 0) + 1;
    const m = parse(s.metadata);
    byExec[m.execution_status || 'null'] = (byExec[m.execution_status || 'null'] || 0) + 1;
    const cc = m.cheatCheck, bp = m.buyPoint;
    const g = cc && cc.grade ? cc.grade + (cc.exempt ? '(豁免←' + cc.exempt.originalGrade + ')' : '') + (cc.exemptDenied ? '[denied]' : '') : (cc ? (cc.status || 'no-grade') : '无段');
    cheatGrades[g] = (cheatGrades[g] || 0) + 1;
    if (bp) {
      const a = bp.assessment || {};
      const b = a.bucket || bp.status || '?';
      bpBuckets[b] = (bpBuckets[b] || 0) + 1;
      if (a.rule) bpRules[a.rule] = (bpRules[a.rule] || 0) + 1;
      const pat = bp.dimensions && bp.dimensions.market_pattern ? bp.dimensions.market_pattern.bucket : null;
      if (pat) bpPatterns[pat] = (bpPatterns[pat] || 0) + 1;
      const ck = `${g}→${b}`;
      cross[ck] = (cross[ck] || 0) + 1;
      const patObj = bp.dimensions && bp.dimensions.market_pattern;
      if (patObj && patObj.exempt) {
        exemptCodes[patObj.exempt.code] = (exemptCodes[patObj.exempt.code] || 0) + 1;
        if (patObj.exempt.code === 'strong_backer_first_wave')
          bpExempt41.push({ tok: s.token_address, at: s.created_at, bucket: b, prob: a.prob, rule: a.rule, ex: patObj.exempt });
      }
    } else if (cc && cc.grade === 'healthy') denyReasons['cheat过·BP无段'] = (denyReasons['cheat过·BP无段'] || 0) + 1;
    if (SIX.includes(s.token_address)) sixRows.push({ s, m, cc, bp });
  }
  console.log('signal_type:', JSON.stringify(byType));
  console.log('execution_status:', JSON.stringify(byExec));
  console.log('\ncheat grade 分布:', JSON.stringify(cheatGrades, null, 0));
  console.log('BP bucket 分布:', JSON.stringify(bpBuckets, null, 0));
  console.log('BP rule 分布:', JSON.stringify(bpRules, null, 0));
  console.log('盘型分布:', JSON.stringify(bpPatterns, null, 0));
  console.log('\ncheat→BP 交叉:');
  for (const k of Object.keys(cross).sort((a, b) => cross[b] - cross[a])) console.log(`  ${k}: ${cross[k]}`);
  console.log('\n盘型豁免码:', JSON.stringify(exemptCodes, null, 0));
  if (bpExempt41.length) {
    console.log('\n===== BP41 strong_backer_first_wave 首例 =====');
    for (const e of bpExempt41) console.log(`  ${short(e.tok)} @${e.at} → ${e.bucket}(${e.prob}) rule=${e.rule} | ath=${e.ex.drawdownFromAthPct} tail=${e.ex.nearTail5BuySharePct}`);
  } else console.log('\nBP41 豁免：零命中');

  // ===== CD380 六判例 =====
  console.log('\n===== CD380 六判例在 bt-v81 =====');
  for (const r of sixRows) {
    const cc = r.cc || {}, bp = r.bp || {}, a = bp.assessment || {};
    console.log(`  ${short(r.s.token_address)} @${r.s.created_at} exec=${r.m.execution_status} | cheat=${cc.grade}${cc.exempt ? '(豁免←' + cc.exempt.originalGrade + ')' : ''}${cc.exemptDenied ? '[denied=' + JSON.stringify(cc.exemptDenied) + ']' : ''} | bp=${a.bucket}(${a.rule})`);
  }
  if (!sixRows.length) console.log('  六票零信号');

  // ===== trades episode =====
  const tRows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from('trades').select('*').eq('experiment_id', EXP).order('id').range(from, from + 999);
    if (error) throw error;
    tRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`\n===== trades：${tRows.length} 行 | 列名: ${tRows[0] ? Object.keys(tRows[0]).join(',') : '-'} =====`);
  if (tRows[0]) {
    const perTok = new Map();
    for (const t of tRows) {
      const k = t.token_address;
      if (!perTok.has(k)) perTok.set(k, []);
      perTok.get(k).push(t);
    }
    const eps = [];
    for (const [tok, list] of perTok) {
      let buyBnb = 0, sellBnb = 0, nb = 0, ns = 0;
      for (const t of list) {
        const side = t.side || t.action || (t.trade_type || '');
        const bnb = Number(t.bnb_amount ?? t.bnbAmount ?? t.total_value ?? t.value ?? 0) || 0;
        const isBuy = /buy|买入/i.test(side) || t.is_buy === true;
        if (isBuy) { buyBnb += bnb; nb++; } else { sellBnb += bnb; ns++; }
      }
      eps.push({ tok, nb, ns, buyBnb, sellBnb, pnl: Number((sellBnb - buyBnb).toFixed(4)) });
    }
    eps.sort((a, b) => a.pnl - b.pnl);
    console.log(`token 数: ${eps.length}`);
    for (const e of eps) console.log(`  ${short(e.tok)} 买${e.nb}笔/${e.buyBnb.toFixed(3)} 卖${e.ns}笔/${e.sellBnb.toFixed(3)} → PnL ${e.pnl >= 0 ? '+' : ''}${e.pnl} BNB`);
    const tot = eps.reduce((s, e) => s + e.pnl, 0);
    const win = eps.filter((e) => e.pnl > 0).length;
    console.log(`合计 PnL: ${tot.toFixed(4)} BNB | 盈利票 ${win}/${eps.length}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
