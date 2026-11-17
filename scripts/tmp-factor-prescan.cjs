// T143 因子购买前检查门·升格命中面预扫描（2026-11-15，182 跑）——全案 gate：
// 对 bt-v129（4af09d63）全部 BUY 信号时刻重放 FP1 判定（PVP 判定树+CD 四臂），
// 输出命中清单×基线净额（Newly-blocked=因子拒 ∧ 基线 executed）、duanju 验收行、
// CD401 裸 A 变体面（无代理腿）并列。误伤净负 → 停下汇报（计划 gate 条款）。
const path = require('path');
const { dbManager } = require('../src/services/dbManager.js');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const FPC = require('../src/market-analysis/factor-pre-buy-check.js');

const EXP_PRE = process.argv[2] || '4af09d63';

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id,experiment_name').limit(500);
  const exp = exps.find((e) => e.id.startsWith(EXP_PRE));
  if (!exp) throw new Error('实验未找到: ' + EXP_PRE);
  // 同源拉数（借 service 私有方法=生产路径 bit 一致；persist:false 不落表）
  const svc = new BuyPointCheckService({ persist: false }, { info() {}, warn() {}, error() {} }, { dbClient: c });

  // ① 全部 BUY 信号
  let sigs = [], from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals')
      .select('token_address,token_symbol,created_at,executed,er:metadata->>execution_reason')
      .eq('experiment_id', exp.id).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    sigs = sigs.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`bt-v129 BUY 信号 ${sigs.length} 行`);

  // ② 基线 per-token 净额
  let tr = [], from2 = 0;
  while (true) {
    const { data, error } = await c.from('trades')
      .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
      .eq('experiment_id', exp.id).range(from2, from2 + 999);
    if (error) throw new Error(error.message);
    tr = tr.concat(data);
    if (data.length < 1000) break;
    from2 += 1000;
  }
  const net = new Map();
  for (const t of tr) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = net.get(t.token_address);
    if (!e) { e = { buyBnb: 0, sellBnb: 0 }; net.set(t.token_address, e); }
    if (buy) e.buyBnb += v; else e.sellBnb += v;
  }
  for (const [k, e] of net) e.net = e.sellBnb - e.buyBnb;

  // ③ 逐信号重放（去重：同 token 多信号全评，票级结论=任一信号时刻放行即放行——
  //    门链每信号独立评，票级 Newly-blocked=全部信号均因子拒 ∧ 基线 executed）
  const byToken = new Map();
  let n = 0;
  for (const s of sigs) {
    n++;
    if (n % 150 === 0) console.log(`  … ${n}/${sigs.length}`);
    let rec = byToken.get(s.token_address);
    if (!rec) { rec = { sym: s.token_symbol, baseExec: false, baseEr: new Set(), sigN: 0, passAny: false, reasons: new Set(), lastTrace: null }; byToken.set(s.token_address, rec); }
    rec.sigN++;
    if (s.executed) rec.baseExec = true;
    if (s.er) rec.baseEr.add(s.er);
    const anchorMs = new Date(s.created_at).getTime();
    try {
      const pull = await svc._pullTicksDb(s.token_address, anchorMs);
      if (!pull.rows.length || pull.anchorTickCount < 6) continue; // minTicks 预门同语义
      const meta = svc._normalizeMeta(s.token_address, { symbol: s.token_symbol, platform: null, createdAtMs: null }, pull, null);
      const snapshot = buildBuyPointSnapshot(pull.rows, meta, {});
      const r = FPC.evaluateFactorPreBuy(snapshot);
      // CD401 裸 A 变体（无代理腿）单独记录
      const cd = snapshot.cheatDerived || {};
      const bare401 = (typeof cd.burstWaveSegSellPct === 'number' && cd.burstWaveSegSellPct >= 30
        && typeof cd.burstWaveSegSellBnb === 'number' && cd.burstWaveSegSellBnb >= 0.3);
      if (r.pass) rec.passAny = true;
      else rec.reasons.add(r.reason);
      rec.lastTrace = { branch: r.pvp.branch, t: { volSingle: r.trace.volSingle, act20: r.trace.act20, act30: r.trace.act30, sell60: r.trace.sell60, hold: r.trace.holdersHolding, absA: r.trace.absorbAlive, absZ: r.trace.absorbZero }, arms: r.arms };
      if (bare401) rec.bare401 = true;
    } catch (e) {
      rec.errors = (rec.errors || 0) + 1;
    }
  }

  // ④ 汇总
  const tokens = [...byToken.entries()];
  const blocked = tokens.filter(([k, r]) => !r.passAny && r.sigN > 0 && r.reasons.size > 0);
  const newly = blocked.filter(([k, r]) => r.baseExec);
  const newlyCost = newly.reduce((s, [k, r]) => s + (net.get(k) ? net.get(k).net : 0), 0);
  console.log(`\n===== 票级汇总（token=${tokens.length}）=====`);
  console.log(`因子门全拒票 ${blocked.length}；其中基线 executed（Newly-blocked）${newly.length} 张，基线净额合计 ${newlyCost >= 0 ? '+' : ''}${newlyCost.toFixed(4)}`);
  console.log(`（负值=拦掉的票基线在亏=止血；正值=误伤成本）`);
  const armCnt = new Map();
  for (const [, r] of tokens) for (const a of (r.lastTrace ? r.lastTrace.arms : []) || []) armCnt.set(a, (armCnt.get(a) || 0) + 1);
  const pvpCnt = new Map();
  for (const [, r] of tokens) for (const x of r.reasons) pvpCnt.set(x, (pvpCnt.get(x) || 0) + 1);
  console.log('拒因分布（票级，含基线也被拒的票）:', [...pvpCnt.entries()].map(([k, v]) => k + ':' + v).join(' '));
  console.log('CD 臂命中（信号级 lastTrace）:', [...armCnt.entries()].map(([k, v]) => k + ':' + v).join(' ') || '无');
  const bareN = tokens.filter(([, r]) => r.bare401).length;
  console.log(`CD401 裸 A 面（无代理腿）票数: ${bareN}`);
  console.log('\n== Newly-blocked 明细（因子拒 ∧ 基线买） ==');
  for (const [k, r] of newly.sort((a, b) => (net.get(a[0])?.net || 0) - (net.get(b[0])?.net || 0)))
    console.log(`  基线净${(net.get(k)?.net ?? NaN) >= 0 ? '+' : ''}${(net.get(k)?.net ?? 0).toFixed(4)}  ${(r.sym || '?').slice(0, 12).padEnd(13)} ${[...r.reasons].join(',')} ${k}`);
  console.log('\n== 因子拒+基线也拒（双拒=省 Jev 面） ==');
  const both = blocked.filter(([k, r]) => !r.baseExec);
  console.log(`  ${both.length} 张（拒因并集 ${new Set(both.flatMap(([, r]) => [...r.reasons])).size} 种）`);
  console.log('\n== duanju 0x65aebe91 验收 ==');
  const dj = byToken.get('0x65aebe91f87b3b8f94e8061f2fa578d7ed8577777');
  if (dj) console.log(`  passAny=${dj.passAny} reasons=${[...dj.reasons].join(',') || '-'} trace=${JSON.stringify(dj.lastTrace)}`);
  else console.log('  （该票不在信号集？）');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
