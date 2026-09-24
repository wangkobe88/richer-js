#!/usr/bin/env node
/**
 * E5 卖侧新因子离线重放验证（只读；182 上跑）：
 *   graduationProgress / rsi9Bar5mRt / risePct5m / riseVel5m
 *
 * 样本：E4 回测（83453b6e）实际交易过的全部 token —— 策略真实会碰到的票型
 * （含毕业票 0x47da：断流前市值收敛 72.1 BNB 的锚实证票）。
 * E5b 版（2026-09-24）：risePct5m/riseVel5m 已改持仓口径（FA 窗下界含买入时间，
 * 无仓恒 null）——重放按 E4 trades 买卖时点 setBuyState/clearBuyState，
 * 针臂统计=持仓期值；并预演 E5b 针臂门（P2 猛 8/15、P4 普 5/15、
 * 市值门 graduationProgress>=2/3）首个触发时点 vs E4 实际出场。
 * 断言（plan §五.2）：
 *   1. totalSupply 覆盖率（P-9：缺 supply → graduationProgress 恒 null）
 *   2. graduationProgress：0x47da max≈1.00；首个 ≥0.9 时点距断流时长（毕业臂提前量）
 *   3. rsi9Bar5mRt：首非 null ≈ 首 tick+50min（RSI9 需 10 根闭合 5m bar 的 warmup）
 *   4. 持仓期 risePct5m/riseVel5m 峰值 + E5b 针臂门触发预演
 * 用法：node scripts/backtest-loop/verify-e5-factors.cjs
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator'));

const SOURCE_EXP = '572033ad-831e-4f60-9985-f6e4f63739c1';
const E4_EXP = '83453b6e-e18e-49b7-b9a8-7c993267a528';
const MKT_GATE = 2 / 3; // 针臂市值门（用户裁定 2026-09-24：≥毕业市值 2/3 才许针臂卖）

async function fetchAll(query) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await query.range(off, off + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

(async () => {
  const c = dbManager.getClient();

  // 1. 样本 = E4 实际交易过的 token（trades 去重）
  const e4Trades = await fetchAll(
    c.from('trades').select('token_address, token_symbol, trade_direction, unit_price, created_at')
      .eq('experiment_id', E4_EXP)
      .order('created_at', { ascending: true })
  );
  const addrSet = new Map();
  const tradeEventsByAddr = new Map(); // addr → [{dir, ts, unit}]（按时间序；回测 created_at=模拟时钟）
  for (const t of e4Trades) {
    addrSet.set(t.token_address, t.token_symbol);
    if (!tradeEventsByAddr.has(t.token_address)) tradeEventsByAddr.set(t.token_address, []);
    tradeEventsByAddr.get(t.token_address).push({
      dir: t.trade_direction, ts: new Date(t.created_at).getTime(), unit: Number(t.unit_price) || 0,
    });
  }

  // 2. supply（experiment_tokens raw_api_data.totalSupply）
  const tokens = await fetchAll(
    c.from('experiment_tokens').select('token_address, token_symbol, raw_api_data')
      .eq('experiment_id', SOURCE_EXP)
  );
  const supply = new Map();
  for (const t of tokens) {
    const s = Number(t.raw_api_data?.totalSupply || 0);
    if (s > 0) supply.set(t.token_address, s);
  }
  const sampleNoSupply = [...addrSet.keys()].filter(a => !supply.has(a));
  console.log(`样本（E4 交易过的票）：${addrSet.size} 个；缺 totalSupply：${sampleNoSupply.length}${sampleNoSupply.length ? ' → ' + sampleNoSupply.join(',') : ''}`);
  const allSupplyCov = tokens.length ? (supply.size / tokens.length * 100).toFixed(1) : 'n/a';
  console.log(`全实验 supply 覆盖率：${supply.size}/${tokens.length}（${allSupplyCov}%）`);

  // 3. 逐 token 重放（tick 映射与 BacktestEngine._loadWssTicks 同构；买卖时点驱动 buyState）
  for (const [addr, sym] of addrSet) {
    const rows = await fetchAll(
      c.from('wss_price_ticks')
        .select('token_address, trade_type, trader_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier')
        .eq('experiment_id', SOURCE_EXP)
        .eq('token_address', addr)
        .order('id', { ascending: true })
    );
    if (!rows.length) { console.log(`\n### ${sym} ${addr.slice(0, 10)} 无 ticks，跳过`); continue; }

    const fa = new FourMemeFactorAggregator();
    const firstTs = new Date(rows[0].block_time).getTime();
    fa.registerToken(addr, { createdAtMs: firstTs, totalSupply: supply.get(addr) || 0 });
    const pending = [...(tradeEventsByAddr.get(addr) || [])]; // 到时即触发（buy→setBuyState / sell→clear）
    let held = false, buyTs = 0, buyUnit = 0;
    let last = null;
    let gradFirst09Ts = null;
    let gradMax = 0, gradMaxTs = null;
    let rsiFirstTs = null;
    let riseMax = 0, velMax = 0, riseMaxTs = null, velMaxTs = null; // 持仓期峰值（口径=E5b 实跑所见）
    // RSI 阈值档命中分布（T85/T78/T75 互斥带 + risePct>=5 前置；持仓期才有值）
    const rsiBands = { t85: 0, t78: 0, t75: 0 };
    // E5b 针臂门触发预演（首触发快照）
    let p2Hit = null, p4Hit = null;
    // 无市值门的裸针臂首触发（对照：看市值门拦掉的触发长什么样）
    let p2NoGate = null;

    for (const row of rows) {
      const ts = new Date(row.block_time).getTime();
      fa.processTick({
        token_address: row.token_address,
        trade_type: row.trade_type,
        trader_address: row.trader_address,
        price_bnb: Number(row.price_bnb),
        price_usd: row.price_usd === null ? null : Number(row.price_usd),
        bnb_amount: Number(row.bnb_amount || 0),
        token_amount: Number(row.token_amount || 0),
        block_number: row.block_number,
        timestamp: ts,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        price_outlier: row.price_outlier || false,
      }, { emitFactors: false });
      // 买卖时点驱动（到达 trade 时刻的首个 tick 前，与引擎「成交后下一 tick 起卖腿评估」同侧）
      while (pending.length && ts >= pending[0].ts) {
        const ev = pending.shift();
        if (ev.dir === 'buy') {
          fa.setBuyState(addr, {
            buyPriceBnb: fa.getTokenState(addr)?.currentPriceBnb || 0,
            buyPriceUsd: ev.unit, buyTime: ev.ts,
          });
          held = true; buyTs = ev.ts; buyUnit = ev.unit;
        } else {
          fa.clearBuyState(addr, 'default');
          held = false;
        }
      }
      // 重放验算：公共 API 构建（与回测强平路径同款），不依赖事件
      const factors = fa.buildFactorMap(addr, ts);
      if (!factors) continue;
      last = factors;
      if (factors.graduationProgress != null) {
        if (factors.graduationProgress > gradMax) { gradMax = factors.graduationProgress; gradMaxTs = ts; }
        if (gradFirst09Ts === null && factors.graduationProgress >= 0.9) gradFirst09Ts = ts;
      }
      if (rsiFirstTs === null && factors.rsi9Bar5mRt != null) rsiFirstTs = ts;
      if (held && factors.risePct5m != null) {
        if (factors.risePct5m > riseMax) { riseMax = factors.risePct5m; riseMaxTs = ts; }
        if (factors.riseVel5m != null && factors.riseVel5m > velMax) { velMax = factors.riseVel5m; velMaxTs = ts; }
      }
      if (held) {
        const r = factors.rsi9Bar5mRt;
        if (r != null && factors.risePct5m != null && factors.risePct5m >= 5) {
          if (r > 85) rsiBands.t85++;
          else if (r > 78) rsiBands.t78++;
          else if (r > 75) rsiBands.t75++;
        }
        // E5b 针臂门预演（与 e5.json P2/P4 条件逐字同构）
        const g = factors.graduationProgress;
        const mktGate = g != null && g >= MKT_GATE;
        const snap = () => ({
          ts, holdMin: (ts - buyTs) / 60000,
          sinceBuyPct: buyUnit > 0 && factors.currentPrice > 0 ? (factors.currentPrice / buyUnit - 1) * 100 : null,
          risePct: factors.risePct5m, vel: factors.riseVel5m, rsi: factors.rsi9Bar5mRt, grad: g,
        });
        if (!p2NoGate && factors.riseVel5m > 8 && factors.risePct5m > 15
            && (factors.rsi9Bar5mRt == null || factors.rsi9Bar5mRt > 60)) p2NoGate = snap();
        if (!p2Hit && mktGate && factors.riseVel5m > 8 && factors.risePct5m > 15
            && (factors.rsi9Bar5mRt == null || factors.rsi9Bar5mRt > 60)) p2Hit = snap();
        if (!p4Hit && mktGate && factors.riseVel5m > 5 && factors.risePct5m > 15
            && (factors.rsi9Bar5mRt == null || factors.rsi9Bar5mRt > 50)) p4Hit = snap();
      }
    }

    const lastTs = new Date(rows[rows.length - 1].block_time).getTime();
    const fmt = (ts) => ts ? new Date(ts).toISOString().slice(11, 19) : '-';
    const f1 = (v) => v == null ? 'n/a' : Number(v).toFixed(1);
    const spanMin = ((lastTs - firstTs) / 60000).toFixed(1);
    console.log(`\n### ${sym} ${addr.slice(0, 10)}  ticks=${rows.length}  生命=${spanMin}min`);
    console.log(`  graduationProgress: max=${gradMax.toFixed(3)}@${fmt(gradMaxTs)}  首个≥0.9=${fmt(gradFirst09Ts)}` +
      (gradFirst09Ts ? `（距断流 ${((lastTs - gradFirst09Ts) / 60000).toFixed(1)}min）` : ''));
    const warmupMin = rsiFirstTs ? ((rsiFirstTs - firstTs) / 60000).toFixed(1) : 'n/a';
    console.log(`  rsi9Bar5mRt: 首值@${fmt(rsiFirstTs)}（首 tick+${warmupMin}min，期望≈50）  末值=${last && last.rsi9Bar5mRt != null ? last.rsi9Bar5mRt.toFixed(1) : 'null'}`);
    console.log(`  持仓期 risePct5m: max=${f1(riseMax)}%@${fmt(riseMaxTs)}  riseVel5m: max=${f1(velMax)}%/min@${fmt(velMaxTs)}`);
    console.log(`  RSI 互斥带命中 tick 数（持仓期，risePct5m≥5 前置）：T85=${rsiBands.t85} T78=${rsiBands.t78} T75=${rsiBands.t75}`);
    const hitLine = (tag, h) => h
      ? `${tag}: @${fmt(h.ts)} 持仓${h.holdMin.toFixed(1)}min 买后${f1(h.sinceBuyPct)}% rise=${f1(h.risePct)}% vel=${f1(h.vel)} rsi=${h.rsi == null ? 'null' : h.rsi.toFixed(1)} grad=${h.grad.toFixed(3)}`
      : `${tag}: 不触发`;
    console.log(`  针臂预演（E5b 门）｜${hitLine('P2猛', p2Hit)}`);
    console.log(`               ｜${hitLine('P4普', p4Hit)}`);
    if (p2NoGate && !p2Hit) console.log(`  （市值门拦掉裸 P2 触发 @${fmt(p2NoGate.ts)}：grad=${p2NoGate.grad.toFixed(3)}<${MKT_GATE.toFixed(4)} 买后${f1(p2NoGate.sinceBuyPct)}%）`);
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
