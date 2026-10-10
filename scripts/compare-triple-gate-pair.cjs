#!/usr/bin/env node
// ============================================================================
// 三门验证臂配对回测对拍（create-triple-gate-arm.cjs 产物，2026-10-10）
// 用法：node scripts/compare-triple-gate-pair.cjs [三门臂ID 基底ID]
//   缺省 = 3e57ed75-133e-497d-b8c8-b190eca2a6b8 vs 7bee34f9-e8bc-4539-b64c-3fbd2b27dd05
//
// 拉取口径（防 statement timeout，参照 compare-corpus-lag-pair）：jsonb 路径窄列
//   strategy_signals: action='buy' 分页拉全
//     metadata->trendFactors->>holderTrendSlope              （G7 门因子）
//     metadata->preBuyCheckFactors->>strictSameNameTokenCount（G1 门因子）
//     metadata->preBuyCheckFactors->>gmgnBundlerWalletRatio   （G4 门因子）
//     metadata->preBuyCheckFactors->>gmgnRiskCovered
//   trades: buy/sell 成功腿分页拉全（net = Σ卖BNB − Σ买BNB）
//
// 门命中判定（与门臂条件子句逐字对应）：
//   G1: tc != null && tc < 3（AVE 失败 -1 同拦 fail-closed）
//   G7: slope != null && slope >= 0.55（null 快枪票放行 fail-open）
//   G4: covered == 1 && ratio < 21.4（covered=0 放行）
// 因子值来源：优先门臂自身行（preBuy 拦的 executed=false 行带真值）；
//   被 condition 门（G7）拦的票门臂无 signal 行 → 回退基底 executed 行因子
//   （同 tick 流回放确定性，fire 时刻因子一致）。
//
// 差分 = 三门臂 − 基底 = 三门净效应；扫描预期对账 ≈ +6.4 BNB
//   （G4 −3.95 + G1 独有 −1.74 + G7 独有 −0.70，重叠不重复计）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const argv = process.argv.slice(2);
const R1 = argv[0] || '3e57ed75-133e-497d-b8c8-b190eca2a6b8';
const R0 = argv[1] || '7bee34f9-e8bc-4539-b64c-3fbd2b27dd05';

const { dbManager } = require('../src/services/dbManager');

