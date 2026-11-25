#!/usr/bin/env node
// 因子代对拍包派生脚本（Jev 退役，2026-11-25 用户裁定）——从库里**最新版**主包克隆出
// 一个独立条目名的因子代策略包：腿 / burstCooldown / pointType 原样，仅把 Jev 三门
// （cheatCheck / actFrontGate / buyPointCheck）的 modules 版本键换成因子代键 v2。
//
// 为什么要独立条目：策略库同名条目是原位版本化——A 臂实验若与 B 臂引用同一包名，
// 运行时都解析最新版，对拍退化成 A=B（交易台账 T239 三修口径教训）。对拍 = 两个包条目：
//   A = 主包 trading-standard-v1（modules v1，Jev 代）
//   B = trading-standard-factor（本脚本产物，modules v2）
//
// ⚠ 主包演进（加腿 / 改条件）后须重跑本脚本重派生，否则因子包的腿滞后于主包——
//   对拍结论混入腿差异。脚本每次从库里取最新版，产物 description 记录派生源版本。
//
// --only 可只换部分门（混代包合法，逐门消融对拍用）：
//   --only buyPointCheck            → 只退役 BP 门的 Jev
//   --only cheatCheck,buyPointCheck → 保留 AF1（Jev 活跃度门），看「只去掉 cheat/BP」
// 源包里没有的模块键不新增（不给包凭空加门）。
//
// 用法：node scripts/deploy-factor-generation-pack.cjs
//         [--src <主包名|uuid>]（缺省 trading-standard-v1）
//         [--name <因子包名>]（缺省 trading-standard-factor）
//         [--only cheatCheck,actFrontGate,buyPointCheck]（缺省三门全换）
//         [--commit]（写库；须在 182 跑——本地 VPN 写库不可靠。缺省 dry-run 本地可跑，
//                    只做一次单行读）
// 产物引用：node scripts/clone-experiment.cjs --src <基底> --name <新名> --pack trading-standard-factor
'use strict';

const { FACTOR_GENERATION_KEY, assertModuleKey } = require('../src/market-analysis/module-registry');

const DEFAULT_SRC = 'trading-standard-v1';
const DEFAULT_NAME = 'trading-standard-factor';
/** 可换因子代的模块（= 有因子代的三个 Jev 门） */
const FACTOR_MODULES = ['cheatCheck', 'actFrontGate', 'buyPointCheck'];

/**
 * 派生因子代包定义（纯函数，零 DB——单测直测）。
 * @param {Object} srcDef - 源包 definition
 * @param {string[]} [onlyKeys] - 只换这些门（缺省三门全换）
 * @returns {{definition:Object, swapped:string[], kept:string[]}}
 *   swapped=换成因子代的模块；kept=源包里有 Jev 代键但本次保留的模块
 * @throws {Error} 源包 modules 形状非法 / onlyKeys 含无因子代的模块
 */
function deriveFactorPack(srcDef, onlyKeys) {
  if (!srcDef || typeof srcDef !== 'object' || Array.isArray(srcDef)) {
    throw new Error('源包 definition 非对象');
  }
  const keys = Array.isArray(onlyKeys) && onlyKeys.length ? onlyKeys : FACTOR_MODULES.slice();
  for (const k of keys) {
    if (!FACTOR_MODULES.includes(k)) {
      throw new Error(`--only 含无因子代的模块 "${k}"（可换：${FACTOR_MODULES.join('/')}）`);
    }
  }
  const srcMods = srcDef.modules;
  if (srcMods !== undefined && srcMods !== null && (typeof srcMods !== 'object' || Array.isArray(srcMods))) {
    throw new Error('源包 modules 段形状非法（须为对象）');
  }
  const definition = JSON.parse(JSON.stringify(srcDef));
  const swapped = [];
  const kept = [];
  const mods = definition.modules && typeof definition.modules === 'object' ? { ...definition.modules } : {};
  for (const k of FACTOR_MODULES) {
    if (!(k in mods)) continue; // 源包没开这门 → 不新增
    assertModuleKey(k, mods[k]); // 源包键非法 fail-fast（不冒充可派生）
    if (keys.includes(k)) {
      mods[k] = FACTOR_GENERATION_KEY;
      swapped.push(k);
    } else {
      kept.push(k);
    }
  }
  if (Object.keys(mods).length) definition.modules = mods;
  return { definition, swapped, kept };
}

