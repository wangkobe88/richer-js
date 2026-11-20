#!/usr/bin/env node
// FP17 尾部接刀臂校准（snapshot 重放版）：buildBuyPointSnapshot 重放买点 → buyDerived 口径分布+域线+臂线
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');

const EXPS = [
  ['bt-v141', '3916fb15-66a1-45f0-bde1-1c145513817a'],
  ['bt-v142', '8a7b6b09-e2bc-4773-8393-a696821ff531'],
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
  ['bt-v149', '177eb99e-b8a9-4f59-93bd-0bc6741b5a78'],
];
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
function pctl(arr,p){const a=arr.filter(x=>x!=null).sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.ceil(p*a.length)-1)]:null;}
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}

async function main() {
  const sb = dbManager.getClient();
  // 买点池：study4（尾部 72）+ v149 复验尾部 + E 组抽样
  const P = [];
  {
    // tail 组 buyTs 从 study.json（第一段 results 含 buyTs）按 exp|token 对齐第一买点
    const sj = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));
    const tsM = new Map();
    for (const r of sj) { const k = r.exp + '|' + r.token; if (!tsM.has(k)) tsM.set(k, r.buyTs); }
    for (const f of JSON.parse(fs.readFileSync('/tmp/tail-entry-study4.json', 'utf8'))) {
      P.push({ exp: f.exp, token: f.token, buyTs: tsM.get(f.exp + '|' + f.token) ?? null, grp: 'tail', mx: f.mx, ep: f.ep, chg5study: f.pre_chg5, platform: null });
    }
  }
  // E 组抽样（study.json）
  const eAll = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8')).filter(r => r.grp === 'E_early_thin');
  const eByTk = new Map();
  for (const r of eAll) { const k = r.exp + '|' + r.token; if (!eByTk.has(k)) eByTk.set(k, r); }
  const epM = new Map();
  for (const s of JSON.parse(fs.readFileSync('/tmp/tail-entry-study2.json', 'utf8'))) if (s.epPnl != null) epM.set(s.exp + '|' + s.token, s.epPnl);
  let i = 0;
  for (const [k, r] of eByTk) { if (i++ % 3 === 0) P.push({ exp: r.exp, token: r.token, buyTs: r.buyTs, grp: 'E', mx: r.mx, ep: epM.get(k) ?? null, chg5study: null, platform: null }); }
  // v149 尾部买点：重拉 trades+signals 分组
  {
    const id = EXPS[5][1], nm = EXPS[5][0];
    const { data: tr } = await sb.from('trades').select('token_address,trade_direction,trade_status,input_amount,input_currency,output_amount,output_currency,created_at,signal_id').eq('experiment_id', id).limit(3000);
    const buys = tr.filter(t => t.trade_direction === 'buy' && t.trade_status === 'success');
    const ids = [...new Set(buys.map(t => t.signal_id).filter(Boolean))];
    const sigM = new Map();
    for (let j = 0; j < ids.length; j += 50) { const { data: sgs } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(j, j + 50)); for (const s of sgs || []) sigM.set(s.id, s); }
    const epM2 = new Map();
    for (const t of tr) { if (t.trade_status !== 'success') continue; if (!epM2.has(t.token_address)) epM2.set(t.token_address, { i: 0, o: 0 }); const e = epM2.get(t.token_address);
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') e.i += Number(t.input_amount);
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') e.o += Number(t.output_amount); }
    const seen = new Set();
    for (const t of buys) {
      const sig = sigM.get(t.signal_id); const tf = (sig && sig.metadata && sig.metadata.trendFactors) || {};
      const lp = Number(tf.launchPrice), cur = Number(tf.currentPrice);
      const curVs = lp && cur ? (cur / lp - 1) * 100 : null;
      const vol = Number(tf.buyVolumeBnb) || 0, wals = Number(tf.buyWallets) || 0;
      if (!(curVs != null && curVs <= 28.5 && vol >= 3 && wals >= 40)) continue;
      const k = t.token_address; if (seen.has(k)) continue; seen.add(k);
      const e = epM2.get(k);
      P.push({ exp: nm, token: k, buyTs: new Date(t.created_at).getTime(), grp: 'tail149', mx: null, ep: e && e.i > 0 ? (e.o - e.i) / e.i * 100 : null, chg5study: null, platform: null });
    }
  }
  // platform 批查（experiment_tokens.platform 列——token_create payload 无此键）
  const toks = [...new Set(P.map(p => p.token))];
  const platM = new Map();
  {
    const expIds = new Map(EXPS.map(x => [x[0], x[1]]));
    for (const [nm, id] of EXPS) {
      const ps = P.filter(p => p.exp === nm).map(p => p.token);
      for (let j = 0; j < ps.length; j += 50) {
        const { data, error } = await sb.from('experiment_tokens').select('token_address,platform')
          .eq('experiment_id', id).in('token_address', ps.slice(j, j + 50)).limit(50);
        if (error) { console.log('plat err', nm, error.message); continue; }
        for (const r of data || []) if (r.platform) platM.set(r.token_address.toLowerCase(), r.platform);
      }
    }
  }
  console.log(`买点=${P.length}（tail=${P.filter(p=>p.grp==='tail').length} tail149=${P.filter(p=>p.grp==='tail149').length} E=${P.filter(p=>p.grp==='E').length}）platform 覆盖=${platM.size}/${toks.length}`);

  // 重放
  const out = [];
  const q = [...P];
  async function w() {
    while (q.length) {
      const p = q.shift();
      try {
        const anchorIso = new Date(p.buyTs + 1000).toISOString();
        // ⚠双列 ORDER BY block_number 形状 planner 弃索引超时（CLAUDE.md 大表坑）——
        // 改单列 block_time 窗口拉取（30min 窗 + limit 3000），内存保序即链上真序近似
        const { data, error } = await sb.from('wss_price_ticks')
          .select(TICK_COLS).eq('token_address', p.token)
          .gte('block_time', new Date(p.buyTs - 1800000).toISOString())
          .lte('block_time', anchorIso)
          .order('block_time', { ascending: true })
          .limit(3000);
        if (error) throw new Error(error.message);
        const rows = (data || []).slice();
        if (rows.length < 6) continue;
        const plat = platM.get(p.token) || 'fourmeme';
        const meta = { address: p.token, symbol: null, name: null, platform: plat, quoteToken: rows[rows.length-1] && rows[rows.length-1].quote_token, createdAt: null, totalSupply: null, creatorAddress: null };
        const snap = buildBuyPointSnapshot(rows, meta, { capped: rows.length >= 3000, anchorTickCount: rows.length });
        const bd = snap.buyDerived || {};
        out.push({ ...p, chg5: bd.chg5Pct ?? null, chg10: bd.chg10Pct ?? null, chg30: bd.chg30Pct ?? null,
          athVs: bd.athVsLaunchPct ?? null, curVs: bd.currentVsLaunchPct ?? null, vol: bd.totalVolumeBnb ?? null,
          age: bd.tokenAgeSec ?? null, span: bd.spanSec ?? null });
      } catch (e) { /* skip */ }
    }
  }
  await Promise.all([w(), w(), w(), w()]);
  console.log(`重放成功=${out.length}/${P.length}`);

  // 分布
  const tailAll = out.filter(o => o.grp === 'tail' || o.grp === 'tail149');
  const neg = tailAll.filter(o => o.mx != null && o.mx < 3), pos = tailAll.filter(o => o.mx != null && o.mx >= 10);
  console.log(`\n尾部票重放: n=${tailAll.length}（mx 已知=${neg.length + pos.length + tailAll.filter(o=>o.mx!=null&&o.mx>=3&&o.mx<10).length}）`);
  for (const k of ['chg5', 'chg30', 'athVs', 'curVs', 'vol', 'age']) {
    console.log(`  ${k.padEnd(6)} 死盘 ${fmt(pctl(neg.map(o=>o[k]),.25))}/${fmt(pctl(neg.map(o=>o[k]),.5))}/${fmt(pctl(neg.map(o=>o[k]),.75))}  起涨 ${fmt(pctl(pos.map(o=>o[k]),.25))}/${fmt(pctl(pos.map(o=>o[k]),.5))}/${fmt(pctl(pos.map(o=>o[k]),.75))}`);
  }
  // chg5 双口径一致性（tail 组有 chg5study）
  const both = tailAll.filter(o => o.chg5study != null && o.chg5 != null);
  console.log(`  chg5 符号一致 ${both.filter(o => Math.sign(o.chg5study) === Math.sign(o.chg5)).length}/${both.length}`);

  // 域线：候选（athVs≥40 ∧ curVs≤28.5）在 E 组的进入率 + 尾部组覆盖率
  for (const [ath, cv] of [[40, 28.5], [50, 28.5], [30, 28.5]]) {
    const inDom = (o) => o.athVs != null && o.curVs != null && o.athVs >= ath && o.curVs <= cv;
    const eIn = out.filter(o => o.grp === 'E' && inDom(o));
    const tIn = tailAll.filter(inDom);
    const eAll2 = out.filter(o => o.grp === 'E' && o.athVs != null && o.curVs != null);
    console.log(`\n域线 athVs>=${ath} ∧ curVs<=${cv}: E进入 ${eIn.length}/${eAll2.length} | 尾部覆盖 ${tIn.length}/${tailAll.length}`);
    for (const c5 of [-5, 0]) {
      const hit = tIn.filter(o => o.chg5 != null && o.chg5 < c5);
      const eps = hit.map(o => o.ep).filter(x => x != null);
      console.log(`  域内 chg5<${c5}: n=${hit.length} epΣ=${eps.length?eps.reduce((s,x)=>s+x,0).toFixed(1):'—'} mean=${mean(eps)?.toFixed(1)}`);
      const eHit = eIn.filter(o => o.chg5 != null && o.chg5 < c5);
      const eEps = eHit.map(o => o.ep).filter(x => x != null);
      console.log(`  E组域内 chg5<${c5}: n=${eHit.length} epΣ=${eEps.length?eEps.reduce((s,x)=>s+x,0).toFixed(1):'—'}（正=拦了会伤）`);
    }
  }
  fs.writeFileSync('/tmp/tail-fp-replay.json', JSON.stringify(out));
  function fmt(v){return v==null?'—':v.toFixed(1);}
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
