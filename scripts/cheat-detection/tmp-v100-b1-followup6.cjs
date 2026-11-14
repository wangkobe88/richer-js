// 一次性（182 跑）：R3 域鉴定——苹果SI 首 8 行完整列（price_bnb/price_usd/bnb_amount/token_amount/quote_token）
// + P7 信号 factors 完整价格键 dump。判定库行与 metadata 的价域分裂点。
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const ADDR = '0xc9bf4530033f6497002d228296fedb45036f7777';
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };

(async () => {
  const c = await dbManager.getClient();
  const { data: rows, error } = await c.from('wss_price_ticks')
    .select('id,block_time,trade_type,bnb_amount,token_amount,price_bnb,price_usd,quote_token,platform')
    .eq('token_address', ADDR).order('id', { ascending: true }).limit(8);
  if (error) throw new Error(error.message);
  console.log('--- 首 8 行完整列 ---');
  for (const r of rows) {
    console.log(`${String(r.block_time).slice(11, 19)} ${r.trade_type} bnb=${Number(r.bnb_amount).toExponential(4)} tok=${Number(r.token_amount).toFixed(1)} price_bnb=${Number(r.price_bnb).toExponential(5)} price_usd=${r.price_usd === null ? 'null' : Number(r.price_usd).toExponential(5)} quote=${r.quote_token || 'NULL'} plat=${r.platform}`);
  }
  // 全行 quote_token 分布
  const { data: all } = await c.from('wss_price_ticks').select('quote_token,price_bnb')
    .eq('token_address', ADDR).order('id', { ascending: true }).limit(500);
  let qtNull = 0, qtSet = 0, expList = [];
  for (const r of all || []) {
    if (r.quote_token) qtSet++; else qtNull++;
    if (expList.length < 4) expList.push(Number(r.price_bnb).toExponential(3));
  }
  console.log(`quote_token 分布：NULL=${qtNull} 填充=${qtSet}（前4行 ${expList.join(' ')}）`);

  // P7 executed 信号 factors 价格键全 dump
  const { data: sigs } = await c.from('strategy_signals').select('id,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('token_address', ADDR)
    .eq('metadata->>execution_status', 'executed');
  for (const s of sigs || []) {
    const m = parse(s.metadata);
    const f = m.factors || {};
    const tf = f.trendFactors || {};
    console.log('--- P7 factors 价格键 ---');
    for (const k of Object.keys(tf).sort()) {
      const v = tf[k];
      if (v === null || v === undefined) continue;
      if (/price|fdv|mcap|cap|First|Peak/i.test(k)) console.log(`  trendFactors.${k}=${typeof v === 'number' ? v.toExponential(6) : v}`);
    }
    console.log(`  metadata.price=${m.price} currentPriceBnb=${m.currentPriceBnb}`);
    // firstPrice 与 fdv 域对照
    console.log(`  firstPrice=${tf.firstPrice} fdv=${tf.fdv} marketCap=${tf.marketCap}`);
    console.log(`  域检：fdv/1e9=${Number(tf.fdv) / 1e9} vs firstPrice=${tf.firstPrice} → 比值=${Number(tf.firstPrice) / (Number(tf.fdv) / 1e9)}`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
