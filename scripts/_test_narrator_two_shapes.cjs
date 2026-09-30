#!/usr/bin/env node
/**
 * J1.20 陈述者两形状分流——题面结构单测（零 DB 零网络）
 * （2026-09-30 用户裁定，C32 正龟案 0x969c6981…7777：A股新规全国级事件被
 *  criteria「第三方小号→C档」字面锚定陈述者 → 事件分 58.2<60 拦下，实际
 *  7 分钟 ×10.6 毕业。裁定原话「它俩只是陈述者罢了（叙事陈述者），事件的
 *  主体是A股」——量级档位定义须区分两种形状：陈述者关联事件 vs 陈述者
 *  无关联只是陈述者）
 *
 * 覆盖：
 *   A. event_magnitude instructions：两形状显式分流 / 回复语料父推规则 /
 *      父推=事件传播证据 / E 类升级规则含父推
 *   B. event_magnitude criteria 双锚：C/B/A 每档 ①陈述者关联+②陈述者无关
 *      双措辞；S 档两形状同一口径；C 档「无源可溯」封顶保留（7777 家族
 *      无主作业票防线）
 *   C. dimension2 同形状分流引用 + E 类回复语料按父推 + C/D 形状②分带指引
 *   D. 版本号 J1.20 + 头部历史条目
 *
 * 用法：node scripts/_test_narrator_two_shapes.cjs
 */

'use strict';

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ''}`); }
}

async function main() {
  const mod = await import('../src/narrative/analyzer/llm/jev-questions.mjs');
  const { buildStandardQuestions, JEV_QUESTIONS_VERSION } = mod;
  const qs = buildStandardQuestions();
  const mag = qs.event_magnitude;
  const dim2 = qs.dimension2;

  // ═══ A. event_magnitude instructions ═══
  console.log('\n── A. event_magnitude instructions 两形状分流 ──');
  check('A1 版本号 J1.21', JEV_QUESTIONS_VERSION === 'J1.21', JEV_QUESTIONS_VERSION);
  check('A2 显式形状①（陈述者关联事件→按陈述者定档）',
    mag.instructions.includes('形状①') && mag.instructions.includes('主体=该陈述者本人'));
  check('A3 显式形状②（陈述者无关联→按事件本身定档，粉丝数不封顶）',
    mag.instructions.includes('形状②') && mag.instructions.includes('既不代表也不封顶'));
  check('A4 外部热点例含政策新规（正龟案锚）',
    mag.instructions.includes('全国性政策新规'));
  check('A5 回复/转述语料规则存在',
    mag.instructions.includes('回复/转述/引用型语料'));
  check('A6 父推=事件传播证据计入（十万粉级以上父推陈述）',
    mag.instructions.includes('父推/源头本身就是事件的传播证据') && mag.instructions.includes('十万粉级以上父推主动陈述'));
  check('A7 回复者粉丝数不参与定档',
    mag.instructions.includes('回复者本人的粉丝数不参与定档'));
  check('A8 找角度/解读型标注形状②',
    mag.instructions.includes('找角度/解读型推文 → 形状②'));

  // ═══ B. event_magnitude criteria 双锚 ═══
  console.log('\n── B. criteria 每档双锚（①陈述者关联 ②陈述者无关）──');
  const tier = (i) => mag.criteria[i];
  check('B1 D 档双锚', tier(1).includes('①陈述者关联') && tier(1).includes('②陈述者无关'));
  check('B2 C 档双锚', tier(2).includes('①陈述者关联') && tier(2).includes('②陈述者无关'));
  check('B3 C 档形状① 保留粉丝锚（<4万普通KOL/第三方小号——形状①语义正确不动）',
    tier(2).includes('粉丝<4万的普通KOL/第三方小号'));
  check('B4 C 档「无源可溯」封顶保留（7777 无主作业票防线）',
    tier(2).includes('无法从语料与常识追溯') && tier(2).includes('最高到此档'));
  check('B5 B 档双锚 + 形状②含「被十万粉级以上KOL主动报道扩散」',
    tier(3).includes('①陈述者关联') && tier(3).includes('被十万粉级以上KOL主动报道扩散的事件'));
  check('B6 A 档形状②含全国级监管政策与市场事件（正龟案锚：A股新规）',
    tier(4).includes('②陈述者无关') && tier(4).includes('全国性监管政策与市场事件'));
  check('B7 S 档两形状同一口径', tier(5).includes('两种形状同一口径'));
  check('B8 E 档无可识别事件主体措辞维持', tier(0).includes('无可识别事件主体'));
  check('B9 E 类升级规则「被KOL大V主动报道」含父推',
    mag.instructions.includes('被KOL大V主动报道（含十万粉级以上父推对本事件的陈述）'));

  // ═══ C. dimension2 同步 ═══
  console.log('\n── C. dimension2 同形状分流 ──');
  check('C1 与 event_magnitude 两形状分流引用',
    dim2.instructions.includes('两形状分流') && dim2.instructions.includes('既不代表也不封顶'));
  check('C2 E 类行不看发推人/回复者 + 回复语料按父推',
    dim2.instructions.includes('不看发推人/回复者的互动与粉丝数据') && dim2.instructions.includes('回复语料按父推/源头传播算'));
  check('C3 C/D 类形状②分带指引（全国级政策/市场事件=全民话题级）',
    dim2.instructions.includes('形状②外部事件主体') && dim2.instructions.includes('全民话题级25-30'));
  check('C4 同主体一致性锚（不要重新贬低主体）维持',
    dim2.instructions.includes('不要在这题重新贬低主体'));

  // ═══ D. 头部历史条目 ═══
  console.log('\n── D. 版本历史 ──');
  const fs = await import('fs');
  const path = await import('path');
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/narrative/analyzer/llm/jev-questions.mjs'), 'utf8');
  check('D1 头部含 J1.20 历史条目（正龟案 + 两形状裁定）',
    src.includes('* J1.20：') && src.includes('C32 正龟案') && src.includes('只是陈述者罢了'));

  console.log(`\n══ 结果: ${passed} 通过 / ${failed} 失败 ══`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('单测执行异常:', err);
  process.exit(1);
});
