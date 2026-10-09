#!/usr/bin/env node
/**
 * bddd3578 C/D 逐 case 深挖 + E 类规律挖掘
 *
 * 数据：trades 明细（买卖时点/价格）+ strategy_signals（tokenCreateTime/
 * narrativeCall/卖出 reason）+ token_narrative（语料全文 + jev 豁免链）
 * 输出：/tmp/bddd-cd-blocks.txt（C/D 35 票逐票 block）
 *      /tmp/bddd-e-rows.json（E 108 票行为行）+ 控制台 E 维度统计
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = 'bddd3578-f04f-42e2-b8a7-1ae4b6893a0a';
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = (v, d = 2) => v == null || !isFinite(v) ? 'null' : v.toFixed(d);
const ts = v => v ? new Date(new Date(v).getTime() + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : '-';

(async () => {
  const c = dbManager.getClient();
  const base = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-bddd3578-narrative.json'), 'utf8')).rows;
  const byAddr = new Map(base.map(r => [r.addr, r]));

  // ── signals 分批拉（metadata 大，批 40）──
  const addrs = base.map(r => r.addr);
  const sigs = new Map(); // addr -> [{action,reason,created_at,md}]
  for (let i = 0; i < addrs.length; i += 40) {
    const { data } = await c.from('strategy_signals')
      .select('token_address,action,reason,created_at,metadata')
      .eq('experiment_id', EXP_ID).in('token_address', addrs.slice(i, i + 40));
    for (const s of data || []) {
      if (!sigs.has(s.token_address)) sigs.set(s.token_address, []);
      sigs.get(s.token_address).push(s);
    }
  }
  // ── trades 明细 ──
  const tradesBy = new Map();
  for (let i = 0; i < addrs.length; i += 40) {
    const { data } = await c.from('trades')
      .select('token_address,trade_direction,input_amount,output_amount,unit_price,created_at')
      .eq('experiment_id', EXP_ID).in('token_address', addrs.slice(i, i + 40));
    for (const t of data || []) {
      if (!tradesBy.has(t.token_address)) tradesBy.set(t.token_address, []);
      tradesBy.get(t.token_address).push(t);
    }
  }

  // ── 行为派生 ──
  const behav = new Map();
  for (const [addr, tl] of tradesBy) {
    const buys = tl.filter(t => t.trade_direction === 'buy').sort((a, b) => a.created_at.localeCompare(b.created_at));
    const sells = tl.filter(t => t.trade_direction === 'sell').sort((a, b) => a.created_at.localeCompare(b.created_at));
    const buySig = (sigs.get(addr) || []).find(s => s.action === 'buy');
    const tokenCreate = buySig?.metadata?.tokenCreateTime || null;
    const firstBuyMs = buys[0] ? new Date(buys[0].created_at).getTime() : null;
    const createMs = tokenCreate ? new Date(tokenCreate).getTime() : null;
    const lastSellMs = sells.length ? new Date(sells[sells.length - 1].created_at).getTime() : null;
    const avgBuy = buys.length ? sum(buys.map(t => Number(t.input_amount) || 0)) / 1 : 0;
    const sellReasons = (sigs.get(addr) || []).filter(s => s.action === 'sell').map(s => (s.reason || '').replace(/^卖出策略\s*/, ''));
    behav.set(addr, {
      buys: buys.length, sells: sells.length,
      firstBuyAgeSec: createMs != null && firstBuyMs != null ? Math.round((firstBuyMs - createMs) / 1000) : null,
      holdSec: firstBuyMs && lastSellMs ? Math.round((lastSellMs - firstBuyMs) / 1000) : null,
      spent: +sum(buys.map(t => Number(t.input_amount) || 0)).toFixed(3),
      got: +sum(sells.map(t => Number(t.output_amount) || 0)).toFixed(3),
      sellReasons: [...new Set(sellReasons)],
      narrCall: buySig?.metadata?.narrativeCall || null,
      corpusLagSec: (() => { // 语料→token创建
        const r = byAddr.get(addr);
        if (!r || !r.corpusTs || createMs == null) return null;
        const cms = new Date(r.corpusTs).getTime();
        return cms != null && !isNaN(cms) ? Math.round((createMs - cms) / 1000) : null;
      })(),
      trendCycle: buySig?.metadata?.trendFactors?.tokenCycle ?? null,
    });
  }

  // ── C/D 逐票 block：拉完整 token_narrative ──
  const cdAddrs = base.filter(r => r.jevCategory === 'C' || r.jevCategory === 'D').map(r => r.addr);
  const narrFull = new Map();
  for (let i = 0; i < cdAddrs.length; i += 40) {
    const { data } = await c.from('token_narrative')
      .select('token_address,stage2_result,stage1_result,twitter_info')
      .in('token_address', cdAddrs.slice(i, i + 40));
    (data || []).forEach(r => narrFull.set(r.token_address, r));
  }
  const out = [];
  out.push('########## C/D 逐 case（jevCategory C/D 共 ' + cdAddrs.length + ' 票）##########');
  for (const cat of ['C', 'D']) {
    out.push(`\n===== 类别 ${cat} =====`);
    for (const r of base.filter(x => x.jevCategory === cat).sort((a, b) => a.net - b.net)) {
      const n = narrFull.get(r.addr) || {};
      const s2 = (n.stage2_result || {});
      const s2j = s2.details?.jev || {};
      const ti = n.twitter_info || {};
      const parent = ti.in_reply_to || {};
      const b = behav.get(r.addr) || {};
      const p = s2j.probabilities || {};
      out.push(`\n--- [${cat}] ${r.symbol} ${r.addr} net=${fmt(r.net)} tier=${s2j.magnitudeTier} rating=${r.rating} refMem=${r.referentMemeability} ---`);
      out.push(`stage2: ${s2.reason || ''}`);
      // 豁免/锚链命中
      const flags = [];
      if (s2j.web3FitAnchored) flags.push('web3FitAnchored');
      if (s2j.tierAnchored) flags.push('tierAnchored(pubProxy)');
      if (s2j.publisherProxyActive) flags.push('pubProxyActive');
      if (s2j.nrNotableExempt) flags.push('nrNotableExempt' + JSON.stringify(s2j.nrNotableExempt));
      if (s2j.wInteractionExempt) flags.push('wInteractionExempt');
      if (s2j.productEntityBinanceExempt) flags.push('binanceExempt');
      if (s2j.rcpPlatformExempt) flags.push('rcpPlatformExempt');
      if (s2j.referentMemeabilityBlock) flags.push('refMemBlock');
      if (s2j.nameReferentBlockMass != null) flags.push(`nrBlockMass=${s2j.nameReferentBlockMass}`);
      out.push(`jev: timing=${s2j.timing} fit=${JSON.stringify(p.web3_fit)} refMem=${s2j.referentMemeabilityScore} nr=${JSON.stringify(p.name_referent)} subjEntity=${s2j.subjectEntity}` + (flags.length ? `  豁免链:[${flags.join(' ')}]` : ''));
      out.push(`s1分类: ${JSON.stringify((n.stage1_result || {}).details?.eventClassification || null)} tweetType=${s2j.tweetType}`);
      out.push(`语料: @${ti.author_screen_name || '-'}(${ti.author_followers_count ?? '?'}粉) ${ts(ti.created_at)}「${(ti.text || '').slice(0, 200)}」` + (parent.tweet_id ? ` 父推=@${parent.author_screen_name}(${parent.author_followers_count ?? '?'}粉)「${(parent.text || '').slice(0, 80)}」` : ''));
      out.push(`盘面: 首买age=${b.firstBuyAgeSec}s 买${b.buys}笔 卖${b.sells}笔 hold=${b.holdSec}s spent=${b.spent} got=${b.got} lag=${b.corpusLagSec}s cycle=${b.trendCycle}`);
      out.push(`卖出腿: ${(b.sellReasons || []).join(' | ') || '无卖出（强平）'}`);
      if (b.narrCall) out.push(`narrativeCall: ${JSON.stringify(b.narrCall).slice(0, 200)}`);
    }
  }
  fs.writeFileSync('/tmp/bddd-cd-blocks.txt', out.join('\n'));
  console.log(`C/D blocks → /tmp/bddd-cd-blocks.txt（${cdAddrs.length} 票）`);

  // ── E 类行为行 ──
  const eRows = base.filter(r => r.jevCategory === 'E').map(r => {
    const b = behav.get(r.addr) || {};
    const ti = r.corpus || {};
    return {
      addr: r.addr, symbol: r.symbol, net: r.net, tier: r.magnitudeTier, rating: r.rating,
      refMem: r.referentMemeability, timing: r.timing,
      author: ti.author || null, followers: ti.authorFollowers ?? null,
      text: ti.text || '', tweetId: ti.tweetId || null, parentAuthor: ti.parentAuthor || null,
      corpusTs: r.corpusTs, lagSec: b.corpusLagSec, firstBuyAgeSec: b.firstBuyAgeSec,
      buys: b.buys, sells: b.sells, holdSec: b.holdSec, cycle: b.trendCycle,
      sellReasons: b.sellReasons || [],
    };
  });
  fs.writeFileSync('/tmp/bddd-e-rows.json', JSON.stringify(eRows, null, 1));
  console.log(`E rows → /tmp/bddd-e-rows.json（${eRows.length} 票）`);
})().catch(e => { console.error(e); process.exit(1); });
