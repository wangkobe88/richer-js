#!/usr/bin/env node
/**
 * 规则5（high_influence_with_media）盲区扫描（2026-10-06 NIGGALON 案评估）
 *
 * 规则语义（pre-check-service.mjs 规则5）：语料推文作者在高影响力名单
 * （HIGH_INFLUENCE_ACCOUNTS）或高交互（赞>5000/转>2000）+ 推文带媒体 →
 * 直接 mid（pass=true）短路，整个 Jev/LLM 流程不跑。
 *
 * 盲区假设：twitterUrl 是发币者自填的，任何 token 贴一条高影响力账号的
 * 带媒体推文即可白拿 mid——与语料内容是否相关完全无关。
 *
 * 本扫描（182 跑，重查询红线）：
 *   A 集 = token_narrative 中 pre_check_result->details->ruleName =
 *          'high_influence_with_media' 的票（含明细：语料作者/文本/gmgn 风险）
 *   B 集 = 其余全部 token_narrative 行（对照；评级取 pre_check_result->rating
 *          回退 stage1_result->rating）
 *   盈亏 = trades per token 聚合（全实验，净额 = Σ卖 output − Σ买 input，
 *          与 analyze-d46b1b6c 同口径）
 *   关联粗筛 = token symbol/name 与语料的指代关联三档（author/content/
 *          unrelated），代码粗筛仅供分桶，结论需人工复查明细
 *
 * 用法（182）：node scripts/scan-high-influence-media-tokens.cjs [--top 40]
 * 输出：控制台摘要 + data/high-influence-media-scan-<ts>.json
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const TOP_N = Number((() => {
  const i = process.argv.indexOf('--top');
  return i === -1 ? 40 : process.argv[i + 1];
})());

function ts(v) {
  return new Date(new Date(v).getTime() + 8 * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
}
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = (v, d = 3) => v == null || !isFinite(v) ? 'null' : v.toFixed(d);

// ── 关联粗筛：token symbol/name 与语料的指代关联三档 ──
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function classifyReferent(symbol, name, tweet) {
  const S = norm(symbol), N = norm(name);
  const text = norm(tweet?.text || '');
  const authorHandle = norm(tweet?.author_screen_name);
  const authorNameWords = norm(tweet?.author_name); // "Elon Musk" → "elonmusk"
  const parentHandle = norm(tweet?.in_reply_to?.author_screen_name);
  const parentNameWords = norm(tweet?.in_reply_to?.author_name);

  // ① author 档：token 名含作者 handle 的显著子串（≥4 字符，取 handle 前缀族）
  const handleChunks = new Set();
  for (const h of [authorHandle, parentHandle]) {
    if (h.length >= 5) {
      for (let len = 4; len <= Math.min(7, h.length - 1); len++) handleChunks.add(h.slice(0, len));
    }
  }
  for (const w of [authorNameWords, parentNameWords]) {
    // 人名按连写整体也加入（elonmusk / cz 等）
    if (w.length >= 3 && w.length <= 12) handleChunks.add(w);
  }
  for (const c of handleChunks) {
    if ((S.length >= c.length + 1 && S.includes(c)) || (N.length >= 3 && N.includes(c))) return 'author';
  }
  // ② content 档：symbol（≥4 字符）整词出现在语料文本中
  if (S.length >= 4 && text.includes(S)) return 'content';
  // 或 token 名包含语料文本中任一 ≥5 字符词（词干引用）
  const words = (tweet?.text || '').toLowerCase().match(/[a-z]{5,}/g) || [];
  const uniq = [...new Set(words)];
  for (const w of uniq) {
    if (S.includes(w) || N.includes(w)) return 'content';
  }
  // ③ 都不中
  return 'unrelated';
}

(async () => {
  const db = dbManager.getClient();
  const t0 = Date.now();

  // ---------- 1. A 集：规则5短路票 ----------
  console.log('── 1. 拉取规则5票集（token_narrative 服务端 jsonb 过滤）──');
  const rule5 = [];
  {
    let cursor = 0;
    for (;;) {
      let q = db.from('token_narrative')
        .select('id,token_address,token_symbol,platform,created_at,pre_check_result,raw_api_data,twitter_info,gmgn_info')
        .eq('pre_check_result->details->>ruleName', 'high_influence_with_media')
        .order('id', { ascending: true })
        .limit(1000);
      if (cursor) q = q.gt('id', cursor);
      const { data, error } = await q;
      if (error) throw new Error('规则5票集查询失败: ' + error.message);
      if (!data || !data.length) break;
      rule5.push(...data);
      cursor = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
  }
  console.log(`规则5票集: ${rule5.length} 行`);

  // ---------- 2. B 集：其余票（对照，按评级 filter 分桶拉地址）----------
  // select 里的 jsonb 路径别名被 supabase-js 编码弄坏（filter 里可用），改用
  // filter 单一 jsonb 路径取地址集；三来源（pre_check/stage1/prestage）互斥
  // （短路时其余为 null），union 无冲突。
  console.log('── 2. 拉取对照票集（mid/high filter 分桶）──');
  const rule5Addrs = new Set(rule5.map(r => r.token_address));
  async function fetchRatingBucket(rating) {
    const out = new Set();
    for (const path of ['pre_check_result->>rating', 'stage1_result->>rating', 'prestage_result->>rating']) {
      let cursor = 0;
      for (;;) {
        let q = db.from('token_narrative')
          .select('id,token_address')
          .eq(path, rating)
          .order('id', { ascending: true })
          .limit(1000);
        if (cursor) q = q.gt('id', cursor);
        const { data, error } = await q;
        if (error) throw new Error(`对照桶(${rating}/${path})查询失败: ` + error.message);
        if (!data || !data.length) break;
        for (const r of data) if (!rule5Addrs.has(r.token_address)) out.add(r.token_address);
        cursor = data[data.length - 1].id;
        if (data.length < 1000) break;
      }
    }
    return out;
  }
  const bMid = await fetchRatingBucket('mid');
  const bHigh = await fetchRatingBucket('high');
  console.log(`对照票集: mid=${bMid.size} high=${bHigh.size}`);

  // ---------- 3. 盈亏：trades per token（A+B 全集分批 .in）----------
  console.log('── 3. 拉取 trades（token 全集分批 .in，100/批）──');
  const allAddrs = [...new Set([...rule5.map(r => r.token_address), ...bMid, ...bHigh])].filter(Boolean);
  const tradesByToken = new Map();
  for (let i = 0; i < allAddrs.length; i += 100) {
    const batch = allAddrs.slice(i, i + 100);
    const { data, error } = await db.from('trades')
      .select('token_address,trade_direction,input_amount,output_amount,success,experiment_id,created_at')
      .in('token_address', batch)
      .limit(1000 * 10);
    if (error) throw new Error('trades 查询失败: ' + error.message);
    if (data) for (const t of data) {
      if (!tradesByToken.has(t.token_address)) tradesByToken.set(t.token_address, []);
      tradesByToken.get(t.token_address).push(t);
    }
    process.stdout.write(`\r  trades 批 ${Math.floor(i / 100) + 1}/${Math.ceil(allAddrs.length / 100)}，累计行 ${sum([...tradesByToken.values()].map(a => a.length))}   `);
  }
  process.stdout.write('\n');

  function accountOf(addr) {
    const rows = tradesByToken.get(addr) || [];
    let spent = 0, received = 0, buys = 0, sells = 0, exps = new Set();
    for (const t of rows) {
      exps.add(t.experiment_id);
      if (t.trade_direction === 'buy') { buys++; spent += Number(t.input_amount) || 0; }
      else if (t.trade_direction === 'sell') { sells++; received += Number(t.output_amount) || 0; }
    }
    const net = received - spent;
    return { bought: rows.length > 0, buys, sells, spentBnb: spent, receivedBnb: received, netBnb: net, expCount: exps.size, outcome: net > 0.001 ? 'win' : (net < -0.001 ? 'loss' : (rows.length ? 'flat' : null)) };
  }

  // ---------- 4. A 集明细 + 关联粗筛 ----------
  console.log('── 4. A 集关联粗筛 + 明细 ──');
  const detail = rule5.map(r => {
    const tw = r.twitter_info || {};
    const acct = accountOf(r.token_address);
    const referent = classifyReferent(r.token_symbol, (r.raw_api_data || {}).name, tw);
    const gm = (r.gmgn_info || {}).risk || {};
    return {
      addr: r.token_address, symbol: r.token_symbol, name: r.token_name, platform: r.platform,
      tokenCreatedAt: r.raw_api_data?.eventTs ? ts(r.raw_api_data.eventTs * 1000) : null,
      analyzedAt: ts(r.created_at),
      author: tw.author_screen_name || null, authorFollowers: tw.author_followers_count ?? null,
      isRt: !!(tw.text || '').startsWith('RT @'),
      parentAuthor: tw.in_reply_to?.author_screen_name || null,
      parentFollowers: tw.in_reply_to?.author_followers_count ?? null,
      tweetAt: tw.formatted_created_at || tw.created_at || null,
      tweetText: (tw.text || '').slice(0, 160),
      rating: (r.pre_check_result || {}).rating || null, referent,
      gmgn: { top: gm.topWallets ?? null, fresh: gm.freshWallets ?? null, sniper: gm.sniperWallets ?? null, bundler: gm.bundlerWallets ?? null, imgDup: gm.imageDupCount ?? null },
      ...acct,
    };
  });

  // 汇总
  const byReferent = {};
  for (const d of detail) {
    byReferent[d.referent] = byReferent[d.referent] || { n: 0, bought: 0, win: 0, loss: 0, flat: 0, net: 0 };
    const b = byReferent[d.referent];
    b.n++;
    if (d.bought) { b.bought++; if (d.outcome === 'win') b.win++; else if (d.outcome === 'loss') b.loss++; else b.flat++; b.net += d.netBnb; }
  }
  const byAuthor = {};
  for (const d of detail) {
    byAuthor[d.author] = byAuthor[d.author] || { n: 0, bought: 0, win: 0, loss: 0, net: 0 };
    const b = byAuthor[d.author];
    b.n++;
    if (d.bought) { b.bought++; if (d.outcome === 'win') b.win++; else if (d.outcome === 'loss') b.loss++; b.net += d.netBnb; }
  }

  const A = detail.map(d => accountOf(d.addr)).filter(a => a.bought);
  const Anet = sum(A.map(a => a.netBnb));

  // ---------- 5. 对照统计（B 集评级 mid/high 票）----------
  console.log('── 5. 对照统计 ──');
  const bHighOnly = new Set([...bHigh].filter(a => !bMid.has(a)));
  const BmidHighAcct = [...bMid, ...bHigh].map(a => accountOf(a)).filter(a => a.bought);

  function block(title, set) {
    const bought = set.filter(a => a.bought);
    const win = bought.filter(a => a.outcome === 'win').length;
    const loss = bought.filter(a => a.outcome === 'loss').length;
    const net = sum(bought.map(a => a.netBnb));
    console.log(`${title}: 票 ${set.length} | 被买 ${bought.length} (${bought.length / Math.max(1, set.length) * 100 | 0}%) | win ${win} / loss ${loss} | 净额 ${fmt(net)} BNB | 均值 ${fmt(net / Math.max(1, bought.length))}`);
    return { n: set.length, bought: bought.length, win, loss, net };
  }

  console.log('\n════════ 摘要 ════════');
  console.log(`A 集规则5短路票: ${rule5.length}`);
  console.log('语料作者分布(票数/被买/win/loss/净额):');
  for (const [a, b] of Object.entries(byAuthor).sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  @${a}: ${b.n} 票 | 被买 ${b.bought} | win ${b.win} / loss ${b.loss} | 净 ${fmt(b.net)}`);
  }
  console.log(`关联粗筛: ${JSON.stringify(byReferent, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v)}`);
  console.log('');
  block('A 全集          ', detail.map(d => ({ ...accountOf(d.addr), addr: d.addr })));
  for (const key of ['unrelated', 'content', 'author']) {
    if (byReferent[key]) block(`A referent=${key}  `, detail.filter(d => d.referent === key).map(d => ({ ...accountOf(d.addr), addr: d.addr })));
  }
  block('B mid(非规则5)  ', [...bMid].map(a => ({ ...accountOf(a), addr: a })));
  block('B high(非规则5) ', [...bHigh].map(a => ({ ...accountOf(a), addr: a })));

  // 明细表（按净额排序）
  console.log(`\n── A 集明细（按净额升序，TOP ${TOP_N}；净额=全实验累计）──`);
  const sorted = [...detail].sort((a, b) => accountOf(a.addr).netBnb - accountOf(b.addr).netBnb);
  console.log('netBnb    | outcome | referent  | author(粉丝) RT | symbol / 推文摘要 | gmgn(t/f/s/b/d)');
  for (const d of sorted.slice(0, TOP_N)) {
    const a = accountOf(d.addr);
    console.log(`${fmt(a.netBnb, 4).padStart(9)} | ${(a.outcome || '-').padStart(7)} | ${d.referent.padStart(9)} | @${d.author}(${d.authorFollowers})${d.isRt ? ' RT' : '  '} | ${d.symbol} / ${d.tweetText.replace(/\n/g, ' ').slice(0, 60)} | ${d.gmgn.top ?? '-'}/${d.gmgn.fresh ?? '-'}/${d.gmgn.sniper ?? '-'}/${d.gmgn.bundler ?? '-'}/${d.gmgn.imgDup ?? '-'}`);
  }

  // ---------- 6. 落盘 ----------
  const bMidBought = [...bMid].map(a => accountOf(a)).filter(x => x.bought);
  const bHighBought = [...bHigh].map(a => accountOf(a)).filter(x => x.bought);
  const out = {
    generatedAt: new Date().toISOString(),
    summary: {
      rule5Total: rule5.length, byAuthor, byReferent,
      aSet: { bought: A.length, net: Anet, win: A.filter(x => x.outcome === 'win').length, loss: A.filter(x => x.outcome === 'loss').length },
      bMid: { n: bMid.size, bought: bMidBought.length, net: sum(bMidBought.map(a => a.netBnb)) },
      bHigh: { n: bHigh.size, bought: bHighBought.length, net: sum(bHighBought.map(a => a.netBnb)) },
    },
    detail,
  };
  const outFile = path.join(__dirname, '..', 'data', `high-influence-media-scan-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(`\n明细 JSON: ${outFile}（${(fs.statSync(outFile).size / 1024).toFixed(1)} KB，耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s）`);
})().catch(e => { console.error(e); process.exit(1); });
