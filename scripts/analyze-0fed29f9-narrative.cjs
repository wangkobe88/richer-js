#!/usr/bin/env node
/**
 * 0fed29f9（链上真序 R2 基线回测，105 票）叙事分析结果系统性分析
 *
 * 1. trades per-token 账本（Σsell.output − Σbuy.input，BNB）
 * 2. token_narrative 关联（stage_final_result.rating / token_category / prestage / stage1 jev 细节）
 * 3. 输出：评级×盈亏矩阵 / token_category×盈亏矩阵 / 重亏票逐票叙事详情（含语料摘要）
 *
 * 用法（182）：node scripts/analyze-0fed29f9-narrative.cjs
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const EXP_ID = '0fed29f9-cf81-4034-8eca-236b5a96916d';
const LOSS_DETAIL_THRESHOLD = -0.04; // 净亏低于此值进逐票详情
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = (v, d = 2) => v == null || (typeof v === 'number' && !isFinite(v)) ? 'null' : (typeof v === 'number' ? v.toFixed(d) : v);

(async () => {
  const c = dbManager.getClient();

  // ---------- 1. 实验 + trades ----------
  const { data: exp } = await c.from('experiments').select('config,stats,experiment_name,started_at,stopped_at').eq('id', EXP_ID).single();
  const cfg = exp.config || {};
  console.log(`实验: ${exp.experiment_name}`);
  console.log(`窗口: ${cfg.startDate ?? '?'} → ${cfg.endDate ?? '?'} platform=${cfg.platform || 'fourmeme(default)'}`);
  const buyLeg = (cfg.strategiesConfig?.buyStrategies || [])[0] || {};
  console.log(`买腿 condition: ${buyLeg.condition}`);
  console.log(`买腿 narrativeCallCondition: ${buyLeg.narrativeCallCondition}`);
  console.log(`买腿 preBuyCheckCondition: ${buyLeg.preBuyCheckCondition}`);

  const { data: trades } = await c.from('trades')
    .select('id,token_address,token_symbol,trade_direction,input_amount,output_amount,unit_price,success,signal_id,created_at')
    .eq('experiment_id', EXP_ID).limit(8000);

  const tokens = new Map();
  for (const t of trades) {
    if (!tokens.has(t.token_address)) tokens.set(t.token_address, { addr: t.token_address, symbol: t.token_symbol, buys: [], sells: [] });
    const tk = tokens.get(t.token_address);
    (t.trade_direction === 'buy' ? tk.buys : tk.sells).push(t);
  }
  for (const tk of tokens.values()) {
    tk.spent = sum(tk.buys.map(t => Number(t.input_amount) || 0));
    tk.got = sum(tk.sells.map(t => Number(t.output_amount) || 0));
    tk.net = tk.got - tk.spent;
    tk.firstBuyAt = tk.buys.length ? tk.buys.map(t => t.created_at).sort()[0] : null;
  }
  const all = [...tokens.values()].sort((a, b) => a.net - b.net);
  const wins = all.filter(t => t.net > 0.0005), losses = all.filter(t => t.net < -0.0005), flats = all.filter(t => !(t.net > 0.0005) && !(t.net < -0.0005));
  console.log(`\n===== 账本总览 =====`);
  console.log(`tokens=${all.length} win=${wins.length} loss=${losses.length} flat=${flats.length} 净额=${sum(all.map(t => t.net)).toFixed(4)} BNB`);
  console.log(`赢票合计 +${sum(wins.map(t => t.net)).toFixed(3)} | 亏票合计 ${sum(losses.map(t => t.net)).toFixed(3)}`);

  // ---------- 2. token_narrative 批查 ----------
  const addrs = all.map(t => t.addr);
  const narr = new Map();
  const NARR_COLS = 'token_address,is_valid,analyzed_at,token_category,analysis_stage,prompt_version,stage_final_result,prestage_result,pre_check_result';
  for (let i = 0; i < addrs.length; i += 60) {
    const { data } = await c.from('token_narrative').select(NARR_COLS).in('token_address', addrs.slice(i, i + 60));
    (data || []).forEach(r => {
      const prev = narr.get(r.token_address);
      if (!prev || (r.is_valid && !prev.is_valid) || (r.is_valid === prev.is_valid && r.analyzed_at > prev.analyzed_at)) narr.set(r.token_address, r);
    });
  }
  console.log(`\nnarrative 关联: ${narr.size}/${all.length}（miss=${all.filter(t => !narr.has(t.addr)).length}）`);

  // ---------- 3. 摘要函数 ----------
  function narrDigest(tk) {
    const n = narr.get(tk.addr);
    if (!n) return { rating: 'NO_ROW', cat: '-', stage: '-', pv: '-' };
    const sf = n.stage_final_result || {};
    const s1 = n.stage1_result || {};
    const jev = s1.jev || {};
    return {
      rating: sf.rating ?? s1.rating ?? (n.prestage_result?.rating ?? null),
      cat: n.token_category || '-',
      stage: n.analysis_stage || '-',
      pv: n.prompt_version || '-',
      reason: sf.reason || jev.reason || null,
      jev,
      s1, sf, prestage: n.prestage_result || null,
      precheck: n.pre_check_result || null,
      analyzedAt: n.analyzed_at,
    };
  }

  // ---------- 4. 评级 × 盈亏矩阵 ----------
  console.log(`\n===== 评级(rating) × 盈亏 =====`);
  const byRating = new Map();
  for (const tk of all) {
    const d = narrDigest(tk);
    const k = d.rating == null ? 'null' : String(d.rating);
    if (!byRating.has(k)) byRating.set(k, []);
    byRating.get(k).push(tk);
  }
  for (const [k, list] of [...byRating.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const w = list.filter(t => t.net > 0.0005).length;
    console.log(`rating=${k}: ${String(list.length).padStart(3)} 票 | 净额 ${sum(list.map(t => t.net)).toFixed(+3 === +3 ? 3 : 3).padStart(8)} | 胜 ${w}/${list.length} (${(100 * w / list.length).toFixed(0)}%)`);
  }

  // ---------- 5. token_category × 盈亏矩阵 ----------
  console.log(`\n===== token_category × 盈亏 =====`);
  const byCat = new Map();
  for (const tk of all) {
    const d = narrDigest(tk);
    const k = d.cat || '-';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(tk);
  }
  for (const [k, list] of [...byCat.entries()].sort((a, b) => sum(b[1].map(t => t.net)) - sum(a[1].map(t => t.net)))) {
    const w = list.filter(t => t.net > 0.0005).length;
    console.log(`${String(k).padEnd(28)} ${String(list.length).padStart(3)} 票 | 净额 ${sum(list.map(t => t.net)).toFixed(3).padStart(8)} | 胜 ${w}/${list.length}`);
  }

  // ---------- 6. 重亏票逐票详情 ----------
  const lossDetail = all.filter(t => t.net < LOSS_DETAIL_THRESHOLD);
  console.log(`\n===== 重亏票（net < ${LOSS_DETAIL_THRESHOLD}，${lossDetail.length} 张，合计 ${sum(lossDetail.map(t => t.net)).toFixed(3)}）=====`);
  for (const tk of lossDetail) {
    const d = narrDigest(tk);
    console.log(`\n--- ${tk.symbol || '?'} ${tk.addr}`);
    console.log(`  净 ${tk.net.toFixed(4)} BNB | 买 ${tk.buys.length} 笔(${tk.spent.toFixed(3)}) 卖 ${tk.sells.length} 笔(${tk.got.toFixed(3)}) | 首买 ${tk.firstBuyAt}`);
    console.log(`  叙事: rating=${d.rating} cat=${d.cat} stage=${d.stage} pv=${d.pv} analyzed=${d.analyzedAt}`);
    if (d.sf && Object.keys(d.sf).length) {
      const o = {};
      for (const k of ['rating', 'finalScore', 'confidence', 'summary']) if (d.sf[k] != null) o[k] = d.sf[k];
      console.log(`  stage_final 摘要: ${JSON.stringify(o).slice(0, 400)}`);
    }
    const jev = d.jev || {};
    if (Object.keys(jev).length) {
      const o = {};
      for (const k of ['category', 'aggregatedCategory', 'totalScore', 'eventScore', 'magnitudeTier', 'effTier', 'blockReason', 'relevance', 'quality', 'reason']) if (jev[k] != null) o[k] = jev[k];
      console.log(`  jev 摘要: ${JSON.stringify(o).slice(0, 700)}`);
    }
    if (d.prestage) {
      const o = {};
      for (const k of ['rating', 'tokenType', 'summary', 'reason']) if (d.prestage[k] != null) o[k] = d.prestage[k];
      console.log(`  prestage 摘要: ${JSON.stringify(o).slice(0, 300)}`);
    }
    if (d.precheck && d.precheck.passed === false) {
      console.log(`  precheck: FAILED ${JSON.stringify(d.precheck).slice(0, 200)}`);
    }
  }

  // ---------- 7. 大赢票对照（top 10）----------
  console.log(`\n===== 大赢票 top10 对照 =====`);
  for (const tk of all.slice(-10).reverse()) {
    const d = narrDigest(tk);
    console.log(`+${tk.net.toFixed(4)}  ${tk.symbol || '?'} rating=${d.rating} cat=${d.cat}`);
  }

  // ---------- 8. 导出 JSON 供后续深挖 ----------
  const fs = require('fs');
  const out = all.map(tk => {
    const d = narrDigest(tk);
    return {
      addr: tk.addr, symbol: tk.symbol, net: +tk.net.toFixed(4), spent: +tk.spent.toFixed(4), got: +tk.got.toFixed(4),
      firstBuyAt: tk.firstBuyAt,
      rating: d.rating, cat: d.cat, stage: d.stage, pv: d.pv, analyzedAt: d.analyzedAt,
      jevKeys: d.jev ? Object.keys(d.jev) : [],
    };
  });
  fs.writeFileSync(require('path').join(__dirname, '../data/analysis-0fed29f9-narrative-summary.json'), JSON.stringify(out, null, 1));
  console.log(`\n导出: data/analysis-0fed29f9-narrative-summary.json`);
})().catch(e => { console.error(e); process.exit(1); });
