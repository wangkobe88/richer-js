// 两票「吃到更大涨幅」研究——数据拉取（本地，per-token ~1k 行小结果）
// 输出 tmp-study-2tok.json：trades 明细/价格线/卖腿条件/BUY 因子快照
const path = require('path');
const fs = require('fs');
const { dbManager } = require(path.join(__dirname, 'src/services/dbManager'));

const EXP = '54dac9c5-6fdf-4759-8b5a-2195313b6820';
const TOKS = [
  '0x29921a532878bf66efc9ca92694b8a40e6157777',
  '0x8fef738d4a5c4cdc312cf53f949fb57e8a557777',
];

async function main() {
  const c = dbManager.getClient();
  const out = { exp: EXP, toks: {} };

  // 卖腿/买腿定义（copy-in 快照）
  const { data: exp } = await c.from('experiments').select('config').eq('id', EXP).single();
  const strats = (((exp || {}).config || {}).strategiesConfig || {}).strategies || [];
  out.legs = strats.map(s => ({
    side: s.side, priority: s.priority, name: s.name,
    cards: s.cards, bypass: s.bypassDebounce,
    condition: s.condition, cooldownSec: s.cooldownSec,
  }));

  for (const tok of TOKS) {
    const rec = { trades: [], ticks: [], buyMeta: [] };

    const { data: trs } = await c.from('trades')
      .select('created_at,executed_at,trade_direction,input_currency,output_currency,input_amount,output_amount,unit_price,success,metadata,sold_cards')
      .eq('experiment_id', EXP).eq('token_address', tok)
      .order('created_at', { ascending: true }).limit(100);
    rec.trades = trs || [];

    const { data: sigs } = await c.from('strategy_signals')
      .select('signal_type,action,created_at,reason,metadata')
      .eq('experiment_id', EXP).eq('token_address', tok)
      .order('created_at', { ascending: true }).limit(200);
    rec.signals = (sigs || []).map(s => ({
      type: s.signal_type, at: s.created_at, reason: s.reason,
      // BUY 行保留完整因子快照 + 门链信息；SELL 行只留 reason/why
      md: s.signal_type === 'BUY' ? s.metadata : {
        why: s.metadata && s.metadata.why,
        trigger: s.metadata && (s.metadata.triggerInfo || s.metadata.reason),
        factorResults: s.metadata && s.metadata.factorResults,
      },
    }));

    // 全量 ticks 分页拉（price_outlier=false 可靠价 + 全行含 outlier 标记的流量统计）
    let off = 0; const PAGE = 1000; let all = [];
    for (;;) {
      const { data } = await c.from('wss_price_ticks')
        .select('block_time,block_number,price_bnb,bnb_amount,trade_type,trader_address,sender_address,price_outlier')
        .eq('token_address', tok)
        .order('block_time', { ascending: true })
        .range(off, off + PAGE - 1);
      if (!data || !data.length) break;
      all = all.concat(data);
      if (data.length < PAGE) break;
      off += PAGE;
    }
    rec.ticks = all;
    const { data: ev } = await c.from('wss_events')
      .select('kind,block_time,payload')
      .eq('token_address', tok).in('kind', ['token_create', 'graduation']).limit(5);
    rec.events = (ev || []).map(e => ({ kind: e.kind, at: e.block_time, payload: e.payload && { symbol: e.payload.symbol, name: e.payload.name, twitterUrl: e.payload.twitterUrl } }));

    out.toks[tok] = rec;
    console.log(tok, 'trades:', rec.trades.length, 'signals:', rec.signals.length, 'ticks:', all.length, 'events:', rec.events.length);
  }
  fs.writeFileSync(path.join(__dirname, 'tmp-study-2tok.json'), JSON.stringify(out));
  console.log('DONE -> tmp-study-2tok.json');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.stack || e); process.exit(1); });
