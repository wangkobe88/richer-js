#!/usr/bin/env node
/**
 * 一次性脚本：金狗集合第五批 5 票添加+同步（182 跑；用户 2026-11-21 裁定，bt-v164 >500% 筛选第四批入选）
 * 用后可删。addToken=轻查询；同步重查询在 182 合规环境串行执行。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { CaseCollectionService } = require('../src/web/services/CaseCollectionService');

const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105'; // 大金狗-尽量保证买入
const ADDRS = [
  '0xdbce339613344baf7c7203b81e4cee6f15457777', // 图力克 635.0%
  '0x7b0c9b1ba9674f75f2ec07f2e0a435d4db377777', // 행복의 날개 584.3%
  '0x0bba00ba64c147a6477fd18720b782a640357777', // 扁头 558.5%
  '0x824c49ea60b32f673c876f7f27f288bca68f7777', // ARB 514.0%
  '0xb8788ff72160ce1af974171e52d501f6903a7777', // 躺平人生 505.0%
];

(async () => {
  const svc = new CaseCollectionService();
  for (const addr of ADDRS) {
    try {
      await svc.addToken(COLLECTION_ID, { tokenAddress: addr, note: '第二批金狗（2026-11-21，bt-v164 >500% 人工筛选）' });
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
