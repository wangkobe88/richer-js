#!/usr/bin/env node
/** 临时:核查 v21 三票敞口链上余额(182 跑) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { ethers } = require('ethers');
const { dbManager } = require('../src/services/dbManager');

const TOKENS = [
  '0xfb9a53a6f66612e278b6440ce535961db2357777',
  '0x827a36d2137fc0e10ec73ee2ec22d4d5ba4e7777',
  '0x1a9dd89b76752566828c82b19e1aa35096ca7777',
];

async function main() {
  const rpc = (process.env.ANKR_WS_URL || '').replace(/^wss:/, 'https:').replace(/\/ws$/, '');
  if (!rpc) throw new Error('no ANKR_WS_URL');
  const prov = new ethers.JsonRpcProvider(rpc);
  const erc20 = ['function balanceOf(address) view returns (uint256)'];
  const db = dbManager.getClient();
  const { data, error } = await db.from('trades')
    .select('token_address,metadata,input_amount,executed_at')
    .eq('experiment_id', 'cf92cbd3-6acc-4c08-959a-1001bd808d6c')
    .eq('trade_direction', 'buy')
    .in('token_address', TOKENS);
  if (error) throw new Error(error.message);
  for (const t of data || []) {
    const tx = await prov.getTransaction((t.metadata || {}).txHash);
    const c = new ethers.Contract(t.token_address, erc20, prov);
    const bal = await c.balanceOf(tx.from);
    console.log(t.token_address.slice(0, 10), 'bought', t.input_amount, 'BNB at', t.executed_at,
      'wallet', tx.from, 'chainBal:', ethers.formatEther(bal));
  }
  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
