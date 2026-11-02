#!/usr/bin/env node
/** 一次性（四票 gate 拦截取证，不进 git）：signals 里 cheat_gate 拒因+买点时点。本地小读取。 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();
const ADDRS = [
  '0xec74ec6b297fbe318ff09da24023319a36737777',
  '0x5a3f19b5bd587c4a127096ff37f6c9d59f007777',
  '0x43705ac9eb429777f3d993d854a29bcd61837777',
  '0xd827bc26713cb6412f4d163766938dee3d0c7777',
];
for (const ADDR of ADDRS) {
  const { data: sigs } = await sb.from('strategy_signals')
    .select('signal_type,action,created_at,metadata').eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(12);
  console.log(`\n${ADDR.slice(0, 10)}… signals=${sigs?.length ?? 0}`);
  for (const s of sigs ?? []) {
    const m = s.metadata || {};
    const cc = m.cheatCheck ? JSON.stringify(m.cheatCheck).slice(0, 260) : (m.gmgnCheck?.reason ? `gmgn:${m.gmgnCheck.reason}` : '');
    console.log(`  ${s.created_at} ${s.signal_type}/${s.action} ${cc}`);
  }
}
