// C254 后续：GMGN 0x699a…7777 链上外部手工卖出（0x9c9f…8860）回填补录
// 信号行（终态 executed）+ trades 行（照 _executeSellLive 形状）+ experiment_tokens 置 sold
// 数据源=链上回执（RPC）+ collector tick（wss_price_ticks id=10056190，净额口径同引擎实收）
const { dbManager } = require('../src/services/dbManager.js');
const Decimal = require('decimal.js');

const EXP = '6581c288-66f9-498a-800e-1325c8a7de58';
const ADDR = '0x699a81a93f55d52691f20a9818d8a042e6cd7777';
const TX = '0x9c9f305c8fcff1c76b3b1ae5dde11bca276ed4d29bdfbefcb305dd1742e88860';
const TX_TIME = '2026-10-28T08:08:43.000Z'; // 块 130246677 出块时间
const GAS_USED = 518285;
const GAS_PRICE_WEI = '120000000';

(async () => {
  const db = dbManager.getClient();

  // 0) 幂等防线：已有卖出行/信号行即拒
  const { data: exist } = await db.from('trades')
    .select('id,trade_direction,token_id,input_currency,input_amount,output_amount')
    .eq('experiment_id', EXP).eq('token_address', ADDR);
  if (exist.some(t => t.trade_direction === 'sell')) {
    console.log('已存在卖出行，拒绝重复补录:', exist); process.exit(1);
  }

  // 1) 买入行拿 token_id + 校验数量闭环
  const buy = exist.find(t => t.trade_direction === 'buy');
  if (!buy) { console.log('买入行缺失，拒绝补录'); process.exit(1); }
  const tokenId = buy.token_id;
  console.log('买入行: qty=' + buy.output_amount + ' tokenId=' + tokenId);

  // 2) tick 净额事实（collector 解码 flap Sell 事件：token_amount=卖量 / bnb_amount=净收款）
  const { data: tick } = await db.from('wss_price_ticks')
    .select('id,token_amount,bnb_amount,price_bnb,price_usd')
    .eq('token_address', ADDR).eq('tx_hash', TX).maybeSingle();
  if (!tick) { console.log('tick 缺失，拒绝补录'); process.exit(1); }
  const qtySold = tick.token_amount;              // 912940.9718996974
  const bnbReceived = tick.bnb_amount;            // 0.007094423051543441
  const bnbUsd = new Decimal(tick.price_usd).div(new Decimal(tick.price_bnb)).toNumber();
  const effUsd = new Decimal(bnbReceived).mul(bnbUsd).div(new Decimal(qtySold)).toNumber();
  const ratio = new Decimal(qtySold).div(new Decimal(buy.output_amount)).toNumber();
  console.log(`tick id=${tick.id} qty=${qtySold} bnb=${bnbReceived} bnbUsd=${bnbUsd.toFixed(4)} effUsd=${effUsd.toExponential(6)}`);
  if (Math.abs(ratio - 1) > 1e-12) { console.log('卖量≠买入量（非全清），拒绝补录 ratio=' + ratio); process.exit(1); }

  // 3) 信号行（照 _saveManualSignal + _finalizeManualSignal 终态一跳到位）
  const signalId = crypto.randomUUID();
  const tradeId = crypto.randomUUID();
  const signalRow = {
    id: signalId,
    experiment_id: EXP,
    token_address: ADDR,
    token_symbol: 'GMGN',
    chain: 'bsc',
    signal_type: 'SELL',
    action: 'sell',
    confidence: 0.9,
    reason: '手动卖出 100% 余仓（链上外部执行回填补录，经 GMGN 聚合路由）',
    metadata: {
      isManualTrade: true,
      manualRequestId: null,
      cards: 3,
      price: effUsd,
      strategyId: null,
      strategyName: '手工交易',
      manualBackfill: true,
      backfillNote: `外部手工卖出 DB 回填：引擎未执行；数据源=链上回执 ${TX} + wss_price_ticks id=${tick.id}`,
      execution_status: 'executed',
      executed_at: TX_TIME,
      tradeResult: {
        success: true,
        tradeId,
        reason: null,
        trade: {
          id: tradeId, tokenSymbol: 'GMGN', tradeDirection: 'sell',
          inputAmount: String(qtySold), outputAmount: String(bnbReceived),
          unitPrice: String(effUsd), success: true,
        },
      },
    },
    executed: true,
    created_at: TX_TIME,
  };
  const { error: sigErr } = await db.from('strategy_signals').insert(signalRow);
  if (sigErr) throw new Error('signal 插入失败: ' + sigErr.message);
  console.log('signal 行已插入:', signalId);

  // 4) trades 行（照 _executeSellLive 3287-3315 形状；cardTrade 3→0 重放删卡）
  const tradeRow = {
    id: tradeId,
    experiment_id: EXP,
    signal_id: signalId,
    token_address: ADDR,
    token_symbol: 'GMGN',
    token_id: tokenId,
    chain: 'bsc',
    trade_direction: 'sell',
    trade_status: 'success',
    success: true,
    is_virtual_trade: false,
    input_currency: 'GMGN',
    output_currency: 'BNB',
    input_amount: String(qtySold),
    output_amount: String(bnbReceived),
    unit_price: String(effUsd),
    created_at: TX_TIME,
    executed_at: TX_TIME,
    metadata: {
      signalId,
      txHash: TX,
      bnbUsd,
      bnbReceived: String(bnbReceived),
      sellPercentage: 1,
      cardTrade: { cards: 3, before: 3, after: 0 },
      protocol: 'Flap Portal',
      method: 'sellToken',
      isManualTrade: true,
      manualBackfill: true,
      gasUsed: GAS_USED,
      gasPrice: GAS_PRICE_WEI,
      txTime: TX_TIME,
      blockNumber: 130246677,
      routeNote: 'GMGN 聚合路由(0x1de460…4bc)→Flap Portal，sender=用户钱包',
    },
  };
  const { error: trErr } = await db.from('trades').insert(tradeRow);
  if (trErr) { console.error('trade 插入失败，回滚 signal:', trErr.message);
    await db.from('strategy_signals').delete().eq('id', signalId); process.exit(1); }
  console.log('trade 行已插入:', tradeId);

  // 5) experiment_tokens 置 sold（引擎全清分支同款 updateTokenStatus）
  const { error: stErr } = await db.from('experiment_tokens')
    .update({ status: 'sold' }).eq('experiment_id', EXP).eq('token_address', ADDR);
  if (stErr) console.log('⚠️ token status 更新失败（不影响补录主体）:', stErr.message);
  else console.log('experiment_tokens status → sold');

  // 6) 验证回读 + PnL
  const { data: verify } = await db.from('trades')
    .select('trade_direction,input_amount,output_amount,unit_price,created_at,signal_id')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at', { ascending: true });
  console.log('\n=== 验证（该票全部 trades）:');
  for (const t of verify) console.log(JSON.stringify(t));
  const b = verify.find(t => t.trade_direction === 'buy');
  const s = verify.find(t => t.trade_direction === 'sell');
  const pnlBnb = new Decimal(s.output_amount).minus(new Decimal(b.input_currency === 'BNB' ? b.input_amount : b.input_amount)).toNumber();
  const pnlPct = (Number(s.output_amount) / Number(b.input_amount) - 1) * 100;
  console.log(`\nPnL: 投入 ${b.input_amount} BNB → 回收 ${s.output_amount} BNB = ${pnlBnb >= 0 ? '+' : ''}${pnlBnb.toFixed(8)} BNB（${pnlPct.toFixed(2)}%，gas 另计 0.0000621942）`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
