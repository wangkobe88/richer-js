#!/usr/bin/env node
/**
 * Twitter Community 数据链路死链修复单测（C48 CREPE 案，2026-10-01）
 * ——本地零 DB 零网络（只做模块解析 + 源码口径，不发任何请求）
 *
 * 背景：社区票链路两处 import 层级写错，从未工作过且静默——
 *   ① data-fetch-service.mjs 主 community 分支 '../../utils/…'（解析到不存在的
 *      src/narrative/utils/twitter-validation/）→ fetch throw → markFailed →
 *      60min 冷却内重跑也不重试 → twitter=null → 社区票全在标准路径盲评
 *      （CREPE 0xeb2b7d56…931d：D 档 + 截词蹭名 low，state twitter 段 0 字符）
 *   ② account-community-rules.mjs getCommunityWithFullTweets 动态 import
 *      三级路径（同样解析到 src/narrative/utils/）→ 恒 null → prestage 社区路径
 *      全部 data_fetch_failed low（若只修 ①，社区票换了个姿势死）
 * 实测社区真实存在：Crepe Community 4145 成员/10 版主；修复后重跑
 * low→mid(2)（P1.9 web3_native_ip_early，「成员4145，活跃度?」）。
 *
 * 覆盖：
 *   A. 模块解析：communities-api.js named import（CJS shorthand 可静态分析）
 *   B. 修复点源码口径：两处 import 均为正确层级（字符串 + path.resolve 真实解析双锁）
 *   C. 全库 twitter-validation 相对 import 无死链（防新增；动态 import 不执行不解析，
 *      语法检查抓不到——这里按文件位置逐一 resolve 验证存在）
 *   D. 字段映射与 fail 语义：community→twitter_info 转换含 members_count；
 *      getCommunityWithFullTweets 失败 → data_fetch_failed low（真失败仍 fail-closed）
 *
 * 用法：node scripts/_test_twitter_community_pipeline.cjs
 */

'use strict';

const { readFileSync, existsSync } = require('fs');
const { resolve, dirname } = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

const ROOT = resolve(__dirname, '..');

// ═══ A. 模块解析 ═══
console.log('\n── A. communities-api.js 模块解析 ──');
const communitiesApiPath = resolve(ROOT, 'src/utils/twitter-validation/communities-api.js');
check('A1 真实文件存在（src/utils/twitter-validation/communities-api.js）', existsSync(communitiesApiPath));
check('A2 src/narrative/utils/twitter-validation/ 不存在（死链目标，防误建掩盖）',
  !existsSync(resolve(ROOT, 'src/narrative/utils/twitter-validation/communities-api.js')));

// ═══ B. 修复点源码口径 ═══
console.log('\n── B. 修复点（两处死链）──');
const dfsSrc = readFileSync(resolve(ROOT, 'src/narrative/analyzer/services/data-fetch-service.mjs'), 'utf8');
const dfsDir = dirname(resolve(ROOT, 'src/narrative/analyzer/services/data-fetch-service.mjs'));
const acrSrc = readFileSync(resolve(ROOT, 'src/narrative/analyzer/prompts/account/account-community-rules.mjs'), 'utf8');
const acrPath = resolve(ROOT, 'src/narrative/analyzer/prompts/account/account-community-rules.mjs');
const acrDir = dirname(acrPath);

// B1 data-fetch-service：全部动态 import communities-api 均为三级（../../../）
const dfsImports = [...dfsSrc.matchAll(/import\('([^']*twitter-validation\/communities-api\.js)'\)/g)].map(m => m[1]);
check('B1 data-fetch-service 引用 communities-api 共 2 处（主分支+回退分支）', dfsImports.length === 2, dfsImports);
check('B2 两处均为 ../../../ 层级（主分支 C48 修复）',
  dfsImports.length === 2 && dfsImports.every(p => p === '../../../utils/twitter-validation/communities-api.js'), dfsImports);
// 真实解析（比字符串匹配更硬：按文件位置 resolve 后文件必须存在）
const dfsResolved = dfsImports.map(p => existsSync(resolve(dfsDir, p)));
check('B3 两处路径按文件位置 resolve 均存在', dfsResolved.every(Boolean), dfsResolved);

// B4 account-community-rules：静态 import（C48 修复，原为三级动态 import 死链）
check('B4 account-community-rules 顶部静态 import fetchCommunityById（communities-api.js 四级）',
  /import \{[^}]*fetchCommunityById[^}]*\} from '\.\.\/\.\.\/\.\.\/\.\.\/utils\/twitter-validation\/communities-api\.js'/.test(acrSrc));
