#!/usr/bin/env node
// 因子代对拍包派生脚本（Jev 退役，2026-11-25 用户裁定）——从库里**最新版**主包克隆出
// 一个独立条目名的因子代策略包：腿 / burstCooldown / pointType 原样，仅把 Jev 三门
// （cheatCheck / actFrontGate / buyPointCheck）的 modules 版本键换成因子代键 v2。
//
// 为什么要独立条目：策略库同名条目是原位版本化——A 臂实验若与 B 臂引用同一包名，
// 运行时都解析最新版，对拍退化成 A=B（交易台账 T239 三修口径教训）。对拍 = 两个包条目：
//   A = 主包 trading-standard-v1（modules v1，Jev 代）
//   B = trading-standard-factor（本脚本产物，modules v2）
// 主包切换因子代后（2026-11-26 用户裁定「主包切因子代」）角色对调：主包 = 因子代，
// Jev 代基线改由本脚本 --to v1 派生（缺省名 trading-standard-jev）——主包已是因子代时
// 缺省方向（--to v2）产物与主包等价，脚本拒入库（对拍退化成 A=B）。
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
//         [--name <产物包名>]（缺省：--to v2 → trading-standard-factor；--to v1 → trading-standard-jev）
//         [--only cheatCheck,actFrontGate,buyPointCheck]（缺省三门全换）
//         [--to v1|v2]（目标代次，缺省 v2 因子代；v1 = Jev 代——主包切因子代后派生 Jev 基线臂）
//         [--commit]（写库；须在 182 跑——本地 VPN 写库不可靠。缺省 dry-run 本地可跑，
//                    只做一次单行读）
// 产物引用：node scripts/clone-experiment.cjs --src <基底> --name <新名> --pack trading-standard-factor
'use strict';

const { FACTOR_GENERATION_KEY, assertModuleKey } = require('../src/market-analysis/module-registry');

const DEFAULT_SRC = 'trading-standard-v1';
const DEFAULT_NAME = 'trading-standard-factor';
const DEFAULT_NAME_JEV = 'trading-standard-jev';
/** 可换代的模块（= 有因子代的三个 Jev 门） */
const FACTOR_MODULES = ['cheatCheck', 'actFrontGate', 'buyPointCheck'];
/** 目标代次键 → 缺省产物包名（v1 = Jev 代 / v2 = 因子代） */
const TARGET_DEFAULT_NAMES = Object.freeze({ v1: DEFAULT_NAME_JEV, [FACTOR_GENERATION_KEY]: DEFAULT_NAME });

/**
 * 派生对拍包定义（纯函数，零 DB——单测直测）：把选中门的 modules 版本键换成目标代次键。
 * @param {Object} srcDef - 源包 definition
 * @param {string[]} [onlyKeys] - 只换这些门（缺省三门全换）
 * @param {string} [targetKey] - 目标代次键（缺省因子代 v2；v1 = Jev 代）
 * @returns {{definition:Object, swapped:string[], kept:string[], already:string[]}}
 *   swapped=本次换成目标代次的模块；kept=源包里开着但本次保留的模块；
 *   already=选中但源包本就是目标代次的模块（零变化）
 * @throws {Error} 源包 modules 形状非法 / onlyKeys 含无因子代的模块 / 目标代次键非法
 */
function deriveFactorPack(srcDef, onlyKeys, targetKey = FACTOR_GENERATION_KEY) {
  if (!srcDef || typeof srcDef !== 'object' || Array.isArray(srcDef)) {
    throw new Error('源包 definition 非对象');
  }
  if (!(targetKey in TARGET_DEFAULT_NAMES)) {
    throw new Error('--to 仅支持 v1（Jev 代）/ v2（因子代）');
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
  const already = [];
  const mods = definition.modules && typeof definition.modules === 'object' ? { ...definition.modules } : {};
  for (const k of FACTOR_MODULES) {
    if (!(k in mods)) continue; // 源包没开这门 → 不新增
    assertModuleKey(k, mods[k]); // 源包键非法 fail-fast（不冒充可派生）
    if (!keys.includes(k)) {
      kept.push(k);
    } else if (mods[k] === targetKey) {
      already.push(k);
    } else {
      mods[k] = targetKey;
      swapped.push(k);
    }
  }
  if (Object.keys(mods).length) definition.modules = mods;
  return { definition, swapped, kept, already };
}

async function main() {
  const argv = process.argv.slice(2);
  const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const srcArg = argOf('--src') || DEFAULT_SRC;
  const toArg = argOf('--to') || FACTOR_GENERATION_KEY;
  if (!(toArg in TARGET_DEFAULT_NAMES)) {
    throw new Error(`--to 仅支持 v1（Jev 代）/ v2（因子代），实际 ${JSON.stringify(toArg)}`);
  }
  const name = argOf('--name') || TARGET_DEFAULT_NAMES[toArg];
  const onlyArg = argOf('--only');
  const onlyKeys = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法: node scripts/deploy-factor-generation-pack.cjs [--src <源包名|uuid>] [--name <产物包名>] [--only cheatCheck,actFrontGate,buyPointCheck] [--to v1|v2] [--commit]');
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
    throw new Error(`产物包名不得与源包同名（"${name}"）——同名=原位覆盖源包，对拍退化成 A=B；换 --name`);
  }

  const { definition, swapped, kept, already } = deriveFactorPack(src.definition, onlyKeys, toArg);
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
  console.log(`  换${toArg === 'v1' ? 'Jev 代' : '因子代'}: ${swapped.join(' ') || '（无）'}${kept.length ? ` | 保留源键: ${kept.join(' ')}` : ''}${already.length ? ` | 源已是目标代次: ${already.join(' ')}` : ''}`);
  console.log(`  腿: 买 ${(definition.buyLegs || []).length} / 卖 ${(definition.sellLegs || []).length}（与源包逐字一致）`);
  if (!swapped.length) {
    console.log(`\n⚠ 选中门在源包里无一需要换（未开 / 已是目标代次 ${toArg}）——产物与源包等价，对拍退化成 A=B；不入库。`);
    return;
  }

  if (!argv.includes('--commit')) {
    console.log('\n[dry] 校验通过，未写库（--commit 在 182 执行写入）');
    return;
  }
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const description = `${toArg === 'v1' ? 'Jev 代对拍包（因子代主包的 Jev 基线臂）' : '因子代对拍包（Jev 退役）'}：由 ${src.name} v${src.version} 派生，仅 ${swapped.join('/')} 换版本键 ${toArg}`
    + `${kept.length ? `（${kept.join('/')} 保留源键）` : ''}。⚠源包演进后须重跑 deploy-factor-generation-pack.cjs 重派生。`;
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
module.exports = { deriveFactorPack, FACTOR_MODULES, DEFAULT_SRC, DEFAULT_NAME, DEFAULT_NAME_JEV, TARGET_DEFAULT_NAMES };
