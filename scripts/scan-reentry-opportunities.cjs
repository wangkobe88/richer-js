#!/usr/bin/env node
/**
 * 再入场买腿历史机会扫描（2026-09-30，暴走板栗案衍生调研）
 *
 * 问题：实验全清某票后，若该票随后放量反弹（本案：全清 1 分钟后 1.67x、5 分钟后毕业 7.73x），
 * 一条「再入场买腿」能捕捉多少历史机会、净效应是正是负？
 *
 * 口径（扫描版代理条件，比真实腿松——无 graduationProgress 门，触发数是上界）：
 *   - 样本：全部实验 trades 重放出的「全清点」（某轮持仓余量归零的卖出时刻 t0）
 *   - 反弹锚 P_base = t0 后 90s 内最低 tick 价（防阴跌半山腰接刀：须从低点反弹 ≥15% 才算）
 *   - 触发：t0+30s 起 30min 内，某 tick 满足 ① 价 ≥ P_base×REBOUND_PCT ② 30s 滑窗 tick 数
 *     ≥ 15（tps≥0.5 热桶代理）③ 该时刻未毕业（graduation 事件晚于 t）
 *   - 买入：0.2 BNB（2 卡）@ 触发 tick 的 price_bnb（全程 BNB 口径记账，flap quote 盘
 *     price_bnb 已换算，量纲自洽；price_bnb null 的历史未回填盘剔除计数）
 *   - 出场三口径：
 *       E1 毕业口径：t0+60min 内有 graduation → 毕业前最后一颗 tick 价全清；否则窗末强平
 *       E2 止盈止损：+50% 卖一半、-35% 全清止损、其余 t0+60min 窗末强平
 *       E3 窗末强平：一律持有到 t0+60min 最后一颗 tick（最保守）
 *
 * 用法：node scripts/scan-reentry-opportunities.cjs [--limit N] [--concurrency K] [--json out.json]
 *   182 跑全量；本地 --limit 3 冒烟。只读，不写库。
 */
const path = require('path');
const { dbManager } = require(path.join(__dirname, '..', 'src', 'services', 'dbManager.js'));

// ── 可调参数 ──
const REBOUND_PCT = 1.15;      // 反弹幅度门（相对 90s 低点）
const TRIGGER_WINDOW_MS = 30 * 60 * 1000;  // 触发窗：t0 后 30min
const DATA_WINDOW_MS = 60 * 60 * 1000;     // 数据窗：t0 后 60min（含出场）
const BASE_WINDOW_MS = 90 * 1000;          // 反弹锚采样窗
const MIN_TICKS_30S = 15;      // 30s 滑窗 tick 数门（tps ≥ 0.5）
const STAKE_BNB = 0.2;         // 再入场固定仓位（2 卡）
const FLAP_GRADUATION_TRUE = true; // flap 毕业断流，E1 用毕业前最后 tick（口径见注释）

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
}
const LIMIT = parseInt(argVal('--limit', '0'), 10);        // 0 = 全量
const CONCURRENCY = parseInt(argVal('--concurrency', '8'), 10);
const JSON_OUT = argVal('--json', null);

async function fetchAll(query, pageSize = 1000) {
  // postgrest 单请求默认截断 1000 行，.range 分页拉全
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) return out;
  }
}

function beijing(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(5, 19);
}

