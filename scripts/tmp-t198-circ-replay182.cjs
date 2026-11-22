'use strict';
// T198 流通豁免跨窗 replay v2（182 跑）：v159(win1019)/v155(win1012)/v145(win1103)。
// v2 修复：去掉 experiment_tokens 全量分页（win1019 超时）——arbHold 判定分母=Σ正净
// 与 totalSupply 无关，先无 supply 建 snapshot 判 ≥30 命中，命中票再按需查
// wss_events token_create payload（tokenMetaFromCreatePayload 共享映射取真 supply）
// 重建 snapshot 算 chip.circSupplyPct + evaluateFactorPreBuy 定纯命中。
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const { evaluateFactorPreBuy } = require('../src/market-analysis/factor-pre-buy-check');
const { tokenMetaFromCreatePayload } = require('../src/trading-engine/core/token-create-meta');

const EXPS = [
  ['v159w1019', 'ce102e94-293c-4f8f-af98-cd06f4b0e98c'],
  ['v155w1012', 'dddbe79e-480a-402a-aa35-85a72d2f591e'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const A = 'metadata->buyPoint->anchors';
const TAGS = new Set(['arbitrager', 'sandwich_bot', 'wash_trader']);
const LINE = 16.5, FWD_MIN = 60;

async function page(sb, table, sel, exp, extraEq) {
  let after = null, out = [];
  for (;;) {
    let q = sb.from(table).select(sel).eq('experiment_id', exp);
    if (extraEq) for (const [k, v] of Object.entries(extraEq)) q = q.eq(k, v);
    q = q.order('id').limit(1000);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    out = out.concat(data); after = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return out;
}
const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

(async () => {
  const sb = dbManager.getClient();
  const arbSet = new Set();
  { let after = null;
    for (;;) {
      let q = sb.from('gmgn_wallet_profiles').select('address,tags').order('address').limit(1000);
      if (after) q = q.gt('address', after);
      const { data } = await q; if (!data || !data.length) break;
      for (const r of data) if ((r.tags || []).some((t) => TAGS.has(t))) arbSet.add(r.address.toLowerCase());
      after = data[data.length - 1].address;
      if (data.length < 1000) break;
    } }
  console.log(`arbBot 集: ${arbSet.size} 址`);

  const hits = [];
  for (const [label, exp] of EXPS) {
    const sigs = await page(sb, 'strategy_signals', `id,token_address,token_symbol,created_at,${A}->routerBuyPct60`, exp, { signal_type: 'BUY' });
    const byTok = new Map();
    for (const s of sigs) {
      if (s.routerBuyPct60 === null || s.routerBuyPct60 === undefined) continue;
      const prev = byTok.get(s.token_address);
      if (!prev || s.created_at < prev.at) byTok.set(s.token_address, { at: s.created_at, symbol: s.token_symbol || '' });
    }
    const trs = await page(sb, 'trades', 'id,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success', exp);
    const net = new Map();
    for (const t of trs) {
      if (!t.success) continue;
      let v = net.get(t.token_address) || 0;
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') v -= Number(t.input_amount);
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') v += Number(t.output_amount);
      net.set(t.token_address, v);
    }
    let done = 0, wHits = 0;
    for (const [tok, info] of byTok) {
      done++;
      if (done % 200 === 0) console.log(`  [${label}] 进度 ${done}/${byTok.size} 命中${wHits}`);
      const { data: rows } = await sb.from('wss_price_ticks')
        .select('*').eq('token_address', tok).lte('block_time', info.at)
        .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
      if (!rows || rows.length < 6) continue;
      const baseMeta = { address: tok, symbol: info.symbol, name: '', createdAt: rows[0].block_time, creatorAddress: null, totalSupply: null };
      let snap;
      try { snap = buildBuyPointSnapshot(rows, baseMeta, { arbBotWallets: arbSet }); }
      catch (e) { console.log(`  SNAP_FAIL ${label} ${tok} ${e.message}`); continue; }
      const pct = snap.buyDerived && snap.buyDerived.arbBotHoldCircPct;
      if (typeof pct !== 'number' || pct < 30) continue;
      // 命中：按需取 token_create 真 supply 重建（流通/纯命中判定需要）
      let circ = null, pure = false, otherArms = [], armHit = false;
      try {
        const { data: ev } = await sb.from('wss_events')
          .select('payload,block_time,platform').eq('token_address', tok).eq('kind', 'token_create').limit(1);
        const evRow = ev && ev[0];
        if (evRow && evRow.payload) {
          const tm = tokenMetaFromCreatePayload(evRow.platform, evRow.payload, evRow.block_time);
          const meta2 = { ...baseMeta, createdAt: evRow.block_time || baseMeta.createdAt, totalSupply: tm.totalSupply > 0 ? tm.totalSupply : null, creatorAddress: tm.creator || null };
          const snap2 = buildBuyPointSnapshot(rows, meta2, { arbBotWallets: arbSet });
          circ = snap2.buyDerived && snap2.buyDerived.chip ? snap2.buyDerived.chip.circSupplyPct : null;
          const v = evaluateFactorPreBuy(snap2);
          armHit = (v.arms || []).includes('arb_bot_holdings'); // 对拍口径：当前代码臂判定（T198b 豁免后=流通≥16.5 才命中）
          otherArms = (v.arms || []).filter((a) => a !== 'arb_bot_holdings');
          pure = otherArms.length === 0;
        } else { pure = false; otherArms = ['NO_CREATE_EVENT']; }
      } catch (e) { pure = false; otherArms = ['EVAL_FAIL:' + e.message.slice(0, 60)]; }
      // 前向收益
      let entry = null, fwdMax = null, fwdMin = null, ret30 = null;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].price_bnb != null) { entry = Number(rows[i].price_bnb); break; }
      }
      if (entry != null) {
        const to = new Date(new Date(info.at).getTime() + FWD_MIN * 60000).toISOString();
        const t30 = new Date(new Date(info.at).getTime() + 30 * 60000).toISOString();
        const { data: fwd } = await sb.from('wss_price_ticks')
          .select('block_time,price_bnb').eq('token_address', tok)
          .gt('block_time', info.at).lte('block_time', to)
          .not('price_bnb', 'is', null).limit(4000);
        const arr = (fwd || []).map((r) => ({ t: r.block_time, p: Number(r.price_bnb) })).sort((a, b) => a.t.localeCompare(b.t));
        if (arr.length) {
          fwdMax = Math.max(...arr.map((x) => x.p)) / entry - 1;
          fwdMin = Math.min(...arr.map((x) => x.p)) / entry - 1;
          const at30 = arr.filter((x) => x.t <= t30).pop();
          ret30 = at30 ? at30.p / entry - 1 : null;
        }
      }
      wHits++;
      hits.push({ label, token: tok, symbol: info.symbol, at: info.at, arbHold: pct, circ, pure, armHit, otherArms, pnl: net.get(tok), fwdMax, fwdMin, ret30 });
      console.log(`  ${armHit ? 'HIT' : 'EXEMPTED'} ${label} ${tok} ${info.symbol} arbHold=${pct}% circ=${circ != null ? circ.toFixed(1) + '%' : '-'} pure=${pure} other=[${otherArms.join(',')}] pnl=${net.get(tok) !== undefined ? net.get(tok).toFixed(3) : '-'} fwdMax=${fwdMax != null ? (fwdMax * 100).toFixed(1) + '%' : '-'} ret30=${ret30 != null ? (ret30 * 100).toFixed(1) + '%' : '-'} fwdMin=${fwdMin != null ? (fwdMin * 100).toFixed(1) + '%' : '-'}`);
    }
    console.log(`### ${label}: token ${byTok.size} 命中 ${wHits} 票`);
  }

  function agg(list, name) {
    const f = list.filter((h) => h.fwdMax != null);
    console.log(`\n=== ${name}: ${list.length} 行（前向数据 ${f.length}）===`);
    if (!f.length) return;
    const mx = f.map((h) => h.fwdMax), mn = f.map((h) => h.fwdMin);
    console.log(`  fwdMax(60m): 中位 ${(med(mx) * 100).toFixed(1)}%  最大 ${(Math.max(...mx) * 100).toFixed(1)}%  ≥+50%: ${mx.filter(r => r >= 0.5).length}  ≥+100%: ${mx.filter(r => r >= 1).length}`);
    const r30 = f.filter((h) => h.ret30 != null).map((h) => h.ret30);
    if (r30.length) console.log(`  ret@30m:   中位 ${(med(r30) * 100).toFixed(1)}%  >0: ${r30.filter(r => r > 0).length}/${r30.length}  最差 ${(Math.min(...r30) * 100).toFixed(1)}%`);
    console.log(`  fwdMin(60m): 中位 ${(med(mn) * 100).toFixed(1)}%  ≤−30%: ${mn.filter(r => r <= -0.3).length}`);
    const withPnl = list.filter((h) => h.pnl !== undefined);
    if (withPnl.length) {
      const s = withPnl.reduce((a, h) => a + h.pnl, 0);
      console.log(`  trades净额(有成交 ${withPnl.length} 票): Σ${s.toFixed(3)} 胜 ${withPnl.filter(h => h.pnl > 0).length}`);
    }
  }
  const blocked = hits.filter((h) => h.armHit);
  const exempted = hits.filter((h) => !h.armHit);
  agg(blocked, 'T198b 后拦截面（当前代码 armHit——流通≥16.5 或流通缺席）');
  agg(exempted, 'T198b 豁免面（armHit=false——流通<16.5）');
  agg(blocked.filter((h) => h.pure), '拦截面·纯命中');
  agg(exempted.filter((h) => h.pure), '豁免面·纯命中（豁免真成交面）');
  // 一致性对拍：豁免面必须恰=流通<16.5；流通缺席必须仍拦（fail-closed）
  const badExempt = exempted.filter((h) => h.circ == null || h.circ >= LINE);
  const badBlock = blocked.filter((h) => h.circ != null && h.circ < LINE);
  console.log(`\n对拍一致性: 豁免面 ${exempted.length} 行（其中流通缺席误豁 ${badExempt.length}）/ 拦截面 ${blocked.length} 行（其中流通<16.5 误拦 ${badBlock.length}）→ ${badExempt.length === 0 && badBlock.length === 0 ? '✅ 与流通切分精确重合' : '❌ 漂移'}`);
  console.log(`总候选（arbHold≥30）${hits.length}（纯命中 ${hits.filter(h => h.pure).length}）`);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message, e); process.exit(1); });
