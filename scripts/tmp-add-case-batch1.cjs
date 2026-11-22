#!/usr/bin/env node
/**
 * 一次性脚本：金狗集合第一批 8 票添加+同步（182 跑；用户 2026-11-21 提供）
 * 用后可删。addToken=轻查询；同步重查询在 182 合规环境串行执行。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { CaseCollectionService } = require('../src/web/services/CaseCollectionService');

const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105'; // 大金狗-尽量保证买入
const ADDRS = [
  '0xa79e736482f55c89e42000151e04af630f2b7777',
  '0xf38f48cfe9e84920e7de4d47823a0fba95a87777',
  '0xb6eeb994aa5ea8e2b5bd4fde8e57e15b0ecd7777',
  '0x76b0dc293faec388e38e5e0013eb7b48312d7777',
  '0x4509204c4f82dee14352bf7cfafae4138b287777',
  '0xc0e896ddec43881055a25786c17fa5d5d6337777',
  '0xc66b1c0b674b00003346b8bb56367a7644ec7777',
  '0x1a0810861af30ed2b85ec2c195f36fb58fc97777',
];

(async () => {
  const svc = new CaseCollectionService();
  for (const addr of ADDRS) {
    try {
      await svc.addToken(COLLECTION_ID, { tokenAddress: addr, note: '第一批金狗（2026-11-21）' });
      console.log(`added ${addr}（已入队同步）`);
    } catch (err) {
      console.log(`skip  ${addr}: [${err.status || 500}] ${err.message}`);
    }
  }
  console.log('等待串行复制链完成…');
  await svc._chain;
  const st = await svc.syncStatus(COLLECTION_ID);
  console.log('汇总:', JSON.stringify(st.summary));
  for (const t of st.tokens) {
    console.log(`  ${t.tokenAddress} ${t.syncState} ticks=${t.tickCount} events=${t.eventCount}${t.syncError ? ' err=' + t.syncError : ''}`);
  }
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
