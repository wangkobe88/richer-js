#!/usr/bin/env node
/**
 * 0fed29f9 叙事全量画像提取（v2，配合 analyze-0fed29f9-narrative.cjs 的账本）
 * 每票：PnL + jev 决策细节（magnitude/category/web3_fit/name_referent/subject_entity）
 *      + stage2/3 分数 + 语料摘要（作者/粉丝/父推/文本）+ 复蹭簇聚类键
 * 输出 data/analysis-0fed29f9-narrative-full.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = '0fed29f9-cf81-4034-8eca-236b5a96916d';
const sum = a => a.reduce((x, y) => x + y, 0);

(async () => {
  const c = dbManager.getClient();

  const { data: trades } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,created_at')
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

  const NARR_COLS = 'token_address,token_symbol,is_valid,analyzed_at,token_category,analysis_stage,prompt_version,stage_final_result,stage1_result,stage2_result,stage3_result,prestage_result,pre_check_result,twitter_info,classified_urls';
  const narr = new Map();
  const addrs = all.map(t => t.addr);
  for (let i = 0; i < addrs.length; i += 50) {
    const { data } = await c.from('token_narrative').select(NARR_COLS).in('token_address', addrs.slice(i, i + 50));
    (data || []).forEach(r => {
      const prev = narr.get(r.token_address);
      if (!prev || (r.is_valid && !prev.is_valid) || (r.is_valid === prev.is_valid && r.analyzed_at > prev.analyzed_at)) narr.set(r.token_address, r);
    });
  }

  const rows = [];
  for (const tk of all) {
    const n = narr.get(tk.addr) || {};
    const s1d = (n.stage1_result || {}).details || {};
    const jev1 = s1d.jev || {};
    const s2 = n.stage2_result || {};
    const s3 = n.stage3_result || {};
    const sf = n.stage_final_result || {};
    const ti = n.twitter_info || {};
    const parent = ti.in_reply_to || {};
    const probs = jev1.probabilities || {};
    const s3j = (s3.details || {}).jev || {};
    const s3d = s3.details || {};

    rows.push({
      addr: tk.addr, symbol: tk.symbol || n.token_symbol, net: +tk.net.toFixed(4), spent: +tk.spent.toFixed(3), got: +tk.got.toFixed(3),
      firstBuyAt: tk.firstBuyAt,
      // 叙事结论
      rating: sf.rating ?? null, tokenCategory: n.token_category ?? null, promptVersion: n.prompt_version ?? null,
      finalScore: sf.score ?? s3.score ?? null,
      eventScore: (sf.details || {}).eventScore ?? null,
      stage2Total: s2.score ?? null,
      // jev 决策细节
      magnitudeTier: jev1.magnitudeTier ?? s2.details?.jev?.magnitudeTier ?? null,
      jevCategory: (s1d.eventClassification || {}).primaryCategory ?? null,
      timing: jev1.timing ?? null,
      tweetType: jev1.tweetType ?? null,
      web3Fit: probs.web3_fit ?? null,
      nameReferent: probs.name_referent ?? null,
      subjectEntity: probs.subject_entity ?? null,
      eventCategoryP: probs.event_category ?? null,
      eventMagnitudeP: probs.event_magnitude ?? null,
      dimension2P: (s2.details?.jev?.probabilities || {}).dimension2 ?? null,
      blockReasonP: probs.block_reason ?? null,
      relevanceType: s3j.relevanceType ?? null, relevanceLevelIdx: s3j.relevanceLevelIdx ?? null,
      relevanceScore: s3d.relevanceScore ?? null, qualityScore: s3d.qualityScore ?? null,
      qualityBreakdown: s3d.breakdown ?? null,
      prestage: n.prestage_result ? { rating: n.prestage_result.rating, reason: (n.prestage_result.reason || '').slice(0, 160) } : null,
      precheckPassed: (n.pre_check_result || {}).passed ?? null,
      // 语料画像
      corpus: ti.text ? {
        author: ti.author_screen_name ?? null,
        authorFollowers: ti.author_followers_count ?? null,
        text: (ti.text || '').slice(0, 160),
        tweetId: ti.tweet_id ?? null,
        createdAt: ti.created_at ?? null,
        hasImage: !!(ti.media && ti.media.images && ti.media.images.length),
        imageAnalysis: !!ti.image_analysis,
        parent: parent.tweet_id ? {
          author: parent.author_screen_name ?? null,
          authorFollowers: parent.author_followers_count ?? null,
          text: (parent.text || '').slice(0, 100),
        } : null,
      } : null,
      hasTwitterUrl: !!((n.classified_urls || {}).twitter || []).length,
    });
  }

  fs.writeFileSync(require('path').join(__dirname, '../data/analysis-0fed29f9-narrative-full.json'), JSON.stringify(rows, null, 1));

  // ---------- 复蹭簇聚类：主推 tweetId / 父推 tweetId / 语料作者 ----------
  const byKey = new Map();
  const bump = (key, row, kind) => {
    if (!key) return;
    const k = kind + ':' + key;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(row);
  };
  for (const r of rows) {
    if (!r.corpus) continue;
    bump(r.corpus.tweetId, r, 'tweet');
    bump(r.corpus.parent ? 'parent' : null, r, 'noop'); // 占位
    if (r.corpus.parent) bump('parent-author:' + r.corpus.parent.author, r, 'pa');
    bump('author:' + r.corpus.author, r, 'au');
  }
  // 父推作者聚类（superIP 语料形状：不同路人回复同一条父推）
  console.log('===== 语料簇（≥2 票）=====');
  for (const [k, list] of [...byKey.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < 2 || k.startsWith('noop') || k.startsWith('au:')) continue;
    const net = sum(list.map(r => r.net));
    console.log(`${k}  ${list.length} 票 净 ${net.toFixed(3)} | ${list.map(r => `${r.symbol}(${r.net.toFixed(2)})`).join(' ')}`);
  }
  console.log('===== 同作者簇（≥2 票）=====');
  for (const [k, list] of [...byKey.entries()].filter(([k]) => k.startsWith('au:')).sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < 2) continue;
    console.log(`${k}  ${list.length} 票 净 ${sum(list.map(r => r.net)).toFixed(3)}`);
  }
  console.log(`\n导出 ${rows.length} 行 → data/analysis-0fed29f9-narrative-full.json`);
})().catch(e => { console.error(e); process.exit(1); });
