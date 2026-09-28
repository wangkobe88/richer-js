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
    check('C1 tokenCreatedAtSec 回退存在三处（0.5/0.55/0.58）', count, 3);
    check('C2 规则0.52 已挂载', src.includes('checkBlueChipConflict'), true);
    check('C3 same_name_blue_chip 规则名已定义', src.includes("'same_name_blue_chip'"), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
