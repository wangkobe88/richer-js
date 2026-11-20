#!/usr/bin/env node
// FP10/T167b 面验证：豁免面（破深≥20%放行）× 距锚切分 vs 拦截面 实际盈亏——0x6075 案立法前验证
// 判据：gates.id='fam_low_exit' → hit=true=域内拦；hit=false 且 value 含「→破发豁免」=域内豁免放行
const { dbManager } = require('../src/services/dbManager');

const CUT = 30; // 距锚切分线（方向 A 提案）

async function main() {
  const sb = dbManager.getClient();

  // 1) 实验列表：backtest + factorCheck 开 + 2026-10-20 起
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
  console.log(`factorCheck 开的回测实验=${exps.length}`);

  // 2) 每实验拉 BUY 信号 factorCheck 段（分页）
  const rows = []; // {exp, name, token, ts, hit, exempt, dist, breach, buyB, lastVs, resid}
  const valRe = /末卖@([+\-]?[\d.]+)% 距锚(\d+)s 买([\d.]+)B 残仓([+\-]?[\d.]+)B 破深(null|[\d.]+)%/;
  for (const e of exps) {
    let anchor = null, n = 0;
    for (;;) {
      let q = sb.from('strategy_signals')
        .select('created_at,token_address,metadata->factorCheck')
        .eq('experiment_id', e.id).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).limit(1000);
      if (anchor) q = q.gt('created_at', anchor);
      const { data, error } = await q;
      if (error) throw new Error(e.name + ': ' + error.message);
      for (const s of (data || [])) {
        const fc = s['factorCheck'] || s['metadata->factorCheck'];
        if (!fc || !Array.isArray(fc.gates)) continue;
        n++;
        const g = fc.gates.find((x) => x && x.id === 'fam_low_exit');
        if (!g || typeof g.value !== 'string') continue;
        const m = g.value.match(valRe);
        if (!m) { console.log('  !value 未解析: ' + g.value); continue; }
        rows.push({
          exp: e.id, name: e.name, token: s.token_address, ts: s.created_at,
          hit: !!g.hit, exempt: g.value.includes('破发豁免'),
          lastVs: parseFloat(m[1]), dist: Number(m[2]), buyB: parseFloat(m[3]),
          resid: parseFloat(m[4]), breach: m[5] === 'null' ? null : parseFloat(m[5]),
          passed: fc.pass === true,
        });
      }
      if (!data || data.length < 1000) break;
      anchor = data[data.length - 1].created_at;
    }
    if (n) console.log(`  ${e.name}: BUY信号含factorCheck=${n}`);
  }
  console.log(`\nfam_low_exit 域观测行=${rows.length}`);
  // 域内五腿自查（渲染的 exempted 标记不分域内外，距锚>120=冷却完成设计内放行不算豁免面）：
  // 买≥0.2 ∧ 残仓≤0.05 ∧ 末卖≤+40 ∧ 距锚≤120（自卖比腿近似由 presenceNet≤0.05∧买≥0.2 隐含）
  const inDomain = (r) => r.buyB >= 0.2 && r.resid <= 0.05 && r.lastVs <= 40 && r.dist <= 120;
  // 域内 = hit(拦) 或 (豁免标记 ∧ 五腿过 ∧ 破深≥20)
  const domain = rows.filter((r) => inDomain(r) && (r.hit || (r.exempt && r.breach !== null && r.breach >= 20)));

  // 3) trades 全量（success）→ per (exp,token) 净盈亏
  const pnl = {};
  for (const e of exps) {
    let anchor = null;
    for (;;) {
      let q = sb.from('trades')
        .select('token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success')
        .eq('experiment_id', e.id).eq('success', true)
        .order('token_address', { ascending: true }).limit(1000);
      if (anchor) q = q.gt('token_address', anchor);
      const { data, error } = await q;
      if (error) throw new Error(e.name + ' trades: ' + error.message);
      for (const t of (data || [])) {
        const k = e.id + '|' + t.token_address;
        const p = (pnl[k] = pnl[k] || { buy: 0, sell: 0 });
        if (t.trade_direction === 'buy' && t.input_currency === 'BNB') p.buy += Number(t.input_amount || 0);
        if (t.trade_direction === 'sell' && t.output_currency === 'BNB') p.sell += Number(t.output_amount || 0);
      }
      if (!data || data.length < 1000) break;
      anchor = data[data.length - 1].token_address;
    }
  }

  // 4) per (exp,token) 取首个域内信号
  const first = {};
  for (const r of domain) {
    const k = r.exp + '|' + r.token;
    if (!first[k] || r.ts < first[k].ts) first[k] = r;
  }
  const tickets = Object.entries(first).map(([k, r]) => {
    const p = pnl[k] || { buy: 0, sell: 0 };
    return { ...r, key: k, traded: p.buy > 0, pnl: p.sell - p.buy };
  }).sort((a, b) => (a.exempt === b.exempt ? a.dist - b.dist : (a.exempt ? 1 : -1)));

  const grp = (label, list) => {
    const traded = list.filter((t) => t.traded);
    const s = traded.reduce((x, t) => x + t.pnl, 0);
    console.log(`\n【${label}】域内票=${list.length} 成交=${traded.length} Σpnl=${s.toFixed(4)} 正票=${traded.filter((t) => t.pnl > 0).length}`);
    for (const t of list) console.log(`  ${t.exempt ? '豁' : '拦'} 距锚${String(t.dist).padStart(3)}s 破深${t.breach === null ? 'null' : t.breach.toFixed(1)}% 末卖@${t.lastVs}% ${t.buyB.toFixed(2)}B 残${t.resid} | ${t.traded ? '成交 pnl=' + t.pnl.toFixed(4) : '未成交'} | ${t.token.slice(0, 10)} ${t.name}`);
  };
  grp(`拦截面（破深<20/null，现行已拒）`, tickets.filter((t) => !t.exempt));
  grp(`豁免面·距锚≤${CUT}s（提案A 将拦）`, tickets.filter((t) => t.exempt && t.dist <= CUT));
  grp(`豁免面·距锚>${CUT}s（提案A 保留豁免）`, tickets.filter((t) => t.exempt && t.dist > CUT));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
