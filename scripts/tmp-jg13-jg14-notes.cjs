#!/usr/bin/env node
/**
 * 一次性脚本：JG-13/JG-14 落备注（用户裁定 2026-11-21，均先核验后写入）。
 * A) 0x00ee…7777 重新入金狗集合 a8414632（推翻 JG-10 移除）——走 CaseCollectionService.addToken
 *    正规入口（token_create 锚 + 后台串行复制），997 ticks 本地小票，写入即带完整备注，轮询等 synced。
 * B) 0x39ed…7777 追加备注（在集成员，保留原筛选注）——updateTokenNote。
 * 用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { CaseCollectionService } = require('../src/web/services/CaseCollectionService');

const COL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const A00EE = '0x00ee613ddfef429b892aa122c8a4fde764f47777';
const A39ED = '0x39ed13ccb5e067b7fce459548501cf2659287777';

const NOTE_00EE = '第二批金狗（2026-11-21，bt-v164 >500% 人工筛选）；用户观点（2026-11-21，已核验）：被 burst 承接冷盘提前卖出误伤——bt-v164 22:36:29 买入（P1 首买 0.2B，curVs +24.7% 门内，arm=sbw burst）；fire+15s 批1「15s承接0<0.1B」bypass 全清（profit 0；15s 窗内零成交=承接根本没来非承接弱）；真承接 +74s 才到（22:37:43 ≈0.6B 买波）；此后 5h50m 慢磨至毕业（fundsBnb 12.16B），ATH=卖价 ×10.06（vs launch +1154%）——两批承接窗 15s/30s 均盖不住慢热形状。JG-10 移除裁定经此推翻（JG-13）。⚠本票 trades/signal.price 为 quote 计价轴（4.28e-6），涨幅/因子为 BNB 轴（5.45e-9），比值 784.6=当时 quote/BNB 汇率';
const VIEW_39ED = '用户观点（2026-11-21，已核验）：活跃度变高后，价格已经脱离买入范围——开盘首波 22s 即越 +28.5%（0.76B/0.89B 高活跃直接穿门）；回落死寂段价 +5% 门内但 10s 活跃≈0，+205s 唯一信号（quietSurge 0.21B，curVs +22.4% 门内）被 FP act_low 拒（actTotalBnb 0.197B，execution_reason=factor_gate_act_low）；活跃度真回来（+260s 0.46B@+29.6%、+340s 1.45B@+116.5%）时价格已出购买域——活跃达标窗与价格门内窗完全错开，零成交';

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const svc = new CaseCollectionService();

  // A) 0x00ee 重新入集（JG-13）
  const { data: pre } = await svc._client().from('case_collection_tokens')
    .select('token_address').eq('collection_id', COL).eq('token_address', A00EE).maybeSingle();
  if (pre) throw new Error('0x00ee 已在集合中（预期不在，JG-10 已移除）——改走备注追加路径');
  console.log('[A] 0x00ee 不在集合（与 JG-10 一致）→ addToken 重新入集…');
  const added = await svc.addToken(COL, { tokenAddress: A00EE, note: NOTE_00EE });
  console.log(`[A] 已插入成员行: platform=${added.platform} sync_state=${added.sync_state}`);
  console.log('[A] 等待后台串行复制…');
  let row = added;
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const { data: m } = await svc._client().from('case_collection_tokens')
      .select('sync_state, sync_error, tick_count, event_count')
      .eq('collection_id', COL).eq('token_address', A00EE).maybeSingle();
    row = m || row;
    if (row.sync_state === 'synced' || row.sync_state === 'failed') break;
  }
  console.log(`[A] 终态: sync_state=${row.sync_state} ticks=${row.tick_count} events=${row.event_count}${row.sync_error ? ' err=' + row.sync_error : ''}`);
  if (row.sync_state !== 'synced') throw new Error('0x00ee 同步未达成 synced（JG-10 记载基线 ticks=997/events=3）');
  if (row.tick_count !== 997 || row.event_count !== 3) {
    console.log(`[A] ⚠ 对账差异：JG-10 移除时基线 ticks=997/events=3，本次=${row.tick_count}/${row.event_count}（若上游有新行须人工确认）`);
  }
  // 复核 note
  const { data: chk } = await svc._client().from('case_collection_tokens')
    .select('note').eq('collection_id', COL).eq('token_address', A00EE).single();
  console.log(`[A] note 落位（${chk.note.length} 字）: ${chk.note.slice(0, 80)}…`);

  // B) 0x39ed 备注追加（JG-14）
  const { data: m2 } = await svc._client().from('case_collection_tokens')
    .select('note').eq('collection_id', COL).eq('token_address', A39ED).maybeSingle();
  if (!m2) throw new Error('0x39ed 不在集合中（预期在位）');
  const newNote2 = m2.note ? `${m2.note}；${VIEW_39ED}` : VIEW_39ED;
  const upd = await svc.updateTokenNote(COL, A39ED, { note: newNote2 });
  console.log(`\n[B] 0x39ed note 已更新（${upd.note.length} 字，原 ${m2.note.length} 字）: ${upd.note.slice(0, 80)}…`);

  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
