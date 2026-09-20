#!/usr/bin/env node
/**
 * P0 冒烟：验证 JevClient 三种原语（Choice/Score/Noul）链路
 *
 * 用法：node scripts/narrative/jev_smoke.mjs
 * 判据：三个答案全部返回且类型正确、延迟 < 5s
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 让 engine/config.mjs 的项目根解析指向仓库根（scripts/narrative/ 上一级）
process.chdir(resolve(__dirname, '../..'));

const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');

async function main() {
  const state = {
    token: { symbol: 'FLAP2', name: 'Flap 2.0' },
    tweet: {
      author: 'meme_kol_99',
      followers: 12000,
      text: 'CZ 刚刚转发了一条关于 BNB Chain meme 生态的消息，并配文"flap is the future"。我们的代币 FLAP2 正是基于此热点发行。',
      posted_days_ago: 1,
    },
    today: new Date().toISOString().substring(0, 10),
  };

  const questions = {
    smoke_choice: {
      type: 'choice',
      instructions: '这条推文属于哪种类型？type_a=直接发布；type_b=解读回复；type_c=角度寻求（借势蹭热度引流）',
      criteria: {
        type_a: '账号直接发布的原创消息',
        type_b: '对他人消息的解读、评论或转发加评',
        type_c: '借势热点为自己项目引流或寻求角度',
      },
    },
    smoke_score: {
      type: 'score',
      instructions: '该事件作为 meme 币叙事的强度',
      criteria: [
        '弱：无明确事件，纯硬广',
        '中：有热点但关联牵强',
        '强：有明确热点事件且关联自然',
        '极强：顶级影响力人物直接相关',
      ],
    },
    smoke_noul: {
      type: 'noul',
      instructions: '这条推文是否在推广某个特定代币？',
    },
  };

  const startedAt = Date.now();
  const result = await JevClient.ask(state, questions, { label: 'smoke' });
  const elapsed = Date.now() - startedAt;

  const a = result.answers;
  console.log('=== Jev 冒烟结果 ===');
  console.log(`model:        ${result.model}`);
  console.log(`elapsed:      ${elapsed}ms`);
  console.log(`usage:        ${JSON.stringify(result.usage)}`);
  console.log(`choice:       ${a.smoke_choice.choice} (p=${JSON.stringify(a.smoke_choice.probabilities)}) conf=${a.smoke_choice.confidence}`);
  console.log(`score:        ${a.smoke_score.score} (conf=${a.smoke_score.confidence})`);
  console.log(`noul:         ${a.smoke_noul.noul}`);

  // 判据
  const checks = [
    ['choice 类型正确', typeof a.smoke_choice.choice === 'string' && ['type_a', 'type_b', 'type_c'].includes(a.smoke_choice.choice)],
    ['score 类型正确', typeof a.smoke_score.score === 'number' && a.smoke_score.score >= 0 && a.smoke_score.score <= 3],
    ['noul 类型正确', typeof a.smoke_noul.noul === 'number' && a.smoke_noul.noul >= 0 && a.smoke_noul.noul <= 1],
    ['延迟 < 5s', elapsed < 5000],
  ];
  console.log('\n=== 判据 ===');
  let allPass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (!ok) allPass = false;
  }
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('❌ 冒烟失败:', err.message);
  process.exit(1);
});
