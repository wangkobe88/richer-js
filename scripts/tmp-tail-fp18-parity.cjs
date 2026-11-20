#!/usr/bin/env node
// T182/FP18 端到端对拍：真 evaluateFactorPreBuy 跑 428 买点 → tail_dip_knife 命中面 vs 研究谓词
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const { evaluateFactorPreBuy, FACTOR_PREBUY_VERSION } = require('../src/market-analysis/factor-pre-buy-check');
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
  console.log('FP version =', FACTOR_PREBUY_VERSION);
  const sb = dbManager.getClient();
  // 复用 final-verify 的重放结果（snapshot 输入已缓存 tick 拉取不可行——重拉一次）
  const all = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));
  const byTk = new Map();
  for (const r of all) { const k = r.exp + '|' + r.token; if (!byTk.has(k)) byTk.set(k, r); }
  const P = [...byTk.values()];
  const epM = new Map();
  for (const s of JSON.parse(fs.readFileSync('/tmp/tail-entry-study2.json', 'utf8'))) if (s.epPnl != null) epM.set(s.exp + '|' + s.token, s.epPnl);

  const platM = new Map();
  for (const [nm, id] of EXPS) {
    const ps = P.filter(p => p.exp === nm).map(p => p.token);
    for (let j = 0; j < ps.length; j += 50) {
      const { data } = await sb.from('experiment_tokens').select('token_address,platform')
        .eq('experiment_id', id).in('token_address', ps.slice(j, j + 50)).limit(50);
      for (const r of data || []) if (r.platform) platM.set(r.token_address.toLowerCase(), r.platform);
    }
  }

  const q = [...P];
  const hits = [];
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
        const verdict = evaluateFactorPreBuy(snap);
        if (!verdict.pass) {
          hits.push({ exp: p.exp, token: p.token, grp: p.grp, reason: verdict.reason, mx: p.mx, ep: epM.get(p.exp + '|' + p.token) ?? null });
        }
        // 专查 tail_dip_knife 命中（pass 也查 arms——reason 取首个臂，可能被更前臂认领）
        if (verdict.arms && verdict.arms.includes('tail_dip_knife')) {
          hits.push({ exp: p.exp, token: p.token, grp: p.grp, reason: 'tail_dip_knife(arms)', mx: p.mx, ep: epM.get(p.exp + '|' + p.token) ?? null });
        }
      } catch (e) {}
    }
  }
  await Promise.all([w(), w(), w(), w(), w(), w()]);

  const knife = hits.filter(h => (h.reason === 'tail_dip_knife' || h.reason === 'tail_dip_knife(arms)'));
  // 去重（同票可能双记）
  const seen = new Set(); const uniq = [];
  for (const h of knife) { const k = h.exp + h.token + h.reason; if (!seen.has(k)) { seen.add(k); uniq.push(h); } }
  const eps = uniq.map(h => h.ep).filter(x => x != null);
  const pos = eps.filter(x => x > 0);
  console.log(`\ntail_dip_knife 命中=${uniq.length}（去重后）`);
  console.log(`epΣ=${eps.reduce((s,x)=>s+x,0).toFixed(1)} mean=${mean(eps)?.toFixed(1)} 正票=${pos.length}/${eps.length}（正票 ep: ${pos.map(x=>x.toFixed(1)).join(',')}）`);
  // 与研究谓词对照（final json 的 KNIFE 双腿谓词命中 43）
  const fin = JSON.parse(fs.readFileSync('/tmp/tail-fp-final.json', 'utf8'));
  const pred43 = fin.filter(o => o.chg5 != null && o.chg30 != null && o.athVs != null && o.curVs != null && o.athVs >= 40 && o.curVs <= 28.5 && o.chg5 < -5 && o.chg30 < -5);
  const predSet = new Set(pred43.map(o => o.exp + '|' + o.token));
  const realSet = new Set(uniq.map(h => h.exp + '|' + h.token));
  const onlyPred = [...predSet].filter(k => !realSet.has(k));
  const onlyReal = [...realSet].filter(k => !predSet.has(k));
  console.log(`研究谓词 43=${predSet.size} | 真函数=${realSet.size} | 仅谓词=${onlyPred.length} 仅真函数=${onlyReal.length}`);
  for (const k of onlyPred.slice(0, 8)) console.log('  仅谓词命中:', k);
  for (const k of onlyReal.slice(0, 8)) console.log('  仅真函数命中:', k);
  // 全拒码分布（观察其它臂在新窗的命中——顺带冒烟）
  const byReason = {};
  for (const h of hits.filter(h => !h.reason.includes('(arms)'))) byReason[h.reason] = (byReason[h.reason] || 0) + 1;
  console.log('\n全部拒码分布:', JSON.stringify(byReason));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
