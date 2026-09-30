#!/usr/bin/env node
/**
 * 同名蓝筹拦截（规则0.52）+ pre-check created_at 口径——本地零 DB 单测
 *
 * 背景（2026-09-28 用户裁定「有同名蓝筹肯定不行」，富贵案 0x5e888…7777
 * 「传奇耐电汪」蹭蓝筹 0x198d…4444 的 symbol「富贵」三层同名防线全漏）：
 *   - pre-check 0.5/0.55/0.58 裸读 raw_api_data.created_at，wss 行无此字段
 *     （flap builder 只存 eventTs）→ 全部 wss 新票同名规则静默失效
 *   - 蓝筹任意时间存在：一周窗 + 同叙事 + appendix 对比覆盖不了，
 *     新规则 0.52 按归一化 symbol + 体量组合门硬拦
 *
 * 覆盖：
 *   A. checkBlueChipConflict 判定矩阵（富贵案例数值复现 / fdv 门 / 组合门
 *      三佐证各自单独立功 / 归一化隐形字符 / symbol 不匹配 / 短 symbol /
 *      排除自己 / AVE 异常 fail-open）
 *   B. 实例级 BSC 搜索缓存（0.5 与 0.52 共用实例同 keyword 只搜一次）
 *   C. pre-check 源码口径防回归（tokenCreatedAtSec 回退出现于 0.5/0.55/0.58 三处）
 *   D. 同事件竞争盘豁免（C29 Cue/Manus 案，2026-09-29）
 *   E. 名实不符豁免（C34 GMGN 蓝筹验证，2026-09-30）：成熟票（票龄≥7d）自身
 *      fdv ≥ 候选最大有效 fdv（>1T 脏值剔除）→ 拦截不成立；票龄不足/无锚/无
 *      自身行/自身 fdv 脏/候选全脏 → fail-closed 维持拦截
 *
 * 用法：node scripts/_test_blue_chip_check.cjs
 */
'use strict';

const { readFileSync } = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// 蓝筹富贵（0x198d…4444）AVE getTokenDetail 实测数值（2026-09-28）
const BLUE_CHIP_FUGUI = {
  token: '0x198dba421a7db566a90da5de7901abe3443b4444',
  name: '富贵', symbol: '富贵',
  fdv: '320000.00000', tvl: '317441.49332',
  holders: 100748, tx_count_24h: 370,
  issue_platform: 'four.meme', created_at: 1783386751
};