check('B5 文件内无 communities-api 动态 import 残留（死链形态整体移除）',
  !/import\('[^']*communities-api\.js'\)/.test(acrSrc));
// 静态 import 逐条真实解析
const acrStaticImports = [...acrSrc.matchAll(/from '(\.[^']*twitter-validation[^']*)'/g)].map(m => m[1]);
check('B6 account-community-rules twitter-validation 静态 import ≥2 条（index.js + communities-api.js）',
  acrStaticImports.length >= 2, acrStaticImports);
check('B7 静态 import 路径按文件位置 resolve 均存在',
  acrStaticImports.every(p => existsSync(resolve(acrDir, p))),
  acrStaticImports.map(p => resolve(acrDir, p)));

// ═══ C. 全库 twitter-validation 引用无死链 ═══
console.log('\n── C. 全库扫描（静态+动态 import 逐条 resolve）──');
const { execSync } = require('child_process');
let allRefs;
try {
  const out = execSync(
    `grep -rn "twitter-validation" ${JSON.stringify(resolve(ROOT, 'src'))} --include='*.mjs' --include='*.js' -l`,
    { encoding: 'utf8' });
  allRefs = out.trim().split('\n').filter(Boolean);
} catch { allRefs = []; }
check('C1 引用 twitter-validation 的文件 ≥4（本测覆盖面在）', allRefs.length >= 4, allRefs);

let deadLinks = [];
for (const file of allRefs) {
  const src = readFileSync(file, 'utf8');
  const dir = dirname(file);
  // 静态 from './...' 与动态 import('...')，相对路径逐条 resolve
  const specs = [
    ...[...src.matchAll(/from '(\.[^']*)'/g)].map(m => m[1]),
    ...[...src.matchAll(/import\('(\.[^']*)'\)/g)].map(m => m[1]),
  ].filter(p => p.includes('twitter-validation'));
  for (const spec of specs) {
    if (!existsSync(resolve(dir, spec))) deadLinks.push(`${file} → ${spec}`);
  }
}
check('C2 全库 twitter-validation 相对 import 零死链（动态 import 不执行不解析，此处按位置 resolve 实锁）',
  deadLinks.length === 0, deadLinks);

// ═══ D. 字段映射与 fail 语义 ═══
console.log('\n── D. community→twitter_info 映射与 fail 语义 ──');
check('D1 data-fetch-service 转换块携带 members_count / moderators_count / rules',
  /members_count: info\.members_count/.test(dfsSrc) && /moderators_count: info\.moderators_count/.test(dfsSrc));
const aasSrc = readFileSync(resolve(ROOT, 'src/narrative/analyzer/services/account-analysis-service.mjs'), 'utf8');
check('D2 account-analysis-service 对 null 社区数据维持 data_fetch_failed low（真失败 fail-closed 语义不变）',
  /category: 'data_fetch_failed'/.test(aasSrc) && /无法获取账号\/社区完整数据/.test(aasSrc));
const sbSrc = readFileSync(resolve(ROOT, 'src/narrative/analyzer/llm/jev-state-builder.mjs'), 'utf8');
check('D3 state builder 渲染成员数（社区数据进 state 的最后一环）', /成员数: \$\{\(data\.members_count \|\| 0\)\.toLocaleString\(\)\}/.test(sbSrc));

// ═══ 汇总 ═══
console.log(`\n══════ _test_twitter_community_pipeline: ${passed} passed, ${failed} failed ══════`);
process.exit(failed > 0 ? 1 : 0);
