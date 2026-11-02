// Ragu 0xf1dc…7777 市场结局 + 同形状票扫描（单票小读取）
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xf1dca9bf42c5f565063f493f693455c86dff7777';
(async () => {
  const db = dbManager.getClient();
  // 1) 价格轨迹（分钟桶采样）+ 成交统计
  const { data: ticks, error: e1 } = await db
    .from('wss_price_ticks')
    .select('price_bnb,block_time,trader_address,bnb_amount,trade_type')
    .eq('token_address', ADDR)
    .order('block_time', { ascending: true })
    .limit(20000);
  if (e1) throw e1;
  console.log('=== ticks 行数:', ticks.length);
  if (ticks.length) {
    let peak = 0, peakTs = null, first = ticks[0].price_bnb, last = ticks[ticks.length-1].price_bnb;
    let buyCnt = 0, sellCnt = 0, buyBnb = 0, sellBnb = 0;
    const traders = new Set();
    for (const t of ticks) {
      const p = Number(t.price_bnb);
      if (p > peak) { peak = p; peakTs = t.block_time; }
      if (t.trade_type === 'buy' || t.trade_type === 'BUY') { buyCnt++; buyBnb += Number(t.bnb_amount||0); }
      else { sellCnt++; sellBnb += Number(t.bnb_amount||0); }
      traders.add(t.trader_address);
    }
    console.log('首价:', first, '| 峰值:', peak, '(', ((peak/first)*1).toFixed(1), 'x ) @', peakTs);
    console.log('最新价:', last, '| 距峰回撤:', (((last-peak)/peak)*100).toFixed(1), '%');
    console.log('买笔:', buyCnt, '卖笔:', sellCnt, '| 买量:', buyBnb.toFixed(2), 'BNB 卖量:', sellBnb.toFixed(2), 'BNB');
    console.log('独立 trader:', traders.size, '| 时间窗:', ticks[0].block_time, '→', ticks[ticks.length-1].block_time);
    // 10 个等距采样点看形状
    const step = Math.max(1, Math.floor(ticks.length/12));
    console.log('轨迹采样:', ticks.filter((_,i)=>i%step===0).map(t=>`${t.block_time.slice(5,16)}=${Number(t.price_bnb).toPrecision(3)}`).join(' | '));
  }
  // 2) 毕业事件
  const { data: ev, error: e2 } = await db.from('wss_events')
    .select('kind,block_timestamp,details')
    .eq('token_address', ADDR)
    .order('block_timestamp', { ascending: true });
  if (e2) console.log('events err:', e2.message);
  else console.log('=== wss_events:', ev.map(e=>e.kind).join(',') || '无');
  // 3) 同形状票：最近 7 天叙事行里作者名带 BNB/binance 字样的
  const { data: sib, error: e3 } = await db.from('token_narrative')
    .select('token_address,token_symbol,analyzed_at,twitter_info,final_result,token_category')
    .ilike('twitter_info->>author_name', '%BNB%')
    .gte('analyzed_at', '2026-10-22')
    .limit(30);
  if (e3) console.log('sib err:', e3.message);
  else {
    console.log('=== 近 7 天 author_name 含 BNB 的叙事行:', sib.length);
    for (const s of sib) {
      const fin = s.final_result || {};
      console.log(`${s.token_symbol} ${s.token_address.slice(0,10)}… | ${s.analyzed_at?.slice(5,16)} | rating=${fin.rating} | cat=${s.token_category} | 作者=${s.twitter_info?.author_name} @${s.twitter_info?.author_screen_name} 粉=${s.twitter_info?.author_followers_count}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
