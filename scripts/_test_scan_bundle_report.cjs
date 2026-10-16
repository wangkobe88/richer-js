#!/usr/bin/env node
/**
 * scan-bundle-clusters 报告数理 + 源码口径离线单测——本地零 DB 零网络
 * （扫描本体在 182 跑；本测锁定：行映射/链序/Spearman/分布/对拍 A 十分位/
 * 对拍 B 混淆矩阵/误报面过滤/GMGN 响应形状 fail-loud/红线源码断言）。
 *
 * 用法：node scripts/_test_scan_bundle_report.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const scan = require(path.join(ROOT, 'scripts', 'scan-bundle-clusters.cjs'));
const { rowToTick, cmpChain, spearman, pct, mean, extractHolderAddresses, buildReport } = scan;

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const KEYS = ['bundleClusterSize', 'bundleClusterSharePct', 'bundleClusterAmountRatio',
  'bundleClusterEvenGap', 'bundleClusterSameTrader', 'maxBlockBuyCircPct'];

// ═══ A. rowToTick（BacktestEngine 684-699 同款映射）═══
console.log('A. rowToTick 行映射');
{
  const row = {
    id: 7, token_address: '0xt', trade_type: 'buy', trader_address: '0xtr',
    sender_address: null, price_bnb: '0.000001', price_usd: null,
    bnb_amount: '0.5', token_amount: '500000', block_number: 123, block_time: '2026-10-16T00:00:00Z',
    tx_hash: '0xhash', log_index: 4, price_outlier: true, platform: 'fourmeme',
  };
  const tk = rowToTick(row);
  check('A1 字段逐一映射（Number 强转 / null USD 透传 / sender null 保 null）', () => {
    assert.strictEqual(tk.token_address, '0xt');
    assert.strictEqual(tk.sender_address, null);
    assert.strictEqual(tk.price_bnb, 0.000001);
    assert.strictEqual(tk.price_usd, null);
    assert.strictEqual(tk.bnb_amount, 0.5);
    assert.strictEqual(tk.token_amount, 500000);
    assert.strictEqual(tk.block_number, 123);
    assert.strictEqual(tk.timestamp, new Date('2026-10-16T00:00:00Z').getTime());
    assert.strictEqual(tk.log_index, 4);
    assert.strictEqual(tk.price_outlier, true);
  });
  check('A2 offers/funds_bnb 刻意不传（回测口径对齐——传了会 tvl 分叉）', () => {
    assert.ok(!('offers' in tk) && !('funds_bnb' in tk));
  });
  const tk2 = rowToTick({ ...row, sender_address: '' });
  check('A3 空 sender 归一 null（|| 语义）', () => assert.strictEqual(tk2.sender_address, null));
}

// ═══ B. cmpChain 链上真序 ═══
console.log('B. cmpChain 链序');
{
  const mk = (b, l, id) => ({ block_number: b, log_index: l, id });
  check('B1 block 优先 → log_index → id 三级', () => {
    assert.ok(cmpChain(mk(1, 5, 9), mk(2, 0, 1)) < 0);
    assert.ok(cmpChain(mk(1, 5, 9), mk(1, 6, 1)) < 0);
    assert.ok(cmpChain(mk(1, 5, 9), mk(1, 5, 10)) < 0);
    assert.strictEqual(cmpChain(mk(1, 5, 9), mk(1, 5, 9)), 0);
  });
}

// ═══ C. Spearman ═══
console.log('C. Spearman 秩相关');
{
  check('C1 完全单调 = 1', () => assert.ok(Math.abs(spearman([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-12));
  check('C2 完全反向 = -1', () => assert.ok(Math.abs(spearman([1, 2, 3, 4], [40, 30, 20, 10]) + 1) < 1e-12));
  check('C3 并列平均秩（[1,1,2] vs [1,2,3] ρ≈0.866）', () => {
    const r = spearman([1, 1, 2], [1, 2, 3]);
    assert.ok(Math.abs(r - 0.8660254037844387) < 1e-9, `got ${r}`);
  });
  check('C4 恒定序列（零方差）→ null 非 NaN', () => assert.strictEqual(spearman([1, 1, 1], [1, 2, 3]), null));
  check('C5 n<3 → null', () => assert.strictEqual(spearman([1, 2], [2, 1]), null));
}

// ═══ D. pct/mean ═══
console.log('D. pct/mean');
{
  check('D1 pct 插值位置（p50/p100）', () => {
    assert.strictEqual(pct([3, 1, 2], 50), 2);
    assert.strictEqual(pct([3, 1, 2], 100), 3);
    assert.strictEqual(pct([], 50), null);
  });
  check('D2 mean 空数组 null', () => assert.strictEqual(mean([]), null));
}

// ═══ E. extractHolderAddresses（GMGN 形状 fail-loud；字段=实测 address 非文档 wallet_address）═══
console.log('E. GMGN top holders 响应形状');
{
  const resp = { list: [
    { address: '0xAA', amount_percentage: 12.5 },
    { address: '0xBB', amount_percentage: 8 },
  ] };
  check('E1 data.list[].address 提取 + 小写归一（2026-10-16 BITCAT probe 实测形状）', () =>
    assert.deepStrictEqual(extractHolderAddresses(resp), ['0xaa', '0xbb']));
  check('E2 空 list = 空数组（无 bundler 是合法答案）', () =>
    assert.deepStrictEqual(extractHolderAddresses({ list: [] }), []));
  check('E3 缺 list / 行缺 address → throw fail-loud（无兜底——形状漂移必须炸，BITCAT probe 抓到的静默空数组陷阱反证）', () => {
    assert.throws(() => extractHolderAddresses({ holders: [] }), /形状异常/);
    assert.throws(() => extractHolderAddresses(null), /形状异常/);
    assert.throws(() => extractHolderAddresses({ list: [{ wallet_address: '0xX' }] }), /缺 address/);
  });
}

// ═══ F. buildReport 端到端（伪造 samples/narrative/gmgn）═══
console.log('F. buildReport 端到端');
{
  const mkSampleRec = (token, samples) => ({
    token, platform: 'fourmeme', blockTime: '2026-10-10T00:00:00Z',
    firstTickTs: 1, tickRows: 100, dustSkipped: 0, fires: 0, firesBeyondRange: 0, samples,
  });
  const mkEval = (size, share, extra = {}) => Object.assign({
    win: 10000, bundleClusterSize: size, bundleClusterSharePct: share,
    bundleClusterAmountRatio: 1, bundleClusterEvenGap: 1, bundleClusterSameTrader: 100,
    maxBlockBuyCircPct: 40, blk: 999, windowBuyBnb: 1, circTokens: 1e6,
  }, extra);
  const ev = (o) => ({ w10000: Object.assign(mkEval(0, 0), o), w30000: Object.assign(mkEval(0, 0), o), w60000: Object.assign(mkEval(0, 0), o) });

  // ── 场景 1（纯净阶梯，对拍 A 专用）：20 票 share=i（i=0,1 伪装无 bundler 段）──
  const ladder = [];
  const ladderNarr = new Map();
  for (let i = 0; i < 20; i++) {
    const tok = `0xg${i.toString(16)}`;
    const bundlers = i <= 1 ? 0 : i;   // 首桶两票 bundlers=0（pbPos=0 的手造前提）
    ladder.push(mkSampleRec(tok, [
      { kind: 'age10', ts: 10, evals: ev({ bundleClusterSize: i, bundleClusterSharePct: i }) },
    ]));
    ladderNarr.set(tok, { bundlerWallets: bundlers, topWallets: 20 });   // fetchNarrativeGmgn 已剥 .risk（提取产物直用）
  }
  const r1 = buildReport(ladder, ladderNarr, null);

  check('F1 distribution 三窗齐全 + 分位键在场', () => {
    for (const w of ['w10000', 'w30000', 'w60000']) {
      const e = r1.sections.distribution[w];
      assert.strictEqual(e.tokenCount, 20);
      assert.ok('p95' in e.maxSharePct && 'p99' in e.maxSize && 'p95' in e.maxCircPct);
    }
  });
  check('F2 对拍 A ρ(share,ratio)≈1（阶梯单调；i<=1 双零并列的秩并列惩罚是数学预期）+ 十分位 10 桶', () => {
    for (const w of [10000, 30000, 60000]) {
      const v = r1.sections.pairingA.windows[w];
      assert.ok(v.spearmanVsRatio > 0.99, `w${w} got ${v.spearmanVsRatio}`);
      assert.strictEqual(v.deciles.length, 10);
      assert.strictEqual(v.deciles.reduce((s, d) => s + d.n, 0), v.n);
    }
  });
  check('F3 十分位首桶 pbPos=0% 末桶=100%（分层方向性）', () => {
    const v = r1.sections.pairingA.windows[10000];
    assert.strictEqual(v.deciles[0].pbPos, 0);
    assert.strictEqual(v.deciles[9].pbPos, 100);
  });
  check('F4 gmgn=null 时无 pairingB 段（--skip-api 无 checkpoint 形状）', () =>
    assert.ok(!('pairingB' in r1.sections)));
  check('F5 窗一致性 ρ=1（三窗同值阶梯）', () => {
    for (const v of Object.values(r1.sections.windowStability)) {
      assert.ok(Math.abs(v - 1) < 1e-9, `got ${v}`);
    }
  });

  // ── 场景 2（混淆矩阵 4 票，对拍 B/误报面专用）──
  const W5 = ['0xt1a', '0xt1b', '0xt1c', '0xt1d', '0xt1e'];
  const W4 = ['0xt2a', '0xt2b', '0xt2c', '0xt2d'];
  const mix = [
    mkSampleRec('0xt1', [{ kind: 'age30', ts: 30, evals: ev({ bundleClusterSize: 5, bundleClusterSharePct: 60, wallets: W5 }) }]), // flagged TP
    mkSampleRec('0xt2', [{ kind: 'age30', ts: 30, evals: ev({ bundleClusterSize: 4, bundleClusterSharePct: 55, wallets: W4 }) }]), // flagged FP（误报面）
    mkSampleRec('0xt3', [{ kind: 'age10', ts: 10, evals: ev({ bundleClusterSize: 1, bundleClusterSharePct: 10 }) }]),              // 漏拦
    mkSampleRec('0xt4', [{ kind: 'age10', ts: 10, evals: ev({ bundleClusterSize: 1, bundleClusterSharePct: 8 }) }]),               // TN
  ];
  const mixNarr = new Map([
    ['0xt1', { bundlerWallets: 5, topWallets: 20 }],
    ['0xt2', { bundlerWallets: 0, topWallets: 20 }],
    ['0xt3', { bundlerWallets: 3, topWallets: 20 }],
    // 0xt4 无叙事行（narrative miss 不进对拍 A/误报面）
  ]);
  const mixGmgn = new Map([
    ['0xt1', { token: '0xt1', ok: true, bundlers: W5 }],          // 5/5 全命中
    ['0xt2', { token: '0xt2', ok: true, bundlers: [] }],
    ['0xt3', { token: '0xt3', ok: true, bundlers: ['0xz1', '0xz2', '0xz3'] }],
    ['0xt4', { token: '0xt4', ok: true, bundlers: [] }],
  ]);
  const r2 = buildReport(mix, mixNarr, mixGmgn);

  check('F6 对拍 B 簇行 precision/coverage（0xt1=1/1；0xt2=0 → meanPrecision=0.5）', () => {
    const rows = r2.sections.pairingB.perWin.w10000.rows;
    const t1 = rows.find(r => r.token === '0xt1'), t2 = rows.find(r => r.token === '0xt2');
    assert.strictEqual(t1.hits, 5);
    assert.ok(Math.abs(t1.precision - 1) < 1e-9);
    assert.ok(Math.abs(t1.coverage - 1) < 1e-9);
    assert.strictEqual(t2.hits, 0);
    assert.ok(Math.abs(r2.sections.pairingB.perWin.w10000.meanPrecision - 0.5) < 1e-9);
  });
  check('F7 混淆矩阵手算对拍（X=50,N=3,truth=1：flagged=2 truthPos=2 tp=1 → P=50% R=50%）', () => {
    const s = r2.sections.pairingB.perWin.w10000.thresholdSweep
      .find(x => x.X === 50 && x.N === 3 && x.truthMin === 1);
    assert.strictEqual(s.flagged, 2);   // 0xt1(60,5) + 0xt2(55,4)
    assert.strictEqual(s.truthPos, 2);  // 0xt1(5) + 0xt3(3)
    assert.strictEqual(s.tp, 1);
    assert.ok(Math.abs(s.precision - 50) < 0.01);
    assert.ok(Math.abs(s.recall - 50) < 0.01);
  });
  check('F8 阈值候选=36 组合（X∈{30,40,50}×N=5 与 X=60×N∈{3,4,5} 均单拦 0xt1 P=100）', () => {
    const c = r2.sections.thresholdCandidates;
    // 每窗 12（X=30/40/50 时 N=5 把 0xt2(size4) 挡掉只剩 0xt1；X=60 时任意 N≥3 都只剩 0xt1）
    // × truthMin∈{1,3} × 3 窗 = 36
    assert.strictEqual(c.length, 36);
    assert.ok(c.every(x => x.precision >= 70 && x.recall >= 50));
    assert.ok(c.every(x => x.flagged === 1 && x.tp === 1));
    assert.ok(c.some(x => x.X === 60 && x.N === 3 && x.truthMin === 1));
  });
  check('F9 误报面只收 bundlers===0（0xt2 在场，0xt1/0xt3 不在；wallets 截 8）', () => {
    const fp = r2.sections.falsePositiveFace;
    assert.ok(fp.top20.some(x => x.token === '0xt2'));
    assert.ok(!fp.top20.some(x => x.token === '0xt1'));
    assert.ok(!fp.top20.some(x => x.token === '0xt3'));
    assert.ok(fp.top20[0].wallets.length <= 8);
  });
  check('F10 gmgn ok=false 票不进对拍 B（0xt1 剔除；0xt2 ok=true 仍在 → rows=1）', () => {
    const g2 = new Map([['0xt1', { token: '0xt1', ok: false, error: 'x' }], ['0xt2', { token: '0xt2', ok: true, bundlers: [] }]]);
    const r3 = buildReport(mix, mixNarr, g2);
    assert.strictEqual(r3.sections.pairingB.ok, 1);
    assert.strictEqual(r3.sections.pairingB.perWin.w10000.clusterRows, 1);
    assert.strictEqual(r3.sections.pairingB.perWin.w10000.rows[0].token, '0xt2');
    assert.strictEqual(r3.sections.pairingB.perWin.w10000.gmgnOkTokens, 1); // 0xt3/0xt4 gmgn miss 同样不进
    assert.ok(r3.sections.pairingB.perWin.w10000.thresholdSweep.length > 0);
  });
}

// ═══ G. 源码口径断言（红线）═══
console.log('G. 源码口径断言');
{
  const src = read('scripts/scan-bundle-clusters.cjs');
  check('G1 尘 tick 过滤口径 = collector minTickBnb（0.001，非另设常数语义）', () => {
    assert.ok(src.includes('const MIN_TICK_BNB = 0.001'));
    assert.ok(/tk\.bnb_amount < MIN_TICK_BNB/.test(src));
  });
  check('G2 拉 ticks 单 token eq + ORDER BY id（唯一允许形状；无 .in 于 wss_price_ticks）', () => {
    const i = src.indexOf("from('wss_price_ticks')");
    const seg = src.slice(i, src.indexOf('limit(PAGE)', i));
    assert.ok(seg.includes(".eq('token_address', token)"), '缺 token eq');
    assert.ok(seg.includes(".order('id'"), '缺 ORDER BY id');
    assert.ok(!seg.includes('.in('), 'wss_price_ticks 查询禁 .in 多值');
  });
  check('G3 dbManager service key（anon RLS 静默空红线）', () =>
    assert.ok(src.includes('dbManager.getClient()')));
  check('G4 拉取列与 BacktestEngine TICK_SELECT_COLUMNS 逐字一致', () => {
    const bt = read('src/trading-engine/implementations/BacktestEngine.js');
    const mBt = bt.match(/TICK_SELECT_COLUMNS\s*=\s*'([^']+)'/);
    const mScan = src.match(/TICK_COLS = '([^']+)'/);
    assert.ok(mBt && mScan, '常量未找到');
    assert.strictEqual(mScan[1].replace(/\s+/g, ''), mBt[1].replace(/\s+/g, ''));
  });
  check('G5 3 FA 实例 factorParams.bundleWinMs 按窗注入（窗长对比零口径漂移）', () =>
    assert.ok(/factorParams:\s*\{\s*bundleWinMs:\s*w\s*\}/.test(src)));
  check('G6 asOf 评估先喂 ts<=sample 全部 tick（防前视）', () =>
    assert.ok(/while \(j < ticks\.length && ticks\[j\]\.timestamp <= s\.ts\)/.test(src)));
  check('G7 token_narrative 批查 .in 批 50（URL 上限红线）', () =>
    assert.ok(/i \+= 50/.test(src) && src.includes(".in('token_address', batch)")));
  check('G8 GMGN 节拍 3s 起步 + 429 停等退避（ban 期续打延长 ban；1 req/s 实测 21 票即雪崩）', () => {
    assert.ok(/let gapMs = 3000/.test(src), '缺 3s 起步节拍');
    assert.ok(/BANNED_MAX/.test(src) && /320000/.test(src), '缺 BANNED_MAX 5 分钟停等');
    assert.ok(/gapMs \* 2/.test(src) && /Math\.min\(12000/.test(src), '缺节拍翻倍上限 12s');
    assert.ok(/attempt < 12/.test(src), '缺 429 重试上限');
  });
  check('G9 checkpoint 只认 ok 行（失败行剔除重写待重试——首跑 279 票灭于失败行进 done）', () => {
    assert.ok(/if \(j\.ok\)/.test(src) && /dropped\+\+/.test(src), '缺 ok 过滤+剔除重写');
  });
  check('G10 token_narrative.gmgn_info 剥 .risk（实存=extractGmgnRisk 提取产物非原始响应；二次提取全 null 事故反证）', () =>
    assert.ok(/gmgn_info && row\.gmgn_info\.risk/.test(src)));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
