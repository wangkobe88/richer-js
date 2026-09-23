#!/usr/bin/env node
// ============================================================================
// 聪明钱挖掘结果对账（verify）——pumpfun-wss-trader 同名脚本 BSC 移植（批 3.2）
//
// 独立路径复核 mine-smart-wallets.cjs 产出的 smart-wallets-{ts}.json：
//   1 锚点硬检查（anchors 全 found 且入榜；无锚点 → skip 不算 fail）
//   2 PnL 抽样重算（独立 DB 路径拉 trader+token 全 tick 重折叠 + token 级 mark 独立重算，
//     与 JSON detail 的 net/buyBnb 对拍，容差 TOL=6e-4 BNB）
//   3 流量交叉检查（outlier 占比 / 价量恒等式 / 覆盖窗结构）
//   4 mark 合理性（★BSC：tick 内含 FX=median(price_usd/price_bnb) 替代母版 sol_price_cache，
//     mark×FX×totalSupply 不得高于 token_profiles.peak_mcap_usd×1.05——毒价虚高在此现形）
//   5 A/B / 零假设 / 协作环 / verdict 结构复核
//   6 bscscan URL 清单（人工抽查入口）
//
// 纯函数走 mine-smart-wallets.cjs 同一代码路径（require 复用）——对账的是数据与管线，
// 不是"另写一份公式"。
//
// 查询量：sample≤12 对 ×(4000+500) tick + 少量单行读取——建议 182 跑（本地 VPN 慢但量级可容忍）。
//
// 用法：node scripts/smart-wallet-mining/verify-smart-wallets.cjs --json data/smart-wallets-XXX.json [--sample 12]
//   缺省 --json 取 data/ 下最新 smart-wallets-*.json。任一 fail 退出码 1。
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../..', 'config/.env') });
const {
  computePairPnL, classifyCarryIn, selectMark,
} = require('./mine-smart-wallets.cjs');

const TOL = 6e-4; // PnL / buyBnb 对拍绝对容差（BNB）
const TICK_COLS = 'token_address,trader_address,trade_type,bnb_amount,token_amount,price_bnb,price_usd,price_outlier,block_number,block_time,experiment_id';

function parseVerifyArgs(argv) {
  const a = argv || process.argv.slice(2);
  const o = { json: null, sample: 12, seed: 42 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--json') o.json = a[++i];
    else if (a[i] === '--sample') o.sample = parseInt(a[++i], 10);
    else if (a[i] === '--seed') o.seed = parseInt(a[++i], 10);
    else { console.error(`未知参数: ${a[i]}`); process.exit(1); }
  }
  if (!o.json) {
    const dir = path.join(__dirname, '../..', 'data');
    const cands = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^smart-wallets-.*\.json$/.test(f)).sort() : [];
    if (!cands.length) { console.error('未指定 --json 且 data/ 下无 smart-wallets-*.json'); process.exit(1); }
    o.json = path.join(dir, cands[cands.length - 1]);
  }
  return o;
}

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); console.log(`  ${ok === 'skip' ? '○' : (ok ? '✅' : '❌')} ${name}${detail ? ` | ${detail}` : ''}`); }
const id8 = u => String(u).slice(0, 8);