async function loadSignals(expId) {
  const client = dbManager.getClient();
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('strategy_signals')
      .select(`token_address, token_symbol, executed, reason,
        slope:metadata->trendFactors->>holderTrendSlope,
        tc:metadata->preBuyCheckFactors->>strictSameNameTokenCount,
        bundler:metadata->preBuyCheckFactors->>gmgnBundlerWalletRatio,
        covered:metadata->preBuyCheckFactors->>gmgnRiskCovered,
        platform:metadata->preBuyCheckFactors->>platform`)
      .eq('experiment_id', expId).eq('action', 'buy')
      .order('created_at', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error('signals: ' + error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function loadTrades(expId) {
  const client = dbManager.getClient();
  const net = new Map();
  for (const dir of ['buy', 'sell']) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from('trades')
        .select('token_address, token_symbol, input_amount, output_amount')
        .eq('experiment_id', expId).eq('success', true).eq('trade_direction', dir)
        .order('created_at', { ascending: true }).range(offset, offset + 999);
      if (error) throw new Error('trades.' + dir + ': ' + error.message);
      if (!data || data.length === 0) break;
      for (const t of data) {
        const cur = net.get(t.token_address) || { sym: t.token_symbol, buy: 0, sell: 0 };
        if (dir === 'buy') cur.buy += Number(t.input_amount) || 0;
        else cur.sell += Number(t.output_amount) || 0;
        net.set(t.token_address, cur);
      }
      if (data.length < 1000) break;
    }
  }
  for (const v of net.values()) v.net = v.sell - v.buy;
  return net;
}

/** 门命中判定：因子快照 → 命中门集合（与门臂条件子句逐字对应） */
function hitGates(f) {
  const hits = [];
  const tc = f.tc != null ? Number(f.tc) : null;
  const slope = f.slope != null && f.slope !== '' ? Number(f.slope) : null;
  const bundler = f.bundler != null && f.bundler !== '' ? Number(f.bundler) : null;
  const covered = f.covered != null ? Number(f.covered) : null;
  if (tc != null && tc < 3) hits.push('G1低名');
  if (slope != null && slope >= 0.55) hits.push('G7slope');
  if (covered === 1 && bundler != null && bundler < 21.4) hits.push('G4bundler');
  return { hits, tc, slope, bundler, covered };
}

(async () => {
  const [sig1, sig0, net1, net0] = await Promise.all([
    loadSignals(R1), loadSignals(R0), loadTrades(R1), loadTrades(R0),
  ]);

  const total = net => { let t = 0; for (const v of net.values()) t += v.net; return t; };

  // executed 买票（首行因子）+ 每票最后一行因子（门臂被拦行带 preBuy 真值）
  const firstExec = sigs => {
    const m = new Map();
    for (const s of sigs) {
      if (!s.executed || m.has(s.token_address)) continue;
      m.set(s.token_address, { sym: s.token_symbol, ...s });
    }
    return m;
  };
  const lastSig = new Map();
  for (const s of sig1) {
    lastSig.set(s.token_address, { sym: s.token_symbol, ...s });
  }
  const exec1 = firstExec(sig1), exec0 = firstExec(sig0);

  console.log(`\n===== 三门验证臂配对对拍 =====`);
  console.log(`三门臂 ${R1.slice(0, 8)}: ${exec1.size} 买票 / 净 ${total(net1).toFixed(4)} BNB / signals ${sig1.length}`);
  console.log(`基底   ${R0.slice(0, 8)}: ${exec0.size} 买票 / 净 ${total(net0).toFixed(4)} BNB / signals ${sig0.length}`);
  console.log(`三门净效应（三门臂−基底）: ${(total(net1) - total(net0)).toFixed(4)} BNB（扫描预期 ≈ +6.4）\n`);

  // 被拦票 = 基底 executed 有、三门臂无
  const blocks = [];
  let passN = 0, passNet = 0;
  for (const [addr, info] of exec0) {
    const n = net0.get(addr)?.net ?? 0;
    if (exec1.has(addr)) { passN++; passNet += n; }
    else {
      // 因子：优先三门臂被拦行（G1/G4 preBuy 拦的 executed=false 行带真值），
      // 无行（G7 condition 门拦、未 fire）回退基底 executed 行
      const f = lastSig.get(addr) || info;
      const { hits, tc, slope, bundler, covered } = hitGates(f);
      blocks.push({
        addr, sym: info.sym, net: n, hits, tc, slope, bundler, covered,
        platform: (lastSig.get(addr)?.platform || info.platform || '').trim(),
        rowFrom: lastSig.has(addr) ? '臂' : '基',
      });
    }
  }
  const blockNet = blocks.reduce((s, b) => s + b.net, 0);
  const winB = blocks.filter(b => b.net > 0), loseB = blocks.filter(b => b.net <= 0);
  console.log(`共同票: ${passN} 张 / 净 ${passNet.toFixed(4)} BNB`);
  console.log(`三门拦掉: ${blocks.length} 张 / 净 ${blockNet.toFixed(4)} BNB`);
  console.log(`  避亏: ${loseB.length} 张 ${loseB.reduce((s, b) => s + b.net, 0).toFixed(4)} | 弃赢: ${winB.length} 张 ${winB.reduce((s, b) => s + b.net, 0).toFixed(4)}\n`);

  // 门组合分桶
  const byCombo = new Map();
  for (const b of blocks) {
    const key = b.hits.length ? b.hits.join('+') : '⚠️无门命中';
    if (!byCombo.has(key)) byCombo.set(key, []);
    byCombo.get(key).push(b);
  }
  console.log('门组合分桶（组合 | 张数 | 净额）:');
  for (const [k, arr] of [...byCombo.entries()].sort((a, b) =>
    a[1].reduce((s, x) => s + x.net, 0) - b[1].reduce((s, x) => s + x.net, 0))) {
    console.log(`  ${k}: ${arr.length} 张 / ${arr.reduce((s, x) => s + x.net, 0).toFixed(4)} BNB`);
  }
  // 单门命中统计（含重叠；对账扫描预测 G1~23/G4~77/G7~7）
  for (const g of ['G1低名', 'G7slope', 'G4bundler']) {
    const arr = blocks.filter(b => b.hits.includes(g));
    console.log(`  [${g} 含重叠] ${arr.length} 张 / ${arr.reduce((s, x) => s + x.net, 0).toFixed(4)} BNB`);
  }
  console.log('');

  // 被拦票逐张（地址必带——case 汇报纪律）
  console.log('被拦票清单（地址 | sym | 命中门 | tc/slope/bundler/covered | 行源 | 平台 | 盈亏BNB）:');
  blocks.sort((a, b) => a.net - b.net);
  for (const b of blocks) {
    console.log(`  ${b.addr} | ${b.sym || '?'} | ${b.hits.join('+') || '无'} | tc=${b.tc ?? '?'} slope=${b.slope ?? 'null'} b=${b.bundler ?? '?'} c=${b.covered ?? '?'} | ${b.rowFrom} | ${b.platform || '?'} | ${b.net.toFixed(4)}`);
  }

  // 三门臂独有票（理论上应为零——三门只能拦不能放）
  const onlyA = [...exec1.keys()].filter(a => !exec0.has(a));
  if (onlyA.length) {
    console.log(`\n⚠️ 三门臂独有票 ${onlyA.length} 张（门只能拦不能放，非零=时序扰动需人工看）:`);
    for (const a of onlyA) {
      console.log(`  ${a} | ${exec1.get(a).sym} | net=${(net1.get(a)?.net ?? 0).toFixed(4)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
