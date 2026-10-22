#!/usr/bin/env node
/**
 * 知识库注入段单测（C165）——零 DB 零网络
 *
 *   A. 段构建 buildKnowledgeSection：
 *      A1 null/undefined/空 matches → ''（bit-parity 前提）
 *      A2 段形状（标题/免责声明/条目行/匹配规则中文名/truncated 提示）
 *      A3 单条 narrative 截 300 / 整段 safeSubstring 封顶
 *      A4 bluechip ATH 事实行 / quasi 毕业日期+评级事实行
 *   B. buildJevState bit-parity：带/不带 knowledgeMatches（null 与空 matches）state 逐字节相等；
 *      命中时 state 含 [KNOWLEDGE_BASE] 且 stats.knowledgeSection 观测在
 *   C. buildPrestageState 同款（header 尾挂位 + bit-parity + stats 观测）
 *
 * 用法：node scripts/_test_knowledge_section.cjs
 */
'use strict';

let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra !== undefined ? ` | ${JSON.stringify(extra)}` : ''}`); }
}
const A = (hex) => `0x${hex.padStart(40, '0')}`;

const NOW = Date.UTC(2026, 9, 22, 0, 0, 0); // 固定基准（时效项确定性）
const TOKEN = { symbol: 'KKNL', address: A('ef4'), raw_api_data: { name: '哭哭奶龙' } };
const FETCH = {};

(async () => {
  const { buildKnowledgeSection } = await import('../src/narrative/analyzer/prompts/sections/knowledge-section.mjs');
  const { buildJevState, buildPrestageState } = await import('../src/narrative/analyzer/llm/jev-state-builder.mjs');

  console.log('A. buildKnowledgeSection');
  {
    assert(buildKnowledgeSection(null) === '' && buildKnowledgeSection(undefined) === ''
      && buildKnowledgeSection({ matches: [] }) === '', 'A1 null/undefined/空 matches → \'\'');
    const matches = {
      matches: [
        { entryId: 'b:' + A('cd2'), kind: 'bluechip', rule: 'name_substring', matchedOn: '哭哭', matchedField: 'name',
          entry: { id: 'b:' + A('cd2'), kind: 'bluechip', name: '哭哭马', symbol: 'KKMA', address: A('cd2'), narrative: '哭哭马 IP 系 meme，先于奶龙发行', athMarketCapUsd: 2_500_000 } },
        { entryId: 'q:' + A('77'), kind: 'quasi', rule: 'corpus_contains', matchedOn: '某某币', matchedField: 'corpus',
          entry: { id: 'q:' + A('77'), kind: 'quasi', name: '某某币', symbol: 'XYZ', address: A('77'), narrative: '蹭热点发射', graduatedAt: '2026-10-20T01:02:03Z', rating: 'high' } },
      ],
      truncated: false,
    };
    const s = buildKnowledgeSection(matches);
    assert(s.startsWith('[KNOWLEDGE_BASE] 系统知识库背景（系统预取，非代币自有语料）'), 'A2 标题行', s.slice(0, 60));
    assert(s.includes('⚠️') && s.includes('仍须按题集逐题判定'), 'A3 免责声明两要素');
    assert(s.includes('[bluechip] 哭哭马 KKMA') && s.includes('ATH市值≈$2500k'), 'A4 bluechip 条目行 + ATH 事实行', s);
    assert(s.includes('[quasi] 某某币 XYZ') && s.includes('毕业 2026-10-20') && s.includes('本系统评 high'), 'A5 quasi 条目行 + 毕业/评级事实行', s);
    assert(s.includes('匹配：名字共享片段「哭哭」') && s.includes('匹配：语料提及「某某币」'), 'A6 规则中文名 + matchedOn');
    assert(buildKnowledgeSection({ ...matches, truncated: true }).includes('已按匹配优先级截断'), 'A7 truncated 提示行');
    const long = buildKnowledgeSection({ matches: [{ entryId: 'x', kind: 'quasi', rule: 'name_exact', matchedOn: 'x', entry: { kind: 'quasi', name: 'X'.repeat(50), narrative: '长'.repeat(400) } }], truncated: false });
    assert(long.includes('长'.repeat(300) + '…') && !long.includes('长'.repeat(301)), 'A8 单条 narrative 截 300 带省略号标记');
    const capped = buildKnowledgeSection({ matches: [
      { entryId: 'x', kind: 'quasi', rule: 'name_exact', matchedOn: 'x', entry: { kind: 'quasi', name: 'N', narrative: '字'.repeat(400) } },
      { entryId: 'y', kind: 'quasi', rule: 'name_exact', matchedOn: 'y', entry: { kind: 'quasi', name: 'M', narrative: '字'.repeat(400) } },
      { entryId: 'z', kind: 'quasi', rule: 'name_exact', matchedOn: 'z', entry: { kind: 'quasi', name: 'L', narrative: '字'.repeat(400) } },
    ], truncated: false }, { maxChars: 1000 });
    assert(capped.length <= 1050 && capped.includes('知识条目已截断'), 'A9 整段 safeSubstring 封顶 + 截断提示', capped.length);
    assert(buildKnowledgeSection(matches, { maxChars: 50 }).length <= 100, 'A10 maxChars 显式覆盖生效');
  }

  console.log('B. buildJevState bit-parity 与观测');
  {
    const base = buildJevState(TOKEN, FETCH, { now: NOW });
    const withNull = buildJevState(TOKEN, FETCH, { now: NOW, knowledgeMatches: null });
    const withEmpty = buildJevState(TOKEN, FETCH, { now: NOW, knowledgeMatches: { matches: [], truncated: false, scannedEntries: 3 } });
    assert(base.state === withNull.state && base.state === withEmpty.state, 'B1 null/空 matches state 逐字节相等', { a: base.state.length, b: withNull.state.length, c: withEmpty.state.length });
    assert(!('knowledgeSection' in base.stats), 'B2 无命中不落 stats.knowledgeSection（bit-parity）');
    const matches = { matches: [{ entryId: 'b:' + A('cd2'), kind: 'bluechip', rule: 'name_substring', matchedOn: '哭哭', matchedField: 'name', entry: { id: 'b:' + A('cd2'), kind: 'bluechip', name: '哭哭马', narrative: '哭哭马 IP' } }], truncated: false };
    const withHit = buildJevState(TOKEN, FETCH, { now: NOW, knowledgeMatches: matches });
    assert(withHit.state.includes('[KNOWLEDGE_BASE]'), 'B3 命中时 state 含 [KNOWLEDGE_BASE] 段');
    assert(withHit.state.length > base.state.length && withHit.state.startsWith(base.state.slice(0, 200)), 'B4 段为增量（前缀不变）');
    assert(withHit.stats.knowledgeSection && withHit.stats.knowledgeSection.entries === 1
      && withHit.stats.knowledgeSection.chars > 0, 'B5 stats.knowledgeSection 观测（chars/entries）', withHit.stats.knowledgeSection);
  }

  console.log('C. buildPrestageState 同款');
  {
    const acc = { type: 'account', screen_name: 'test', name: 'Test', description: 'bio', followers_count: 10, verified: false, is_blue_verified: false, statuses_count: 5, created_at: '2020-01-01T00:00:00Z', tweets: [{ tweet_id: '1', text: 'hello', created_at: '2026-10-20T00:00:00Z' }] };
    const base = buildPrestageState(TOKEN, acc, { now: NOW });
    const withNull = buildPrestageState(TOKEN, acc, { now: NOW, knowledgeMatches: null });
    const withEmpty = buildPrestageState(TOKEN, acc, { now: NOW, knowledgeMatches: { matches: [], truncated: false } });
    assert(base.state === withNull.state && base.state === withEmpty.state, 'C1 prestage null/空 matches 逐字节相等');
    const matches = { matches: [{ entryId: 'concept:flap', kind: 'concept', rule: 'concept_keyword', matchedOn: 'flap', matchedField: 'corpus', entry: { id: 'concept:flap', kind: 'concept', name: 'Flap', narrative: 'BSC 发射平台' } }], truncated: false };
    const withHit = buildPrestageState(TOKEN, acc, { now: NOW, knowledgeMatches: matches });
    assert(withHit.state.includes('[KNOWLEDGE_BASE]'), 'C2 prestage 命中注入段');
    assert(withHit.stats.knowledgeSection?.entries === 1, 'C3 prestage stats 观测', withHit.stats.knowledgeSection);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
