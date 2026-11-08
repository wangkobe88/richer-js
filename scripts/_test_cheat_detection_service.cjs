#!/usr/bin/env node
/**
 * CheatCheckService 单测（CD158 重构，2026-11-03）——零 DB 零网络
 *
 * 打桩：dbClient（内存链式 builder，数据可热替换）/ loadLlm（假 JevClient）/
 * now（可控时钟）。CD158 形状：买信号驱动 gateBuyPoint 单入口（noteBuyPoint
 * 观察/预触发已退役）；判定粘滞（cheat=拉黑终态 / healthy=同版秒回 cached /
 * unhealthy=每买信号重判，2026-11-03 用户裁定移除升级拉黑）；增量门/顶帽
 * （首析+3）/factorGated 全退役——配额由引擎侧 BuySignalThrottle 信号帽
 * 天然封顶。覆盖：enabled 物化 / 首析全链+落行 / minTicks 跳过不落表不粘滞 /
 * 粘滞语义（healthy 秒回零 Jev·新 tick 不重判 / unhealthy 连续真析永不拉黑）/
 * 满帽（tail 锚+head 补充）/ 超时行+失败冷却 / 错误行 / ticks 拉取失败链内吞 /
 * jev_prompt 首行全文 / inflight join / 落库失败 loud 不抛 / bootstrap 三态
 * （cheat 拉黑恢复·healthy 粘滞恢复·unhealthy 计数恢复不拉黑）+ 版本域 /
 * capped→snapshot→state 全链透传 / 引擎接线源码口径锁 / 退役反证（noteBuyPoint
 * ·增量门·顶帽·升级臂零残留）。失败 exit 非零。
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
function makeDb({ ticks = [], cheatLatest = [], failInsert = false, failTicks = false } = {}) {
  const holder = { ticks, cheatLatest, failInsert, failTicks };
  const state = { inserts: [], tickQueries: 0, headQueries: 0, latestQueries: 0, cheatOps: [], tickOps: [], otherTables: [] };
  function resultFor(table, ops) {
    if (table === 'wss_price_ticks') {
      state.tickQueries++;
      state.tickOps.push(ops);
      if (holder.failTicks) return { data: null, error: { message: 'db down' } };
      const limitOp = ops.find((o) => o[0] === 'limit');
      const limit = limitOp ? limitOp[1][0] : 1000;
      // anchorMs 截窗（backtest.signalGateReal）语义过滤：.lte('block_time', iso) →
      // 锚后行不可见（as-of 防前视——服务侧由 DB 截窗承担，桩侧同款实现供断言）
      const lteOp = ops.find((o) => o[0] === 'lte' && o[1][0] === 'block_time');
      const anchorTs = lteOp ? new Date(lteOp[1][1]).getTime() : null;
      const orders = ops.filter((o) => o[0] === 'order');
      const asc = orders.length ? orders[0][1][1] && orders[0][1][1].ascending !== false : true;
      if (asc) state.headQueries++;
      const visible = anchorTs != null
        ? holder.ticks.filter((r) => new Date(r.block_time).getTime() <= anchorTs)
        : holder.ticks;
      const sorted = [...visible].sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
      const data = asc ? sorted.slice(0, limit) : sorted.slice(-limit).reverse();
      return { data, error: null };
    }
    // cheat_detection：bootstrap 最新行查询（CD158：count 起底已退役）/ insert
    // （wss_events createMeta 查询同走本分支——Y 段按 otherTables 表名断言）
    state.latestQueries++;
    state.otherTables.push(table);
    state.cheatOps.push(ops);
    return { data: holder.cheatLatest, error: null };
  }
  const client = {
    from(table) {
      const ops = [];
      const p = {
        select: (...a) => { ops.push(['select', a]); return p; },
        eq: (...a) => { ops.push(['eq', a]); return p; },
        lte: (...a) => { ops.push(['lte', a]); return p; },
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
function genTicks(n, { startBlock = 100, senderPrefix = '0xw', routerEvery = 0 } = {}) {
  const rows = [];
  let buyIdx = 0;
  for (let i = 0; i < n; i++) {
    const isBuy = i % 3 !== 2;
    // routerEvery（G17/D3.62）：每 N 笔买入走 GMGN 聚合路由（trader=router+sender 已解析
    // =真钱包 viaRouter）——基底全直连形状买 ≥15 笔会被 N 通道拦（N_no_retail_entry0.0），
    // 需要 healthy 终态的场景用零售混合形状
    const viaRt = routerEvery > 0 && isBuy && (buyIdx % routerEvery === 0);
    if (isBuy) buyIdx++;
    rows.push({
      block_time: new Date(1700000000000 + i * 2000).toISOString(),
      block_number: startBlock + Math.floor(i / 2), log_index: i % 2,
      // 卖行 0.11（≠0.1 买额、超 ±2% 对数带）：D3.28 起同块等额一卖一买=wash pair 锚，
      // 基底若卖 0.1 会 6 对卖占 100% 触发 H 通道污染全部 gate 分级测试
      trade_type: i % 3 === 2 ? 'sell' : 'buy',
      bnb_amount: i % 3 === 2 ? 0.11 : 0.1, price_bnb: 1e-9, price_outlier: false,
      trader_address: viaRt
        ? '0x1de460f363af910f51726def188f9004276bf4bc'
        : `${senderPrefix}${i % 10}`.padEnd(42, '0'),
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
  wash_pair: phAns('none'),
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
/** 全 none healthy 形状（不触发任何通道不拉黑——粘滞/bootstrap 类测试用） */
const NONE_ANSWERS = {
  equal_amount_split: phAns('none'), coordinated_sell_back: phAns('none'),
  creator_front_run: phAns('none'), sell_dispersion: phAns('none'),
  stall_burst_wave: sbwAns('none'), amount_tiering: phAns('none'),
  same_block_buy_wave: phAns('none'), insider_supply_sell: phAns('none'),
  slow_grind_pump: phAns('none'), activity_level: actAns('mid'),
  bundled_trade_dominance: bdAns('low'),
};
/** A 降级形状（唯一 pump strong ∧ burst ∧ mod<3）→ unhealthy（Z2 连续真析用） */
const PUMP_BURST = {
  equal_amount_split: phAns('none'), coordinated_sell_back: phAns('none'),
  creator_front_run: phAns('none'), sell_dispersion: phAns('none'),
  stall_burst_wave: sbwAns('burst'), amount_tiering: phAns('none'),
  same_block_buy_wave: phAns('none'), insider_supply_sell: phAns('none'),
  slow_grind_pump: phAns('strong'), activity_level: actAns('mid'),
  bundled_trade_dominance: bdAns('low'),
};
function makeSvc(db, llm, config = {}, nowRef = { t: 1000000 }) {
  return new CheatCheckService(
    { enabled: true, settleDelayMs: 5, timeoutMs: 500, ...config },
    null,
    { dbClient: db.client, now: () => nowRef.t, loadLlm: async () => llm.mod },
  );
}