async function main() {
  const { SameNameCheckService } = await import(
    '../src/narrative/analyzer/services/same-name-check-service.mjs'
  );

  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const SELF = '0x5e888dde073ba817c1cb120653d66fbd28757777';

  /** 打桩 AVE：searchTokens 返回 fixture 并计数 */
  function makeService(rows) {
    const svc = new SameNameCheckService(logger);
    let calls = 0;
    svc.api = {
      searchTokens: async (kw, chain, limit, orderby) => {
        calls++;
        return rows.map(r => ({ ...r }));
      }
    };
    svc._callCount = () => calls;
    return svc;
  }

  // ============ A. checkBlueChipConflict 判定矩阵 ============
  console.log('\nA. checkBlueChipConflict 判定矩阵');

  // A1 富贵案例端到端复现：蓝筹命中 + 自己排除 + 小盘不达
  {
    const svc = makeService([
      BLUE_CHIP_FUGUI,
      { token: SELF, name: '传奇耐电汪', symbol: '富贵', fdv: '500000', tvl: '400000', holders: 50000, tx_count_24h: 500, created_at: 1790563801 }, // 自己：体量达标也须排除
      { token: '0xsmall1', name: '富贵', symbol: '富贵', fdv: '99999', tvl: '80000', holders: 20000, tx_count_24h: 200, created_at: 1790000000 }, // fdv 不达
      { token: '0xsmall2', name: '富贵星', symbol: '富贵', fdv: '353470', tvl: '', holders: 0, tx_count_24h: 1, created_at: 1790000000 }, // fdv 达标但佐证全缺
    ]);
    const r = await svc.checkBlueChipConflict('富贵', SELF);
    check('A1 命中且仅蓝筹一条', r.isConflict, true);
    check('A1 matched 只含蓝筹（按 fdv 降序）', r.matched.map(m => m.token), [BLUE_CHIP_FUGUI.token]);
    check('A1 蓝筹数值解析', [r.matched[0].fdv, r.matched[0].tvl, r.matched[0].holders, r.matched[0].txCount],
      [320000, 317441.49332, 100748, 370]);
  }

  // A2 fdv 恰达门槛 100000：tvl 佐证 → 命中
  {
    const svc = makeService([{ token: '0xa2', name: 'AB', symbol: 'AB', fdv: '100000', tvl: '50000', holders: 0, tx_count_24h: 0, created_at: 1 }]);
    const r = await svc.checkBlueChipConflict('AB', '0xself');
    check('A2 fdv=100k 且 tvl=50k 边界命中', r.isConflict, true);
  }

  // A3 fdv 差 1 不达
  {
    const svc = makeService([{ token: '0xa3', name: 'AB', symbol: 'AB', fdv: '99999.99', tvl: '999999', holders: 999999, tx_count_24h: 9999, created_at: 1 }]);
    const r = await svc.checkBlueChipConflict('AB', '0xself');
    check('A3 fdv 差 1 不拦', r.isConflict, false);
  }

  // A4 组合门三佐证各自单独立功
  {
    const holders = makeService([{ token: '0xa4a', name: 'AB', symbol: 'AB', fdv: '150000', tvl: '0', holders: 10000, tx_count_24h: 0, created_at: 1 }]);
    check('A4 holders 单佐证命中', (await holders.checkBlueChipConflict('AB', '0xself')).isConflict, true);
    const tx = makeService([{ token: '0xa4b', name: 'AB', symbol: 'AB', fdv: '150000', tvl: '0', holders: 0, tx_count_24h: 100, created_at: 1 }]);
    check('A4 txCount 单佐证命中', (await tx.checkBlueChipConflict('AB', '0xself')).isConflict, true);
    const none = makeService([{ token: '0xa4c', name: 'AB', symbol: 'AB', fdv: '150000', tvl: '49999', holders: 9999, tx_count_24h: 99, created_at: 1 }]);
    check('A4 三佐证各差 1 不拦', (await none.checkBlueChipConflict('AB', '0xself')).isConflict, false);
  }

  // A5 归一化：候选 symbol 带隐形字符（U+3164）仍匹配
  {
    const svc = makeService([{ ...BLUE_CHIP_FUGUI, symbol: '富贵ㅤ' }]);
    const r = await svc.checkBlueChipConflict('富贵', '0xself');
    check('A5 隐形字符归一化匹配', r.isConflict, true);
  }

  // A6 symbol 不同 / 大小写（AVE 返回小写 symbol 的大写目标）
  {
    const diff = makeService([{ ...BLUE_CHIP_FUGUI, symbol: '富貴' }]);
    check('A6 繁简不同不匹配（归一化不做繁简转换）', (await diff.checkBlueChipConflict('富贵', '0xself')).isConflict, false);
    const cs = makeService([{ ...BLUE_CHIP_FUGUI, symbol: 'FUGUI' }]);
    check('A6 大小写归一化匹配', (await cs.checkBlueChipConflict('fugui', '0xself')).isConflict, true);
  }

  // A7 短 symbol（<2 字符）直接不查
  {
    const svc = makeService([{ ...BLUE_CHIP_FUGUI, symbol: 'A' }]);
    const r = await svc.checkBlueChipConflict('A', '0xself');
    check('A7 单字符 symbol 跳过（不搜索）', r.isConflict, false);
    check('A7 单字符不触发 AVE 调用', svc._callCount(), 0);
  }

  // A8 只有自己达标（排除后空）→ 不拦
  {
    const svc = makeService([{ token: SELF.toUpperCase(), name: '传奇耐电汪', symbol: '富贵', fdv: '900000', tvl: '800000', holders: 100000, tx_count_24h: 900, created_at: 1 }]);
    const r = await svc.checkBlueChipConflict('富贵', SELF);
    check('A8 大小写不敏感排除自己', r.isConflict, false);
  }

  // A9 AVE 异常 fail-open（success=false 不拦，由 pre-check 侧记日志跳过）
  {
    const svc = new SameNameCheckService(logger);
    svc.api = { searchTokens: async () => { throw new Error('ave down'); } };
    const r = await svc.checkBlueChipConflict('富贵', '0xself');
    check('A9 AVE 异常 fail-open', [r.success, r.isConflict], [false, false]);
  }

  // ============ B. 实例级 BSC 搜索缓存 ============
  console.log('\nB. BSC 搜索缓存（0.5/0.52 共用实例）');

  // B1 同 symbol：0.5 的 checkIfCopycatToken 与 0.52 的 checkBlueChipConflict 只搜一次 BSC
  {
    const svc = makeService([{ ...BLUE_CHIP_FUGUI }]);
    // 模拟 pre-check 顺序：先 0.5（有 created_at 路径）再 0.52
    await svc.checkIfCopycatToken('富贵', '传奇耐电汪', 1790563801, { raw_api_data: {} });
    const r = await svc.checkBlueChipConflict('富贵', SELF);
    check('B1 两规则共用一次搜索', svc._callCount(), 1);
    check('B1 缓存路径蓝筹仍命中', r.isConflict, true);
  }

  // B2 换 keyword 缓存失效重新搜
  {
    const svc = makeService([{ ...BLUE_CHIP_FUGUI }]);
    await svc.checkBlueChipConflict('富贵', '0xself');
    await svc.checkBlueChipConflict('别的', '0xself');
    check('B2 不同 keyword 各搜一次', svc._callCount(), 2);
  }

  // ============ C. pre-check created_at 口径防回归 ============
  console.log('\nC. pre-check created_at 口径（源码级断言）');

  {
    const src = readFileSync(
      path.join(__dirname, '../src/narrative/analyzer/services/pre-check-service.mjs'), 'utf8');
    const fallback = 'tokenData.tokenCreatedAtSec || tokenData.raw_api_data?.created_at';
    const count = src.split(fallback).length - 1;
    check('C1 tokenCreatedAtSec 回退存在四处（0.5/0.52/0.55/0.58）', count, 4);
    check('C2 规则0.52 已挂载', src.includes('checkBlueChipConflict'), true);
    check('C3 same_name_blue_chip 规则名已定义', src.includes("'same_name_blue_chip'"), true);
    check('C4 0.52 调用传蓝筹豁免锚（第三参）', src.includes('checkBlueChipConflict(tokenSymbol, selfAddress, blueChipCreatedAt)'), true);
  }

  // ============ D. 同事件竞争盘豁免（C29 Cue/Manus 案，2026-09-29 用户裁定）============
  console.log('\nD. 同事件竞争盘豁免');

  // CUE 案实测数值：本 token 1790609551，同事件骑乘盘 0x3895f33c 晚 411s（fdv 15.9 万）
  {
    const svc = makeService([{
      token: '0x3895f33c9f61388fc68754aa7e00e744ddafd1f0',
      name: 'CUE', symbol: 'CUE',
      fdv: '159020', tvl: '0.03', holders: 196, tx_count_24h: 298,
      issue_platform: 'four.meme', created_at: 1790609962
    }]);
    const r = await svc.checkBlueChipConflict('CUE', '0x5074546cb787d5a698ec8e9a1734e33a3fae7777', 1790609551);
    check('D1 晚 411s 抢发骑乘盘（fdv 15.9 万）不拦', r.isConflict, false);
  }

  // 早发抢跑盘（-300s）同样豁免
  {
    const svc = makeService([{ ...BLUE_CHIP_FUGUI, created_at: 1790563801 - 300 }]);
    const r = await svc.checkBlueChipConflict('富贵', SELF, 1790563801);
    check('D2 早 300s 抢跑盘不拦', r.isConflict, false);
  }

  // 富贵案原语义：老蓝筹（创建时间差 80+ 天）维持拦截
  {
    const svc = makeService([BLUE_CHIP_FUGUI]);
    const r = await svc.checkBlueChipConflict('富贵', SELF, 1790563801);
    check('D3 窗外老蓝筹维持拦截（富贵案语义不变）', r.isConflict, true);
  }

  // 无锚（不传第三参）→ 维持拦截（无法证明同事件，fail-closed）
  {
    const svc = makeService([{ ...BLUE_CHIP_FUGUI, created_at: 1790563801 - 100 }]);
    const r = await svc.checkBlueChipConflict('富贵', SELF);
    check('D4 无锚维持拦截（原行为）', r.isConflict, true);
  }

  // 锚存在但候选 created_at=0/缺失（无法判定时间）→ 保守维持拦截
  {
    const svc = makeService([{ ...BLUE_CHIP_FUGUI, created_at: 0 }]);
    const r = await svc.checkBlueChipConflict('富贵', SELF, 1790563801);
    check('D5 候选无 created_at 维持拦截', r.isConflict, true);
  }

  // 混合：窗内骑乘盘 + 窗外真蓝筹 → matched 只含窗外蓝筹，仍拦
  {
    const svc = makeService([
      { token: '0x3895f33c9f61388fc68754aa7e00e744ddafd1f0', name: 'CUE', symbol: 'CUE', fdv: '159020', tvl: '0.03', holders: 196, tx_count_24h: 298, created_at: 1790609962 },
      { token: '0xoldblue', name: 'CUE', symbol: 'CUE', fdv: '500000', tvl: '100000', holders: 20000, tx_count_24h: 500, created_at: 1780000000 },
    ]);
    const r = await svc.checkBlueChipConflict('CUE', '0x5074546cb787d5a698ec8e9a1734e33a3fae7777', 1790609551);
    check('D6 混合场景仍拦（matched 只含窗外蓝筹）', [r.isConflict, r.matched.map(m => m.token)], [true, ['0xoldblue']]);
    check('D7 matched 审计带 createdAt', r.matched[0].createdAt, 1780000000);
  }

  // 窗边界：恰 3600s 排除，3601s 不排除
  {
    const edge = makeService([{ ...BLUE_CHIP_FUGUI, created_at: 1790563801 - 3600 }]);
    check('D8 恰 1h 边界排除', (await edge.checkBlueChipConflict('富贵', SELF, 1790563801)).isConflict, false);
    const over = makeService([{ ...BLUE_CHIP_FUGUI, created_at: 1790563801 - 3601 }]);
    check('D9 超 1h 不排除', (await over.checkBlueChipConflict('富贵', SELF, 1790563801)).isConflict, true);
  }

  // ============ E. 名实不符豁免（C34 GMGN 蓝筹验证，2026-09-30 用户裁定）============
  console.log('\nE. 名实不符豁免');

  const NOW = Math.floor(Date.now() / 1000);
  const MATURE = NOW - 8 * 86400;                 // 票龄 8 天
  // 自身行：DOGE 仿盘（AVE 同次搜索自带，零新配额；自身被排除出 candidates 不进组合门）
  const SELF_ROW = {
    token: SELF, name: 'Doge on BSC', symbol: 'DOGE',
    fdv: '249700000', tvl: '100000', holders: 50000, tx_count_24h: 500,
    created_at: MATURE,
  };
  // 蓝筹候选：BSC 小盘 Dogecoin（C34 实测 $1.69M——组合门达标但远小于自身）
  const DOGE_CAND = {
    token: '0xdogecand', name: 'Dogecoin', symbol: 'DOGE',
    fdv: '1690000', tvl: '800000', holders: 20000, tx_count_24h: 300,
    created_at: 1,
  };

  // E1 DOGE 案端到端：自身 $249.7M ≥ 候选 $1.69M → 豁免（isConflict=false + 审计）
  {
    const svc = makeService([SELF_ROW, DOGE_CAND]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF, MATURE);
    check('E1 名实不符豁免放行', [r.success, r.isConflict], [true, false]);
    check('E1 matched 保留（审计）', r.matched.map(m => m.token), [DOGE_CAND.token]);
    check('E1 exempt 审计数值', [r.exempt.selfFdv, r.exempt.candMaxFdv], [249700000, 1690000]);
    check('E1 exempt 票龄≈8', r.exempt.ageDays, 8);
  }

  // E2 票龄 7 天差 1 分钟 → 不豁免（A 类新票语义零扰动；锚在 7 天线之后
  // 60s，防测试取 NOW 与代码内 Date.now() 的秒级流逝翻转边界）
  {
    const svc = makeService([SELF_ROW, DOGE_CAND]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF, NOW - 7 * 86400 + 60);
    check('E2 票龄不足维持拦截', [r.isConflict, r.exempt], [true, null]);
  }

  // E3 恰 7 天边界 → 豁免（>= 含边界）
  {
    const svc = makeService([SELF_ROW, DOGE_CAND]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF, NOW - 7 * 86400);
    check('E3 恰 7 天豁免', [r.isConflict, r.exempt != null], [false, true]);
  }

  // E4 无锚（不传第三参）→ 维持拦截（无法证龄，fail-closed）
  {
    const svc = makeService([SELF_ROW, DOGE_CAND]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF);
    check('E4 无锚维持拦截', [r.isConflict, r.exempt], [true, null]);
  }

  // E5 AVE 搜索结果无自身行（300 条截断）→ 维持拦截（无法证自身体量）
  {
    const svc = makeService([DOGE_CAND]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF, MATURE);
    check('E5 无自身行维持拦截', [r.isConflict, r.exempt], [true, null]);
  }

  // E6 自身 fdv 脏（≥1T 天文数字）→ 维持拦截
  {
    const svc = makeService([{ ...SELF_ROW, fdv: '2000000000000' }, DOGE_CAND]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF, MATURE);
    check('E6 自身 fdv 脏维持拦截', [r.isConflict, r.exempt], [true, null]);
  }

  // E7 候选有效 fdv 全缺（比特币案：候选 $1.83T 全脏）→ fail-closed 维持拦截
  {
    const svc = makeService([
      { ...SELF_ROW, fdv: '89400000' },
      { token: '0xbtccand', name: '比特币', symbol: '比特币', fdv: '1830000000000', tvl: '900000', holders: 30000, tx_count_24h: 400, created_at: 1 },
    ]);
    const r = await svc.checkBlueChipConflict('比特币', SELF, MATURE);
    check('E7 候选全脏 fail-closed 维持拦截', [r.isConflict, r.exempt], [true, null]);
  }

  // E8 混合候选：$2T 脏行进 matched（组合门/审计不动）但比较只用有效值 → 豁免
  {
    const svc = makeService([
      SELF_ROW,
      { token: '0xdirtyt', name: 'DOGE', symbol: 'DOGE', fdv: '2000000000000', tvl: '800000', holders: 20000, tx_count_24h: 300, created_at: 1 },
      { ...DOGE_CAND, token: '0xdogecand2', fdv: '5000000' },
    ]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF, MATURE);
    check('E8 脏行剔除后有效值比较豁免', [r.isConflict, r.exempt.candMaxFdv], [false, 5000000]);
    check('E8 脏行仍在 matched 审计', r.matched.length, 2);
  }

  // E9 自身 < 候选最大有效值（FIST 形状 $46.5M vs $435.9B）→ 维持拦截（蹭名方向正确）
  {
    const svc = makeService([
      { ...SELF_ROW, fdv: '46500000' },
      { ...DOGE_CAND, fdv: '435900000000' },
    ]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF, MATURE);
    check('E9 自身小于候选维持拦截', [r.isConflict, r.exempt], [true, null]);
  }

  // E10 同事件豁免先排空 matched → 豁免分支不激活（形状：isConflict=false 且 exempt=null）
  {
    const svc = makeService([SELF_ROW, { ...DOGE_CAND, created_at: MATURE + 100 }]);
    const r = await svc.checkBlueChipConflict('DOGE', SELF, MATURE);
    check('E10 同事件豁免排空后 exempt 恒 null', [r.isConflict, r.exempt, r.matched.length], [false, null, 0]);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
