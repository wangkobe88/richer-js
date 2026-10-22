#!/usr/bin/env node
/**
 * 知识库匹配器单测（C164）——零 DB 零网络
 *
 *   A. 案例锚（知识库立项动机的两案）：
 *      A1 彪弟×彪哥：name_substring 不命中（LCS「彪」1 CJK < minCjk 2）
 *      A2 彪弟票语料提及「彪哥」→ corpus_contains 命中（立项主路径）
 *      A3 哭哭奶龙×哭哭马：LCS「哭哭」2 CJK → name_substring 命中
 *   B. 规则分级与优先级：address/twitter/name exact 三级 + 同条目多级保最高级
 *   C. 归一化：大小写/空格/@/emoji
 *   D. denylist：substring/corpus 压制、name_exact 同名不压
 *   E. corpusTrigger:false：substring/corpus 不触发、name_exact 仍命中
 *   F. 封顶：maxEntries 截断 + truncated 留痕 + 输出剥 _score
 *   G. concept keyword 命中
 *   H. 空索引/空输入零命中
 *   I. autoCorpusTriggerForEntry（builder 数据侧防线，与 C/D 同判据）
 *
 * 用法：node scripts/_test_knowledge_matcher.cjs
 */
'use strict';

const path = require('node:path');

let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra !== undefined ? ` | ${JSON.stringify(extra)}` : ''}`); }
}

const A = (hex) => `0x${hex.padStart(40, '0')}`;
const BI_AGE = A('ab1'); // 彪哥
const KK_MA = A('cd2');  // 哭哭马

(async () => {
  const M = await import('../src/narrative/analyzer/knowledge/knowledge-matcher.mjs');
  const { normalizeForKnowledgeMatch, buildKnowledgeIndex, matchKnowledge, isValidKnowledgeEntry, autoCorpusTriggerForEntry, excludeSelfFeedback } = M;

  console.log('A. 案例锚（彪弟/哭哭奶龙）');
  {
    const index = buildKnowledgeIndex([
      { id: 'b:' + BI_AGE, kind: 'bluechip', name: '彪哥', symbol: 'BIAOGE', address: BI_AGE, corpusTrigger: true },
      { id: 'b:' + KK_MA, kind: 'bluechip', name: '哭哭马', symbol: 'KKMA', address: KK_MA, corpusTrigger: true },
    ]);
    const cfg = { maxEntries: 5, minCjk: 2, minLatin: 4 };
    // A1 彪弟×彪哥 substring 不命中（语料不含「彪哥」）
    let r = matchKnowledge({ symbol: 'BIAODI', name: '彪弟', address: A('ef3'), twitterHandle: null, corpusText: '' }, index, cfg);
    assert(r.matches.length === 0, 'A1 彪弟×彪哥 name_substring 不命中（LCS 1 CJK<2）', r.matches);
    // A2 语料提及「彪哥」→ corpus_contains
    r = matchKnowledge({ symbol: 'BIAODI', name: '彪弟', address: A('ef3'), twitterHandle: null, corpusText: '致敬彪哥的新币 彪弟起飞' }, index, cfg);
    const hit = r.matches.find((m) => m.entryId === 'b:' + BI_AGE);
    assert(hit && hit.rule === 'corpus_contains' && hit.matchedOn === '彪哥', 'A2 语料提及彪哥 → corpus_contains 命中', hit);
    // A3 哭哭奶龙×哭哭马 LCS「哭哭」
    r = matchKnowledge({ symbol: 'KKNL', name: '哭哭奶龙', address: A('ef4'), twitterHandle: null, corpusText: '' }, index, cfg);
    const hit2 = r.matches.find((m) => m.entryId === 'b:' + KK_MA);
    assert(hit2 && hit2.rule === 'name_substring' && hit2.matchedOn === '哭哭', 'A3 哭哭奶龙×哭哭马 LCS「哭哭」命中', hit2);
  }

  console.log('B. 规则分级与优先级');
  {
    const addr = A('11');
    const index = buildKnowledgeIndex([
      { id: 'b:' + addr, kind: 'bluechip', name: 'Test Coin', symbol: 'TEST', address: addr, twitter: 'https://x.com/TestCoin', corpusTrigger: true },
    ]);
    const input = { symbol: 'TEST', name: 'Test Coin', address: addr, twitterHandle: 'testcoin', corpusText: 'Test Coin test' };
    const r = matchKnowledge(input, index, { maxEntries: 5, minCjk: 2, minLatin: 4 });
    assert(r.matches.length === 1 && r.matches[0].rule === 'address_exact', 'B1 address_exact 最高级（同条目多级命中保最高）', r.matches);
    const r2 = matchKnowledge({ ...input, address: A('99') }, index, { maxEntries: 5, minCjk: 2, minLatin: 4 });
    assert(r2.matches[0].rule === 'twitter_exact', 'B2 twitter_exact 次级', r2.matches[0]);
    const r3 = matchKnowledge({ ...input, address: A('99'), twitterHandle: null }, index, { maxEntries: 5, minCjk: 2, minLatin: 4 });
    assert(r3.matches[0].rule === 'name_exact', 'B3 name_exact 再次级', r3.matches[0]);
    // 裸 handle 条目（无 URL 前缀）也可 twitter_exact
    const idx2 = buildKnowledgeIndex([{ id: 'q:x', kind: 'quasi', name: 'X 项目', address: A('22'), twitter: 'RawHandle', corpusTrigger: false }]);
    const r4 = matchKnowledge({ symbol: 'Y', name: 'Y 币', address: A('33'), twitterHandle: '@rawhandle', corpusText: '' }, idx2, {});
    assert(r4.matches[0]?.rule === 'twitter_exact', 'B4 条目裸 handle ↔ 输入 @handle 归一化后命中', r4.matches[0]);
  }

  console.log('C. 归一化');
  {
    assert(normalizeForKnowledgeMatch(' Hello-World_42 @X ') === 'helloworld42x', 'C1 大小写/空白/_-@# 剥除');
    assert(normalizeForKnowledgeMatch('DND😾猫') === 'dnd猫', 'C2 emoji 剥除保留 CJK', normalizeForKnowledgeMatch('DND😾猫'));
    const index = buildKnowledgeIndex([{ id: 'q:z', kind: 'quasi', name: 'Baby Doge', address: A('44'), corpusTrigger: true }]);
    const r = matchKnowledge({ symbol: 'BABYDOGE', name: null, address: A('55'), twitterHandle: null, corpusText: '' }, index, { minCjk: 2, minLatin: 4 });
    assert(r.matches[0]?.rule === 'name_exact', 'C3 symbol 归一化后与条目名全等（name_exact）', r.matches[0]);
  }

  console.log('D. denylist 只压 substring/corpus');
  {
    const index = buildKnowledgeIndex([
      { id: 'b:p', kind: 'bluechip', name: 'PEPE 2.0', symbol: 'PEPE2', address: A('66'), corpusTrigger: true },
    ]);
    const cfg = { maxEntries: 5, minCjk: 2, minLatin: 4 };
    // 同名 → name_exact 照样命中（强信号不压）
    let r = matchKnowledge({ symbol: 'PEPE2.0', name: null, address: A('77'), twitterHandle: null, corpusText: '' }, index, cfg);
    assert(r.matches[0]?.rule === 'name_exact', 'D1 denylist 词 name_exact 同名仍命中', r.matches[0]);
    // 不同名但语料提及 → corpus 级被 denylist 压
    r = matchKnowledge({ symbol: 'XXX', name: '某某币', address: A('77'), twitterHandle: null, corpusText: '致敬 pepe 2.0' }, index, cfg);
    assert(r.matches.length === 0, 'D2 denylist 词 corpus_contains 压制', r.matches);
  }

  console.log('E. corpusTrigger:false 条目级防线');
  {
    const index = buildKnowledgeIndex([
      { id: 'b:k', kind: 'bluechip', name: '哭哭马', address: KK_MA, corpusTrigger: false },
    ]);
    const cfg = { maxEntries: 5, minCjk: 2, minLatin: 4 };
    let r = matchKnowledge({ symbol: 'KKNL', name: '哭哭奶龙', address: A('88'), twitterHandle: null, corpusText: '提到哭哭马' }, index, cfg);
    assert(r.matches.length === 0, 'E1 corpusTrigger:false → substring/corpus 双压制', r.matches);
    r = matchKnowledge({ symbol: '哭哭马', name: null, address: A('88'), twitterHandle: null, corpusText: '' }, index, cfg);
    assert(r.matches[0]?.rule === 'name_exact', 'E2 name_exact 不受 corpusTrigger 影响（同条目名 token）', r.matches[0]);
  }

  console.log('F. 封顶与输出形状');
  {
    const entries = [];
    for (let i = 0; i < 7; i++) entries.push({ id: `q:a${i}`, kind: 'quasi', name: `概念币${i}号`, address: A(String(100 + i)), corpusTrigger: true });
    const index = buildKnowledgeIndex(entries);
    const corpus = '概念币0号 概念币1号 概念币2号 概念币3号 概念币4号 概念币5号 概念币6号';
    const r = matchKnowledge({ symbol: 'ZZZ', name: '无名', address: A('999'), twitterHandle: null, corpusText: corpus }, index, { maxEntries: 5, minCjk: 2, minLatin: 4 });
    assert(r.matches.length === 5 && r.truncated === true, 'F1 maxEntries=5 截断 + truncated 留痕', { len: r.matches.length, truncated: r.truncated });
    assert(r.matches.every((m) => !('_score' in m) && m.entry && m.rule && m.matchedOn !== undefined), 'F2 输出剥 _score 且带 entry/rule/matchedOn');
    assert(r.scannedEntries === 7, 'F3 scannedEntries 记录扫描面', r.scannedEntries);
  }

  console.log('G. concept keyword（concept 条目不走 name_substring——类目名共享「概念」通用词全是噪声）');
  {
    const index = buildKnowledgeIndex([
      { id: 'concept:stock', kind: 'concept', name: '股票概念币', keywords: ['股票', '美股'], corpusTrigger: true },
    ]);
    let r = matchKnowledge({ symbol: 'TSLA6', name: '特斯拉概念', address: A('aa1'), twitterHandle: null, corpusText: '蹭美股热点发射' }, index, { maxEntries: 5, minCjk: 2, minLatin: 4 });
    assert(r.matches[0]?.rule === 'concept_keyword' && r.matches[0]?.matchedOn === '美股', 'G1 keywords 语料命中', r.matches[0]);
    r = matchKnowledge({ symbol: 'TSLA6', name: '特斯拉概念', address: A('aa1'), twitterHandle: null, corpusText: '普通梗币发射' }, index, { maxEntries: 5, minCjk: 2, minLatin: 4 });
    assert(r.matches.length === 0, 'G2 语料无关键词不命中（且 name「特斯拉概念」×「股票概念币」共享「概念」不触发 substring）', r.matches);
  }

  console.log('H. 空输入零命中');
  {
    assert(matchKnowledge(null, buildKnowledgeIndex([]), {}).matches.length === 0, 'H1 空 matchInput');
    const empty = buildKnowledgeIndex([]);
    assert(matchKnowledge({ symbol: 'X', name: 'X', address: A('1'), twitterHandle: null, corpusText: 'x' }, empty, {}).matches.length === 0, 'H2 空索引');
    assert(!isValidKnowledgeEntry({ name: 'X' }) && !isValidKnowledgeEntry({ name: 'X', kind: 'other' })
      && !isValidKnowledgeEntry({ name: 'X', kind: 'quasi', address: '0x123' })
      && isValidKnowledgeEntry({ name: 'X', kind: 'quasi' }), 'H3 条目最小校验（kind/address 形状）');
  }

  console.log('I. autoCorpusTriggerForEntry（builder 数据侧防线）');
  {
    assert(autoCorpusTriggerForEntry(['哭哭马']) === true, 'I1 正常 CJK 名 true');
    assert(autoCorpusTriggerForEntry(['PEPE 2.0', 'PEPE2']) === false, 'I2 denylist 命中 → false（alias 也压）');
    assert(autoCorpusTriggerForEntry(['DND']) === false, 'I3 3 latin < minLatin(4) 短名 → false（语料级触发不可靠）', autoCorpusTriggerForEntry(['DND']));
  }

  console.log('J. feedback 自反馈排除（C164 回归现场反证：C106 票 high 回写后 address_exact 命中自己=自锚定锁死）');
  {
    const selfAddr = A('d50e');
    const fbSelf = { id: 'q:' + selfAddr, kind: 'quasi', name: 'BNB Tree', address: selfAddr, source: 'feedback' };
    const index = buildKnowledgeIndex([fbSelf]);
    const r = matchKnowledge({ symbol: 'TREE', name: 'BNB Tree', address: selfAddr, twitterHandle: null, corpusText: '' }, index, {});
    assert(r.matches[0]?.rule === 'address_exact', 'J1 前置：feedback 条目对本票地址 address_exact 命中（排除逻辑挂 analyzer 侧）', r.matches[0]);
    const kept = excludeSelfFeedback(r.matches, selfAddr);
    assert(kept.length === 0, 'J2 feedback 自地址命中被剔除（「本系统评 high」不得当自己重析的证据）', kept);
    assert(excludeSelfFeedback(r.matches, A('ee1')).length === 1, 'J3 同条目对姐妹票地址保留（跨票 feedback 背景是设计内信号）');
    const bcSelf = { id: 'b:' + selfAddr, kind: 'bluechip', name: 'BNB Tree', address: selfAddr, source: 'gmgn' };
    const rBc = matchKnowledge({ symbol: 'TREE', name: 'BNB Tree', address: selfAddr, twitterHandle: null, corpusText: '' }, buildKnowledgeIndex([bcSelf]), {});
    assert(excludeSelfFeedback(rBc.matches, selfAddr).length === 1, 'J4 蓝筹自命中保留（客观 ATH 事实非主观评级）');
    assert(excludeSelfFeedback(null, selfAddr).length === 0 && excludeSelfFeedback(r.matches, null).length === 1, 'J5 空输入直通（null matches=空、无地址=不过滤）');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
