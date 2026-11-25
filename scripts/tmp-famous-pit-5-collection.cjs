#!/usr/bin/env node
/**
 * 一次性：famous 坑 5 票小 case 集合（用户指令 2026-11-25「把这 5 票，形成一个小的
 * case 集合，前期测试，测试这个小的就行」）——182 跑。
 * addToken 自动 enqueueSync 串行链，全部入队后等链排空再报状态。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { CaseCollectionService } = require('../src/web/services/CaseCollectionService');

const NAME = 'famous坑5票';
const DESC = 'T238 famous 参与坑臂专题 5 票（金狗集合「希望进 famous 坑臂」标签子集，2026-11-25 用户指令建小集合供前期测试）：彪弟/超级汪汪队/ChillGuy/来财/小狗山';
const NOTE = 'T238 famous 坑专题 5 票（用户指令 2026-11-25）';
const TOKENS = [
  ['0x3b5c3271fb581e503389dd2c52a75065f36f7777', '彪弟'],
  ['0x7f0c0a0965ef4b9733ec0604c390d7e7a51f7777', '超级汪汪队'],
  ['0xb2c6ebd437b782729965015382392efa01f87777', 'ChillGuy'],
  ['0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', '来财'],
  ['0xf8c808a42c915409c53a66fbc56c1c3bf0f37777', '小狗山'],
];

(async () => {
  const svc = new CaseCollectionService();
  let col;
  try {
    col = await svc.create({ name: NAME, description: DESC });
  } catch (e) {
    if (e.status === 409) {
      console.log('集合已存在，改为复用：');
      const c = svc._client();
      const { data } = await c.from('case_collections').select('id, name').eq('name', NAME).single();
      col = data;
    } else throw e;
  }
  console.log(`集合: ${col.name} id=${col.id}`);

  const added = [];
  const failed = [];
  for (const [addr, sym] of TOKENS) {
    try {
      const r = await svc.addToken(col.id, { tokenAddress: addr, note: NOTE });
      added.push([addr, sym]);
      console.log(`ADD   ${sym}\t${addr}\tsync_state=${r.sync_state}`);
    } catch (e) {
      failed.push([addr, sym, e.message]);
      console.log(`FAIL  ${sym}\t${addr}\t${e.message}`);
    }
  }
  console.log(`--- 入队完成: 新增 ${added.length} / 失败 ${failed.length}；等待串行复制链排空…`);
  await svc._chain;
  const st = await svc.syncStatus(col.id);
  console.log(`--- 同步状态: ${JSON.stringify(st)}`);
  process.exit(failed.length ? 2 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
