#!/usr/bin/env node
// tmp：CD122 锚窗逐笔明细——验证「top2 不是单一钱包而是捆绑簇」裁定事实
import { createRequire } from 'module';
const require_ = createRequire(new URL('file://' + process.cwd() + '/').href);
const { dbManager } = require_('./src/services/dbManager.js');
const c = dbManager.getClient();
const { data } = await c.from('wss_price_ticks')
  .select('block_number,log_index,trade_type,bnb_amount,token_amount,trader_address,sender_address,tx_hash')
  .eq('token_address', '0xdaf3dfdf3c6e84a725cda2a1c8d59df24ef97777')
  .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(19);
const T1 = '0x9230538d7fa674197692175ee01316607654035e';
const T2 = '0x55746309186b4da0d1d40155d0baba78dfeac7a5';
console.log('blk      li side  bnb     tok(M)  wallet尾8  tx尾8');
for (const r of data) {
  const w = (r.sender_address || r.trader_address || '').toLowerCase();
  const tag = w === T1 ? '<T1' : w === T2 ? '<T2' : '';
  console.log(String(r.block_number).padEnd(9), String(r.log_index).padEnd(2), r.trade_type.padEnd(5),
    (Number(r.bnb_amount) || 0).toFixed(4).padEnd(7), ((Number(r.token_amount) || 0) / 1e6).toFixed(1).padEnd(7),
    w.slice(-8) + tag, (r.tx_hash || '').slice(-8));
}
