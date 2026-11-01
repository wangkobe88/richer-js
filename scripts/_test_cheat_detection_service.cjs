#!/usr/bin/env node
/**
 * CheatCheckService 单测（CD1）——零 DB 零网络
 *
 * 打桩：dbClient（内存链式 builder，数据可热替换）/ loadLlm（假 JevClient）/
 * now（可控时钟）。覆盖：enabled 物化 / settle 后单查询锚 / minTicks 跳过不落表 /
 * 增量判定（0 新 tick=复用、+1∧间隔未到=限流、+1∧间隔已到=重析、≥delta 硬触发）/
 * 满帽（tail 锚+head 补充+水位增量）/ 预算顶帽（DB 计数起底）/ 超时行+迟到丢弃 /
 * 错误行烧预算 / 失败冷却 / ticks 拉取失败链内吞 / jev_prompt 首行全文 /
 * inflight join / 落库失败 loud 不抛 / capped→snapshot→state 全链透传 /
 * 引擎接线源码口径锁。失败 exit 非零。
 */

const fs = require('fs');
const path = require('path');
const { CheatCheckService } = require('../src/market-analysis/CheatCheckService');

let passed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error(`\n❌ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ✓ ${label}`);
}

// ── 内存 DB 桩：链式 builder（select/eq/order/limit/insert），holder 数据可热替换 ──
function makeDb({ ticks = [], cheatLatest = [], cheatCount = 0, failInsert = false, failTicks = false } = {}) {
  const holder = { ticks, cheatLatest, cheatCount, failInsert, failTicks };
  const state = { inserts: [], tickQueries: 0, headQueries: 0, latestQueries: 0, countQueries: 0 };
  function resultFor(table, ops) {
    if (table === 'wss_price_ticks') {
      state.tickQueries++;
      if (holder.failTicks) return { data: null, error: { message: 'db down' } };
      const limitOp = ops.find((o) => o[0] === 'limit');
      const limit = limitOp ? limitOp[1][0] : 1000;
      const orders = ops.filter((o) => o[0] === 'order');
      const asc = orders.length ? orders[0][1][1] && orders[0][1][1].ascending !== false : true;
      if (asc) state.headQueries++;
      const sorted = [...holder.ticks].sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
      const data = asc ? sorted.slice(0, limit) : sorted.slice(-limit).reverse();
      return { data, error: null };
    }
    // cheat_detection：count 查询 / 最新行查询 / insert
    if (ops.some((o) => o[0] === 'select' && o[1][1] && o[1][1].count === 'exact')) {
      state.countQueries++;
      return { count: holder.cheatCount, data: null, error: null };
    }
    state.latestQueries++;
    return { data: holder.cheatLatest, error: null };
  }
  const client = {
    from(table) {
      const ops = [];
      const p = {
        select: (...a) => { ops.push(['select', a]); return p; },
        eq: (...a) => { ops.push(['eq', a]); return p; },
        order: (...a) => { ops.push(['order', a]); return p; },
        limit: (...a) => { ops.push(['limit', a]); return p; },
        insert: (rows) => {
          ops.push(['insert', rows]);
          if (holder.failInsert) return Promise.resolve({ error: { message: 'insert rejected' } });
          state.inserts.push(...rows);
          return Promise.resolve({ error: null });
        },
        then: (res, rej) => Promise.resolve(resultFor(table, ops)).then(res, rej),
      };
      return p;
    },
  };
  return { client, state, holder };
}

// ── 行工厂（链上真序递增；2 tick/块）──
function genTicks(n, { startBlock = 100, senderPrefix = '0xw' } = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      block_time: new Date(1700000000000 + i * 2000).toISOString(),
      block_number: startBlock + Math.floor(i / 2), log_index: i % 2,
      trade_type: i % 3 === 2 ? 'sell' : 'buy',
      bnb_amount: 0.1, price_bnb: 1e-9, price_outlier: false,
      trader_address: `${senderPrefix}${i % 10}`.padEnd(42, '0'),
      sender_address: `${senderPrefix}${i % 10}`.padEnd(42, '0'),
      quote_token: null,
    });
  }
  return rows;
}

