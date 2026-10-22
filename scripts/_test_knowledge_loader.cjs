#!/usr/bin/env node
/**
 * 知识库加载器单测（C165）——零 DB 零网络（真实 fs + 临时目录）
 *
 *   A. 五文件按 id 合并（后读覆盖）：manual 覆盖生成件 / feedback 覆盖 graduations
 *   B. 容错：损坏 JSON warn 跳过不抛；全缺失 → null；最小校验剔除（bad kind/地址形状）
 *   C. mtime 指纹热载：文件变化即重载（forceReload false）；invalidateKnowledgeBase
 *   D. 配置门：段缺失/enabled:false → null；options.config 注入生效
 *
 * 用法：node scripts/_test_knowledge_loader.cjs
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
    files: {
      concepts: 'config/knowledge/concepts.json',
      bluechips: 'config/knowledge/bluechips.json',
      manual: 'config/knowledge/manual-entries.json',
      quasiGraduations: 'data/knowledge/quasi-graduations.json',
      quasiFeedback: 'data/knowledge/quasi-feedback.json',
    },
  },
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-loader-'));
function writeCfg(relPath, obj) {
  const p = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
const touch = async (relPath) => {
  await new Promise((r) => setTimeout(r, 20)); // mtime 分辨率保险
  const p = path.join(tmpRoot, relPath);
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  doc.entries[0].updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(doc, null, 2));
};

(async () => {
  const { getKnowledgeBase, invalidateKnowledgeBase } = await import('../src/narrative/analyzer/knowledge/knowledge-loader.mjs');
  const opts = () => ({ config: CONFIG, root: tmpRoot });

  console.log('A. 五文件合并（后读覆盖同 id）');
  {
    const ADDR = A('ab1');
    writeCfg('config/knowledge/bluechips.json', { entries: [
      { id: `b:${ADDR}`, kind: 'bluechip', name: '彪哥', address: ADDR, narrative: '榜上版本' },
      { id: 'b:' + A('cd2'), kind: 'bluechip', name: '哭哭马', address: A('cd2') },
    ] });
    writeCfg('config/knowledge/manual-entries.json', { entries: [
      { id: `b:${ADDR}`, kind: 'bluechip', name: '彪哥', address: ADDR, narrative: 'manual 兜底版本' },
    ] });
    writeCfg('data/knowledge/quasi-graduations.json', { entries: [
      { id: `q:${ADDR}`, kind: 'quasi', name: '彪哥', address: ADDR, narrative: '毕业快照版' },
    ] });
    writeCfg('data/knowledge/quasi-feedback.json', { entries: [
      { id: `q:${ADDR}`, kind: 'quasi', name: '彪哥', address: ADDR, narrative: 'feedback 沉淀版' },
    ] });
    const kb = await getKnowledgeBase(opts());
    assert(kb && kb.entriesTotal === 3, 'A1 三有效条目（manual 覆盖 bluechip 同 id、feedback 覆盖 graduations 同 id）', kb?.entriesTotal);
    const manualEntry = kb.index.byAddress.get(ADDR);
    // manual 覆盖 bluechip（同 b:addr id）；feedback 覆盖 graduations（同 q:addr id）→ 地址索引指向后写的 feedback 条目
    assert(manualEntry.id === `q:${ADDR}` && manualEntry.narrative === 'feedback 沉淀版', 'A2 byAddress 指向覆盖序最后的条目', manualEntry);
    const all = kb.index.entries.map((e) => e.id).sort();
    assert(all.join() === ['b:' + A('cd2'), 'b:' + ADDR, 'q:' + ADDR].sort().join(), 'A3 两个 id 域并存（b:/q:）', all);
    await invalidateKnowledgeBase();
  }

  console.log('B. 容错');
  {
    // 损坏 concepts + 合法 bluechips → 跳过损坏不抛
    writeCfg('config/knowledge/concepts.json', { entries: [{ id: 'concept:x', kind: 'concept', name: 'X概念' }] });
    const p = path.join(tmpRoot, 'config/knowledge/concepts.json');
    fs.writeFileSync(p, '{ broken json !!!');
    let kb = await getKnowledgeBase(opts());
    assert(kb && kb.entriesTotal === 3 && !kb.index.byExactName.has('x概念'), 'B1 损坏文件 warn 跳过不抛（其余文件照载）', kb?.entriesTotal);
    // 最小校验剔除
    writeCfg('config/knowledge/bluechips.json', { entries: [
      { id: 'b:' + A('cd2'), kind: 'bluechip', name: '哭哭马', address: A('cd2') },
      { id: 'bad:1', kind: 'other', name: 'bad kind' },
      { id: 'bad:2', kind: 'quasi', name: 'bad addr', address: '0x123' },
      { kind: 'quasi' }, // 缺 name
    ] });
    await invalidateKnowledgeBase();
    kb = await getKnowledgeBase(opts());
    assert(kb.entriesTotal === 3, 'B2 最小校验剔除 3 条非法（kind/地址形状/缺 name）', kb.index.entries.map((e) => e.id));
    // 全缺失 → null
    fs.rmSync(path.join(tmpRoot, 'config'), { recursive: true, force: true });
    fs.rmSync(path.join(tmpRoot, 'data'), { recursive: true, force: true });
    await invalidateKnowledgeBase();
    kb = await getKnowledgeBase(opts());
    assert(kb === null, 'B3 全部文件缺失 → null（知识 miss=正常态）');
  }

  console.log('C. mtime 热载');
  {
    writeCfg('data/knowledge/quasi-feedback.json', { entries: [{ id: 'q:' + A('ef9'), kind: 'quasi', name: '热载票', address: A('ef9') }] });
    let kb = await getKnowledgeBase(opts());
    assert(kb.entriesTotal === 1 && kb.index.byExactName.has('热载票'), 'C1 首载');
    const firstLoadedAt = kb.loadedAt;
    await touch('data/knowledge/quasi-feedback.json');
    kb = await getKnowledgeBase(opts());
    assert(kb.loadedAt !== firstLoadedAt, 'C2 mtime 变化自动重载（免 invalidate）', { a: firstLoadedAt, b: kb.loadedAt });
    const kb2 = await getKnowledgeBase(opts());
    assert(kb2.loadedAt === kb.loadedAt, 'C3 指纹未变走缓存（loadedAt 不变）');
    await invalidateKnowledgeBase();
  }

  console.log('D. 配置门');
  {
    let kb = await getKnowledgeBase({ config: {}, root: tmpRoot });
    assert(kb === null, 'D1 段缺失 → null');
    kb = await getKnowledgeBase({ config: { knowledgeBase: { enabled: false } }, root: tmpRoot });
    assert(kb === null, 'D2 enabled:false → null');
    let threw = false;
    try { await getKnowledgeBase({ config: { knowledgeBase: { enabled: true, files: { concepts: '' } } }, root: tmpRoot }); }
    catch (e) { threw = true; }
    assert(threw, 'D3 enabled:true 但配置残缺 → throw fail-loud（部署错误不静默）');
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
