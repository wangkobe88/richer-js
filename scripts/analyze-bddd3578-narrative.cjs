#!/usr/bin/env node
/**
 * bddd3578（回测-lag门-36a2c12a窗口-叙事重析-1009）交易 × 叙事画像分析
 *
 * 目标：损失票主要是什么类型（叙事分类/评级/量级档/题材维度）
 * 口径：net = Σ卖 output − Σ买 input（与 analyze-0fed29f9-narrative-full 同口径）
 * 叙事：token_narrative（is_valid 优先 + analyzed_at 最新去重）
 *
 * 用法（182）：node scripts/analyze-bddd3578-narrative.cjs
 * 输出：控制台摘要 + data/analysis-bddd3578-narrative.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = 'bddd3578-f04f-42e2-b8a7-1ae4b6893a0a';
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = (v, d = 3) => v == null || !isFinite(v) ? 'null' : v.toFixed(d);

function groupStats(rows) {
  const n = rows.length;
  const wins = rows.filter(r => r.net > 0).length;
  const net = sum(rows.map(r => r.net));
  return { n, wins, losses: n - wins, net, winRate: n ? 100 * wins / n : null };
}
function printGroup(title, rows, keyFn) {
  const g = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  console.log(`\n===== ${title} =====`);
  console.log('类型                 n    赢/亏      净额     亏票净额   winRate');
  const entries = [...g.entries()].sort((a, b) => sum(b[1].map(r => r.net)) - sum(a[1].map(r => r.net)));
  for (const [k, list] of entries) {
    const s = groupStats(list);
    const lossNet = sum(list.filter(r => r.net <= 0).map(r => r.net));
    console.log(
      String(k).padEnd(18).slice(0, 18) +
      String(s.n).padStart(5) +
      `  ${String(s.wins).padStart(3)}/${String(s.losses).padStart(3)}` +
      `${fmt(s.net).padStart(10)}` +
      `${fmt(lossNet).padStart(10)}` +
      `   ${fmt(s.winRate, 0)}%`
    );
  }
}

(async () => {
  const c = dbManager.getClient();

  // ── 1. trades per-token 聚合 ──
  const { data: trades } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,created_at')
    .eq('experiment_id', EXP_ID).limit(8000);
  const tokens = new Map();
  for (const t of trades || []) {
    if (!tokens.has(t.token_address)) tokens.set(t.token_address, { addr: t.token_address, symbol: t.token_symbol, buys: [], sells: [] });
    const tk = tokens.get(t.token_address);
    (t.trade_direction === 'buy' ? tk.buys : tk.sells).push(t);
  }
  for (const tk of tokens.values()) {
    tk.spent = sum(tk.buys.map(t => Number(t.input_amount) || 0));
    tk.got = sum(tk.sells.map(t => Number(t.output_amount) || 0));
    tk.net = tk.got - tk.spent;
  }

  // platform 维度
  const { data: ets } = await c.from('experiment_tokens').select('token_address,platform').eq('experiment_id', EXP_ID).limit(2000);
  const platformByAddr = new Map((ets || []).map(e => [e.token_address, e.platform]));

  // ── 2. token_narrative join ──
  const NARR_COLS = 'token_address,token_symbol,is_valid,analyzed_at,token_category,analysis_stage,prompt_version,stage_final_result,stage1_result,stage2_result,stage3_result,prestage_result,pre_check_result,twitter_info';
  const narr = new Map();
  const addrs = [...tokens.keys()];
  for (let i = 0; i < addrs.length; i += 50) {
    const { data } = await c.from('token_narrative').select(NARR_COLS).in('token_address', addrs.slice(i, i + 50));
    (data || []).forEach(r => {
      const prev = narr.get(r.token_address);
      if (!prev || (r.is_valid && !prev.is_valid) || (r.is_valid === prev.is_valid && r.analyzed_at > prev.analyzed_at)) narr.set(r.token_address, r);
    });
  }

  // ── 3. 逐票画像 ──
  const rows = [];
  for (const tk of tokens.values()) {
    const n = narr.get(tk.addr) || {};
    const s1d = (n.stage1_result || {}).details || {};
    const s2 = n.stage2_result || {};
    // J1.28 审计对象挂载位（182 实测确认）：stage2_result.details.jev
    const s2j = s2.details?.jev || {};
    const probs = s2j.probabilities || {};
    const sf = n.stage_final_result || {};
    const ti = n.twitter_info || {};
    const parent = ti.in_reply_to || {};
    const corpusTs = ti.created_at || null;
    const wfP = probs.web3_fit || null;
    const web3FitArgmax = wfP ? Object.keys(wfP).reduce((a, b) => wfP[a] >= wfP[b] ? a : b) : null;

    rows.push({
      addr: tk.addr, symbol: tk.symbol || n.token_symbol, platform: platformByAddr.get(tk.addr) || 'unknown',
      net: +tk.net.toFixed(4), spent: +tk.spent.toFixed(3), got: +tk.got.toFixed(3),
      rating: sf.rating ?? s2.rating ?? null,
      tokenCategory: n.token_category ?? null,
      jevCategory: (s1d.eventClassification || {}).primaryCategory ?? (n.token_category || '').replace('event:', '') ?? null,
      magnitudeTier: s2j.magnitudeTier ?? s1d.jev?.magnitudeTier ?? null,
      timing: s2j.timing ?? s1d.jev?.timing ?? null,
      tweetType: s2j.tweetType ?? s1d.jev?.tweetType ?? null,
      web3Fit: web3FitArgmax,
      web3FitStrongP: wfP ? (wfP.strong_fit ?? 0) + (wfP.fit ?? 0) : null,
      nameReferent: probs.name_referent ?? null,
      referentMemeability: s2j.referentMemeabilityScore ?? null,
      subjectEntity: s2j.subjectEntity ?? null,
      stage2Pass: s2.pass ?? null,
      stage2Reason: (s2.reason || '').slice(0, 120) || null,
      eventScore: (sf.details || {}).eventScore ?? null,
      corpusTs,
      corpus: ti.text ? {
        author: ti.author_screen_name ?? null,
        authorFollowers: ti.author_followers_count ?? null,
        text: (ti.text || '').slice(0, 120),
        tweetId: ti.tweet_id ?? null,
        parentAuthor: parent.tweet_id ? (parent.author_screen_name ?? null) : null,
        hasImage: !!(ti.media && ti.media.images && ti.media.images.length),
      } : null,
      prestage: n.prestage_result ? { rating: n.prestage_result.rating, reason: (n.prestage_result.reason || '').slice(0, 120) } : null,
    });
  }
  rows.sort((a, b) => a.net - b.net);

  // ── 4. 总览 ──
  const all = groupStats(rows);
  const narrHit = rows.filter(r => r.rating != null).length;
  console.log('========== 总览 ==========');
  console.log(`票数 ${all.n}（叙事有评级 ${narrHit} / 无评级或未析 ${all.n - narrHit}） 赢 ${all.wins} 亏 ${all.losses} winRate ${fmt(all.winRate, 1)}% 净额 ${fmt(all.net)}`);
  const noNarr = rows.filter(r => r.rating == null);
  if (noNarr.length) console.log(`无评级票 ${noNarr.length} 张 净额 ${fmt(sum(noNarr.map(r => r.net)))}（rating 门放行形状：9=unrated 或叙事链未覆盖）`);

  // ── 5. 分组统计 ──
  printGroup('按叙事评级 rating（1=low 2=mid 3=high null=9/未析）', rows, r => r.rating == null ? 'null(9/未析)' : `rating${r.rating}`);
  printGroup('按平台 platform', rows, r => r.platform);
  printGroup('按 token_category（叙事输出口径）', rows, r => r.tokenCategory || '(null)');
  printGroup('按 jev 事件分类 A~W（损失票视角，按净额降序）', rows, r => r.jevCategory || '(null)');
  printGroup('损失票（net<0）jev 分类分布', rows.filter(r => r.net < 0), r => r.jevCategory || '(null)');
  printGroup('损失票 magnitudeTier 分布', rows.filter(r => r.net < 0), r => r.magnitudeTier || '(null)');
  printGroup('损失票 web3_fit 分布', rows.filter(r => r.net < 0), r => r.web3Fit || '(null)');
  printGroup('损失票 timing 分布', rows.filter(r => r.net < 0), r => r.timing || '(null)');
  printGroup('损失票 referentMemeability 分布', rows.filter(r => r.net < 0), r => r.referentMemeability == null ? '(null)' : (r.referentMemeability <= 1 ? '≤1(拦档)' : r.referentMemeability <= 2.5 ? '1~2.5' : '>2.5'));

  // ── 6. 赢 vs 亏 关键维度对比 ──
  console.log('\n===== 赢 vs 亏 关键维度（均值/中位） =====');
  const win = rows.filter(r => r.net > 0), loss = rows.filter(r => r.net <= 0);
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const dim = (label, fn) => {
    const w = win.map(fn).filter(v => v != null), l = loss.map(fn).filter(v => v != null);
    console.log(`${label.padEnd(22)} 赢票 n=${String(w.length).padStart(3)} 均值 ${fmt(sum(w) / (w.length || 1), 2)} 中位 ${fmt(med(w), 2)}   亏票 n=${String(l.length).padStart(3)} 均值 ${fmt(sum(l) / (l.length || 1), 2)} 中位 ${fmt(med(l), 2)}`);
  };
  dim('referentMemeability', r => r.referentMemeability);
  dim('web3FitStrongP(strong+fit)', r => r.web3FitStrongP);
  dim('corpusFollowers', r => r.corpus ? r.corpus.authorFollowers : null);
  dim('eventScore', r => r.eventScore);

  // ── 7. 损失 top 30 明细（带地址） ──
  console.log('\n===== 损失 top 30（地址 | symbol | 净额 | 平台 | 类别 | tier | rating | refMem | web3fit | 语料作者） =====');
  for (const r of rows.slice(0, 30)) {
    console.log(
      `${r.addr}\n  ${r.symbol || '?'} net=${fmt(r.net)} ${r.platform} cat=${r.jevCategory}/${r.tokenCategory} tier=${r.magnitudeTier} rating=${r.rating} refMem=${r.referentMemeability} fit=${r.web3Fit}` +
      (r.corpus ? ` 语料=@${r.corpus.author}(${r.corpus.authorFollowers ?? '?'}粉)「${r.corpus.text.slice(0, 40)}」` : ' 无语料')
    );
  }

  // ── 8. 语料簇 ≥2 票 ──
  const byKey = new Map();
  for (const r of rows) {
    if (!r.corpus) continue;
    for (const [kind, key] of [['tweet', r.corpus.tweetId], ['pauthor', r.corpus.parentAuthor], ['author', r.corpus.author]]) {
      if (!key) continue;
      const k = kind + ':' + key;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
  }
  console.log('\n===== 语料簇（≥3 票，按净额升序=最差在前） =====');
  for (const [k, list] of [...byKey.entries()].filter(([, l]) => l.length >= 3).sort((a, b) => sum(a[1].map(r => r.net)) - sum(b[1].map(r => r.net)))) {
    console.log(`${k}  ${list.length} 票 净 ${fmt(sum(list.map(r => r.net)))} | ${list.map(r => `${r.symbol}(${fmt(r.net, 2)})`).join(' ')}`);
  }

  // ── 9. 导出 ──
  const out = require('path').join(__dirname, '../data/analysis-bddd3578-narrative.json');
  fs.writeFileSync(out, JSON.stringify({ overview: all, rows }, null, 1));
  console.log(`\n导出 ${rows.length} 行 → ${out}`);
})().catch(e => { console.error(e); process.exit(1); });