// D3.5 形状：4 现象 Choice 四档 + sbw 观察题 + activity_level 活跃度题（独立档域）
const LVL = ['none', 'weak', 'moderate', 'strong'];
function phAns(bucket, p = 0.78) {
  const rest = (1 - p) / 3;
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(LVL.map((b) => [b, b === bucket ? p : rest])) };
}
const ACT = ['low', 'mid', 'high', 'ultra'];
function actAns(bucket, p = 0.81) {
  const rest = (1 - p) / 3;
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(ACT.map((b) => [b, b === bucket ? p : rest])) };
}
// D3.8 捆绑题独立档域三桶
const BND = ['low', 'mid', 'high'];
function bdAns(bucket, p = 0.84) {
  const rest = (1 - p) / 2;
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(BND.map((b) => [b, b === bucket ? p : rest])) };
}
// D3.11 停滞突发波现象二分桶域（none/burst——只判有无；旧四档值与 burst_suspect/burst_cheat/burst_normal mapper 断代）
const SBW = ['none', 'burst'];
function sbwAns(bucket, p = 0.8) {
  const rest = 1 - p;
  return { type: 'choice', choice: bucket, probabilities: Object.fromEntries(SBW.map((b) => [b, b === bucket ? p : rest])) };
}
const GOOD_ANSWERS = {
  equal_amount_split: phAns('none'),
  coordinated_sell_back: phAns('weak'),
  creator_front_run: phAns('strong'),
  sell_dispersion: phAns('none'),
  stall_burst_wave: sbwAns('burst'),
  amount_tiering: phAns('strong'),
  same_block_buy_wave: phAns('strong'),
  activity_level: actAns('mid'),
  bundled_trade_dominance: bdAns('high'),
  insider_supply_sell: phAns('strong'),
};
function makeLlm({ answers = GOOD_ANSWERS, hang = false, reject = null } = {}) {
  const calls = { ask: 0 };
  return {
    mod: {
      JevClient: {
        ask: async () => {
          calls.ask++;
          if (hang) await new Promise(() => {});
          if (reject) throw new Error(reject);
          return { model: 'fake', answers, usage: { total: 1 } };
        },
      },
      buildCheatQuestions: () => ({ market_health_verdict: { type: 'choice' } }),
      CHEAT_QUESTIONS_VERSION: 'D3.26',
    },
    calls,
  };
}

const META = { address: '0xtok', symbol: 'S', name: 'S', platform: 'flap', createdAtMs: 1700000000000, creatorAddress: null };
function makeSvc(db, llm, config = {}, nowRef = { t: 1000000 }) {
  return new CheatCheckService(
    { enabled: true, settleDelayMs: 5, timeoutMs: 500, minIntervalMs: 60000, ...config },
    null,
    { dbClient: db.client, now: () => nowRef.t, loadLlm: async () => llm.mod },
  );
}

