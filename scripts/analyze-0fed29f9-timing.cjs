#!/usr/bin/env node
/**
 * 0fed29f9 早晚票分级数据补拉：
 * 1. token_narrative 主推/父推 created_at（事件锚候选）
 * 2. wss_price_ticks 每 token 最早行（token 创建锚，单条轻查询）
 * 3. strategy_signals 首买信号 metadata（trendFactors + preBuyCheckFactors）
 * 输出 data/analysis-0fed29f9-timing.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = '0fed29f9-cf81-4034-8eca-236b5a96916d';

(async () => {
  const c = dbManager.getClient();
  const base = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-0fed29f9-narrative-full.json'), 'utf8'));
  console.log('base rows:', base.length);

  // ---------- 1. 语料时间（主推 + 父推） ----------
  const corpusTime = new Map();
  const addrs = base.map(r => r.addr);
  for (let i = 0; i < addrs.length; i += 50) {
    const { data } = await c.from('token_narrative').select('token_address,twitter_info')
      .in('token_address', addrs.slice(i, i + 50));
    (data || []).forEach(r => {
      const ti = r.twitter_info || {};
      corpusTime.set(r.token_address, {
        main: ti.created_at ?? null,
        mainTs: parseTwitterDate(ti.created_at),
        parent: ti.in_reply_to?.created_at ?? null,
        parentTs: parseTwitterDate(ti.in_reply_to?.created_at),
      });
    });
  }
  function parseTwitterDate(s) {
    if (!s) return null;
    const t = Date.parse(s); // "Sun Oct 04 09:00:06 +0000 2026" JS 可直接解析
    return isNaN(t) ? null : t;
  }
  console.log('corpus time:', corpusTime.size);

  // ---------- 2. 每 token 最早 tick（token 创建锚，单条轻查询） ----------
  let done = 0;
  const firstTick = new Map();
  for (const a of addrs) {
    const { data } = await c.from('wss_price_ticks').select('id,received_at,block_time,block_number')
      .eq('token_address', a).order('id', { ascending: true }).limit(1);
    if (data && data[0]) firstTick.set(a, data[0]);
    if (++done % 20 === 0) console.log('  firstTick', done + '/' + addrs.length);
  }
  console.log('firstTick:', firstTick.size);

  // ---------- 3. 首买信号因子 ----------
  const signals = [];
  {
    let cursor = null;
    for (let page = 0; page < 30; page++) {
      let q = c.from('strategy_signals').select('id,token_address,metadata,created_at')
        .eq('experiment_id', EXP_ID).eq('action', 'buy').order('id', { ascending: true }).limit(1000);
      if (cursor) q = q.gt('id', cursor);
      const { data: chunk } = await q;
      if (!chunk || !chunk.length) break;
      signals.push(...chunk);
      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < 1000) break;
    }
  }
  console.log('buy signals:', signals.length);
  const firstSigByToken = new Map();
  for (const s of signals) {
    if (!firstSigByToken.has(s.token_address)) firstSigByToken.set(s.token_address, s);
  }

  // ---------- 合并输出 ----------
  const out = base.map(r => {
    const ct = corpusTime.get(r.addr) || {};
    const ft = firstTick.get(r.addr) || {};
    const sig = firstSigByToken.get(r.addr);
    const m = (sig && sig.metadata) || {};
    const tf = m.trendFactors || {};
    const pbc = m.preBuyCheckFactors || {};
    return {
      addr: r.addr, symbol: r.symbol, net: r.net, firstBuyAt: r.firstBuyAt,
      corpusMainAt: ct.mainTs, corpusParentAt: ct.parentTs,
      firstTickId: ft.id ?? null, firstTickReceivedAt: ft.received_at ?? null,
      firstTickBlockTime: ft.block_time ?? null,
      tf: {
        earlyReturn: tf.earlyReturn ?? null,
        holders: tf.holders ?? null,
        holderTrendGrowthRatio: tf.holderTrendGrowthRatio ?? null,
        buyVolumeBnb: tf.buyVolumeBnb ?? null,
        tokenCycle: tf.tokenCycle ?? null,
        tokenAgeSec: tf.tokenAgeSec ?? null,
        gradProgress: tf.graduationProgress ?? null,
      },
      pbc: {
        earlyTradesUniqueWallets: pbc.earlyTradesUniqueWallets ?? null,
        earlyTradesTop1BuySharePct: pbc.earlyTradesTop1BuySharePct ?? null,
        earlyTradesRouterPct: pbc.earlyTradesRouterPct ?? null,
        earlyTradesBuyBnb: pbc.earlyTradesBuyBnb ?? null,
        narrativeRating: pbc.narrativeRating ?? null,
      },
    };
  });
  fs.writeFileSync(require('path').join(__dirname, '../data/analysis-0fed29f9-timing.json'), JSON.stringify(out, null, 1));
  console.log('导出:', out.length, '行');
})().catch(e => { console.error(e); process.exit(1); });
