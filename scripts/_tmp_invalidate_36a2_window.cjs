#!/usr/bin/env node
// ============================================================================
// 一次性：36a2c12a 窗口 token 全集的 token_narrative 缓存失效（比
// invalidate-referent-window.cjs 的 buy-signal 集更宽：experiment_tokens 全集 →
// 回测叙事直调触发集与 36a2c12a signal 集的差集票也强制重析）。
// 用法：node scripts/_tmp_invalidate_36a2_window.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const SRC = '36a2c12a-a7d6-47ec-ba7e-7f007562fdb4';
const COMMIT = process.argv.includes('--commit');
const CHUNK = 100;

(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const c = dbManager.getClient();
  const tokens = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await c.from('experiment_tokens').select('token_address')
      .eq('experiment_id', SRC).range(from, from + 999);
    if (error) throw new Error('tokens: ' + error.message);
    for (const r of data) if (r.token_address) tokens.add(r.token_address.toLowerCase());
    if (data.length < 1000) break;
  }
  const addrs = [...tokens];
  console.log(`experiment_tokens distinct: ${addrs.length}`);
  let validRows = 0;
  const validChunks = [];
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const chunk = addrs.slice(i, i + CHUNK);
    const { data, error } = await c.from('token_narrative').select('token_address')
      .eq('is_valid', true).in('token_address', chunk);
    if (error) throw new Error('tn: ' + error.message);
    if (data.length) { validRows += data.length; validChunks.push(chunk); }
  }
  console.log(`token_narrative 窗口内 is_valid=true 行: ${validRows}`);
  if (!COMMIT) { console.log('[dry-run] 未更新；加 --commit 置 is_valid=false'); process.exit(0); }
  for (const chunk of validChunks) {
    const { error } = await c.from('token_narrative').update({ is_valid: false })
      .eq('is_valid', true).in('token_address', chunk);
    if (error) throw new Error('update: ' + error.message);
  }
  console.log(`完成：${validChunks.length} 批失效（${validRows} 行）`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
