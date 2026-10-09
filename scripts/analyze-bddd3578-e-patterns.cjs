#!/usr/bin/env node
/**
 * bddd3578 E 类（108 票）规律挖掘（修正版：tokenCreateTime 秒→ms）
 * 维度：lag / 粉丝档 / 中英语料 / 题材关键词 / 簇位置 / 买入age / 死法 / tier / refMem
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = 'bddd3578-f04f-42e2-b8a7-1ae4b6893a0a';
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = (v, d = 2) => v == null || !isFinite(v) ? 'null' : v.toFixed(d);

function printGroup(title, rows, keyFn) {
  const g = new Map();
  for (const r of rows) { const k = keyFn(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  console.log(`\n--- ${title} ---`);
  console.log('桶                n   赢/亏   winR    净额    均值');
  for (const [k, l] of [...g.entries()].sort((a, b) => sum(b[1].map(r => r.net)) - sum(a[1].map(r => r.net)))) {
    const w = l.filter(r => r.net > 0).length;
    console.log(String(k).padEnd(14).slice(0, 14) + String(l.length).padStart(5) + `  ${String(w).padStart(3)}/${String(l.length - w).padStart(3)}  ${fmt(100 * w / l.length, 0)}% ${fmt(sum(l.map(r => r.net))).padStart(8)} ${fmt(sum(l.map(r => r.net)) / l.length, 4).padStart(8)}`);
  }
}

(async () => {
  const c = dbManager.getClient();
  const base = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-bddd3578-narrative.json'), 'utf8')).rows;
  const eBase = base.filter(r => r.jevCategory === 'E');
  const addrs = eBase.map(r => r.addr);

  // signals + trades
  const sigs = new Map(); const tradesBy = new Map();
  for (let i = 0; i < addrs.length; i += 40) {
    const s = await c.from('strategy_signals').select('token_address,action,reason,created_at,metadata')
      .eq('experiment_id', EXP_ID).in('token_address', addrs.slice(i, i + 40));
    for (const x of s.data || []) { if (!sigs.has(x.token_address)) sigs.set(x.token_address, []); sigs.get(x.token_address).push(x); }
    const t = await c.from('trades').select('token_address,trade_direction,created_at,input_amount,output_amount')
      .eq('experiment_id', EXP_ID).in('token_address', addrs.slice(i, i + 40));
    for (const x of t.data || []) { if (!tradesBy.has(x.token_address)) tradesBy.set(x.token_address, []); tradesBy.get(x.token_address).push(x); }
  }

  const rows = eBase.map(r => {
    const sl = sigs.get(r.addr) || [];
    const buySig = sl.find(s => s.action === 'buy');
    const md = buySig?.metadata || {};
    const createMs = Number(md.tokenCreateTime) > 1e12 ? Number(md.tokenCreateTime) : Number(md.tokenCreateTime) * 1000; // 秒→ms
    const tl = (tradesBy.get(r.addr) || []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const buys = tl.filter(t => t.trade_direction === 'buy');
    const sells = tl.filter(t => t.trade_direction === 'sell');
    const firstBuyMs = buys[0] ? new Date(buys[0].created_at).getTime() : null;
    const lastSellMs = sells.length ? new Date(sells[sells.length - 1].created_at).getTime() : null;
    const corpusMs = r.corpusTs ? new Date(r.corpusTs).getTime() : null;
    const sellReasons = sl.filter(s => s.action === 'sell').map(s => (s.reason || '').replace(/^卖出策略\s*/, ''));
    const text = r.corpus ? r.corpus.text : '';
    const zh = (text.match(/[一-龥]/g) || []).length;
    return {
      addr: r.addr, symbol: r.symbol, net: r.net, tier: r.magnitudeTier, refMem: r.referentMemeability,
      followers: r.corpus ? r.corpus.authorFollowers : null, author: r.corpus ? r.corpus.author : null,
      tweetId: r.corpus ? r.corpus.tweetId : null, parentAuthor: r.corpus ? r.corpus.parentAuthor : null,
      text, zhRatio: text.length ? zh / text.length : 0,
      lagSec: createMs && corpusMs ? Math.round((createMs - corpusMs) / 1000) : null,
      buyAgeSec: md.trendFactors?.tokenAgeSec ?? (createMs && firstBuyMs ? Math.round((firstBuyMs - createMs) / 1000) : null),
      holdSec: firstBuyMs && lastSellMs ? Math.round((lastSellMs - firstBuyMs) / 1000) : null,
      death: sellReasons.includes('P11') ? 'P11冲高回落' : sellReasons.length ? sellReasons.join('+') : '强平(持到窗口末)',
      createMs,
    };
  });

  // 簇位置
  const cluster = new Map(); // key -> [rows sorted by createMs]
  for (const r of rows) {
    const keys = [];
    if (r.tweetId) keys.push('tw:' + r.tweetId);
    if (r.parentAuthor) keys.push('pa:' + r.parentAuthor);
    for (const k of keys) { if (!cluster.has(k)) cluster.set(k, []); cluster.get(k).push(r); }
  }
  const posByAddr = new Map();
  for (const r of rows) {
    let pos = '孤票', order = Infinity;
    for (const [k, l] of cluster) {
      if (l.includes(r) && l.length >= 2) {
        const sorted = [...l].sort((a, b) => (a.createMs || 9e15) - (b.createMs || 9e15));
        const idx = sorted.indexOf(r);
        if (idx < order) { order = idx; pos = idx === 0 ? '簇首' : `簇内第${idx + 1}张`; }
      }
    }
    posByAddr.set(r.addr, pos);
  }

  const total = sum(rows.map(r => r.net));
  const w = rows.filter(r => r.net > 0).length;
  console.log(`E 类 ${rows.length} 票 赢${w} winR=${fmt(100 * w / rows.length, 0)}% 净${fmt(total)}`);

  printGroup('lag（token创建−语料时间）', rows, r => {
    if (r.lagSec == null) return 'null';
    if (r.lagSec < 0) return '<0宣告竞态';
    if (r.lagSec < 300) return '0-300s';
    if (r.lagSec < 1800) return '300-1800s';
    return '>1800s';
  });
  printGroup('语料作者粉丝档', rows, r => {
    if (r.followers == null) return 'null';
    if (r.followers < 100) return '<100';
    if (r.followers < 1000) return '100-1k';
    if (r.followers < 10000) return '1k-1w';
    if (r.followers < 1000000) return '1w-100w';
    return '>100w';
  });
  printGroup('语料语言', rows, r => r.zhRatio > 0.3 ? '中文' : (r.zhRatio > 0 ? '混合' : '英文'));
  printGroup('题材细分（关键词）', rows, r => {
    const t = r.text;
    if (/抖音|快手|短视频|TikTok/i.test(t)) return '抖音/TikTok梗';
    if (/微博|热搜|小红书|B站|bilibili/i.test(t)) return '微博/B站热搜';
    if (/微信|腾讯|WeChat/i.test(t)) return '微信/腾讯';
    if (/发布|上线|推出|launch|新品|开卖|上映|票房/i.test(t)) return '产品/作品发布';
    if (/新闻|刚刚|爆火|火了|热搜|爆红|出圈|viral|trending/i.test(t)) return '突发热点/爆火';
    return '社区梗/其他';
  });
  printGroup('簇位置（tweet/父推作者簇）', rows, r => posByAddr.get(r.addr));
  printGroup('首买 tokenAgeSec', rows, r => {
    if (r.buyAgeSec == null) return 'null';
    if (r.buyAgeSec < 30) return '<30s';
    if (r.buyAgeSec < 60) return '30-60s';
    if (r.buyAgeSec < 90) return '60-90s';
    return '>90s';
  });
  printGroup('死法（卖出腿）', rows, r => r.death);
  printGroup('tier', rows, r => r.tier || 'null');
  printGroup('refMem 档', rows, r => r.refMem == null ? 'null' : r.refMem <= 1 ? '≤1' : r.refMem <= 2.5 ? '1-2.5' : '>2.5');

  // E 赢票 vs 亏票语料对照
  console.log('\n===== E 赢票 top 12 =====');
  for (const r of [...rows].sort((a, b) => b.net - a.net).slice(0, 12)) {
    console.log(`${r.symbol}(+${fmt(r.net)}) ${r.addr} lag=${r.lagSec}s age=${r.buyAgeSec}s 粉=${r.followers} 死法=${r.death}「${r.text.slice(0, 45)}」`);
  }
  console.log('\n===== E 亏票 top 12 =====');
  for (const r of [...rows].sort((a, b) => a.net - b.net).slice(0, 12)) {
    console.log(`${r.symbol}(${fmt(r.net)}) ${r.addr} lag=${r.lagSec}s age=${r.buyAgeSec}s 粉=${r.followers} 死法=${r.death}「${r.text.slice(0, 45)}」`);
  }
  fs.writeFileSync('/tmp/bddd-e-patterns.json', JSON.stringify(rows.map(r => ({ ...r, clusterPos: posByAddr.get(r.addr) })), null, 1));
  console.log('\n→ /tmp/bddd-e-patterns.json');
})().catch(e => { console.error(e); process.exit(1); });
