#!/usr/bin/env node
/** T225：建 solodance-8 候选池 case 集合（8 票成员，token_meta 形状契约同 CaseCollectionService） */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const TOKENS = [
  '0x1a0810861af30ed2b85ec2c195f36fb58fc97777', // LAB（+305% 毕业）
  '0xa38b2d9478d8a9ed87ec0fc93ea29e3e69dc7777', // 개구리씨（+404% 毕业）
  '0xe1fcd957c62bc2da3b8337a986710142531d7777', // 湖南nice（平）
  '0x5bd4383824477a7f7ae7fe66e1e03f87372f7777', // ZEC（平）
  '0x5cd0755bb61818c7b1f2c0dae03b83c63bd67777', // Willow（-0.4%）
  '0x3f7031be6094a94e8b75ad846fac6dfa1c977777', // Fomies（-19%）
  '0x29f4940f61456774daceed255c69873002617777', // 庄周（-20%）
  '0xbda9abd9e7f9afefabfd0965c9d6f07153347777', // 吕吕（-26%）
];
(async () => {
  const db = dbManager.getClient();
  const NAME = 'solodance-8-独舞候选池';
  const { data: exist } = await db.from('case_collections').select('id, name').eq('name', NAME).maybeSingle();
  let colId = exist && exist.id;
  if (!colId) {
    const { data: ins, error } = await db.from('case_collections')
      .insert({ name: NAME, description: 'T225 独舞形态候选池（唯一大户∧出口留仓 三窗首fire 8 票）：LAB/개구리씨 两张毕业+6 张死盘对照——纯独舞买腿+v7 卖腿回测对拍用' })
      .select('id, name').single();
    if (error) throw new Error(error.message);
    colId = ins.id;
    console.log('集合已建:', NAME, colId);
  } else console.log('集合已存在:', colId);
  for (const addr of TOKENS) {
    const { data: row } = await db.from('wss_events')
      .select('id, token_address, platform, payload, block_time', { count: 'exact' })
      .eq('token_address', addr).eq('kind', 'token_create').order('block_time', { ascending: true }).limit(1);
    if (!row || !row.length) { console.error('  无 token_create，跳过:', addr); continue; }
    const c = row[0];
    const tokenMeta = { payload: c.payload || {}, blockTimeIso: c.block_time || null, sourceEventId: c.id != null ? Number(c.id) : null, platform: c.platform || 'fourmeme' };
    const { error } = await db.from('case_collection_tokens')
      .insert({ collection_id: colId, token_address: addr, platform: c.platform || 'fourmeme', note: '', token_meta: tokenMeta, sync_state: 'pending' });
    if (error) {
      if (String(error.message).includes('duplicate key') || String(error.message).includes('unique')) console.log('  已在集合:', addr.slice(0, 10));
      else throw new Error(error.message);
    } else console.log('  +', addr.slice(0, 12), (c.payload && c.payload.symbol) || '');
  }
  console.log('完成。同步请跑: node scripts/sync-case-collection.cjs --collection', colId);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
