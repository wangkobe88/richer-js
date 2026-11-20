#!/usr/bin/env node
// FP17 最终确认：E 组全量 356 票重放 → 双腿臂全量净效应
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const EXPS = [
  ['bt-v141', '3916fb15-66a1-45f0-bde1-1c145513817a'],
  ['bt-v142', '8a7b6b09-e2bc-4773-8393-a696821ff531'],
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
];
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}

async function main() {
  const sb = dbManager.getClient();
  const all = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));
  const byTk = new Map();
  for (const r of all) { const k = r.exp + '|' + r.token; if (!byTk.has(k)) byTk.set(k, r); }
  const P = [...byTk.values()]; // 全部 428 买点（含尾部+对照）
  const epM = new Map();
  for (const s of JSON.parse(fs.readFileSync('/tmp/tail-entry-study2.json', 'utf8'))) if (s.epPnl != null) epM.set(s.exp + '|' + s.token, s.epPnl);

  // platform
  const platM = new Map();
  for (const [nm, id] of EXPS) {
    const ps = P.filter(p => p.exp === nm).map(p => p.token);
    for (let j = 0; j < ps.length; j += 50) {
      const { data } = await sb.from('experiment_tokens').select('token_address,platform')
        .eq('experiment_id', id).in('token_address', ps.slice(j, j + 50)).limit(50);
      for (const r of data || []) if (r.platform) platM.set(r.token_address.toLowerCase(), r.platform);
    }
  }
  console.log(`买点=${P.length} platform=${platM.size}`);

  const out = [];
  const q = [...P];
  async function w() {
    while (q.length) {
      const p = q.shift();
      try {
        const { data, error } = await sb.from('wss_price_ticks')
          .select(TICK_COLS).eq('token_address', p.token)
          .gte('block_time', new Date(p.buyTs - 1800000).toISOString())
          .lte('block_time', new Date(p.buyTs + 1000).toISOString())
          .order('block_time', { ascending: true }).limit(3000);
        if (error) throw new Error(error.message);
        const rows = data || [];
        if (rows.length < 6) continue;
        const plat = platM.get(p.token) || 'fourmeme';
        const meta = { address: p.token, symbol: null, name: null, platform: plat, quoteToken: rows[rows.length-1] && rows[rows.length-1].quote_token, createdAt: null, totalSupply: null, creatorAddress: null };
        const snap = buildBuyPointSnapshot(rows, meta, { capped: rows.length >= 3000, anchorTickCount: rows.length });
        const bd = snap.buyDerived || {};
        out.push({ exp: p.exp, token: p.token, grp: p.grp, mx: p.mx, ep: epM.get(p.exp + '|' + p.token) ?? null,
          chg5: bd.chg5Pct ?? null, chg30: bd.chg30Pct ?? null, athVs: bd.athVsLaunchPct ?? null, curVs: bd.currentVsLaunchPct ?? null });
      } catch (e) {}
    }
  }
  await Promise.all([w(), w(), w(), w(), w(), w()]);
  console.log(`重放=${out.length}/${P.length}`);

  const KNIFE = (o) => o.chg5 != null && o.chg30 != null && o.athVs != null && o.curVs != null
    && o.athVs >= 40 && o.curVs <= 28.5 && o.chg5 < -5 && o.chg30 < -5;
  // 对照：单腿（无 chg30 腿）
  const KNIFE1 = (o) => o.chg5 != null && o.athVs != null && o.curVs != null && o.athVs >= 40 && o.curVs <= 28.5 && o.chg5 < -5;

  for (const [nm, pred] of [['双腿 chg5<-5∧chg30<-5', KNIFE], ['单腿 chg5<-5', KNIFE1]]) {
    const hit = out.filter(pred);
    const eps = hit.map(o => o.ep).filter(x => x != null);
    const byG = {};
    for (const h of hit) byG[h.grp.startsWith('E') ? 'E' : 'tail'] = (byG[h.grp.startsWith('E') ? 'E' : 'tail'] || 0) + 1;
    const tailHit = hit.filter(h => !h.grp.startsWith('E')), eHit = hit.filter(h => h.grp.startsWith('E'));
    const tS = tailHit.map(o=>o.ep).filter(x=>x!=null).reduce((s,x)=>s+x,0);
    const eS = eHit.map(o=>o.ep).filter(x=>x!=null).reduce((s,x)=>s+x,0);
    console.log(`\n[${nm}] 命中=${hit.length}（尾部${byG.tail||0}/E组${byG['E']||0}）`);
    console.log(`  尾部命中 epΣ=${tS.toFixed(1)}（负=拦对） E组命中 epΣ=${eS.toFixed(1)}（负=拦对）`);
    console.log(`  命中票 ep mean=${mean(eps)?.toFixed(1)} 正票数=${eps.filter(x=>x>0).length}`);
  }
  // 双腿臂明细
  console.log('\n=== 双腿臂命中全明细');
  for (const o of out.filter(KNIFE)) {
    console.log(`${o.grp.startsWith('E') ? 'E' : '尾'} ${o.exp} ${o.token.slice(0,10)} chg5=${o.chg5.toFixed(1)} chg30=${o.chg30.toFixed(1)} ath=${o.athVs.toFixed(0)} curVs=${o.curVs.toFixed(1)} mx=${o.mx?.toFixed(0)} ep=${o.ep?.toFixed(1)}`);
  }
  fs.writeFileSync('/tmp/tail-fp-final.json', JSON.stringify(out));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