async function main() {
  const argv = process.argv.slice(2);
  const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const srcArg = argOf('--src') || DEFAULT_SRC;
  const name = argOf('--name') || DEFAULT_NAME;
  const onlyArg = argOf('--only');
  const onlyKeys = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法: node scripts/deploy-factor-generation-pack.cjs [--src <主包名|uuid>] [--name <因子包名>] [--only cheatCheck,actFrontGate,buyPointCheck] [--commit]');
    return;
  }

  const { dbManager } = require('../src/services/dbManager');
  const c = dbManager.getClient();
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const q = c.from('strategy_library').select('id, name, version, definition').limit(1);
  const { data: rows, error } = UUID_RE.test(srcArg) ? await q.eq('id', srcArg) : await q.eq('name', srcArg);
  if (error) throw new Error(`策略包读取失败: ${error.message}`);
  const src = (rows || [])[0];
  if (!src) throw new Error(`源策略包不存在: ${srcArg}`);
  if (src.name === name) {
    throw new Error(`因子包名不得与源包同名（"${name}"）——同名=原位覆盖主包，对拍退化成 A=B；换 --name`);
  }

  const { definition, swapped, kept } = deriveFactorPack(src.definition, onlyKeys);
  const { validatePack } = require('../src/web/services/StrategyLibraryService');
  const check = validatePack(definition);
  if (!check.valid) {
    console.error('FATAL 派生包校验失败（不入库）:\n  - ' + check.errors.join('\n  - '));
    process.exit(1);
  }
  const fmtMods = (m) => Object.entries(m || {}).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`源包: ${src.name} v${src.version}（id=${src.id}）`);
  console.log(`  modules: ${fmtMods(src.definition && src.definition.modules) || '无'}`);
  console.log(`产物: ${name}`);
  console.log(`  modules: ${fmtMods(definition.modules) || '无'}`);
  console.log(`  换因子代: ${swapped.join(' ') || '（无——源包未开任何 Jev 门）'}${kept.length ? ` | 保留 Jev 代: ${kept.join(' ')}` : ''}`);
  console.log(`  腿: 买 ${(definition.buyLegs || []).length} / 卖 ${(definition.sellLegs || []).length}（与源包逐字一致）`);
  if (!swapped.length) {
    console.log('\n⚠ 源包的三门都不在场——产物与源包等价，对拍无意义；不入库。');
    return;
  }

  if (!argv.includes('--commit')) {
    console.log('\n[dry] 校验通过，未写库（--commit 在 182 执行写入）');
    return;
  }
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const description = `因子代对拍包（Jev 退役）：由 ${src.name} v${src.version} 派生，仅 ${swapped.join('/')} 换因子代键 ${FACTOR_GENERATION_KEY}`
    + `${kept.length ? `（${kept.join('/')} 保留 Jev 代）` : ''}。⚠主包演进后须重跑 deploy-factor-generation-pack.cjs 重派生。`;
  const cur = (await svc.list()).find((x) => x.name === name);
  if (!cur) {
    const row = await svc.create({ name, description, definition });
    console.log(`\n✅ 已创建: ${name} v${row.version}（id=${row.id}）`);
    return;
  }
  const full = await svc.getById(cur.id);
  const norm = (v) => JSON.stringify((function s(x) { if (Array.isArray(x)) return x.map(s); if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) o[k] = s(x[k]); return o; } return x; })(v));
  if (norm(full.definition) === norm(definition)) {
    console.log(`\nSKIP: ${name} v${full.version} definition 无变化`);
    return;
  }
  const row = await svc.update(cur.id, { name, description, definition, expectedVersion: full.version });
  console.log(`\n✅ 已更新: ${name} v${full.version} → v${row.version}（引用实验重启生效）`);
  console.log(`克隆对拍实验：node scripts/clone-experiment.cjs --src <基底> --name <新名> --pack ${name}`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
}
module.exports = { deriveFactorPack, FACTOR_MODULES, DEFAULT_SRC, DEFAULT_NAME };
