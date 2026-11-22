#!/usr/bin/env node
// 一次性：扩容 6fd0372f 为崩塌域门族被拦全集（三窗 8 臂去重票）。182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COL = '6fd0372f-48eb-494d-890b-5fa652127609';
const CORE = ['factor_gate_tail_dip_knife', 'factor_gate_tail_no_buyer_pressure', 'factor_gate_lifecycle_sell_residual',
  'factor_gate_lifecycle_burst_residual', 'factor_gate_act_low', 'factor_gate_act_ultra', 'act_front_low', 'factor_gate_act_tail_flat'];
const WINS = ['9e9163de-a677-4d39-9c33-9ec9df05e400', 'ce102e94-293c-4f8f-af98-cd06f4b0e98c', 'dddbe79e-480a-402a-aa35-85a72d2f591e'];

(async () => {
  const sb = dbManager.getClient();
  // 门族被拦票全集（per 票主拦臂=首个命中的 CORE reason）
  const byArm = new Map();
  for (const exp of WINS) {
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals')
        .select('token_address, metadata').eq('experiment_id', exp).eq('signal_type', 'BUY')
        .order('id', { ascending: true }).range(from, from + 499);
      if (error) throw new Error(error.message);
      if (!data || !data.length) break;
      for (const s of data) {
        const er = (s.metadata || {}).execution_reason;
        if (!er || !CORE.includes(er)) continue;
        if (!byArm.has(s.token_address)) byArm.set(s.token_address, er); // 首命中臂
      }
      if (data.length < 500) break;
      from += 500;
    }
  }
  const armCount = {};
  for (const [, r] of byArm) armCount[r] = (armCount[r] || 0) + 1;
  console.log('门族全集去重:', byArm.size, '票；首命中臂分布:', JSON.stringify(armCount));

  // 现有成员
  const { data: exist } = await sb.from('case_collection_tokens').select('token_address').eq('collection_id', COL);
  const have = new Set((exist || []).map(r => r.token_address));
  console.log('现有成员:', have.size);

  // meta 批量（wss_events token_create）
  const need = [...byArm.keys()].filter(a => !have.has(a));
  console.log('待插入:', need.length);
  let done = 0;
  for (let i = 0; i < need.length; i++) {
    const addr = need[i];
    const { data: ev } = await sb.from('wss_events').select('platform,payload,block_time')
      .eq('kind', 'token_create').eq('token_address', addr).order('id', { ascending: true }).limit(5);
    const hit = (ev || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
    const p = hit ? hit.payload : {};
    const meta = {
      address: addr, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
      creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
      totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
      quoteToken: null,
    };
    const { error } = await sb.from('case_collection_tokens').insert({
      collection_id: COL, token_address: addr, platform: meta.platform,
      note: 'JG-6c 崩塌域门族成员（首拦臂=' + byArm.get(addr).replace('factor_gate_', '').replace('act_front_', 'AF1_') + '）',
      token_meta: meta, sync_state: 'pending',
    });
    if (error) { console.error('插入失败', addr, error.message); process.exit(1); }
    if (++done % 200 === 0) console.log('  …' + done + '/' + need.length);
  }
  console.log('插入完成:', done);

  // 更新集合描述
  const { error: ue } = await sb.from('case_collections').update({
    description: 'JG-6c 崩塌域门族全集（用户裁定 2026-11-21：「这几个门高度重叠，一起梳理——搞明白到底什么情况可以抄底、什么时候不能」）：三窗（w1003/w1019/w1012）被崩塌/死寂域八臂拦的去重票——tail_dip_knife/tail_no_buyer_pressure/lifecycle_sell_residual/lifecycle_burst_residual/act_low/act_ultra/act_front_low/act_tail_flat。成员 note 记首拦臂。研究主线=全集前向结局分布×形状维度 → 「可抄底」子形状立法。',
  }).eq('id', COL);
  if (ue) throw new Error(ue.message);
  console.log('集合描述已更新');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