async function main() {
  const client = dbManager.getClient();

  // 1) 全部成交（success），重放找全清点
  console.log('[1/4] 拉取 trades ...');
  const trades = await fetchAll(client
    .from('trades')
    .select('experiment_id, token_address, token_symbol, trade_direction, input_amount, output_amount, created_at, is_virtual_trade')
    .eq('success', true)
    .order('created_at', { ascending: true }));
  console.log(`    trades ${trades.length} 笔`);

  // per (exp, token) 重放
  const groups = new Map();
  for (const t of trades) {
    const key = `${t.experiment_id}|${t.token_address}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const opportunities = [];
  for (const [key, arr] of groups) {
    const [expId, token] = key.split('|');
    let qty = 0, maxQty = 0, symbol = '', virtual = true;
    for (const t of arr) {
      symbol = t.token_symbol || symbol;
      virtual = t.is_virtual_trade !== false;
      if (t.trade_direction === 'buy') {
        qty += Number(t.output_amount) || 0;
        maxQty = Math.max(maxQty, qty);
      } else {
        qty -= Number(t.input_amount) || 0;
        // 余量归零（相对 1e-9 容差，双精度重放口径）→ 全清点 = 机会
        if (maxQty > 0 && qty <= maxQty * 1e-9) {
          opportunities.push({
            expId, token, symbol, virtual,
            t0: t.created_at,
            roundBuyBnb: undefined, // 该轮买入 BNB（参考值，下面填）
          });
          qty = 0; maxQty = 0;
        }
      }
    }
  }
  console.log(`    全清机会 ${opportunities.length} 个（${groups.size} 个 exp×token 组合）`);
  const scanList = LIMIT > 0 ? opportunities.slice(0, LIMIT) : opportunities;

  // 2) graduation 事件表
  console.log('[2/4] 拉取 graduation 事件 ...');
  const tokens = [...new Set(opportunities.map(o => o.token))];
  const gradMap = new Map();
  for (let i = 0; i < tokens.length; i += 200) {
    const { data: evs, error: e2 } = await client
      .from('wss_events')
      .select('token_address, block_time')
      .eq('kind', 'graduation')
      .in('token_address', tokens.slice(i, i + 200));
    if (e2) throw e2;
    for (const e of evs) {
      const prev = gradMap.get(e.token_address);
      if (!prev || new Date(e.block_time) < new Date(prev)) gradMap.set(e.token_address, e.block_time);
    }
  }
  console.log(`    graduation ${gradMap.size} 个 token`);

  // 3) 逐机会扫 ticks（分批并发）
  console.log(`[3/4] 扫描 ${scanList.length} 个机会的触发与模拟（并发 ${CONCURRENCY}）...`);
  let done = 0;
  async function scanOne(opp) {
    const t0 = new Date(opp.t0).getTime();
    const ticks = await fetchAll(client
      .from('wss_price_ticks')
      .select('received_at, price_bnb')
      .eq('token_address', opp.token)
      .gte('received_at', opp.t0)
      .lte('received_at', new Date(t0 + DATA_WINDOW_MS).toISOString())
      .not('price_bnb', 'is', null)
      .order('received_at', { ascending: true }));
    done++;
    if (done % 100 === 0) console.log(`    ... ${done}/${scanList.length}`);

    const base = { ...opp, ticks: ticks.length, result: null };
    if (!ticks.length) return base;

    const ts = ticks.map(t => new Date(t.received_at).getTime());
    const ps = ticks.map(t => Number(t.price_bnb));
    const gradAt = gradMap.has(opp.token) ? new Date(gradMap.get(opp.token)).getTime() : null;

    // 反弹锚：t0 后 90s 内最低价；窗口内无 tick 则用首颗
    let pBase = null;
    for (let i = 0; i < ts.length && ts[i] <= t0 + BASE_WINDOW_MS; i++) {
      if (pBase == null || ps[i] < pBase) pBase = ps[i];
    }
    if (pBase == null) pBase = ps[0];
    if (pBase <= 0) return base;

    // 找触发：双指针滑窗计 30s tick 数
    let left = 0, trigIdx = -1;
    for (let i = 0; i < ts.length; i++) {
      while (ts[i] - ts[left] > 30000) left++;
      if (ts[i] <= t0 + 30000) continue;                       // 避开卖出自成交段
      if (ts[i] > t0 + TRIGGER_WINDOW_MS) break;               // 触发窗截止
      if (gradAt != null && ts[i] >= gradAt) break;            // 已毕业断流
      const hot = (i - left + 1) >= MIN_TICKS_30S;
      if (hot && ps[i] >= pBase * REBOUND_PCT) { trigIdx = i; break; }
    }
    if (trigIdx < 0) return base;

    const buyPrice = ps[trigIdx];
    const qty = STAKE_BNB / buyPrice;
    const endMs = t0 + DATA_WINDOW_MS;

    // E1 毕业口径：毕业前最后一颗 tick / 窗末强平
    let e1Idx = ts.length - 1;
    if (gradAt != null && gradAt > ts[trigIdx] && gradAt <= endMs) {
      e1Idx = trigIdx;
      while (e1Idx + 1 < ts.length && ts[e1Idx + 1] < gradAt) e1Idx++;
    }
    const e1 = ps[e1Idx] * qty - STAKE_BNB;

    // E2 止盈止损：+50% 减半、-35% 全清、窗末强平
    let remaining = qty, bnb = 0;
    for (let i = trigIdx + 1; i < ts.length; i++) {
      if (ps[i] >= buyPrice * 1.5 && remaining > qty / 2) { bnb += (remaining - qty / 2) * ps[i]; remaining = qty / 2; }
      if (ps[i] <= buyPrice * 0.65) { bnb += remaining * ps[i]; remaining = 0; break; }
    }
    if (remaining > 0) bnb += remaining * ps[ts.length - 1];
    const e2 = bnb - STAKE_BNB;

    // E3 窗末强平
    const e3 = ps[ts.length - 1] * qty - STAKE_BNB;

    base.result = {
      trigAt: ticks[trigIdx].received_at,
      trigDelaySec: Math.round((ts[trigIdx] - t0) / 1000),
      buyPrice,
      mult: ps[ts.length - 1] / buyPrice,
      e1, e2, e3,
      graduated: gradAt != null && gradAt > ts[trigIdx] && gradAt <= endMs,
    };
    return base;
  }

  const results = [];
  for (let i = 0; i < scanList.length; i += CONCURRENCY) {
    const batch = scanList.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(batch.map(scanOne)));
  }

  // 4) 汇总
  console.log('[4/4] 汇总 ...');
  const fired = results.filter(r => r.result);
  const noTicks = results.filter(r => r.ticks === 0).length;
  const sum = key => fired.reduce((s, r) => s + r.result[key], 0);
  const wins = key => fired.filter(r => r.result[key] > 0).length;

  function statLine(name, key) {
    const total = sum(key);
    const arr = fired.map(r => r.result[key]).sort((a, b) => a - b);
    const med = arr.length ? arr[Math.floor(arr.length / 2)] : 0;
    console.log(`  ${name}: 净 ${total >= 0 ? '+' : ''}${total.toFixed(3)} BNB | 赢 ${wins(key)}/${fired.length}（${fired.length ? (wins(key) / fired.length * 100).toFixed(1) : 0}%）| 均值 ${fired.length ? (total / fired.length).toFixed(4) : 0} | 中位 ${med.toFixed(4)}`);
  }

  console.log('\n========== 再入场扫描汇总 ==========');
  console.log(`机会（全清点）: ${results.length} | 无 ticks(断流/回填缺失): ${noTicks} | 触发: ${fired.length}（${results.length ? (fired.length / results.length * 100).toFixed(1) : 0}%）`);
  statLine('E1 毕业口径', 'e1');
  statLine('E2 止盈止损  ', 'e2');
  statLine('E3 窗末强平  ', 'e3');
  console.log(`触发后毕业: ${fired.filter(r => r.result.graduated).length}/${fired.length}`);

  // per-token 去重（同票多实验/多轮，只计最早一次全清后的再入场）
  const byToken = new Map();
  for (const r of fired) {
    if (!byToken.has(r.token) || new Date(r.t0) < new Date(byToken.get(r.token).t0)) byToken.set(r.token, r);
  }
  const uniq = [...byToken.values()];
  const usum = k => uniq.reduce((s, r) => s + r.result[k], 0);
  const uwins = k => uniq.filter(r => r.result[k] > 0).length;
  console.log(`\n-- per-token 去重（${uniq.length} 个独立票）--`);
  for (const [name, k] of [['E1', 'e1'], ['E2', 'e2'], ['E3', 'e3']]) {
    console.log(`  ${name}: 净 ${usum(k) >= 0 ? '+' : ''}${usum(k).toFixed(3)} BNB | 赢 ${uwins(k)}/${uniq.length}（${uniq.length ? (uwins(k) / uniq.length * 100).toFixed(1) : 0}%）| 均值 ${uniq.length ? (usum(k) / uniq.length).toFixed(4) : 0}`);
  }

  // 按实验分组
  const byExp = new Map();
  for (const r of fired) {
    if (!byExp.has(r.expId)) byExp.set(r.expId, { n: 0, e1: 0, e2: 0, e3: 0, symbol: r.symbol });
    const g = byExp.get(r.expId);
    g.n++; g.e1 += r.result.e1; g.e2 += r.result.e2; g.e3 += r.result.e3;
  }
  console.log('\n-- 按实验（只列触发数>0）--');
  for (const [expId, g] of [...byExp.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${expId.slice(0, 8)} 触发 ${String(g.n).padStart(3)} | E1 ${g.e1 >= 0 ? '+' : ''}${g.e1.toFixed(3)} | E2 ${g.e2 >= 0 ? '+' : ''}${g.e2.toFixed(3)} | E3 ${g.e3 >= 0 ? '+' : ''}${g.e3.toFixed(3)}`);
  }

  // 明细 top/bottom
  const sorted = [...fired].sort((a, b) => a.result.e1 - b.result.e1);
  console.log('\n-- E1 最差 5 --');
  for (const r of sorted.slice(0, 5)) console.log(`  ${beijing(r.t0)} ${r.symbol} ${r.token.slice(0, 10)} 延迟${r.result.trigDelaySec}s E1=${r.result.e1.toFixed(3)} E3=${r.result.e3.toFixed(3)} ${r.expId.slice(0, 8)}`);
  console.log('-- E1 最好 5 --');
  for (const r of sorted.slice(-5).reverse()) console.log(`  ${beijing(r.t0)} ${r.symbol} ${r.token.slice(0, 10)} 延迟${r.result.trigDelaySec}s E1=${r.result.e1.toFixed(3)} E3=${r.result.e3.toFixed(3)} ${r.expId.slice(0, 8)}`);

  if (JSON_OUT) {
    const fs = require('fs');
    fs.writeFileSync(JSON_OUT, JSON.stringify({ params: { REBOUND_PCT, TRIGGER_WINDOW_MS, DATA_WINDOW_MS, MIN_TICKS_30S, STAKE_BNB }, summary: { total: results.length, noTicks, fired: fired.length }, results }, null, 1));
    console.log(`\n明细已写 ${JSON_OUT}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
