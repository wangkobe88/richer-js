#!/usr/bin/env node
// FP10/T167b 面验证 v2：成交买信号级口径——新腿（豁免须距锚≥30s）的确定止血面
// per (exp,token)：买信号集合全部落在「豁免∧距锚≤30s」= 全拦止血；否则 mixed/不受影响
const { dbManager } = require('../src/services/dbManager');

const CUT = 30;

async function main() {
  const sb = dbManager.getClient();

  // 1) factorCheck 开的回测实验
  const exps = [];
  {
    let off = 0;
    for (;;) {
      const { data, error } = await sb.from('experiments')
        .select('id,experiment_name,trading_mode,created_at,config')
        .eq('trading_mode', 'backtest').gte('created_at', '2026-10-20')
        .order('created_at', { ascending: true }).range(off, off + 49);
      if (error) throw new Error(error.message);
      for (const e of (data || [])) {
        const fm = (e.config || {}).fourmemeWs || {};
        const on = fm.buyPointCheck && fm.buyPointCheck.factorCheck && fm.buyPointCheck.factorCheck.enabled === true;
        if (on) exps.push({ id: e.id, name: e.experiment_name });
      }
      if (!data || data.length < 50) break;
      off += 50;
    }
  }
  console.log(`实验=${exps.length}`);

  // 2) 成功买 trades：signal_id + token + pnl 原料
  const trades = []; // {exp,name,token,signalId,amt}
  const pnlMap = {};
  for (const e of exps) {
    let anchor = null;
    for (;;) {
      let q = sb.from('trades')
        .select('token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success,signal_id')
        .eq('experiment_id', e.id).eq('success', true)
        .order('token_address', { ascending: true }).limit(1000);
      if (anchor) q = q.gt('token_address', anchor);
      const { data, error } = await q;
      if (error) throw new Error(e.name + ' trades: ' + error.message);
      for (const t of (data || [])) {
        const k = e.id + '|' + t.token_address;
        const p = (pnlMap[k] = pnlMap[k] || { buy: 0, sell: 0 });
        if (t.trade_direction === 'buy' && t.input_currency === 'BNB') {
          p.buy += Number(t.input_amount || 0);
          if (t.signal_id) trades.push({ exp: e.id, name: e.name, token: t.token_address, signalId: t.signal_id, amt: Number(t.input_amount || 0) });
        }
        if (t.trade_direction === 'sell' && t.output_currency === 'BNB') p.sell += Number(t.output_amount || 0);
      }
      if (!data || data.length < 1000) break;
      anchor = data[data.length - 1].token_address;
    }
  }
  console.log(`成功买 trade=${trades.length}`);

  // 3) 买信号 factorCheck 批量拉（批 50）
  const sigInfo = {}; // signalId -> {hit, exempt, dist, breach, lastVs, buyB, resid}
  const byExp = {};
  for (const t of trades) (byExp[t.exp] = byExp[t.exp] || []).push(t);
  const valRe = /末卖@([+\-]?[\d.]+)% 距锚(\d+)s 买([\d.]+)B 残仓([+\-]?[\d.]+)B 破深(null|[\d.]+)%/;
  let pendIds = [];
  const flush = async () => {
    if (!pendIds.length) return;
    const { data, error } = await sb.from('strategy_signals')
      .select('id,metadata->factorCheck').in('id', pendIds.splice(0));
    if (error) throw new Error('sig batch: ' + error.message);
    for (const s of (data || [])) {
      const fc = s['factorCheck'] || s['metadata->factorCheck'];
      const g = fc && Array.isArray(fc.gates) && fc.gates.find((x) => x && x.id === 'fam_low_exit');
      sigInfo[s.id] = g ? g : null;
    }
  };
  for (const t of trades) {
    // 同实验下 id 无序分页不便，直接全量收集后批查
  }
  const allIds = [...new Set(trades.map((t) => t.signalId))];
  for (let i = 0; i < allIds.length; i += 50) {
    const { data, error } = await sb.from('strategy_signals')
      .select('id,metadata->factorCheck').in('id', allIds.slice(i, i + 50));
    if (error) throw new Error('sig batch: ' + error.message);
    for (const s of (data || [])) {
      const fc = s['factorCheck'] || s['metadata->factorCheck'];
      const g = fc && Array.isArray(fc.gates) && fc.gates.find((x) => x && x.id === 'fam_low_exit');
      sigInfo[s.id] = g || null;
    }
  }

  // 4) per (exp,token) 买信号分类
  const tokSigs = {};
  for (const t of trades) {
    const k = t.exp + '|' + t.token;
    (tokSigs[k] = tokSigs[k] || { exp: t.exp, name: t.name, token: t.token, sigs: [] }).sigs.push(t.signalId);
  }
  const inDomain = (g) => {
    const m = g.value && g.value.match(valRe);
    if (!m) return null;
    return { lastVs: parseFloat(m[1]), dist: Number(m[2]), buyB: parseFloat(m[3]), resid: parseFloat(m[4]), breach: m[5] === 'null' ? null : parseFloat(m[5]) };
  };
  const rows = [];
  for (const [k, o] of Object.entries(tokSigs)) {
    const p = pnlMap[k] || { buy: 0, sell: 0 };
    const pnl = p.sell - p.buy;
    let nAll = 0, nBlocked = 0, nExemptKeep = 0, nExemptCut = 0, minDist = null, maxBreach = null;
    for (const sid of o.sigs) {
      const g = sigInfo[sid];
      if (!g) continue; // 无 factorCheck 段（非 signalGate/旧路径）
      const v = inDomain(g);
      if (!v) continue;
      nAll++;
      const dom = v.buyB >= 0.2 && v.resid <= 0.05 && v.lastVs <= 40 && v.dist <= 120;
      const exempt = dom && !g.hit && String(g.value).includes('破发豁免') && v.breach !== null && v.breach >= 20;
      if (exempt && v.dist <= CUT) { nBlocked++; nExemptCut++; }
      else if (exempt) nExemptKeep++;
      if (exempt) { minDist = minDist === null ? v.dist : Math.min(minDist, v.dist); maxBreach = maxBreach === null ? v.breach : Math.max(maxBreach, v.breach); }
    }
    if (nExemptCut === 0 && nExemptKeep === 0) continue; // 与豁免面无关的成交票
    rows.push({ ...o, pnl, nSig: o.sigs.length, nAll, nBlocked, nExemptKeep, minDist, maxBreach,
      cls: nExemptCut > 0 && nExemptKeep === 0 ? 'FULL' : (nExemptCut > 0 ? 'MIXED' : 'KEEP') });
  }
  rows.sort((a, b) => (a.cls < b.cls ? -1 : a.cls > b.cls ? 1 : (a.minDist || 0) - (b.minDist || 0)));

  const grp = (label, list) => {
    const s = list.reduce((x, t) => x + t.pnl, 0);
    console.log(`\n【${label}】票(实验×token)=${list.length} Σpnl=${s.toFixed(4)} 正=${list.filter((t) => t.pnl > 0).length} 负=${list.filter((t) => t.pnl <= 0).length}`);
    for (const t of list) console.log(`  ${t.cls} min距锚${String(t.minDist).padStart(3)}s 破深${t.maxBreach === null ? '-' : t.maxBreach.toFixed(1)}% 拦${t.nBlocked}/${t.nAll}信号 pnl=${t.pnl.toFixed(4)} | ${t.token.slice(0, 10)} ${t.name}`);
  };
  grp('全拦止血面（豁免∧距锚≤30 全部买信号，提案A 阻止成交）', rows.filter((r) => r.cls === 'FULL'));
  grp('mixed（部分信号被拦、部分豁免保留）', rows.filter((r) => r.cls === 'MIXED'));
  grp('不受影响（豁免但距锚全>30）', rows.filter((r) => r.cls === 'KEEP'));

  // 5) 跨实验去重（同 token 同窗克隆系只计一次，取 pnl 均值口径的净额）
  const byTok = {};
  for (const r of rows) (byTok[r.token] = byTok[r.token] || []).push(r);
  console.log(`\n=== 跨实验去重（per token 取各实验 pnl 均值）`);
  const dedup = { FULL: [], MIXED: [], KEEP: [] };
  for (const [tok, list] of Object.entries(byTok)) {
    const cls = list.some((x) => x.cls === 'FULL') && !list.some((x) => x.cls !== 'FULL') ? 'FULL' : (list.some((x) => x.cls === 'FULL' || x.cls === 'MIXED') ? 'MIXED' : 'KEEP');
    const avg = list.reduce((x, t) => x + t.pnl, 0) / list.length;
    dedup[cls].push({ tok, avg, n: list.length });
  }
  for (const [cls, list] of Object.entries(dedup)) {
    const s = list.reduce((x, t) => x + t.avg, 0);
    console.log(`${cls}: 票=${list.length} Σ均pnl=${s.toFixed(4)} 正=${list.filter((t) => t.avg > 0).length}`);
    for (const t of list.sort((a, b) => a.avg - b.avg)) console.log(`  ${t.avg >= 0 ? '+' : ''}${t.avg.toFixed(4)} (${t.n}实验) ${t.tok.slice(0, 10)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
