// 一次性统计（182 跑）：bt-v87（或任意实验）成交票按 BP 盘面类型（market_pattern 桶）盈亏分布
const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../../src/services/dbManager.js');
const db = dbManager.getClient();
const EXP = process.argv[2];

async function main() {
  // 1) 全量 BUY 信号（分页）
  const sigs = []; let cur = '';
  for (let p = 0; p < 40; p++) {
    let q = db.from('strategy_signals').select('created_at,token_address,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1000);
    if (cur) q = q.gt('created_at', cur);
    const { data } = await q; if (!data?.length) break;
    sigs.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  // 2) 成交信号 → per-token 盘面类型（一票一成交；多行取首行 executed）
  const tokPattern = {}; const tokMeta = {};
  for (const s of sigs) {
    const m = s.metadata || {};
    if (m.execution_status !== 'executed') continue;
    if (tokPattern[s.token_address]) continue;
    const bp = m.buyPoint || {}; const dims = bp.dimensions || {};
    const mp = dims.market_pattern || {};
    const act = dims.activity_level || {}; const heat = dims.market_heat || {}; const chip = dims.holder_concentration || {};
    tokPattern[s.token_address] = mp.bucket || 'unknown';
    tokMeta[s.token_address] = {
      prob: mp.prob, act: act.bucket, heat: heat.bucket, chip: chip.bucket,
      rule: (bp.assessment || {}).rule, exempt: (bp.assessment && bp.assessment.exempt && bp.assessment.exempt.code) || null,
      curVs: (bp.anchors || {}).currentVsLaunchPct ?? null, minVs: (bp.anchors || {}).minVsLaunchPct ?? null,
      ccExempt: (m.cheatCheck && m.cheatCheck.info && m.cheatCheck.info.exempt && m.cheatCheck.info.exempt.code) || (m.cheatCheck && m.cheatCheck.exempt && m.cheatCheck.exempt.code) || null,
      leg: (m.signalGate || {}).legId, at: s.created_at.slice(5, 19),
    };
  }
  // 3) trades per-token 盈亏（BNB 域）
  const { data: trades } = await db.from('trades')
    .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
    .eq('experiment_id', EXP).limit(3000);
  const by = {};
  for (const t of trades || []) {
    if (t.success === false) continue;
    by[t.token_address] = by[t.token_address] || { buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') { const v = t.input_currency === 'BNB' ? Number(t.input_amount || 0) : t.output_currency === 'BNB' ? Number(t.output_amount || 0) : 0; by[t.token_address].buy += v; }
    else { const v = t.output_currency === 'BNB' ? Number(t.output_amount || 0) : t.input_currency === 'BNB' ? Number(t.input_amount || 0) : 0; by[t.token_address].sell += v; }
  }
  // 4) 按盘面类型聚合
  const groups = {};
  for (const [addr, pat] of Object.entries(tokPattern)) {
    const v = by[addr] || { buy: 0, sell: 0 };
    const net = v.sell - v.buy;
    const open = v.buy > 1e-12 && v.sell < v.buy * 0.999;
    groups[pat] = groups[pat] || { n: 0, net: 0, win: 0, lose: 0, open: 0, rows: [] };
    const g = groups[pat]; g.n++; g.net += net; if (net > 0) g.win++; else if (net < 0) g.lose++; if (open) g.open++;
    g.rows.push({ addr, net, open, ...tokMeta[addr] });
  }
  console.log(`实验 ${EXP} | 成交票 ${Object.keys(tokPattern).length} | 盘面类型分布与盈亏（BNB）`);
  const order = Object.entries(groups).sort((a, b) => b[1].net - a[1].net);
  for (const [pat, g] of order) {
    console.log(`\n【${pat}】 ${g.n} 票 | 净 ${g.net >= 0 ? '+' : ''}${g.net.toFixed(4)} | 盈 ${g.win} / 亏 ${g.lose} / 未平仓 ${g.open}`);
    for (const r of g.rows.sort((x, y) => y.net - x.net)) {
      console.log(`  ${r.addr.slice(0, 10)} ${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)}${r.open ? '(未平)' : ''}` +
        ` act=${r.act || '?'} heat=${r.heat || '?'} chip=${r.chip || '?'} curVs=${r.curVs ?? '?'} minVs=${r.minVs ?? '?'}` +
        ` prob=${r.prob != null ? Number(r.prob).toFixed(2) : '?'} leg=${(r.leg || '-').replace('buy_', '')} ${r.at}` +
        `${r.exempt ? ' bpExempt=' + r.exempt : ''}${r.ccExempt ? ' ccExempt=' + r.ccExempt : ''}`);
    }
  }
  // 5) 未成交但持仓的票（手工核对防漏）
  const extra = Object.keys(by).filter((a) => by[a].buy > 1e-12 && !tokPattern[a]);
  if (extra.length) console.log(`\n⚠有买入无 executed 信号的票 ${extra.length}: ${extra.map((a) => a.slice(0, 10)).join(' ')}`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
