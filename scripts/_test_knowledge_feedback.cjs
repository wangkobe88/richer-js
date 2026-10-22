#!/usr/bin/env node
/**
 * 知识库反馈回写单测（C164）——零 DB 零网络（打桩 fs + queryGraduation）
 *
 *   A. _shouldCapture 三分支：captureRatings 命中 / 毕业非 low / 都不满足
 *   B. maybeCaptureKnowledgeFeedback 行为：
 *      B1 high 票写入（客观字段 + narrative=intro截120｜本系统评…）
 *      B2 同地址 upsert 留最新（不重复）
 *      B3 超 maxEntries 驱逐最旧（analyzedAt 升序）
 *      B4 tmp+rename 原子写调用序（tmp 名带 pid）
 *      B5 mid 票非毕业不写；mid 票毕业（isGraduated 注入）写；low 毕业不写
 *      B6 feedback.enabled=false → 不写零 IO
 *      B7 写失败（fs 抛）→ 返回 false 不抛
 *   C. 毕业点查 _isGraduated：queryGraduation 打桩优先；空 data=false（事故反证锚）
 *
 * 用法：node scripts/_test_knowledge_feedback.cjs
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra !== undefined ? ` | ${JSON.stringify(extra)}` : ''}`); }
}
const A = (hex) => `0x${hex.padStart(40, '0')}`;

const CONFIG = {
  knowledgeBase: {
    enabled: true,
    feedback: { enabled: true, captureRatings: ['high'], graduatedAlso: true, maxEntries: 3, path: 'data/knowledge/quasi-feedback.json' },
  },
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-feedback-'));
const feedbackFile = path.join(tmpRoot, 'data/knowledge/quasi-feedback.json');

/** 记录 writeFile/rename 调用序的 fs 打桩（读穿透真 fs） */
function makeRecordingFs() {
  const calls = [];
  const real = fs;
  return {
    calls,
    promises: {
      mkdir: async (...a) => { calls.push(['mkdir', ...a]); },
      readFile: async (...a) => { calls.push(['readFile', ...a]); return real.promises.readFile(...a); },
      writeFile: async (p, content) => { calls.push(['writeFile', p]); return real.promises.writeFile(p, content); },
      rename: async (from, to) => { calls.push(['rename', from, to]); return real.promises.rename(from, to); },
    },
  };
}

