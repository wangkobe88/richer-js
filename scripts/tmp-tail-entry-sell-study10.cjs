#!/usr/bin/env node
// 尾部低位研究 第十段：E 组（对照组）泛化验证 pre_chg5 规律
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['bt-v141', '3916fb15-66a1-45f0-bde1-1c145513817a'],
  ['bt-v142', '8a7b6b09-e2bc-4773-8393-a696821ff531'],
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
];
function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;}

async function main() {
  const sb = dbManager.getClient();
  const all = JSON.parse(fs.readFileSync('/tmp/tail-entry-study.json', 'utf8'));
  const eGrp = all.filter(r => r.grp === 'E_early_thin');
  // 按票去重
  const byTk = new Map();
  for (const r of eGrp) { const k = r.exp + '|' + r.token; if (!byTk.has(k)) byTk.set(k, r); }
  const P = [...byTk.values()];
  console.log(`E 组按票去重 n=${P.length}`);
  const epM = new Map();
  for (const s of JSON.parse(fs.readFileSync('/tmp/tail-entry-study2.json', 'utf8'))) if (s.epPnl != null) epM.set(s.exp + '|' + s.token, s.epPnl);
  for (const p of P) p.ep = epM.get(p.exp + '|' + p.token) ?? null;

  // 拉买前 ticks（±10s 即可算 chg5）
  const toks = [...new Set(P.map(p => p.token))];
  const chg5Map = new Map(); // exp|token -> chg5（取该票第一个买点）
  let done = 0;
  async function one(p) {
    const t0 = p.buyTs - 15000, t1 = p.buyTs + 500;
    const { data, error } = await sb.from('wss_price_ticks')
      .select('block_time,price_usd,price_outlier')
      .eq('token_address', p.token)
      .gte('block_time', new Date(t0).toISOString()).lt('block_time', new Date(t1).toISOString())
      .order('block_time', { ascending: true }).limit(200);
    if (error) return;
    const rows = (data || []).filter(r => !r.price_outlier && Number(r.price_usd) > 0)
      .map(r => ({ ts: new Date(r.block_time).getTime(), p: Number(r.price_usd) }));
    if (!rows.length) return;
    const pre = rows.filter(r => r.ts <= p.buyTs + 3000);
    const P0 = pre.length ? pre[pre.length - 1].p : null;
    if (P0 == null) return;
    const ref = pre.find(r => r.ts > p.buyTs - 5000);
    const refP = ref ? ref.p : pre[0].p;
    chg5Map.set(p.exp + '|' + p.token, (P0 / refP - 1) * 100);
  }
  const q = [...P];
  async function w() { while (q.length) { const p = q.shift(); try { await one(p); } catch (e) {} if (++done % 80 === 0) console.log(`  ${done}/${P.length}`); } }
  await Promise.all([w(), w(), w(), w(), w(), w()]);

  let cov = 0;
  for (const p of P) { p.chg5 = chg5Map.get(p.exp + '|' + p.token); if (p.chg5 != null) cov++; }
  console.log(`chg5 覆盖 ${cov}/${P.length}`);

  // E 组分桶
  for (const [name, pred] of [
    ['chg5<-5 (接刀)', p => p.chg5 != null && p.chg5 < -5],
    ['-5<=chg5<0', p => p.chg5 != null && p.chg5 >= -5 && p.chg5 < 0],
    ['chg5>=0 (已微涨)', p => p.chg5 != null && p.chg5 >= 0],
  ]) {
    const rs = P.filter(pred);
    const eps = rs.map(p => p.ep).filter(x => x != null);
    const win = eps.filter(x => x > 0).length;
    console.log(`${name.padEnd(16)} n=${rs.length} ep mean=${mean(eps)?.toFixed(1)} 中位=${eps.sort((a,b)=>a-b)[Math.floor(eps.length/2)]?.toFixed(1)} 胜率=${(win/Math.max(eps.length,1)*100).toFixed(0)}% mx<3占比=${(rs.filter(r=>r.mx<3).length/rs.length*100).toFixed(0)}%`);
  }
  // 拦截面明细 top 亏损与 top 盈利（chg5<-5 的被拦票 ep 分布）
  const arm = P.filter(p => p.chg5 != null && p.chg5 < -5 && p.ep != null).sort((a, b) => a.ep - b.ep);
  console.log(`\nE组 chg5<-5 拦截面 n=${arm.length} epΣ=${arm.reduce((s,x)=>s+x.ep,0).toFixed(1)}`);
  console.log('最差5:', arm.slice(0, 5).map(x => `${x.token.slice(0,8)}:${x.ep.toFixed(0)}`).join(' '));
  console.log('最好5:', arm.slice(-5).reverse().map(x => `${x.token.slice(0,8)}:${x.ep.toFixed(0)}(${x.chg5.toFixed(0)})`).join(' '));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