async function main() {
  const opt = parseVerifyArgs();
  const R = JSON.parse(fs.readFileSync(opt.json, 'utf8'));
  const params = R._meta && R._meta.params ? R._meta.params : {};
  const minTickBnb = params.minTickBnb != null ? params.minTickBnb : 0.002;
  const carryinTol = params.carryinTol != null ? params.carryinTol : 0.01;
  const costPerSide = params.costPerSide != null ? params.costPerSide : 0.03;
  console.log(`对账 ${path.basename(opt.json)}（生成于 ${R._meta ? R._meta.generatedAt : '?'}，源 ${R.sources ? R.sources.length : 0} 个）`);

  const { dbManager } = require('../../src/services/dbManager');
  const sb = dbManager.getClient();
  const srcIds = (R.sources || []).map(s => s.id);

  // ── token 元数据缓存（experiment_tokens totalSupply / token_profiles peak） ──
  const tmetaCache = new Map();
  async function tokenMeta(tk) {
    if (tmetaCache.has(tk)) return tmetaCache.get(tk);
    let creator = null, supply = 0, peak = null;
    const { data: et } = await sb.from('experiment_tokens')
      .select('token_address,creator_address,raw_api_data,created_at')
      .in('experiment_id', srcIds).eq('token_address', tk)
      .order('created_at', { ascending: false }).limit(1);
    if (et && et[0]) {
      creator = et[0].creator_address || null;
      const ts = Number(et[0].raw_api_data && et[0].raw_api_data.totalSupply);
      supply = Number.isFinite(ts) && ts > 0 ? ts : 0;
    }
    const { data: tp } = await sb.from('token_profiles').select('peak_mcap_usd').eq('token_address', tk).limit(1);
    if (tp && tp[0] && tp[0].peak_mcap_usd != null && Number.isFinite(+tp[0].peak_mcap_usd)) peak = +tp[0].peak_mcap_usd;
    const v = { creator, supply, peak };
    tmetaCache.set(tk, v);
    return v;
  }

  // ── 独立路径：token 级 mark（500 recent desc reversed，client-side 滤 outlier/尘/px>0） ──
  async function tokenMark(tk) {
    const { data } = await sb.from('wss_price_ticks')
      .select('price_bnb,bnb_amount,price_outlier,block_time,block_number')
      .in('experiment_id', srcIds).eq('token_address', tk)
      .order('block_time', { ascending: false }).limit(500);
    if (!data || !data.length) return { mark: null, fx: null };
    const seq = data.slice().reverse();
    const pr = [];
    const ratios = [];
    for (const t of seq) {
      const px = +t.price_bnb, bnb = +t.bnb_amount || 0, usd = +t.price_usd;
      if (t.price_outlier || !(px > 0) || bnb < minTickBnb) continue;
      pr.push({ t: new Date(t.block_time).getTime(), k: t.block_number != null ? Number(t.block_number) : 0, p: px });
      if (Number.isFinite(usd) && usd > 0) ratios.push(usd / px);
    }
    ratios.sort((a, b) => a - b);
    const fx = ratios.length ? ratios[ratios.length >> 1] : null; // tick 内含 BNB/USD（中位抗噪）
    return { mark: selectMark(pr).mark, fx };
  }

  // ── 独立路径：pair 重折叠（与 foldTicks 同口径：outlier/尘滤、复合键首笔） ──
  function refoldPair(ticks) {
    const p = { bs: 0, ss: 0, bt: 0, st: 0, nb: 0, ns: 0, fbt: Infinity, fbk: Infinity, fst: Infinity, fsk: Infinity, ft: Infinity, fk: Infinity, ftp: '' };
    for (const t of ticks) {
      const isBuy = String(t.trade_type).toLowerCase() === 'buy';
      const ts = new Date(t.block_time).getTime();
      if (!Number.isFinite(ts)) continue;
      const slot = t.block_number != null ? Number(t.block_number) : 0;
      const bnb = +t.bnb_amount || 0;
      if (t.price_outlier) continue;
      if (bnb < minTickBnb) continue;
      if (isBuy) { p.bs += bnb; p.bt += (+t.token_amount || 0); p.nb++; if (ts < p.fbt || (ts === p.fbt && slot < p.fbk)) { p.fbt = ts; p.fbk = slot; } }
      else { p.ss += bnb; p.st += (+t.token_amount || 0); p.ns++; if (ts < p.fst || (ts === p.fst && slot < p.fsk)) { p.fst = ts; p.fsk = slot; } }
      if (ts < p.ft || (ts === p.ft && slot < p.fk)) { p.ft = ts; p.fk = slot; p.ftp = isBuy ? 'b' : 's'; }
    }
    return p;
  }

  // ═══ 1 锚点硬检查 ═══
  console.log('── 1) 锚点 ──');
  {
    const anchors = R.anchors || [];
    if (!anchors.length) record('锚点检查', 'skip', 'run 未提供 --anchor-wallets（名单置信靠本对账）');
    else {
      const bad = anchors.filter(x => !x.found || x.batch === '未入榜');
      record('锚点全入榜', bad.length === 0, bad.length ? bad.map(x => `${id8(x.address)}(${x.batch})`).join(',') : `${anchors.length} 个全命中`);
    }
  }

  // ═══ 2 PnL 抽样重算（独立 DB 路径） ═══
  console.log('── 2) PnL 抽样重算 ──');
  {
    const wallets = Object.entries(R.detail || {});
    const picked = wallets.slice(0, Math.min(opt.sample, wallets.length));
    let n = 0, fails = [];
    for (const [waddr, d] of picked) {
      for (const x of (d.pairs || []).slice(0, 2)) {
        n++;
        const { data: raw } = await sb.from('wss_price_ticks').select(TICK_COLS)
          .in('experiment_id', srcIds)
          .eq('token_address', x.token).eq('trader_address', waddr)  // 大小写敏感原样（DB 口径）
          .order('block_time', { ascending: true }).limit(4000);
        const p = refoldPair(raw || []);
        const carry = classifyCarryIn(p, carryinTol);
        if (carry) { fails.push(`${id8(waddr)}/${id8(x.token)} 重算出 carry=${carry}（detail 应为合格票）`); continue; }
        if (p.bs < (params.pairMinBuyBnb != null ? params.pairMinBuyBnb : 0.02)) { fails.push(`${id8(waddr)}/${id8(x.token)} 重算买额 ${r3v(p.bs)} 低于参与门`); continue; }
        const { mark } = await tokenMark(x.token);
        if (mark == null) { fails.push(`${id8(x.token)} mark 独立重算为 null`); continue; }
        const pnl = computePairPnL(p, mark, { costPerSide });
        if (Math.abs(pnl.net - x.net) > TOL) fails.push(`${id8(waddr)}/${id8(x.token)} net ${r6(pnl.net)} vs ${r6(x.net)}`);
        if (Math.abs(p.bs - x.buyBnb) > TOL) fails.push(`${id8(waddr)}/${id8(x.token)} buyBnb ${r6(p.bs)} vs ${r6(x.buyBnb)}`);
      }
    }
    record(`PnL 对拍（${n} 对，容差 ${TOL} BNB）`, fails.length === 0, fails.length ? `${fails.length} 不符: ${fails.slice(0, 3).join(' ; ')}` : '全部一致');
  }

  // ═══ 3 流量交叉检查 ═══
  console.log('── 3) 流量交叉 ──');
  {
    const tf = R.tickFilters || {};
    const total = (tf.ticks || 0) + (tf.outlier || 0) + (tf.dust || 0);
    const outlierShare = total ? (tf.outlier || 0) / total : 0;
    record('outlier 占比 < 50%', outlierShare < 0.5, `${(outlierShare * 100).toFixed(1)}%（${tf.outlier}/${total}）`);
    const idm = tf.identityChecked ? tf.identityMismatch / tf.identityChecked : 0;
    record('价量恒等式抽样不符率 < 1%', idm < 0.01, `${tf.identityMismatch}/${tf.identityChecked}=${(idm * 100).toFixed(2)}%`);
    const srcMin = Math.min(...(R.sources || []).filter(s => s.kept > 0).map(s => s.minT));
    const srcMax = Math.max(...(R.sources || []).filter(s => s.kept > 0).map(s => s.maxT));
    record('覆盖窗与源统计一致', R.globalWindow && R.globalWindow.min === srcMin && R.globalWindow.max === srcMax,
      `${R.globalWindow ? new Date(R.globalWindow.min).toISOString() : '?'} → ${R.globalWindow ? new Date(R.globalWindow.max).toISOString() : '?'}`);
    record('合格配对 > 0', (R.buckets || {}).qualified > 0, `qualified=${(R.buckets || {}).qualified}`);
  }

  // ═══ 4 mark 合理性（tick 内含 FX；无 sol_price_cache） ═══
  console.log('── 4) mark 合理性 ──');
  {
    const toks = new Set();
    for (const [, d] of Object.entries(R.detail || {})) for (const x of (d.pairs || []).slice(0, 1)) toks.add(x.token);
    const list = [...toks].slice(0, Math.min(opt.sample, toks.size));
    let n = 0, fails = [], fxOk = 0;
    for (const tk of list) {
      const { mark, fx } = await tokenMark(tk);
      if (mark == null) { fails.push(`${id8(tk)} mark null`); continue; }
      n++;
      if (fx != null && fx >= 50 && fx <= 20000) fxOk++;  // BNB/USD 物理域（宽松两个量级）
      else if (fx != null) fails.push(`${id8(tk)} FX=${r3v(fx)} 越域`);
      const { supply, peak } = await tokenMeta(tk);
      if (peak != null && supply > 0 && fx != null) {
        const mcapMark = mark * fx * supply;
        if (mcapMark > peak * 1.05) fails.push(`${id8(tk)} mark市值 ${r3v(mcapMark)} > peak ${r3v(peak)}×1.05（毒价嫌疑）`);
      }
    }
    record(`mark 市值 ≤ peak×1.05 / FX 域（${n} token）`, fails.length === 0, fails.length ? `${fails.length} 异常: ${fails.slice(0, 3).join(' ; ')}` : `FX 有效 ${fxOk}/${n}`);
  }

  // ═══ 5 A/B / 零假设 / 环 / verdict ═══
  console.log('── 5) A/B 结构 ──');
  {
    if (params.skipAb) record('A/B 复核', 'skip', 'run 带 --skip-ab');
    else if (!R.ab) record('A/B 报告存在', false, 'JSON 无 ab 字段');
    else {
      const ab = R.ab;
      const minA = params.abMinATokens != null ? params.abMinATokens : 30;
      const verdictOk = ab.metrics.nA < minA ? /^不确定/.test(ab.verdict) : /^(支持|部分支持|证伪)/.test(ab.verdict);
      record('verdict 与 nA 一致', verdictOk, `nA=${ab.metrics.nA}/${minA} → ${String(ab.verdict).slice(0, 40)}`);
      if (ab.metrics.nA >= minA && ab.metrics.survivalLift <= 0) record('非证伪时存活Δ>0', false, `survivalLift=${ab.metrics.survivalLift}`);
      else record('存活Δ方向与 verdict 一致', true);
      const ringListed = [...(R.batch1 || []), ...(R.batch2 || [])].filter(s => s.ringWith != null).length;
      record('协作环计数一致', ringListed === (ab.ringCount || 0), `listed 标注 ${ringListed} = ab.ringCount ${ab.ringCount || 0}`);
      if (ab.nullMetrics) record('零假设样本记录', ab.nullMetrics.wallets > 0 && ab.nullMetrics.wallets <= (params.nullSampleWallets || 300),
        `${ab.nullMetrics.wallets} 随机钱包 存活Δ=${fmtPct(ab.nullMetrics.metrics.survivalLift)}`);
      else record('零假设', 'skip', '无随机钱包样本');
      if (ab.truncated) console.log('  ⚠️ lead-lag T 集截断（truncated=true）——follow/lead 标注覆盖率下降');
    }
  }

  // ═══ 6 bscscan URL 清单 ═══
  console.log('── 6) bscscan 抽查入口 ──');
  {
    const top = (arr, label) => {
      const l = (arr || []).slice(0, 20);
      if (!l.length) return;
      console.log(`  [${label}]`);
      for (let i = 0; i < l.length; i++) console.log(`    ${i + 1}. https://bscscan.com/address/${l[i].address}  n=${l[i].n} win=${l[i].winRate} mean=${l[i].meanNet} ${l[i].notes || ''}`);
    };
    top(R.batch1, '批1 活跃持续盈利 Top20');
    top(R.batch2, '批2 稳准狠 Top20');
    const toks = new Set();
    for (const [, d] of Object.entries(R.detail || {})) for (const x of (d.pairs || []).slice(0, 1)) toks.add(x.token);
    for (const tk of [...toks].slice(0, 10)) console.log(`    token https://bscscan.com/token/${tk}`);
    record('bscscan 清单打印', true);
  }

  const fails = results.filter(r => r.ok === false).length;
  console.log(`\n对账结果：${results.length - fails} 通过 / ${fails} 失败${fails === 0 ? ' ✅' : ' ❌'}`);
  process.exit(fails ? 1 : 0);
}

const r3v = x => Math.round(x * 1000) / 1000;
const r6 = x => Math.round(x * 1e6) / 1e6;
const fmtPct = x => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a');

if (require.main === module) {
  main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
}
module.exports = { parseVerifyArgs };