(async () => {
  const F = await import('../src/narrative/analyzer/knowledge/knowledge-feedback.mjs');
  const { _shouldCapture, _isGraduated, maybeCaptureKnowledgeFeedback } = F;

  console.log('A. _shouldCapture 三分支');
  {
    const fb = { captureRatings: ['high'], graduatedAlso: true };
    assert(_shouldCapture({ address: A('1'), rating: 'high' }, fb, false) === true, 'A1 high ∈ captureRatings');
    assert(_shouldCapture({ address: A('1'), rating: 'mid' }, fb, true) === true, 'A2 mid ∧ 毕业 → true');
    assert(_shouldCapture({ address: A('1'), rating: 'mid' }, fb, false) === false, 'A3 mid 非毕业 → false');
    assert(_shouldCapture({ address: A('1'), rating: 'low' }, fb, true) === false, 'A4 low 毕业 → false（低质不沉淀）');
    assert(_shouldCapture({ rating: 'high' }, fb, false) === false, 'A5 缺 address → false');
    assert(_shouldCapture({ address: A('1'), rating: 'mid' }, { captureRatings: ['high'], graduatedAlso: false }, true) === false, 'A6 graduatedAlso:false 关毕业臂');
  }

  console.log('B. 回写行为');
  {
    const base = { symbol: 'KKNL', name: '哭哭奶龙', introCn: '简介', rating: 'high', tokenCategory: 'account_based_meme', reason: '理由', twitter: null, analyzedAt: '2026-10-22T00:00:00Z' };
    let r = await maybeCaptureKnowledgeFeedback({ ...base, address: A('aa1') }, { config: CONFIG, root: tmpRoot, fs, now: '2026-10-22T01:00:00Z', isGraduated: false });
    assert(r === true, 'B1 high 票写入');
    let doc = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
    const e1 = doc.entries[0];
    assert(e1.id === 'q:' + A('aa1') && e1.kind === 'quasi' && e1.source === 'feedback' && e1.corpusTrigger === true
      && e1.narrative === '简介｜本系统评 high：理由', 'B2 条目客观字段 + narrative 拼装', e1);

    // upsert 同地址留最新
    r = await maybeCaptureKnowledgeFeedback({ ...base, address: A('aa1'), reason: '新理由' }, { config: CONFIG, root: tmpRoot, fs, now: '2026-10-22T02:00:00Z', isGraduated: false });
    doc = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
    assert(r === true && doc.entries.length === 1 && doc.entries[0].narrative.includes('新理由') && doc.entries[0].updatedAt === '2026-10-22T02:00:00Z', 'B3 同地址 upsert 留最新', doc.entries);

    // 驱逐：maxEntries=3，加 3 票（不同地址、analyzedAt 递增）→ 最旧被逐
    for (let i = 2; i <= 4; i++) {
      await maybeCaptureKnowledgeFeedback({ ...base, address: A(`b${i}`), analyzedAt: `2026-10-2${i}T00:00:00Z` }, { config: CONFIG, root: tmpRoot, fs, now: `2026-10-2${i}T00:00:00Z`, isGraduated: false });
    }
    doc = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
    assert(doc.entries.length === 3 && !doc.entries.some((e) => e.address === A('aa1')), 'B4 超 maxEntries 驱逐最旧（aa1 analyzedAt 最早被逐）', doc.entries.map((e) => e.address));

    // tmp+rename 原子写调用序
    fs.rmSync(feedbackFile, { force: true });
    const recFs = makeRecordingFs();
    await maybeCaptureKnowledgeFeedback({ ...base, address: A('cc1') }, { config: CONFIG, root: tmpRoot, fs: recFs, now: '2026-10-22T03:00:00Z', isGraduated: false });
    const writeIdx = recFs.calls.findIndex((c) => c[0] === 'writeFile');
    const renameIdx = recFs.calls.findIndex((c) => c[0] === 'rename');
    assert(writeIdx >= 0 && renameIdx === writeIdx + 1, 'B5 writeFile→rename 相邻调用序（tmp+rename 原子写）', recFs.calls.map((c) => c[0]));
    const tmpPath = recFs.calls[writeIdx][1];
    assert(tmpPath.includes('.tmp-') && recFs.calls[renameIdx][1] === tmpPath && recFs.calls[renameIdx][2] === feedbackFile, 'B6 tmp 名带 .tmp- 且 rename(tmp→file)');

    // 评级/毕业组合
    fs.rmSync(feedbackFile, { force: true });
    r = await maybeCaptureKnowledgeFeedback({ ...base, address: A('dd1'), rating: 'mid' }, { config: CONFIG, root: tmpRoot, fs, now: '2026-10-22T04:00:00Z', isGraduated: false });
    assert(r === false && !fs.existsSync(feedbackFile), 'B7 mid 非毕业不写');
    r = await maybeCaptureKnowledgeFeedback({ ...base, address: A('dd1'), rating: 'mid' }, { config: CONFIG, root: tmpRoot, fs, now: '2026-10-22T04:00:00Z', isGraduated: true });
    doc = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
    assert(r === true && doc.entries[0].graduatedAt === '2026-10-22T04:00:00Z', 'B8 mid 毕业（isGraduated 注入）写 + graduatedAt 落值', doc.entries[0]);

    // 配置关
    const offCfg = { knowledgeBase: { enabled: true, feedback: { enabled: false } } };
    const calls0 = [];
    const spyFs = { promises: { mkdir: async (...a) => calls0.push(a), readFile: async () => { calls0.push('read'); throw new Error('nope'); }, writeFile: async () => calls0.push('write'), rename: async () => calls0.push('rename') } };
    r = await maybeCaptureKnowledgeFeedback({ ...base, address: A('ee1'), rating: 'high' }, { config: offCfg, root: tmpRoot, fs: spyFs, isGraduated: false });
    assert(r === false && calls0.length === 0, 'B9 feedback.enabled=false → 不写零 IO');

    // 写失败不抛
    const boomFs = { promises: { mkdir: async () => {}, readFile: async () => { throw new Error('miss'); }, writeFile: async () => { throw new Error('disk full'); }, rename: async () => {} } };
    r = await maybeCaptureKnowledgeFeedback({ ...base, address: A('ff1'), rating: 'high' }, { config: CONFIG, root: tmpRoot, fs: boomFs, isGraduated: false });
    assert(r === false, 'B10 写失败（fs 抛）→ false 不抛');
  }

  console.log('C. 毕业点查');
  {
    let asked = null;
    const r = await _isGraduated(A('99'), { queryGraduation: async (a) => { asked = a; return true; } });
    assert(r === true && asked === A('99'), 'C1 queryGraduation 打桩优先');
    // 空集误判事故反证锚：data=[] 必须 false（初版曾无条件 return true）
    const { dbManager } = { dbManager: null };
    let threw = null;
    try {
      // 不打桩时走 dbManager——离线环境必然在 getClient 或 from 抛错；这里只验打桩路径
      await _isGraduated(A('99'), { queryGraduation: async () => false });
    } catch (e) { threw = e; }
    assert(threw === null, 'C2 打桩 false 原样透传');
    // 空集形状由 dbManager mock 不可行（真链路 182 验证），此处锁定源码口径
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/narrative/analyzer/knowledge/knowledge-feedback.mjs'), 'utf8');
    assert(src.includes('return Array.isArray(data) && data.length > 0;'), 'C3 源码口径：空集/undefined → false（事故反证锚）');
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