async function main() {
  // ═══════════════ A. enabled 物化 + disabled 返回形状 ═══════════════
  console.log('A. enabled 物化语义');
  {
    const db = makeDb();
    const svc = new CheatCheckService({ enabled: false }, null, { dbClient: db.client });
    const r = await svc.gateBuyPoint('0xtok', META, {});
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
    const r = await svc.gateBuyPoint('0xTOK', META, { experimentId: 'exp-1' }, { awaitMs: 3000 });
    ok(r.status === 'analyzed' && r.grade === 'cheat', `首判 analyzed+grade（GOOD 形状 A 通道 strong→cheat；实际 ${r.status}/${r.grade}）`);
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
    // D3.59（CD184 临近买点段）：genTicks(20)=20 行 2s 间隔 → spanSec=38、临近段=dt>8 的 15 行
    // （买 10×0.1+卖 5×0.11=1.55 → 段吞吐 3.1）；全窗买 14 笔全 0.1 → 中位 0.1、
    // 总额 2.06÷38×60=3.25；价格全平 → maxDD=0
    const dgAct59 = row.snapshot_digest.activity;
    ok(dgAct59.buyMedianBnb === 0.1 && dgAct59.throughputBnbPerMin === 3.25 && dgAct59.maxDrawdownPct === 0,
      `D3.59 digest activity 全窗三锚（中位 0.1/吞吐 2.06÷38×60=3.25/平价 maxDD=0；实际 ${dgAct59.buyMedianBnb}/${dgAct59.throughputBnbPerMin}/${dgAct59.maxDrawdownPct}）`);
    ok(dgAct59.nearSegTickN === 15 && dgAct59.nearSegBuyN === 10 && dgAct59.nearSegSellN === 5
      && dgAct59.nearSegBnbPerMin === 3.1 && dgAct59.nearSegBuyMedianBnb === 0.1,
      `D3.59 digest activity 临近段七键（段=dt>末−30 共 15 行买 10/卖 5、段吞吐 (1.0+0.55)÷30×60=3.1；实际 ${dgAct59.nearSegTickN}/${dgAct59.nearSegBuyN}/${dgAct59.nearSegSellN}/${dgAct59.nearSegBnbPerMin}/${dgAct59.nearSegBuyMedianBnb}）`);
    ok(row.jev_prompt.includes('[TICKS]') && row.jev_prompt.includes('截至第 20 笔')
      && !row.jev_prompt.includes('超拉数帽'), '首行落 jev_prompt 全文（锚声明在、未满帽无截断注记）');
    ok(row.question_version === 'D3.26' && row.anchor_tick_count === 20 && row.source_experiment_id === 'exp-1',
      'question_version/anchor/source_experiment_id');
    ok(row.snapshot_digest.tickCount === 20 && row.snapshot_digest.capped === false
      && row.snapshot_digest.watermark && row.snapshot_digest.buyBnb > 0,
      'snapshot_digest 锚+水位+资金摘要');
    ok(svc.stats.analyzed === 1 && svc.stats.rowsWritten === 1, 'stats.analyzed/rowsWritten');
    ok(svc.isGateBlocked('0xtok') === true, 'cheat 落行后 service 拉黑（终态）');
  }

  // ═══════════════ C. minTicks 跳过（不调 Jev 不落表不粘滞） ═══════════════
  console.log('C. minTicks 预门');
  {
    const db = makeDb({ ticks: genTicks(5) });
    const llm = makeLlm();
    const svc = makeSvc(db, llm, { minTicks: 8 });
    const r = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r.status === 'insufficient_ticks' && llm.calls.ask === 0 && db.state.inserts.length === 0
      && svc.stats.skippedInsufficientTicks === 1,
      '5<8 tick：insufficient_ticks 零 Jev 零落表（放行态）');
    const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r2.status === 'insufficient_ticks' && llm.calls.ask === 0,
      'insufficient 不粘滞（无 _lastGrade——下个买信号照常重析路径）');
  }

  // ═══════════════ D. 粘滞语义（CD158 核心：healthy 秒回 / unhealthy 每信号重判） ═══════════════
  console.log('D. 粘滞语义');
  {
    // D1 healthy 秒回：cached:true 零 Jev；levels/anchors 自 _lastGrade 透传
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ answers: NONE_ANSWERS });
    const svc = makeSvc(db, llm);
    const r1 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r1.status === 'analyzed' && r1.grade === 'healthy' && r1.cached !== true,
      '全 none 形状首判 healthy（真析）');
    const askBefore = llm.calls.ask;
    const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r2.status === 'graded' && r2.grade === 'healthy' && r2.cached === true
      && llm.calls.ask === askBefore && svc.stats.stickyReused === 1,
      'healthy 二击 → 粘滞秒回 cached:true（零 Jev——同版本判定不重判）');
    ok(r2.levels && r2.levels.sameBlockBuyWave === 0 && r2.anchors && 'top1HoldCircPct' in r2.anchors,
      '粘滞秒回带 levels+anchors（_lastGrade 透传——FA 投影因子不缺位）');

    // D2 粘滞不受新 tick 影响（版本内）：盘面晚变作弊本版本不修正=用户明示接受
    db.holder.ticks = genTicks(60);
    const r3 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r3.cached === true && llm.calls.ask === askBefore && db.state.inserts.length === 1,
      '新 tick 到场 healthy 仍粘滞（版本 bump 才允许重判一次——bootstrap 版本域）');

    // D3 unhealthy 每买信号真判（连续 6 轮全真析永不拉黑——升级臂退役反证+无帽反证合一）
    const db4 = makeDb({ ticks: genTicks(20) });
    const llm4 = makeLlm({ answers: PUMP_BURST });
    const svc4 = makeSvc(db4, llm4);
    for (let round = 1; round <= 6; round++) {
      if (round > 1) db4.holder.ticks = genTicks(20 + round * 10);
      const r = await svc4.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
      ok(r.status === 'analyzed' && r.grade === 'unhealthy' && r.unhealthyGrades === round
        && r.cached !== true && llm4.calls.ask === round,
        `unhealthy 第 ${round} 轮：真析非秒回（ask=${llm4.calls.ask}）+ unhealthyGrades 递增`);
    }
    ok(svc4.isGateBlocked('0xtok') === false && db4.state.inserts.length === 6,
      '连续 6 次 unhealthy 永不拉黑（升级臂退役）+ 无顶帽连续落行（旧帽 4 在第 5 轮即拒——配额由引擎信号帽封顶）');

    // D4 unhealthy 翻案：下个信号判 healthy 后进入粘滞
    // （换零售混合 tick：53 笔买 1/3 走路由≈32%——基底全直连形状会被 G17 N 通道
    //  拦成 N_no_retail_entry0.0，翻案场景意图=档位翻正非入口锚，本段不测 N）
    db4.holder.ticks = genTicks(80, { routerEvery: 3 });
    llm4.mod.JevClient.ask = async () => {
      llm4.calls.ask++;
      return { model: 'fake', answers: NONE_ANSWERS, usage: { total: 1 } };
    };
    const rFlip = await svc4.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(rFlip.status === 'analyzed' && rFlip.grade === 'healthy' && rFlip.unhealthyGrades === 6,
      'unhealthy 翻案：真析 healthy（unhealthyGrades 观测计数保留不重置）');
    const rFlip2 = await svc4.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(rFlip2.cached === true && rFlip2.grade === 'healthy', '翻案后即粘滞（healthy 秒回）');
    ok(rFlip.unblocked === undefined && svc4.stats.unblocked === 0,
      '非 forceRecheck 真析天然零 unblocked（_maybeUnblock no-op——拉黑只在 cheat 判定登记）');
  }

  // ═══════════════ D5. CD381 forceRecheck 重检（almost_launch 回落可翻案） ═══════════════
  console.log('D5. CD381 forceRecheck 重检+翻案');
  {
    // D5a forceRecheck 绕拉黑秒回真调：cheat 拉黑后普通二击=blocked 秒回零 Jev；
    // forceRecheck=true → 真调重检（价格回到 almost_launch 的重检主路径）
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm(); // GOOD 形状=A 通道 strong→cheat
    const svc = makeSvc(db, llm);
    await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(svc.isGateBlocked('0xtok') === true, '首判 cheat 拉黑');
    const askAtBlock = llm.calls.ask;
    const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r2.grade === 'cheat' && r2.blocked === true && r2.cached !== true
      && llm.calls.ask === askAtBlock && svc.stats.gateBlockedHits === 1,
      '拉黑票普通二击=blocked 秒回（零 Jev）');
    const r3 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000, forceRecheck: true });
    ok(r3.status === 'analyzed' && llm.calls.ask === askAtBlock + 1 && svc.stats.forceRechecks === 1,
      'forceRecheck 绕拉黑秒回真调重检（ask+1、forceRechecks 计数）');
    ok(r3.grade === 'cheat' && r3.unblocked !== true && svc.isGateBlocked('0xtok') === true,
      '重检再判 cheat → 保持拉黑（无 unblocked 留痕）');

    // D5b forceRecheck 重检翻正 → 解除拉黑（unblocked 留痕+可买恢复+清仓不回滚）
    db.holder.ticks = genTicks(80, { routerEvery: 3 }); // 零售混合防 N 通道拦截（同 D4 形状）
    llm.mod.JevClient.ask = async () => {
      llm.calls.ask++;
      return { model: 'fake', answers: NONE_ANSWERS, usage: { total: 1 } };
    };
    const r4 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000, forceRecheck: true });
    ok(r4.grade === 'healthy' && r4.unblocked === true && svc.isGateBlocked('0xtok') === false
      && svc.stats.unblocked === 1,
      '重检翻 healthy → 解除拉黑恢复可买（unblocked 留痕+stats.unblocked）');
    const r5 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r5.cached === true && r5.grade === 'healthy' && r5.unblocked !== true,
      '解除后下击=healthy 粘滞秒回（不再 blocked）');

    // D5c forceRecheck 绕粘滞（healthy/unhealthy 两态——重检语义覆盖 recheckUnhealthy 布尔）
    const r6 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000, forceRecheck: true });
    ok(r6.cached !== true && llm.calls.ask >= 3, 'forceRecheck 绕 healthy 粘滞真调');
    const db6 = makeDb({ ticks: genTicks(20) });
    const llm6 = makeLlm({ answers: PUMP_BURST });
    const svc6 = makeSvc(db6, llm6);
    await svc6.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 }); // unhealthy 真析
    const ask6 = llm6.calls.ask;
    const r7 = await svc6.gateBuyPoint('0xtok', META, {},
      { awaitMs: 3000, recheckUnhealthy: false }); // 粘滞秒回
    ok(r7.cached === true && llm6.calls.ask === ask6, 'recheckUnhealthy=false → unhealthy 粘滞秒回');
    const r8 = await svc6.gateBuyPoint('0xtok', META, {},
      { awaitMs: 3000, recheckUnhealthy: false, forceRecheck: true });
    ok(r8.cached !== true && llm6.calls.ask === ask6 + 1,
      'forceRecheck 覆盖 recheckUnhealthy=false 绕粘滞真调');
  }

  // ═══════════════ E. 满帽拉数（capped） ═══════════════
  console.log('E. 满帽拉数');
  {
    const rows = genTicks(50);
    const db = makeDb({ ticks: rows });
    // headLimit/pullLimit 防呆下限=10（service num(v,dflt,10)），测试取合法小值
    const svc = makeSvc(db, makeLlm(), { pullLimit: 20, headLimit: 10 });
    await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    const row = db.state.inserts[0];
    ok(row.anchor_tick_count === 20 && row.snapshot_digest.capped === true, '满帽：anchor=tail 单查询行数 20+capped 标记');
    ok(db.state.headQueries === 1 && db.state.tickQueries === 2, '满帽才补 head 查询（launch 窗保留；tail+head 恰两次）');
    ok(row.jev_prompt.includes('超拉数帽') && row.jev_prompt.includes('截至第 20 笔'),
      'capped 全链透传：pull.capped→snapshot.capped→[ANCHOR] 截断声明');
    ok((row.jev_prompt.match(/^t\+\d+s /gm) || []).length === 30, '满帽窗口=head10+tail20=30 行进 state（[WALLETS] 的 @t+Ns 不计）');
  }

  // ═══════════════ F. 超时 / 错误 / 冷却 / 拉取失败 ═══════════════
  console.log('F. 失败语义');
  {
    // 超时：ask 永挂 → timeout 行（_runJev 内部 timeoutMs 竞速）
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ hang: true });
    const svc = makeSvc(db, llm, { timeoutMs: 40 });
    const r = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r.status === 'fail' && r.reason === 'jev_timeout'
      && db.state.inserts.length === 1 && db.state.inserts[0].verdict === 'timeout'
      && db.state.inserts[0].fail_reason.includes('jev_timeout')
      && db.state.inserts[0].jev_prompt === null,
      '超时 → fail 放行态 + timeout 行带 fail_reason（无 prompt）');
    ok(svc.stats.timeouts === 1, 'stats.timeouts=1');
    // 失败冷却期内再买点：冷却短路在拉数前（防故障环保留——CD158 最小代价）
    const pullsBefore = db.state.tickQueries;
    const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r2.status === 'fail' && r2.reason === 'cooldown'
      && db.state.tickQueries === pullsBefore && svc.stats.cooldownSkipped === 1,
      '失败冷却期内买点零拉数（fail:cooldown 放行态）');
    // 冷却不粘滞：冷却过后真析
    // （nowRef 未推进的 service 已冷却；此处新建推进时钟验证冷却窗过后恢复）
    const nowRef = { t: 1000000 };
    const svc1b = makeSvc(makeDb({ ticks: genTicks(20) }), makeLlm({ hang: true }), { timeoutMs: 40 }, nowRef);
    await svc1b.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    nowRef.t += 60000; // 越过 failCooldownMs（缺省 10s）
    const r1b = await svc1b.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r1b.reason === 'jev_timeout' && svc1b.stats.cooldownSkipped === 0,
      '冷却窗过后恢复真析（不粘滞——下个买信号可重判）');
  }
  {
    // Jev 抛错 → error 行（+冷却）
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm({ reject: 'boom' });
    const svc = makeSvc(db, llm);
    const r = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r.status === 'fail' && r.reason === 'jev_error'
      && db.state.inserts.length === 1 && db.state.inserts[0].verdict === 'error'
      && db.state.inserts[0].fail_reason.includes('boom'), 'error 行带 fail_reason（fail 放行态）');
  }
  {
    // ticks 拉取失败：链内吞不抛（观察期纪律）
    const db = makeDb({ ticks: [], failTicks: true });
    const llm = makeLlm();
    const svc = makeSvc(db, llm);
    let threw = false;
    let r;
    try { r = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 }); } catch (_) { threw = true; }
    ok(!threw && r.status === 'fail' && db.state.inserts.length === 0 && svc.stats.errors === 1,
      'DB 拉取失败=链内吞不抛（fail:chain_error 放行态，errors 计数）');
  }

  // ═══════════════ G. bootstrap 三态恢复（CD158：拉黑/粘滞/计数）+ 版本域 ═══════════════
  console.log('G. bootstrap 三态');
  {
    const digest = (grade) => ({
      grade, gradeVersion: 'G17', capped: false, watermark: null,
      phenomena: { equal_amount_split: 'strong', coordinated_sell_back: 'none', creator_front_run: 'none', sell_dispersion: 'none' },
      extLevels: { stall_burst_wave: 'none' },
      activityLevel: { bucket: 'mid' }, bundledDominance: { bucket: 'low' },
      anchors: { sameBlockHoldPct: 84.2, top1HoldCircPct: 16 },
    });
    const row = (grade, ago) => ({
      verdict: 'observed', anchor_tick_count: 40,
      analyzed_at: new Date(1000000 - ago).toISOString(),
      snapshot_digest: digest(grade),
    });
    // G1 cheat 行恢复：首链 4b 复检秒回 graded/blocked（零 Jev 零新落行，
    // levels/anchors 自 digest 重建）；第二击起入口内存短路照常
    const llm = makeLlm(); // GOOD→cheat；4b 失守会真烧 ask 落行（反证）
    const db = makeDb({ ticks: genTicks(40), cheatLatest: [row('cheat', 61000)] });
    const svc = makeSvc(db, llm);
    const r1 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r1.status === 'graded' && r1.grade === 'cheat' && r1.blocked === true
      && r1.reasons[0].code === 'gate_blocked'
      && r1.levels && r1.levels.equalAmountSplit === 3
      && r1.anchors && r1.anchors.sameBlockHoldPct === 84.2,
      'bootstrap 恢复拉黑 → 首链 4b 复检秒回 graded/blocked（levels/anchors 自 digest 重建）');
    ok(llm.calls.ask === 0 && db.state.inserts.length === 0,
      '恢复路径零 Jev 零新落行（拉黑不被重启洗掉）');
    const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r2.status === 'graded' && r2.blocked === true && svc.stats.gateBlockedHits === 2,
      '恢复后第二击起入口内存短路照常');
    // G2 healthy 粘滞跨重启：首链 4c 秒回 cached:true 零 Jev
    const dbH = makeDb({ ticks: genTicks(40), cheatLatest: [row('healthy', 61000)] });
    const llmH = makeLlm();
    const svcH = makeSvc(dbH, llmH);
    const rH = await svcH.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(rH.status === 'graded' && rH.grade === 'healthy' && rH.cached === true
      && llmH.calls.ask === 0 && svcH.stats.stickyBootstrapped === 1,
      'bootstrap 恢复 healthy _lastGrade → 首链 4c 粘滞秒回（cached:true 零 Jev——无此复检重启后白烧一次）');
    // G3 unhealthy 计数恢复：4 行 unhealthy → 不拉黑（升级臂退役）+ 计数续接
    const dbU4 = makeDb({
      ticks: genTicks(40),
      cheatLatest: [61000, 122000, 183000, 244000].map((ago) => row('unhealthy', ago)),
    });
    const rU4 = await makeSvc(dbU4, makeLlm({ answers: PUMP_BURST }), {}).gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(rU4.status === 'analyzed' && rU4.grade === 'unhealthy' && rU4.unhealthyGrades === 5
      && rU4.blocked !== true,
      'unhealthy 4 行 bootstrap 恢复计数（=4）不拉黑，真析续接 unhealthyGrades=5（升级臂退役跨进程语义）');
    // G4 版本域：bootstrap 查询按当前题集版本过滤（版本 bump → 旧行不可见=粘滞失效一次）
    const firstOps = db.state.cheatOps[0] || [];
    const hasVersionEq = firstOps.some((o) => o[0] === 'eq' && o[1][0] === 'question_version' && o[1][1] === 'D3.26');
    ok(hasVersionEq, 'bootstrap 查询带 .eq(question_version, 当前版本)（版本域=粘滞按题集版本的载体）');
    const hasLimit8 = firstOps.some((o) => o[0] === 'limit' && o[1][0] === 8);
    ok(hasLimit8, 'bootstrap 固定 8 行窗口（limit(8)——无 count 查询）');
    ok(db.state.latestQueries === 1, 'bootstrap 首触恰一次（_bootstrapped 去重）');
  }

  // ═══════════════ H. inflight join + 落库失败 + 引擎接线口径锁 ═══════════════
  console.log('H. join/落库失败/接线锁');
  {
    const db = makeDb({ ticks: genTicks(20) });
    const llm = makeLlm();
    const svc = makeSvc(db, llm, { settleDelayMs: 60 });
    const [r1, r2] = await Promise.all([
      svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 }),
      svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 }),
    ]);
    ok(svc.stats.inflightJoined === 1 && db.state.inserts.length === 1 && llm.calls.ask === 1
      && r1.grade === 'cheat' && r2.grade === 'cheat',
      '相邻买点 inflight join（一条链盖住，双买点同收 graded 结果）');
  }
  {
    const db = makeDb({ ticks: genTicks(20), failInsert: true });
    const svc = makeSvc(db, makeLlm());
    let threw = false;
    let r;
    try { r = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 }); } catch (_) { threw = true; }
    ok(!threw && svc.stats.writeFailed === 1 && r.grade === 'cheat',
      '落库失败=writeFailed 计数不抛（loud 留痕语义；链返回值照常（grade 已判））');
  }
  {
    // 引擎接线源码口径锁（挂点=腿字段门/GMGN 前/drain/metadata 轨迹三防线）
    const engineSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
    const condIdx = engineSrc.indexOf("const cheatCheckCondition = String(strategy.cheatCheckCondition || '').trim();");
    const gateIdx = engineSrc.indexOf('const gate = await this._cheatGateEvaluate(');
    const gmgnIdx = engineSrc.indexOf("const gmgnCheckCondition = String(strategy.gmgnCheckCondition || '').trim();");
    ok(condIdx > 0 && gateIdx > condIdx && gmgnIdx > gateIdx, '挂点：腿 cheatCheckCondition 非空才走门，且在 GMGN 之前');
    ok(engineSrc.includes('await this._cheatCheckService.drain(5000)'), 'stop drain 接线在场');
    const spreadCount = (engineSrc.match(/\.\.\.\(cheatCheckInfo \? \{ cheatCheck: cheatCheckInfo \} : \{\}\)/g) || []).length;
    ok(spreadCount === 2, `拒买/通过双路径 metadata 均带 cheatCheck 轨迹（spread×${spreadCount}=2）`);
    ok(engineSrc.includes('this._mergedWsConfig().cheatCheck || {}'), 'config 走 _mergedWsConfig（flap/gang 实验同键生效）');
  }
  {
    // 生产 _client() require 路径锁（2026-11-02 v67 首日事故现场反证）：曾写成
    // '../../services/dbManager'（market-analysis 在 src/ 下，services 同层须一层
    // ../）→ MODULE_NOT_FOUND 被 _chain 外层吞成 fail：43 次预触发分析全灭、零
    // 表行。deps.dbClient 注入短路本路径=单测漏网面，此块从真实模块系统侧锁死
    const svcDir = path.join(__dirname, '../src/market-analysis');
    const svcSrc = fs.readFileSync(path.join(svcDir, 'CheatCheckService.js'), 'utf8');
    ok(!svcSrc.includes("require('../../services/dbManager')"), "事故反证：不再含 '../../services/dbManager' 错误路径");
    const m = svcSrc.match(/require\('(\.\.?\/services\/dbManager)'\)/);
    ok(!!m, '_client() dbManager require 字面量在场');
    ok(!!m && m[1] === '../services/dbManager', `_client() 路径=一层上层（实际 ${m && m[1]}）`);
    let resolved = null;
    try { resolved = require.resolve(m[1], { paths: [svcDir] }); } catch (_) { /* 解析失败留 null */ }
    ok(!!resolved, 'require.resolve 从 market-analysis 出发可解析 dbManager（真实模块系统烟测）');
  }

  {
    // _log receiver 绑定锁（2026-11-02 v67 现场二次事故反证）：class 方法摘出直调
    // this=undefined（class 体严格模式）→ `this.log` TypeError 被 _log catch 吞 =
    // 「盘面观测」/「分析链异常」/「落库失败」自上线起零日志输出（检测/落表本身
    // 正常，丢的只是可观测性）。行为级断言：真 class 实例 logger（方法体触 this，
    // unbound 调用必 throw）注入后 _log 必须穿透到实例——曾写法
    // `const fn = this._logger[level]; fn(...)` 摘方法丢 receiver 全灭。
    class ProbeLogger {
      constructor() { this.calls = []; }
      info(...a) { this.calls.push(['info', ...a]); }
      warn(...a) { this.calls.push(['warn', ...a]); }
      error(...a) { this.calls.push(['error', ...a]); }
      debug(...a) { this.calls.push(['debug', ...a]); }
    }
    const pl = new ProbeLogger();
    const svc2 = new CheatCheckService({ enabled: true }, pl);
    svc2._log('info', 'receiver-bind-probe');
    svc2._log('warn', 'receiver-bind-probe-w');
    svc2._log('error', 'receiver-bind-probe-e');
    ok(pl.calls.length === 3, `_log class logger 调用穿透 3 级（unbound throw 被吞=0 次，实际 ${pl.calls.length}）`);
    ok(pl.calls[0][2] === 'CheatCheck' && pl.calls[0][3] === 'receiver-bind-probe', '_log 行形状=空 experimentId+module CheatCheck+消息');
    ok(pl.calls[2][0] === 'error', 'error 级别映射正确');
    // console 兜底路径：无 logger 时 _log 不得 throw（plain 输出，不校验内容）
    const svc3 = new CheatCheckService({ enabled: true }, null);
    let consoleFallbackOk = true;
    try { svc3._log('info', 'fallback-probe'); } catch (_) { consoleFallbackOk = false; }
    ok(consoleFallbackOk, '_log 无 logger console 兜底不抛');
  }

  // ═══════════════ Z. G1 分级门返回形状（levels/buckets/anchors 精确值） ═══════════════
  console.log('Z. gateBuyPoint 分级门');
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
      && db.state.inserts[0].snapshot_digest.gradeVersion === 'G17'
      && Number.isFinite(db.state.inserts[0].snapshot_digest.anchorSellCount),
      'digest 落 grade/gradeVersion/anchorSellCount（重放对拍原料）');
    // Z1b 因子化：analyzed 返回带 levels（数值档，FA 出口原料）+ buckets（字符串
    // 原值）——GOOD 形状 tier/bw/rat strong=3、sbw burst=1、cr strong=3、
    // act mid=1、bd high=2、wash none=0（D3.28）
    ok(r1.levels && r1.levels.sameBlockBuyWave === 3 && r1.levels.amountTiering === 3
      && r1.levels.insiderSupplySell === 3 && r1.levels.stallBurstWave === 1
      && r1.levels.creatorFrontRun === 3 && r1.levels.activityLevel === 1
      && r1.levels.bundledDominance === 2 && r1.levels.equalAmountSplit === 0
      && r1.levels.washPair === 0,
      `analyzed 带 levels 数值档（实际 ${JSON.stringify(r1.levels)}）`);
    ok(r1.buckets && r1.buckets.sameBlockBuyWave === 'strong' && r1.buckets.stallBurstWave === 'burst'
      && r1.buckets.activityLevel === 'mid',
      `analyzed 带 buckets 字符串原值（研究留档）`);
    // Z1c 数值锚：四持仓占比键真算数值（genTicks 全 0.1 同额 10 钱包买侧）+
    // washPair 三键（卖 0.11 超带=零配对 null）+famous 三键缺席 null
    ok(r1.anchors && ['sameBlockHoldPct', 'equalBandHoldPct', 'washPairCount', 'washPairSellPct',
      'washPairBuyPct', 'top1HoldSupplyPct', 'top1HoldCircPct',
      'famousDominancePct', 'famousDominanceLevel', 'famousDominance']
      .every((k) => k in r1.anchors) && r1.anchors.famousDominancePct === null
      && r1.anchors.famousDominance === null && r1.anchors.famousDominanceLevel === null,
      `analyzed 带 anchors 十键（famous 无命中缺席 null）（实际 ${JSON.stringify(r1.anchors)}）`);
    ok(r1.anchors.equalBandHoldPct === 100,
      `等额带锚精确值（全 0.1 同额 10 钱包簇并集=全场 Σ正净 → 100）（实际 ${r1.anchors.equalBandHoldPct}）`);
    ok(r1.anchors.washPairCount === null && r1.anchors.washPairSellPct === null
      && r1.anchors.washPairBuyPct === null,
      '基底零配对（卖 0.11 超带）→ washPair 三键 null（H 通道不触发=gate 测试基底干净）');
    // G8 四新锚：零买入纯卖方占比+burst 波强度三键
    ok(['burstMaxGapSec', 'burstWaveBuyBnb', 'burstWaveWallets', 'noBuySellPct']
      .every((k) => k in r1.anchors),
      'analyzed 带 G8 四新锚键（在場断言；实际 ' + JSON.stringify(Object.keys(r1.anchors)) + '）');
    ok(r1.anchors.noBuySellPct === 0,
      `纯卖=0 有证据零值（genTicks 十钱包均有买入、总卖 0.66>0 → 0 非 null）（实际 ${r1.anchors.noBuySellPct}）`);
    ok(r1.anchors.noBuySellVolumePct === 0,
      `D3.50 纯卖占总交易量=0 有证据零值（noBuySellBnb=0、总交易量>0）（实际 ${r1.anchors.noBuySellVolumePct}）`);
    ok(r1.anchors.burstWaveBuyBnb === 0.2 && r1.anchors.burstWaveWallets === 3
      && r1.anchors.burstMaxGapSec === 2,
      `burst 波精确值（最密 5s 窗=首三 tick 0/2/4s 两买一卖：买 0.1+0.1=0.2、去重 3 钱包；gap 全 2s）（实际 买${r1.anchors.burstWaveBuyBnb}/${r1.anchors.burstWaveWallets}户/gap${r1.anchors.burstMaxGapSec}s）`);
    // D3.51 尖刺两锚（genTicks 手算：maxGap 2s<60→簇=整个窗口；最密 3s 窗=t+0~2 两买
    // 0.2（w0/w1）占簇买 0.2/1.4=14.3%；尖刺钱包 w0 正净 0.2（w1 净 −0.01 不在正净域）
    // ÷Σ正净 0.8=25.0）
    ok(r1.anchors.spikeBuyPctInBurst === 14.3 && r1.anchors.spikeHoldPctAll === 25,
      `D3.51 尖刺两锚精确值（占簇买 14.3%/尖刺持 25.0）（实际 ${r1.anchors.spikeBuyPctInBurst}/${r1.anchors.spikeHoldPctAll}）`);
    ok(r1.levels && r1.levels.burstSpikeConcentration === null
      && r1.buckets && r1.buckets.burstSpikeConcentration === null,
      'GOOD 基底无 burst_spike_concentration 答案（stub 题集未含新题）→ levels/buckets 容缺 null（≤D3.50 旧档断代重放零变化防线）');
    // D3.35 协同买入四键+创建者峰值（genTicks(20) 手算：14 买×0.1 全 0xw0-9 十钱包；
    // 买块 100-109 各 1-2 笔、最大 2 笔并列四块（Σ同 0.2 取先到块 100=首买块）→
    // count=2/pct=0.2/1.4=14.3/preGap=null（首买块无前摇）；全 0.1000 档 10/10=100
    ok(['maxBlockBuyCount', 'maxBlockBuyPct', 'maxBlockPreGapSec', 'sameAmountWalletPct',
      'creatorPeakHoldSupplyPct'].every((k) => k in r1.anchors)
      && r1.anchors.maxBlockBuyCount === 2 && r1.anchors.maxBlockBuyPct === 14.3
      && r1.anchors.maxBlockPreGapSec === null && r1.anchors.sameAmountWalletPct === 100
      && r1.anchors.creatorPeakHoldSupplyPct === null,
      `D3.35 五新锚精确值（最大块 2 笔/14.3%/首买块 preGap null/同档 10 钱包=100%/创建者无行 null）（实际 ${r1.anchors.maxBlockBuyCount}/${r1.anchors.maxBlockBuyPct}/${r1.anchors.maxBlockPreGapSec}/${r1.anchors.sameAmountWalletPct}/${r1.anchors.creatorPeakHoldSupplyPct}）`);
    ok(r1.levels && r1.levels.abnormalBehavior === null && r1.buckets && r1.buckets.abnormalBehavior === null
      && r1.levels.realParticipation === undefined,
      'GOOD 基底无 abnormal_behavior_ratio 答案（stub 题集未含新题）→ levels/buckets 容缺 null+旧键 realParticipation 不残留（<D3.39 断代重放零变化防线）');
    ok(r2.levels && r2.levels.sameBlockBuyWave === 3 && r2.anchors && 'sameBlockHoldPct' in r2.anchors,
      '拉黑秒回也带 levels+anchors（_lastGrade 透传——gate 短路路径因子不缺位）');
  }
  {
    // Z1.5 CD27 对倒形状（D3.28 锚+G9 退役反证）：10 块逐块等额卖↔买配对+尾部散买
    // ——H 纯锚通道已随 G9 退役：锚照常真算落 digest（10 对/卖占 100/买占 50 喂
    // wash_pair 题），wash 题档 moderate（非 strong）→ 不再拉黑
    const washRows = [];
    for (let i = 0; i < 10; i++) {
      const blk = 300 + i;
      washRows.push({ block_time: new Date(1700000000000 + i * 3000).toISOString(), block_number: blk, log_index: 0,
        trade_type: 'sell', bnb_amount: 0.1, price_bnb: 1e-9, price_outlier: false,
        trader_address: '0xwashsell'.padEnd(42, '0'), sender_address: '0xwashsell'.padEnd(42, '0'), quote_token: null });
      washRows.push({ block_time: new Date(1700000000000 + i * 3000 + 500).toISOString(), block_number: blk, log_index: 1,
        trade_type: 'buy', bnb_amount: 0.1, price_bnb: 1e-9, price_outlier: false,
        trader_address: `0xwashbuy${i}`.padEnd(42, '0'), sender_address: `0xwashbuy${i}`.padEnd(42, '0'), quote_token: null });
    }
    for (let i = 0; i < 5; i++) {
      washRows.push({ block_time: new Date(1700000000000 + 40000 + i * 1000).toISOString(), block_number: 400 + i, log_index: 0,
        trade_type: 'buy', bnb_amount: 0.2, price_bnb: 1e-9, price_outlier: false,
        // 尾部散买走 GMGN 路由（G17/D3.62）：全直连形状 15 笔买会被 N 通道拦
        // （N_no_retail_entry0.0）污染本场景「wash 锚+G9 退役」意图；钱包=sender 不变
        trader_address: '0x1de460f363af910f51726def188f9004276bf4bc',
        sender_address: `0xwashrand${i}`.padEnd(42, '0'), quote_token: null });
    }
    const NONE_ALL = {
      equal_amount_split: phAns('none'), coordinated_sell_back: phAns('none'),
      creator_front_run: phAns('none'), sell_dispersion: phAns('none'),
      stall_burst_wave: sbwAns('none'), amount_tiering: phAns('none'),
      same_block_buy_wave: phAns('none'), insider_supply_sell: phAns('none'),
      slow_grind_pump: phAns('none'), wash_pair: phAns('moderate'),
      activity_level: actAns('mid'), bundled_trade_dominance: bdAns('low'),
    };
    const db = makeDb({ ticks: washRows });
    const llm = makeLlm({ answers: NONE_ALL });
    const svc = makeSvc(db, llm);
    const r = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r.status === 'analyzed' && r.grade === 'healthy' && r.reasons.length === 0,
      `CD27 对倒形状 G9 退役反证：wash 题档 moderate（非 strong）→ 不拉黑（H 已退役；实际 ${r.grade}/${r.reasons.map((x) => x.code).join(',')}）`);
    ok(svc.isGateBlocked('0xtok') === false, '纯锚无档位不拉黑（对倒拉黑须 Jev wash strong 走 A）');
    const dg = db.state.inserts[0].snapshot_digest;
    ok(dg.anchors.washPairCount === 10 && dg.anchors.washPairSellPct === 100
      && dg.anchors.washPairBuyPct === 50,
      `digest 落 washPair 三键真算值（10 对/卖占 100/买占 0.995→散买摊薄 50；实际 ${JSON.stringify(dg.anchors)}）`);
    ok(r.levels.washPair === 2 && r.buckets.washPair === 'moderate',
      'wash_pair 题档 moderate 照投影（levels=2/buckets 原值——题档与锚通道独立成键）');
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
    // Z5. 放行态形状：insufficient_ticks / jev 失败 / disabled
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
    // Z6. CD159 SB1 强庄形状观察臂（曾经命中粘滞，§七.5）：轮 1 命中形状 →
    // 置位 strongbackerLike=1（手算：burst 5 钱包同块 0.6×5=3.0 ≥2.2 ∧
    // top2=6e8/1e9=60% ≥4.5 ∧ 同档 0.6000 档 5/35 钱包=14.3% <15 ∧ 零卖行=
    // washPairCount null 干净 ∧ tpm 32.3/avg 0.30 → act mid ≠low）；Jev 答案
    // PUMP_BURST=unhealthy（每买信号重判=SB1 递增锚轮目标人群）；轮 2 换
    // genTicks 基底（burst 0.2+无 token_amount=形状消失）重判 → 粘滞仍 1、
    // hits 不再增；grade 轨迹与 SB1 无关（零门效应）；未命中 token 恒 0
    const sbRows = [];
    for (let i = 0; i < 5; i++) {
      sbRows.push({ block_time: new Date(1700000000000 + i * 400).toISOString(), block_number: 100, log_index: i,
        trade_type: 'buy', bnb_amount: 0.6, token_amount: 6e8, price_bnb: 1e-9, price_outlier: false,
        trader_address: `0xsburst${i}`.padEnd(42, '0'), sender_address: `0xsburst${i}`.padEnd(42, '0'), quote_token: null });
    }
    for (let i = 0; i < 30; i++) {
      const amt = +(0.11 + i * 0.01).toFixed(4); // 互异四档（0.1100..0.4000）——同档顶 size=burst 5
      const w = `0xsrand${String(i).padStart(2, '0')}`; // 定长后缀：padEnd 补零下 '1'/'10' 前缀碰撞教训
      sbRows.push({ block_time: new Date(1700000000000 + 5000 + i * 2000).toISOString(), block_number: 101 + i, log_index: 0,
        trade_type: 'buy', bnb_amount: amt, token_amount: amt / 1e-9, price_bnb: 1e-9, price_outlier: false,
        trader_address: w.padEnd(42, '0'), sender_address: w.padEnd(42, '0'), quote_token: null });
    }
    const META2 = { ...META, totalSupply: 1e9 };
    const db = makeDb({ ticks: sbRows });
    const llm = makeLlm({ answers: PUMP_BURST });
    const svc = makeSvc(db, llm);
    const r1 = await svc.gateBuyPoint('0xsbtok', META2, {}, { awaitMs: 3000 });
    ok(r1.status === 'analyzed' && r1.grade === 'unhealthy' && r1.strongbackerLike === 1
      && svc.stats.strongbackerHits === 1,
      `SB1 轮 1 命中形状 → strongbackerLike=1（曾经命中置位+hits 计数；实际 sb=${r1.strongbackerLike}/grade=${r1.grade}/hits=${svc.stats.strongbackerHits}）`);
    ok(r1.anchors && r1.anchors.burstWaveBuyBnb === 3.11 && r1.anchors.top2HoldSupplyPct === 60
      && r1.anchors.sameAmountWalletPct === 14.3 && r1.anchors.washPairCount === null,
      `SB1 命中轮四锚手算对拍（burst 3.11=5s 窗恰含 t+5 首笔散买 0.11/top2 60/同档 14.3/wash null；实际 ${r1.anchors && JSON.stringify({ b: r1.anchors.burstWaveBuyBnb, t: r1.anchors.top2HoldSupplyPct, s: r1.anchors.sameAmountWalletPct, w: r1.anchors.washPairCount })}）`);
    // 轮 2：unhealthy 每买信号重判——形状消失（genTicks 基底 burst 0.2+缺 token_amount=失明）
    db.holder.ticks = genTicks(40);
    const r2 = await svc.gateBuyPoint('0xsbtok', META2, {}, { awaitMs: 3000 });
    ok(r2.status === 'analyzed' && r2.strongbackerLike === 1 && svc.stats.strongbackerHits === 1,
      `SB1 轮 2 形状消失重判 → 粘滞仍 1（hits 不增；实际 sb=${r2.strongbackerLike}/hits=${svc.stats.strongbackerHits}）`);
    const r0 = await svc.gateBuyPoint('0xsb0', META2, {}, { awaitMs: 3000 });
    ok(r0.status === 'analyzed' && r0.strongbackerLike === 0,
      `SB1 未命中过的 token → 0（不冒充；实际 ${r0.strongbackerLike}）`);
    // 落库 digest 留观察轨迹：轮 1 digest 带 strongbackerLike=1（研究主数据源）
    const dg = db.state.inserts.find((x) => x.token_address === '0xsbtok' && x.snapshot_digest && x.snapshot_digest.grade === 'unhealthy');
    ok(dg && dg.snapshot_digest.strongbackerLike === 1,
      'digest 落 strongbackerLike=1（轮 1 命中留档——signal metadata/研究对拍原料）');
  }

  // ═══════════════ W. 退役反证（CD158 删除零残留） ═══════════════
  console.log('W. 退役反证');
  {
    const svcSrc = fs.readFileSync(path.join(__dirname, '../src/market-analysis/CheatCheckService.js'), 'utf8');
    const code = svcSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok(!code.includes('noteBuyPoint'), 'noteBuyPoint API 退役（观察/预触发入口删除）');
    ok(!code.includes('_lastAnalysis') && !code.includes('_analysisCount'), '_lastAnalysis/_analysisCount 增量态退役');
    ok(!code.includes('maxAnalysesPerToken') && !code.includes('skippedQuota'), '顶帽（首析+3 重判）退役——配额由引擎信号帽封顶');
    ok(!code.includes('unhealthyReanalyses') && !code.includes('_unhealthyReanalyses'), 'unhealthyReanalyses 升级拉黑臂退役（永不拉黑）');
    ok(!code.includes('factorGated') && !code.includes('reanalyzeTickDelta'), 'factorGated/reanalyzeTickDelta 增量门退役');
    ok(!code.includes('cacheReused'), 'cacheReused 统计退役（增量门产物）');
    ok(svcSrc.includes('stickyReused') && svcSrc.includes('stickyBootstrapped'),
      '粘滞观测计数在场（stickyReused/stickyBootstrapped）');
    const hasBlockedAdd = svcSrc.includes('this._gateBlocked.add(token)');
    const blockedAdds = (svcSrc.match(/this\._gateBlocked\.add\(token\)/g) || []).length;
    ok(hasBlockedAdd && blockedAdds === 2,
      `_gateBlocked.add 恰两处（cheat 判定+bootstrap cheat 行恢复——无 unhealthy 来源；实际 ${blockedAdds}）`);
  }

  // ═══════════════ Y. anchorMs 截窗 + persist:false 回测隔离（backtest.signalGateReal） ═══════════════
  console.log('Y. anchorMs 截窗 + persist:false 回测隔离');
  {
    // Y1 anchorMs 截窗（tail 单查询）：.lte('block_time', 锚 iso) 传参 + 桩语义过滤
    // genTicks(50, { routerEvery: 2 })：行 i 的 block_time=1700000000000+i*2000ms——锚=行 30 时刻 → 锚内 31 行
    const anchorMs = 1700000000000 + 30 * 2000;
    const db1 = makeDb({ ticks: genTicks(50, { routerEvery: 2 }) });
    const r1 = await makeSvc(db1, makeLlm({ answers: NONE_ANSWERS }))
      .gateBuyPoint('0xtok', META, {}, { awaitMs: 3000, anchorMs });
    const ltes1 = db1.state.tickOps.flatMap((o) => o.filter((x) => x[0] === 'lte'));
    ok(r1.status === 'analyzed' && r1.grade === 'healthy',
      `锚内 31 行 ≥ minTicks 全链（实际 ${r1.status}/${r1.grade}）`);
    ok(ltes1.length === 1 && ltes1[0][1][0] === 'block_time' && ltes1[0][1][1] === new Date(anchorMs).toISOString(),
      `tail 查询 .lte('block_time', 锚 iso)（实际 ${JSON.stringify(ltes1.map((x) => x[1]))}）`);
    // Y1b 锚切到行 6（锚内 7 行 < minTicks 8）→ insufficient_ticks：锚后 43 行被截
    //（无锚=50 行必过预门——截窗「真的截」的行为证据）
    const db1b = makeDb({ ticks: genTicks(50, { routerEvery: 2 }) });
    const r1b = await makeSvc(db1b, makeLlm({ answers: NONE_ANSWERS }))
      .gateBuyPoint('0xtok', META, {}, { awaitMs: 3000, anchorMs: 1700000000000 + 6 * 2000 });
    ok(r1b.status === 'insufficient_ticks' && r1b.anchorTickCount === 7,
      `锚截 7 行 < minTicks → insufficient_ticks（实际 ${r1b.status}/${r1b.anchorTickCount}）`);
    // Y1c 满帽补 head：pullLimit 20 × 锚内 31 行 → tail 20=capped → head 查询同样带 lte
    const db1c = makeDb({ ticks: genTicks(50, { routerEvery: 2 }) });
    const svc1c = makeSvc(db1c, makeLlm({ answers: NONE_ANSWERS }), { pullLimit: 20, headLimit: 10 });
    await svc1c.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000, anchorMs });
    const ltes1c = db1c.state.tickOps.flatMap((o) => o.filter((x) => x[0] === 'lte'));
    ok(ltes1c.length === 2 && ltes1c.every((x) => x[1][1] === new Date(anchorMs).toISOString()),
      `capped 补 head 两查询均 .lte 截窗（实际 ${ltes1c.length} 处）`);
    // Y2 无/非法 anchorMs=零 lte（生产现状 bit 一致；0/负数=有限正数门拒收）
    const db2 = makeDb({ ticks: genTicks(50, { routerEvery: 2 }) });
    const r2 = await makeSvc(db2, makeLlm({ answers: NONE_ANSWERS }))
      .gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r2.status === 'analyzed' && db2.state.tickOps.every((o) => !o.some((x) => x[0] === 'lte')),
      '不传 anchorMs → 零 lte（生产 tail 语义不变）');
    const db2b = makeDb({ ticks: genTicks(50, { routerEvery: 2 }) });
    await makeSvc(db2b, makeLlm({ answers: NONE_ANSWERS }))
      .gateBuyPoint('0xtok', META, {}, { awaitMs: 3000, anchorMs: 0 });
    ok(db2b.state.tickOps.every((o) => !o.some((x) => x[0] === 'lte')),
      'anchorMs=0（非法）→ 同不传（有限正数门）');
    // Y3 persist:false：跳写 cheat_detection + 禁 bootstrap 读（回测隔离——防污染生产
    // bootstrap/粘滞判定域；判定链本身完整照常）
    const db3 = makeDb({ ticks: genTicks(20) });
    const svc3 = makeSvc(db3, makeLlm({ answers: NONE_ANSWERS }), { persist: false });
    const r3 = await svc3.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(r3.status === 'analyzed' && r3.grade === 'healthy', 'persist=false 判定链完整照常');
    ok(db3.state.inserts.length === 0 && svc3.stats.persistSkipped >= 1,
      `跳写 cheat_detection（inserts=0/persistSkipped=${svc3.stats.persistSkipped}）`);
    ok(db3.state.otherTables.every((t) => t !== 'cheat_detection') && svc3._bootstrapped.has('0xtok'),
      `禁 bootstrap 读（cheat_detection 零查询（其余表=${[...new Set(db3.state.otherTables)]}——wss_events createMeta 照常=一次性历史事实无前视）；_bootstrapped 标记防重复进段）`);
    const db3b = makeDb({ ticks: genTicks(20) });
    await makeSvc(db3b, makeLlm({ answers: NONE_ANSWERS })).gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(db3b.state.inserts.length === 1, '对照组 persist 默认=true 照常落 1 行');
    // Y4 回测构造形状物化：settleDelayMs:0 不回落 4000（num min=0）+ persist 物化
    const svc4 = new CheatCheckService({ enabled: true, settleDelayMs: 0, persist: false }, null,
      { dbClient: makeDb().client });
    ok(svc4._settleDelayMs === 0 && svc4._persist === false,
      `settleDelayMs:0/persist:false 物化（实际 ${svc4._settleDelayMs}/${svc4._persist}——回测注入跳 settle 等待）`);
    // Y5 源码口径：.lte('block_time', anchorIso) 恰两处（tail+head）
    const src5 = fs.readFileSync(path.join(__dirname, '../src/market-analysis/CheatCheckService.js'), 'utf8');
    const lteSrc = (src5.match(/\.lte\('block_time', anchorIso\)/g) || []).length;
    ok(lteSrc === 2, `.lte('block_time', anchorIso) 源码恰两处 tail+head（实际 ${lteSrc}）`);
  }

  // ═══════════════ Z2. CD382 盘面重置截窗（回到过 almost_launch=证据窗重置到最低点行起）═══════════════
  console.log('Z2. CD382 盘面重置截窗');
  {
    // 价格轨迹行工厂（拉高→砸回 almost_launch 重启形状；genTicks 恒价 1e-9=从不离开不触发）。
    // 2026-11-08 发行价口径修正：META platform='flap'+BNB 盘（quote_token null）→ CD382
    // reset 锚=FLAP 主力档常量 5.546e-9——价格域乘常量（形状倍数不变=断言数值 bit 不变，
    // 且真实锁「常量平台锚」生产链路；乘 1e-9 会全落破发域=从未离开不触发 reset）
    const FL = 6.14 / (107036752 + 1e9);
    const priceTicks = (prices) => prices.map((p, i) => ({
      block_time: new Date(1700000000000 + i * 2000).toISOString(),
      block_number: 100 + i, log_index: 0,
      trade_type: 'buy', bnb_amount: 0.1, token_amount: 1e8,
      price_bnb: p * FL, price_outlier: false,
      trader_address: `0xp${i % 8}`.padEnd(42, '0'), sender_address: `0xp${i % 8}`.padEnd(42, '0'),
      quote_token: null,
    }));
    // Z2-1 重置全链：12 行轨迹（首个 >1.2=行1(1.5)；涨起后最低 1.05@行4）→ 判定窗
    // idx4..11=8 行 ≥minTicks 真调 Jev；digest/返回双留痕；资金只计截断窗
    const dbZ1 = makeDb({ ticks: priceTicks([1.0, 1.5, 2.0, 1.3, 1.05, 1.06, 1.07, 1.08, 1.09, 1.1, 1.12, 1.15]) });
    const svcZ1 = makeSvc(dbZ1, makeLlm({ answers: NONE_ANSWERS }));
    const rZ1 = await svcZ1.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(rZ1.status === 'analyzed' && rZ1.grade === 'healthy', `重置窗 8 行 ≥minTicks 全链（实际 ${rZ1.status}/${rZ1.grade}）`);
    ok(rZ1.marketReset && rZ1.marketReset.minVsLaunchPct === 5 && rZ1.marketReset.fullAnchorTickCount === 12,
      `返回 marketReset 留痕（minVsLaunchPct=+5/fullAnchorTickCount=12；实际 ${JSON.stringify(rZ1.marketReset)}）`);
    const rowZ1 = dbZ1.state.inserts[0];
    ok(rowZ1 && rowZ1.anchor_tick_count === 8 && rowZ1.snapshot_digest.tickCount === 8,
      `落行锚数=截断后 8 行（实际 ${rowZ1 && rowZ1.anchor_tick_count}/${rowZ1 && rowZ1.snapshot_digest.tickCount}）`);
    ok(rowZ1.snapshot_digest.marketReset && rowZ1.snapshot_digest.marketReset.minVsLaunchPct === 5,
      'digest.marketReset 留痕（应用行才有键——新旧窗口径区分）');
    ok(Math.abs(rowZ1.snapshot_digest.buyBnb - 0.8) < 1e-9,
      `digest 资金只计截断窗（8 行×0.1=0.8——上一轮 4 行不进；实际 ${rowZ1.snapshot_digest.buyBnb}）`);
    ok(svcZ1.stats.marketResets === 1, `stats.marketResets 计数（实际 ${svcZ1.stats.marketResets}）`);
    // Z2-2 重置窗 <minTicks → reset_insufficient_ticks（CD384 fail-closed：bt-v83
    // 完整窗口 87/87 实证 reset 截窗制造的不足放行=最大亏损源 -1.38，独立 status
    // 引擎侧硬拒不进 BP；不落表不粘滞；info 带 marketReset）
    const dbZ2 = makeDb({ ticks: priceTicks([1.0, 1.5, 2.0, 1.3, 1.05, 1.06, 1.07]) });
    const svcZ2 = makeSvc(dbZ2, makeLlm({ answers: NONE_ANSWERS }));
    const rZ2 = await svcZ2.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(rZ2.status === 'reset_insufficient_ticks' && rZ2.anchorTickCount === 3,
      `重置窗 3 行 <minTicks → reset_insufficient_ticks（CD384 fail-closed；实际 ${rZ2.status}/${rZ2.anchorTickCount}）`);
    ok(rZ2.marketReset && rZ2.marketReset.fullAnchorTickCount === 7 && dbZ2.state.inserts.length === 0,
      `reset_insufficient 行 info 留痕+不落表（实际 full=${rZ2.marketReset && rZ2.marketReset.fullAnchorTickCount}/inserts=${dbZ2.state.inserts.length}）`);
    ok(svcZ2.stats.resetInsufficientRejects === 1, `stats.resetInsufficientRejects 计数（实际 ${svcZ2.stats.resetInsufficientRejects}）`);
    ok(svcZ2._llm === null || dbZ2.state.inserts.length === 0, 'reset_insufficient 不烧 Jev 判定（落表零行）');
    // Z2-2b 天然短窗（无 reset）维持 insufficient_ticks fail-open 存量语义（CD384
    // 只收 reset 截窗制造的不足；genTicks 恒价不触发 reset → 5 行天然不足）
    const dbZ2b = makeDb({ ticks: priceTicks([1.0, 1.0, 1.0, 1.0, 1.0]) });
    const svcZ2b = makeSvc(dbZ2b, makeLlm({ answers: NONE_ANSWERS }));
    const rZ2b = await svcZ2b.gateBuyPoint('0xtok2', META, {}, { awaitMs: 3000 });
    ok(rZ2b.status === 'insufficient_ticks' && rZ2b.marketReset == null && rZ2b.anchorTickCount === 5,
      `天然短窗 5 行 → insufficient_ticks 照旧（无 marketReset；实际 ${rZ2b.status}/mr=${rZ2b.marketReset}/${rZ2b.anchorTickCount}）`);
    ok(svcZ2b.stats.resetInsufficientRejects === 0, `天然短窗不计 resetInsufficientRejects（实际 ${svcZ2b.stats.resetInsufficientRejects}）`);
    // Z2-3 满帽（capped）不重置：锚窗不含出生段=伪发行价，宁保持原判（config
    // pullLimit 最小合法值 10——num() min 拒收更小值；14 行票 tail 10=满帽 →
    // capped=true，head 补前段 → 不应用重置）
    const capTicks = priceTicks([1.0, 1.5, 2.0, 1.3, 1.05, 1.06, 1.07, 1.08, 1.09, 1.1, 1.12, 1.15, 1.2, 1.25]);
    const dbZ3 = makeDb({ ticks: capTicks });
    const svcZ3 = makeSvc(dbZ3, makeLlm({ answers: NONE_ANSWERS }), { pullLimit: 10, headLimit: 10 });
    const rZ3 = await svcZ3.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(rZ3.status === 'analyzed' && rZ3.marketReset === null && svcZ3.stats.marketResets === 0,
      `capped 满帽不重置（tail 10 行=帽 → capped=true；实际 ${rZ3.status}/mr=${rZ3.marketReset}/resets=${svcZ3.stats.marketResets}）`);
    const rowZ3 = dbZ3.state.inserts[0];
    ok(rowZ3.snapshot_digest.marketReset === null && rowZ3.snapshot_digest.tickCount === 10,
      `capped 行 digest.marketReset=null 全窗口径（anchor=tail 10；实际 ${JSON.stringify(rowZ3.snapshot_digest.marketReset)}/${rowZ3.snapshot_digest.tickCount}）`);
    // Z2-4 从未离开（恒价）→ bit 不变零重置（既有语义回归锚）
    const dbZ4 = makeDb({ ticks: genTicks(20, { routerEvery: 2 }) });
    const svcZ4 = makeSvc(dbZ4, makeLlm({ answers: NONE_ANSWERS }));
    const rZ4 = await svcZ4.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
    ok(rZ4.status === 'analyzed' && rZ4.marketReset === null && svcZ4.stats.marketResets === 0,
      `恒价票（从未离开 almost_launch）零重置 bit 不变（实际 ${rZ4.status}/resets=${svcZ4.stats.marketResets}）`);
    // Z2-5 anchorMs 截窗后重置照常应用（回测 signalGateReal：锚窗内判形状）
    const anchorMsZ5 = 1700000000000 + 11 * 2000; // 锚=行 11 → 锚内 12 行同 Z2-1
    const dbZ5 = makeDb({ ticks: priceTicks([1.0, 1.5, 2.0, 1.3, 1.05, 1.06, 1.07, 1.08, 1.09, 1.1, 1.12, 1.15, 1.3, 1.5]) });
    const rZ5 = await makeSvc(dbZ5, makeLlm({ answers: NONE_ANSWERS }))
      .gateBuyPoint('0xtok', META, {}, { awaitMs: 3000, anchorMs: anchorMsZ5 });
    ok(rZ5.status === 'analyzed' && rZ5.marketReset && rZ5.marketReset.fullAnchorTickCount === 12,
      `anchorMs 锚内重置照常（锚后 2 行不进窗不影响 resetIdx；实际 ${rZ5.marketReset && rZ5.marketReset.fullAnchorTickCount}）`);
    // Z2-6 题集版本不 bump（窗口口径非题面——粘滞域零变化）
    const srcZ6 = fs.readFileSync(path.join(__dirname, '../src/market-analysis/CheatCheckService.js'), 'utf8');
    ok(srcZ6.includes('computeMarketResetIndex'),
      'Service 接线在场（_chain 5b 消费 computeMarketResetIndex）');
  }

  console.log(`\n✅ _test_cheat_detection_service 全过（${passed} 断言）`);
}

main().catch((e) => {
  console.error(`\n❌ 异常: ${e?.stack || e}`);
  process.exit(1);
});
