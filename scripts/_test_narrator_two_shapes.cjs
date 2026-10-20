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
  const mag = qs.web3_user_event_impact;

  // ═══ A. event_magnitude instructions ═══
  console.log('\n── A. event_magnitude instructions 两形状分流 ──');
  check('A1 版本号 ≥ J1.21（随问题集 bump 不回退）', parseInt(JEV_QUESTIONS_VERSION.replace('J1.', ''), 10) >= 21, JEV_QUESTIONS_VERSION);
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

  // ═══ B. J1.72 用户模拟评分 ═══
  console.log('\n── B. 影响力=模拟 BSC meme 买家反应（非死板分级）──');
  check('B1 criteria 为反应强度描述（0/1-2/3/4/5）', Array.isArray(mag.criteria) && mag.criteria.length === 5
    && mag.criteria[0].includes('完全无感') && mag.criteria[4].includes('全圈刷屏'));
  check('B2 题面要求代入 BSC 链 Meme 币买家（第一反应）',
    mag.instructions.includes('BSC 链的 Meme 币买家') && mag.instructions.includes('第一反应'));
  check('B3 明确反对按粉丝/播放/机构规模查表打分',
    mag.instructions.includes('不要按粉丝数/播放量/机构规模查表打分'));
  check('B4 传播面与时序是反应来源（不是独立加分项）',
    mag.instructions.includes('传播面与时序不是独立加分项') && mag.instructions.includes('反应强')
    && mag.instructions.includes('反应弱'));
  check('B5 反应分五档语义在场（划过去/可能参与/主动参与/全圈刷屏）',
    mag.instructions.includes('你大概率划过去') && mag.instructions.includes('可能参与')
    && mag.instructions.includes('你会主动去看/参与') && mag.instructions.includes('全圈刷屏'));
  check('B6 主体判定保留（陈述者关联/外部事件/父推）',
    mag.instructions.includes('陈述者关联事件') && mag.instructions.includes('主体=该外部事件本身')
    && mag.instructions.includes('十万粉级以上父推'));
  check('B7 类别提示为用户视角线索而非档位映射',
    mag.instructions.includes('只作思考线索，不是档位映射') && mag.instructions.includes('形象 IP/角色'));

  // ═══ C. J1.71 三合一 ═══
  console.log('\n── C. J1.71 事件侧三合一 ──');
  check('C1 web3_user_event_spread 题删除（影响力单题化）', qs.web3_user_event_spread === undefined);
  check('C2 impact 题声明唯一事件价值题 + 传播/时效内化',
    mag.instructions.includes('唯一事件价值题') && mag.instructions.includes('传播面与时序不是独立加分项'));

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