async function main() {
  // ═══════════════ A. enabled 物化 + sync 返回形状 ═══════════════
  console.log('A. enabled 物化语义');
  {
    const db = makeDb();
    const svc = new CheatCheckService({ enabled: false }, null, { dbClient: db.client });
    const r = svc.noteBuyPoint('0xtok', META, {});
    ok(r.status === 'disabled' && db.state.tickQueries === 0, '缺 enabled=true → disabled 零链路（新机制默认零影响）');
    ok(new CheatCheckService({}, null, { dbClient: db.client }).enabled === false, '空配置=关（物化语义）');
    ok(new CheatCheckService({ enabled: true }, null, { dbClient: db.client }).enabled === true, '显式 enabled=true=开');
  }

  // ═══════════════ B. 首析全链 + 落行形状 ═══════════════
  console.log('B. 首析全链');
  {
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm();
    const svc = makeSvc(db, llm);
    const info = svc.noteBuyPoint('0xTOK', META, { experimentId: 'exp-1' });
    ok(info.status === 'initiated' && typeof info.settleDelayMs === 'number', 'sync 返回 initiated（fire-and-forget 不阻塞买点）');
    await svc.drain(3000);
    ok(db.state.tickQueries === 1 && db.state.inserts.length === 1, `settle 后单次 tail 查询+落 1 行（tickQueries=${db.state.tickQueries}）`);
    const row = db.state.inserts[0];
    ok(row.token_address === '0xtok' && row.verdict === 'observed' && row.cheat_prob === null
      && row.pattern_type === null && row.retail_participation === undefined,
      `行字段：verdict='observed'/cheat_prob=null/pattern_type=null（D3.5 判定层停产；retail 列已停写=undefined；实际 ${row.verdict}/${row.cheat_prob}/${row.pattern_type}）`);
    ok(row.snapshot_digest.phenomena && row.snapshot_digest.phenomena.creator_front_run === 'strong'
      && row.snapshot_digest.extLevels.stall_burst_wave === 'burst'
      && row.snapshot_digest.extLevels.amount_tiering === 'strong'
      && row.snapshot_digest.extLevels.same_block_buy_wave === 'strong'
      && row.snapshot_digest.extLevels.insider_supply_sell === 'strong'
      && row.snapshot_digest.activityLevel.bucket === 'mid'
      && row.snapshot_digest.bundledDominance.bucket === 'high',
      `digest 落观测记录主体（phenomena/extLevels 含 sbw 现象二分/tiering/bw/insider/activityLevel/bd；实际 ${JSON.stringify(row.snapshot_digest.phenomena)}/${JSON.stringify(row.snapshot_digest.activityLevel)}）`);
    ok(row.snapshot_digest.anchors && row.snapshot_digest.anchors.equalBandHoldPct === 100,
      `snapshot_digest 落锚快照（数值透传；实际 ${JSON.stringify(row.snapshot_digest.anchors)}）`);
    ok(row.snapshot_digest.activity && typeof row.snapshot_digest.activity.ticksPerMin === 'number',
      'digest 保留代码活跃度原始数值（Jev 档位校准对照原料）');
    ok(row.jev_prompt.includes('[TICKS]') && row.jev_prompt.includes('截至第 20 笔')
      && !row.jev_prompt.includes('超拉数帽'), '首行落 jev_prompt 全文（锚声明在、未满帽无截断注记）');
    ok(row.question_version === 'D3.26' && row.anchor_tick_count === 20 && row.source_experiment_id === 'exp-1',
      'question_version/anchor/source_experiment_id');
    ok(row.snapshot_digest.tickCount === 20 && row.snapshot_digest.capped === false
      && row.snapshot_digest.watermark && row.snapshot_digest.buyBnb > 0,
      'snapshot_digest 锚+水位+资金摘要');
    ok(svc.stats.analyzed === 1 && svc.stats.rowsWritten === 1, 'stats.analyzed/rowsWritten');
  }

  // ═══════════════ C. minTicks 跳过（不调 Jev 不落表） ═══════════════
  console.log('C. minTicks 预门');
  {
    const db = makeDb({ ticks: genTicks(5) });
    const llm = makeLlm();
    const svc = makeSvc(db, llm, { minTicks: 8 });
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(llm.calls.ask === 0 && db.state.inserts.length === 0 && svc.stats.skippedInsufficientTicks === 1,
      '5<8 tick：零 Jev 零落表 skippedInsufficient=1（unclear 桶留给真判定）');
    const st = svc._lastAnalysis.get('0xtok');
    ok(st && st.lowTicks === true && st.anchorTickCount === 5, 'lowTicks 态入缓存（下轮 tick 补足可触发）');
  }

  // ═══════════════ D. 增量判定（时点性缓存核心） ═══════════════
  console.log('D. 增量判定');
  {
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm();
    const nowRef = { t: 1000000 };
    const svc = makeSvc(db, llm, {}, nowRef);
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 1, '首析落 1 行');

    // 同锚再买点：0 新 tick → 复用不重析
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 1 && svc.stats.cacheReused === 1, '0 新 tick=cacheReused（不烧配额）');
    ok(svc.noteBuyPoint('0xtok', META, {}).lastVerdict === 'observed', 'sync 轨迹带 lastVerdict=链终态 observed（进程内已知态）');

    // +1 tick 且间隔未到 → 限流不重析
    db.holder.ticks = genTicks(21);
    nowRef.t += 1000;
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 1 && svc.stats.cacheReused === 2, '+1 tick 且 age<minInterval → 限流不重析');

    // +1 tick 且间隔已到 → 重析（慢票 unhealthy→healthy 转化覆盖）
    nowRef.t += 60000;
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 2, '+1 tick 且 age≥minInterval → 重析');
    ok(db.state.inserts[1].jev_prompt === null && db.state.inserts[0].jev_prompt !== null,
      '二析行 jev_prompt=null（首行全文防线：多行历史无界增长）');

    // +≥delta(20) tick 无视间隔 → 硬触发
    db.holder.ticks = genTicks(45);
    nowRef.t += 1000; // 距上次仅 1s
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 3, '新tick≥delta(20) 无视间隔 → 硬触发（快票关键增量必析）');
    ok(db.state.inserts[2].anchor_tick_count === 45, '三析行锚=新锚 45');
  }

  // ═══════════════ E. 满帽拉数（capped）+ 水位增量 ═══════════════
  console.log('E. 满帽与水位');
  {
    const rows = genTicks(50);
    const db = makeDb({ ticks: rows });
    // headLimit/pullLimit 防呆下限=10（service num(v,dflt,10)），测试取合法小值
    const svc = makeSvc(db, makeLlm(), { pullLimit: 20, headLimit: 10 });
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    const row = db.state.inserts[0];
    ok(row.anchor_tick_count === 20 && row.snapshot_digest.capped === true, '满帽：anchor=tail 单查询行数 20+capped 标记');
    ok(db.state.headQueries === 1 && db.state.tickQueries === 2, '满帽才补 head 查询（launch 窗保留；tail+head 恰两次）');
    ok(row.jev_prompt.includes('超拉数帽') && row.jev_prompt.includes('截至第 20 笔'),
      'capped 全链透传：pull.capped→snapshot.capped→[ANCHOR] 截断声明');
    ok((row.jev_prompt.match(/^t\+\d+s /gm) || []).length === 30, '满帽窗口=head10+tail20=30 行进 state（[WALLETS] 的 @t+Ns 不计）');

    // 水位不变 → 0 新 tick（行数饱和不可信，水位承担增量）
    const svc2 = makeSvc(makeDb({ ticks: rows }), makeLlm(), { pullLimit: 20, headLimit: 10 });
    const lastRow = rows[rows.length - 1];
    const wm = { block: lastRow.block_number, log: lastRow.log_index, key: `${lastRow.block_number}:${lastRow.log_index}` };
    svc2._lastAnalysis.set('0xtok', { questionVersion: 'D3.26', anchorTickCount: 20, capped: true, watermark: wm, analyzedAt: 1000000 - 1000, verdict: 'observed' });
    svc2.noteBuyPoint('0xtok', META, {});
    await svc2.drain(3000);
    ok(svc2.stats.cacheReused === 1, '满帽水位不变=0 新 tick（不重析）');

    // 水位变化 → 按满值重析
    const rows2 = rows.concat(genTicks(2, { startBlock: 500 }));
    const svc3 = makeSvc(makeDb({ ticks: rows2 }), makeLlm(), { pullLimit: 20, headLimit: 10 });
    svc3._lastAnalysis.set('0xtok', { questionVersion: 'D3.26', anchorTickCount: 20, capped: true, watermark: wm, analyzedAt: 1000000 - 1000, verdict: 'observed' });
    svc3.noteBuyPoint('0xtok', META, {});
    await svc3.drain(3000);
    ok(svc3._analysisCount.get('0xtok') === 1 && svc3._lastAnalysis.get('0xtok').verdict === 'observed',
      '满帽水位变化=重析（量未知按满值处理，限流+顶帽兜底；重析后链终态=observed）');
  }

  // ═══════════════ F. 超时 / 错误 / 冷却 / 拉取失败 ═══════════════
  console.log('F. 失败语义');
  {
    // 超时：ask 永挂 → timeout 行
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ hang: true });
    const svc = makeSvc(db, llm, { timeoutMs: 40 });
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 1 && db.state.inserts[0].verdict === 'timeout'
      && db.state.inserts[0].fail_reason.includes('jev_timeout')
      && db.state.inserts[0].jev_prompt === null, '超时落 timeout 行带 fail_reason（无 prompt）');
    ok(svc.stats.timeouts === 1, 'stats.timeouts=1');
    // 冷却期内再买点：冷却短路在拉数前
    const pullsBefore = db.state.tickQueries;
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.tickQueries === pullsBefore && svc.stats.cooldownSkipped === 1, '失败冷却期内买点零拉数');
  }
  {
    // Jev 抛错 → error 行 + 烧预算
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ reject: 'boom' });
    const svc = makeSvc(db, llm);
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 1 && db.state.inserts[0].verdict === 'error'
      && db.state.inserts[0].fail_reason.includes('boom'), 'error 行带 fail_reason');
    ok((svc._analysisCount.get('0xtok') || 0) === 1, '失败也烧预算（防故障环）');
  }
  {
    // ticks 拉取失败：链内吞不抛（观察层纪律）
    const db = makeDb({ ticks: [], failTicks: true });
    const llm = makeLlm();
    const svc = makeSvc(db, llm);
    let threw = false;
    try { svc.noteBuyPoint('0xtok', META, {}); await svc.drain(3000); } catch (_) { threw = true; }
    ok(!threw && db.state.inserts.length === 0 && svc.stats.errors === 1, 'DB 拉取失败=链内吞不抛（errors 计数）');
  }

  // ═══════════════ G. 预算顶帽（DB 计数起底）+ bootstrap 连续性 ═══════════════
  console.log('G. 预算与 bootstrap');
  {
    // 增量已触发（+8 tick ∧ 间隔已过）但 DB 计数=顶帽 → 拒析
    const db = makeDb({
      ticks: genTicks(20), cheatCount: 20,
      cheatLatest: [{ verdict: 'unhealthy', anchor_tick_count: 12, analyzed_at: new Date(1000000 - 61000).toISOString(), snapshot_digest: { capped: false, watermark: null } }],
    });
    const svc = makeSvc(db, makeLlm(), { maxAnalysesPerToken: 20 });
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 0 && svc.stats.skippedQuota === 1 && db.state.countQueries >= 1,
      'DB 计数 20=顶帽耗尽 → 零 Jev（跨进程预算兜底；增量判定先于顶帽=触发后才见帽）');
    ok(db.state.latestQueries >= 1, '首触 bootstrap 查最新行');
  }
  {
    // bootstrap 续接：DB 最新行 40s 前、同锚 → 复用不重析
    const db = makeDb({
      ticks: genTicks(12), cheatCount: 1,
      cheatLatest: [{ verdict: 'unhealthy', anchor_tick_count: 12, analyzed_at: new Date(1000000 - 40000).toISOString(), snapshot_digest: { capped: false, watermark: null } }],
    });
    const svc = makeSvc(db, makeLlm(), {});
    svc.noteBuyPoint('0xtok', META, {});
    await svc.drain(3000);
    ok(db.state.inserts.length === 0 && svc.stats.cacheReused === 1,
      'bootstrap 续接跨进程缓存：同锚+间隔未满=复用（重启不重复烧）');
    ok(svc.noteBuyPoint('0xtok', META, {}).lastVerdict === 'unhealthy', 'lastVerdict 来自 DB bootstrap');
  }

  // ═══════════════ H. inflight join + 落库失败 + 引擎接线口径锁 ═══════════════
  console.log('H. join/落库失败/接线锁');
  {
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm();
    const svc = makeSvc(db, llm, { settleDelayMs: 60 });
    const i1 = svc.noteBuyPoint('0xtok', META, {});
    const i2 = svc.noteBuyPoint('0xtok', META, {});
    ok(i2.status === 'joined_inflight' && svc.stats.inflightJoined === 1, '相邻买点 inflight join（一条链盖住）');
    await svc.drain(3000);
    ok(db.state.inserts.length === 1 && llm.calls.ask === 1, 'join 后仍只析一次');
    ok(!('lastVerdict' in i1), '首买点无 lastVerdict');
  }
  {
    const db = makeDb({ ticks: genTicks(20), failInsert: true });
    const svc = makeSvc(db, makeLlm());
    let threw = false;
    try { svc.noteBuyPoint('0xtok', META, {}); await svc.drain(3000); } catch (_) { threw = true; }
    ok(!threw && svc.stats.writeFailed === 1, '落库失败=writeFailed 计数不抛（loud 留痕语义）');
  }
  {
    // 引擎接线源码口径锁（挂点位置/drain/metadata 轨迹三防线）
    const engineSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
    const hookIdx = engineSrc.indexOf('cheatCheckInfo = this._cheatCheckService.noteBuyPoint(tokenAddress');
    const gmgnIdx = engineSrc.indexOf("const gmgnCheckCondition = String(strategy.gmgnCheckCondition || '').trim();");
    ok(hookIdx > 0 && gmgnIdx > 0 && hookIdx < gmgnIdx, '挂点在 GMGN if 块之前（无 GMGN 条件腿照样观察）');
    ok(engineSrc.includes('await this._cheatCheckService.drain(5000)'), 'stop drain 接线在场');
    const spreadCount = (engineSrc.match(/\.\.\.\(cheatCheckInfo \? \{ cheatCheck: cheatCheckInfo \} : \{\}\)/g) || []).length;
    ok(spreadCount === 2, `拒买/通过双路径 metadata 均带 cheatCheck 轨迹（spread×${spreadCount}=2）`);
    ok(engineSrc.includes('this._mergedWsConfig().cheatCheck || {}'), 'config 走 _mergedWsConfig（flap/gang 实验同键生效）');
  }

  // ═══════════════ Z. G1 分级门（2026-11-01 用户裁定升级为买门） ═══════════════
  console.log('Z. G1 gateBuyPoint 分级门');
  {
    // Z1. cheat 首判：GOOD（tier/bw/rat 三 strong）→ A 通道拉黑 + 拉黑秒回零 Jev
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm();
    const svc = makeSvc(db, llm);
    const r1 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r1.status === 'analyzed' && r1.grade === 'cheat'
      && r1.reasons.some((x) => x.code.startsWith('A_strong')),
      `首判 cheat（A 通道 strong）+ reasons 留痕（实际 ${r1.grade}/${r1.reasons.map((x) => x.code).join(',')}）`);
    ok(svc.isGateBlocked('0xtok') === true, 'cheat → service 拉黑（isGateBlocked）');
    const before = llm.calls.ask;
    const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r2.status === 'graded' && r2.grade === 'cheat' && r2.blocked === true
      && llm.calls.ask === before && svc.stats.gateBlockedHits === 1,
      '拉黑秒回 grade=cheat blocked=true（零 Jev 配额）');
    ok(db.state.inserts.length === 1 && db.state.inserts[0].snapshot_digest.grade === 'cheat'
      && db.state.inserts[0].snapshot_digest.gradeVersion === 'G2'
      && Number.isFinite(db.state.inserts[0].snapshot_digest.anchorSellCount),
      'digest 落 grade/gradeVersion/anchorSellCount（重放对拍原料）');
    // Z1b 因子化（2026-11-01 用户指令）：analyzed 返回带 levels（11 题数值档，FA 出口
    // 原料）+ buckets（字符串原值）——GOOD 形状 tier/bw/rat strong=3、sbw burst=1、
    // cr strong=3（辅助判定照投影）、act mid=1、bd high=2
    ok(r1.levels && r1.levels.sameBlockBuyWave === 3 && r1.levels.amountTiering === 3
      && r1.levels.insiderSupplySell === 3 && r1.levels.stallBurstWave === 1
      && r1.levels.creatorFrontRun === 3 && r1.levels.activityLevel === 1
      && r1.levels.bundledDominance === 2 && r1.levels.equalAmountSplit === 0,
      `analyzed 带 levels 数值档（实际 ${JSON.stringify(r1.levels)}）`);
    ok(r1.buckets && r1.buckets.sameBlockBuyWave === 'strong' && r1.buckets.stallBurstWave === 'burst'
      && r1.buckets.activityLevel === 'mid',
      `analyzed 带 buckets 字符串原值（研究留档）`);
    // Z1c 数值锚六键（用户补点「著名钱包掌控/持仓极不均衡」）：四持仓占比键真算数值
    // （genTicks 全 0.1 同额 10 钱包）+famous 三键缺席 null（名单无命中=该轴不适用）
    ok(r1.anchors && ['sameBlockHoldPct', 'equalBandHoldPct', 'top1HoldSupplyPct',
      'top1HoldCircPct', 'famousDominancePct', 'famousDominanceLevel', 'famousDominance']
      .every((k) => k in r1.anchors) && r1.anchors.famousDominancePct === null
      && r1.anchors.famousDominance === null && r1.anchors.famousDominanceLevel === null,
      `analyzed 带 anchors 七键（famous 无命中缺席 null）（实际 ${JSON.stringify(r1.anchors)}）`);
    ok(r1.anchors.equalBandHoldPct === 100,
      `等额带锚精确值（全 0.1 同额 10 钱包簇并集=全场 Σ正净 → 100）（实际 ${r1.anchors.equalBandHoldPct}）`);
    ok(r2.levels && r2.levels.sameBlockBuyWave === 3 && r2.anchors && 'sameBlockHoldPct' in r2.anchors,
      '拉黑秒回也带 levels+anchors（_lastGrade 透传——gate 短路路径因子不缺位）');
  }
  {
    // Z2. unhealthy 计数→重判→用尽拉黑（unhealthyReanalyses=3：第 4 次 unhealthy 拉黑）
    const db = makeDb({ ticks: genTicks(20) });
    const pumpBurst = { // A 降级形状（唯一 pump strong ∧ burst ∧ mod<3 ∧ sbHold<50）→ unhealthy
      equal_amount_split: phAns('none'), coordinated_sell_back: phAns('none'),
      creator_front_run: phAns('none'), sell_dispersion: phAns('none'),
      stall_burst_wave: sbwAns('burst'), amount_tiering: phAns('none'),
      same_block_buy_wave: phAns('none'), insider_supply_sell: phAns('none'),
      slow_grind_pump: phAns('strong'), activity_level: actAns('mid'),
      bundled_trade_dominance: bdAns('low'),
    };
    const llm = makeLlm({ answers: pumpBurst });
    const nowRef = { t: 1000000 };
    const svc = makeSvc(db, llm, { gate: { unhealthyReanalyses: 3 } }, nowRef);
    for (let round = 1; round <= 4; round++) {
      if (round > 1) { db.holder.ticks = genTicks(20 + round * 20); nowRef.t += 61000; } // +20 tick 硬增量触发重判
      const r = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
      ok(r.status === 'analyzed' && r.grade === 'unhealthy' && r.unhealthyGrades === round,
        `第 ${round} 轮 unhealthy（unhealthyGrades=${r.unhealthyGrades}）`);
    }
    ok(svc.isGateBlocked('0xtok') === true, '第 4 次 unhealthy（>3 重判上限）→ 拉黑');
    const askBefore = llm.calls.ask;
    const r5 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r5.grade === 'cheat' && r5.blocked === true && llm.calls.ask === askBefore,
      '用尽后 gate 秒回 blocked（不再重判）');
  }
  {
    // Z3. 增量门内重用（不烧 Jev，grade 重用）+ healthy 放行
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: {
      equal_amount_split: phAns('none'), coordinated_sell_back: phAns('none'),
      creator_front_run: phAns('none'), sell_dispersion: phAns('none'),
      stall_burst_wave: sbwAns('none'), amount_tiering: phAns('none'),
      same_block_buy_wave: phAns('none'), insider_supply_sell: phAns('none'),
      slow_grind_pump: phAns('none'), activity_level: actAns('mid'),
      bundled_trade_dominance: bdAns('low'),
    } });
    const nowRef = { t: 1000000 };
    const svc = makeSvc(db, llm, {}, nowRef);
    const r1 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r1.status === 'analyzed' && r1.grade === 'healthy', '全 none 形状 → healthy 放行');
    const askBefore = llm.calls.ask;
    const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r2.status === 'reused' && r2.grade === 'healthy' && llm.calls.ask === askBefore,
      '同锚再买点 → reused 重用 grade（零 Jev——增量门是重判节流器）');
  }
  {
    // Z4. 竞速超时 fail-open：本笔放行（timeout_fail_open）+ late 链续跑迟到可消费
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ hang: true });
    const svc = makeSvc(db, llm, { settleDelayMs: 50 });
    const t0 = Date.now();
    const r = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 200 });
    ok(r.status === 'timeout_fail_open' && r.late && typeof r.late.then === 'function'
      && Date.now() - t0 < 2000,
      '竞速超时 → timeout_fail_open + late promise（本笔放行不阻塞等待 Jev）');
    ok(svc.stats.gateTimeouts === 1, 'gateTimeouts 计数');
  }
  {
    // Z5. 放行态四形状（观察层 fail-open 语义平移）：insufficient_ticks / quota /
    //     jev 失败 / disabled
    const db = makeDb({ ticks: genTicks(5) });
    const llm = makeLlm();
    const svc = makeSvc(db, llm, { minTicks: 8 });
    const r1 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r1.status === 'insufficient_ticks', '低 tick → insufficient_ticks（放行态，无 grade）');
    const svc2 = new CheatCheckService({ enabled: false }, null, { dbClient: db.client });
    ok((await svc2.gateBuyPoint('0xtok', META, {})).status === 'disabled', 'enabled=false → disabled');
    const db3 = makeDb({ ticks: genTicks(20) });
    const llm3 = makeLlm({ reject: 'jev down' });
    const svc3 = makeSvc(db3, llm3);
    const r3 = await svc3.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r3.status === 'fail' && r3.reason === 'jev_error', 'Jev 失败 → fail 放行态（不拦买点）');
  }
  {
    // Z6. 因子化预触发通道（2026-11-01 用户指令）：noteBuyPoint onResult 回调——
    //     链完成（analyzed/reused/fail 全形状）回调一次，引擎预触发用它投影 FA
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm();
    const svc = makeSvc(db, llm, { settleDelayMs: 10 });
    const got = [];
    const info = svc.noteBuyPoint('0xtok', META, {}, (res) => got.push(res));
    ok(info.status === 'initiated', 'noteBuyPoint 同步返回轨迹形状不变');
    await new Promise((r) => setTimeout(r, 150)); // settle 10ms + 链完成
    ok(got.length === 1 && got[0].status === 'analyzed' && got[0].grade === 'cheat'
      && got[0].levels && got[0].levels.sameBlockBuyWave === 3
      && got[0].anchors && 'top1HoldCircPct' in got[0].anchors,
      'onResult 回调收 analyzed+levels+anchors（预触发投影 FA 原料）');
    // 增量门内二次预触发 → joined_inflight 或新链 reused：回调也回（reused 形状带 grade）
    const got2 = [];
    svc.noteBuyPoint('0xtok', META, {}, (res) => got2.push(res));
    await new Promise((r) => setTimeout(r, 150));
    ok(got2.length === 1 && got2[0].status === 'reused' && got2[0].grade === 'cheat'
      && got2[0].levels && got2[0].levels.sameBlockBuyWave === 3
      && got2[0].anchors && 'top1HoldCircPct' in got2[0].anchors,
      '增量门内 reused → onResult 带 _lastGrade levels+anchors（连续预触发因子不缺位）');
    // fail 形状也回（insufficient_ticks 低票）——回调不丢、不抛
    const db2 = makeDb({ ticks: genTicks(3) });
    const svc2 = makeSvc(db2, makeLlm(), { minTicks: 8, settleDelayMs: 10 });
    const got3 = [];
    svc2.noteBuyPoint('0xlow', META, {}, (res) => got3.push(res));
    await new Promise((r) => setTimeout(r, 100));
    ok(got3.length === 1 && got3[0].status === 'insufficient_ticks',
      'insufficient_ticks → onResult 照回（无 grade=引擎投影自然跳过）');
  }

  console.log(`\n✅ _test_cheat_detection_service 全过（${passed} 断言）`);
}

main().catch((e) => {
  console.error(`\n❌ 异常: ${e?.stack || e}`);
  process.exit(1);
});
