#!/usr/bin/env node
/**
 * E5 卖侧新因子离线重放验证（只读；182 上跑）：
 *   graduationProgress / rsi9Bar5mRt / risePct5m / riseVel5m
 *
 * 样本：E4 回测（83453b6e）实际交易过的全部 token —— 策略真实会碰到的票型
 * （含毕业票 0x47da：断流前市值收敛 72.1 BNB 的锚实证票）。
 * 断言（plan §五.2）：
 *   1. totalSupply 覆盖率（P-9：缺 supply → graduationProgress 恒 null）
 *   2. graduationProgress：0x47da max≈1.00；首个 ≥0.9 时点距断流时长（毕业臂提前量）
 *   3. rsi9Bar5mRt：首非 null ≈ 首 tick+50min（RSI9 需 10 根闭合 5m bar 的 warmup）
 *   4. risePct5m/riseVel5m 主升段峰值（校准针臂门 8/15 与 5/15）
 * 用法：node scripts/backtest-loop/verify-e5-factors.cjs
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { dbManager } = require(path.join(ROOT, 'src/services/dbManager'));
const FourMemeFactorAggregator = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator'));

const SOURCE_EXP = '572033ad-831e-4f60-9985-f6e4f63739c1';
const E4_EXP = '83453b6e-e18e-49b7-b9a8-7c993267a528';

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
  const e4Tokens = await fetchAll(
    c.from('trades').select('token_address, token_symbol')
      .eq('experiment_id', E4_EXP)
  );
  const addrSet = new Map();
  for (const t of e4Tokens) addrSet.set(t.token_address, t.token_symbol);

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

  // 3. 逐 token 重放（tick 映射与 BacktestEngine._loadWssTicks 同构）
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
    let last = null;
    let gradFirst09Ts = null;
    let gradMax = 0, gradMaxTs = null;
    let rsiFirstTs = null;
    let riseMax = 0, velMax = 0, riseMaxTs = null, velMaxTs = null;
    // RSI 阈值档命中分布（T85/T78/T75 互斥带 + risePct>=5 前置）
    const rsiBands = { t85: 0, t78: 0, t75: 0 };

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
      // 重放验算：公共 API 构建（与回测强平路径同款），不依赖事件
      const factors = fa.buildFactorMap(addr, ts);
      if (!factors) continue;
      last = factors;
      if (factors.graduationProgress != null) {
        if (factors.graduationProgress > gradMax) { gradMax = factors.graduationProgress; gradMaxTs = ts; }
        if (gradFirst09Ts === null && factors.graduationProgress >= 0.9) gradFirst09Ts = ts;
      }
      if (rsiFirstTs === null && factors.rsi9Bar5mRt != null) rsiFirstTs = ts;
      if (factors.risePct5m != null) {
        if (factors.risePct5m > riseMax) { riseMax = factors.risePct5m; riseMaxTs = ts; }
        if (factors.riseVel5m != null && factors.riseVel5m > velMax) { velMax = factors.riseVel5m; velMaxTs = ts; }
      }
      const r = factors.rsi9Bar5mRt;
      if (r != null && factors.risePct5m != null && factors.risePct5m >= 5) {
        if (r > 85) rsiBands.t85++;
        else if (r > 78) rsiBands.t78++;
        else if (r > 75) rsiBands.t75++;
      }
    }

    const lastTs = new Date(rows[rows.length - 1].block_time).getTime();
    const fmt = (ts) => ts ? new Date(ts).toISOString().slice(11, 19) : '-';
    const spanMin = ((lastTs - firstTs) / 60000).toFixed(1);
    console.log(`\n### ${sym} ${addr.slice(0, 10)}  ticks=${rows.length}  生命=${spanMin}min`);
    console.log(`  graduationProgress: max=${gradMax.toFixed(3)}@${fmt(gradMaxTs)}  首个≥0.9=${fmt(gradFirst09Ts)}` +
      (gradFirst09Ts ? `（距断流 ${((lastTs - gradFirst09Ts) / 60000).toFixed(1)}min）` : ''));
    const warmupMin = rsiFirstTs ? ((rsiFirstTs - firstTs) / 60000).toFixed(1) : 'n/a';
    console.log(`  rsi9Bar5mRt: 首值@${fmt(rsiFirstTs)}（首 tick+${warmupMin}min，期望≈50）  末值=${last && last.rsi9Bar5mRt != null ? last.rsi9Bar5mRt.toFixed(1) : 'null'}`);
    console.log(`  risePct5m: max=${riseMax.toFixed(1)}%@${fmt(riseMaxTs)}  riseVel5m: max=${velMax.toFixed(1)}%/min@${fmt(velMaxTs)}`);
    console.log(`  RSI 互斥带命中 tick 数（risePct5m≥5 前置）：T85=${rsiBands.t85} T78=${rsiBands.t78} T75=${rsiBands.t75}`);
    const arm = velMax > 8 && riseMax > 15 ? '猛档' : (velMax > 5 && riseMax > 15 ? '普通档' : '不触发');
    console.log(`  针臂门（8/15 与 5/15）峰值判定：${arm}（若谷→峰值在同一 5min 稀疏窗内连击）`);
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
