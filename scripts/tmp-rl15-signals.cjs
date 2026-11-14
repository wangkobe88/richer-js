#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：0x28ad2c7d bt-s01 全 BUY 信号×门链明细——回答「RL15 臂触发了吗」。
// 打印每行：created_at / legId+triggerNo / cheat 段 grade·reason·unblocked /
// buyPoint 段 bucket / execution 状态；末尾 strategy_library ladder v10 腿映射表。
// ============================================================================
require('dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const BT = '6a02e983-9a6f-48d3-b47e-aa796bef4c18';
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';

async function main() {
  const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');
  const db = dbManager.getClient();

  const { data: sigs, error } = await db.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', BT).eq('signal_type', 'BUY').eq('token_address', TOKEN)
    .order('created_at');
  if (error) throw new Error(error.message);
  console.log(`[bt-s01 0x28ad2c7d] BUY 信号共 ${sigs.length} 行\n`);
  for (const s of sigs) {
    const m = s.metadata || {};
    const g = m.signalGate || {};
    const c = m.cheatCheck || {};
    const b = m.buyPoint || {};
    const a = b.assessment || {};
    console.log([
      s.created_at.slice(11, 23),
      `leg=${g.legId ?? '?'}`,
      `trig=${g.triggerNo ?? '?'}`,
      `cheat=${c.grade ?? c.status ?? '?'}${c.reason ? `(${c.reason})` : ''}${c.unblocked ? '·unblocked' : ''}`,
      `bp=${a.bucket ?? b.status ?? '-'}`,
      `exec=${m.execution_status ?? m.status ?? '-'}`,
    ].join('  '));
  }

  // ladder v10 腿映射（priority→条件串）
  const { data: lib } = await db.from('strategy_library')
    .select('name,version,legs')
    .eq('name', 'signal-source-ladder-v1');
  const entry = lib && lib[0];
  if (entry) {
    console.log(`\n[库] ${entry.name} version=${entry.version}`);
    (entry.legs || []).filter((l) => l.side === 'buy').forEach((l) => {
      console.log(`  priority=${l.priority}  ${String(l.condition).slice(0, 110)}`);
    });
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
