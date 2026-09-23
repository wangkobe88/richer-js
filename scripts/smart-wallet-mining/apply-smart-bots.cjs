#!/usr/bin/env node
// ============================================================================
// 高频 bot 钱名单落库（apply-smart-bots）——pumpfun-wss-trader 同名脚本 BSC 移植（批 3.2）
//
// 从 mine 产出的 smart-wallets-{ts}.json 里挑出 notes 含「高频bot样」的入榜钱包，
// upsert wallets.category='smart_bot'（chain='bsc'）——批 3.3 FA.loadSmartBotWallets
// 消费该名单出 smartBotCount 观察因子。
//
// ★BSC 与母版差异：
//   - wallets 表仅 {id,address,chain,name,category}：母版顺带写的 tags/clusters 列不存在，不迁；
//     upsert 只送 {address,chain,category}——PostgREST on conflict 只更新送入列，name 保留。
//   - 人工标注冲突（现有 category 非空且非 smart_bot/smart_money）跳过+告警，不覆盖
//     （mine --apply 同一约定）。
//   - 回读断言按本次运行精确计数：.in(address, 本次 botAddrs) .eq category='smart_bot'
//     分页求和 === 本次 upsert 行数（母版全局 count 会跨运行累计，等值断言必假）。
//
// 写操作（upsert）——建议 182 跑；量小（≤数百行）本地可跑但遵守红线优先远程。
// 用法：node scripts/smart-wallet-mining/apply-smart-bots.cjs --json data/smart-wallets-XXX.json [--dry-run]
// ============================================================================
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../..', 'config/.env') });

function parseArgs(argv) {
  const a = argv || process.argv.slice(2);
  const o = { json: null, dryRun: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--json') o.json = a[++i];
    else if (a[i] === '--dry-run') o.dryRun = true;
    else { console.error(`未知参数: ${a[i]}`); process.exit(1); }
  }
  if (!o.json) {
    const dir = path.join(__dirname, '../..', 'data');
    const cands = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^smart-wallets-.*\.json$/.test(f)).sort() : [];
    if (!cands.length) { console.error('未指定 --json 且 data/ 下无 smart-wallets-*.json'); process.exit(1); }
    o.json = path.join(dir, cands[cands.length - 1]);
  }
  return o;
}

async function main() {
  const opt = parseArgs();
  const R = JSON.parse(fs.readFileSync(opt.json, 'utf8'));
  const listed = [...(R.batch1 || []), ...(R.batch2 || [])];
  const bots = listed.filter(s => (s.notes || '').includes('高频bot样'));
  console.log(`源 ${path.basename(opt.json)}：入榜 ${listed.length}（批1 ${((R.batch1) || []).length} + 批2 ${((R.batch2) || []).length}），高频bot样 ${bots.length} 个`);
  if (!bots.length) { console.log('无 bot 名单，结束'); return; }

  const { dbManager } = require('../../src/services/dbManager');
  const sb = dbManager.getClient();

  // 预取现有 category：人工标注（非空且非 smart 族）跳过不覆盖
  const botAddrs = bots.map(s => s.address);
  const existing = new Map();
  for (let i = 0; i < botAddrs.length; i += 300) {
    const { data, error } = await sb.from('wallets').select('address,category').in('address', botAddrs.slice(i, i + 300));
    if (error) throw new Error(`wallets 预取失败: ${error.message}`);
    for (const r of (data || [])) existing.set(r.address, r.category);
  }
  const applyBots = [];
  let skipped = 0;
  for (const a of botAddrs) {
    const cat = existing.get(a) || null;
    if (cat && cat !== 'smart_bot' && cat !== 'smart_money') { skipped++; console.warn(`  ⚠️ 跳过 ${a}（人工标注 category='${cat}'，不覆盖）`); continue; }
    applyBots.push(a);
  }
  console.log(`待写入 ${applyBots.length} 个（人工标注冲突跳过 ${skipped}）`);
  if (opt.dryRun) { console.log('--dry-run：不写入。名单：'); for (const a of applyBots) console.log(`  ${a}`); return; }
  if (!applyBots.length) { console.log('无可写入行，结束'); return; }

  // 分页 upsert（100/页）
  let upserted = 0;
  for (let i = 0; i < applyBots.length; i += 100) {
    const rows = applyBots.slice(i, i + 100).map(a => ({ address: a, chain: 'bsc', category: 'smart_bot' }));
    const { error } = await sb.from('wallets').upsert(rows, { onConflict: 'address,chain' });
    if (error) throw new Error(`upsert 失败(页 ${i / 100 + 1}): ${error.message}`);
    upserted += rows.length;
  }

  // 回读断言（本次运行精确计数，非全局 count）
  let readBack = 0;
  for (let i = 0; i < applyBots.length; i += 500) {
    const { data, error } = await sb.from('wallets').select('address')
      .eq('chain', 'bsc').eq('category', 'smart_bot').in('address', applyBots.slice(i, i + 500));
    if (error) throw new Error(`回读失败: ${error.message}`);
    readBack += (data || []).length;
  }
  if (readBack !== upserted) {
    console.error(`⛔ 回读断言失败：写入 ${upserted} 行，回读到 smart_bot ${readBack} 行（本次名单内）`);
    process.exit(1);
  }
  console.log(`✅ wallets.category='smart_bot' 写入 ${upserted} 行，回读 ${readBack} 行一致`);
}

if (require.main === module) {
  main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
}
module.exports = { parseArgs };
