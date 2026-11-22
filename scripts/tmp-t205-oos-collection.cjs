#!/usr/bin/env node
// 一次性（182 跑）：建「T205 窗外验证」集合——win1103（冷窗，不在 6fd0372f
// provenance）三实验（bt-v142/144/145）中 act low 族拒绝（factor_gate_act_low ∪
// act_front_low）的票并集去重，per-token 记首拦时刻。用户提案：以窗外 act_low
// 命中票专用集合做低活跃放行（T205 三键）的窗外对拍测试床。建行后 sync 走
// scripts/sync-case-collection.cjs。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const crypto = require('crypto');
const { dbManager } = require('../src/services/dbManager');

const NAME = 'T205-actlow-win1103-窗外验证';
const DESC = 'T205 阶段放行窗外验证集：win1103（冷窗 23h，11-03 前后）三实验（bt-v142/144/145）被 act low 族拒绝（factor_gate_act_low/act_front_low）的票并集——窗外=不曾在 6fd0372f 标定集合 provenance 内（该集合=win1003/1019/1012 三窗）。用法：ctrl（T205 三键关）vs both（三键开）两臂 case 通道对拍，增量面=低活跃放行在自然窗外窗的真实期望。';
const SRCS = [
  ['bt-v142-all-changes-23h-win1103', 'v142'],
  ['bt-v144-fp13-burst-weak-23h-win1103', 'v144'],
  ['bt-v145-af1-actfront-23h-win1103', 'v145'],
];
const REASONS = ['factor_gate_act_low', 'act_front_low'];

(async () => {
  const sb = dbManager.getClient();
  const { data: exist } = await sb.from('case_collections').select('id').eq('name', NAME).maybeSingle();
  let colId;
  if (exist) { colId = exist.id; console.log('集合已存在:', colId); }
  else {
    colId = crypto.randomUUID();
    const { error } = await sb.from('case_collections').insert({ id: colId, name: NAME, description: DESC });
    if (error) throw new Error(error.message);
    console.log('集合已建:', colId);
  }
  // 收集成员：per-token 首拦（来源+reason+时刻）
  const members = new Map(); // addr → {src, reason, t}
  for (const [name, label] of SRCS) {
    const { data: exp } = await sb.from('experiments').select('id').eq('experiment_name', name).limit(1);
    if (!exp || !exp[0]) { console.log(`[${label}] 实验未找到 ${name}`); continue; }
    for (const reason of REASONS) {
      let from = 0;
      for (;;) {
        const { data, error } = await sb.from('strategy_signals')
          .select('token_address, created_at').eq('experiment_id', exp[0].id).eq('signal_type', 'BUY')
          .filter('metadata->>execution_reason', 'eq', reason)
          .order('created_at', { ascending: true }).range(from, from + 499);
        if (error) throw new Error(error.message);
        if (!data || !data.length) break;
        for (const s of data) {
          const e = members.get(s.token_address);
          if (!e || new Date(s.created_at) < new Date(e.t)) {
            members.set(s.token_address, { src: label, reason, t: s.created_at });
          }
        }
        if (data.length < 500) break; from += 500;
      }
    }
    console.log(`[${label}] 累计去重成员 ${members.size}`);
  }
  console.log('合计成员:', members.size);
  // 插成员（token_meta 从 token_create 服务口径；幂等冲突跳过）
  let inserted = 0, noMeta = 0;
  for (const [addr, m] of members) {
    const { data: dup } = await sb.from('case_collection_tokens').select('id')
      .eq('collection_id', colId).eq('token_address', addr).maybeSingle();
    if (dup) continue;
    const { data: ev } = await sb.from('wss_events').select('platform,payload,block_time')
      .eq('kind', 'token_create').eq('token_address', addr).order('id', { ascending: true }).limit(5);
    const hitEv = (ev || []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
    if (!hitEv) { noMeta++; continue; } // 宁缺勿冒充（零 token_create 行不进集合）
    const p = hitEv.payload || {};
    const meta = {
      address: addr, symbol: p.symbol || null, name: p.name || null, platform: hitEv.platform,
      createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : hitEv.block_time,
      creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
      totalSupply: p.totalSupply ?? ((hitEv.platform === 'flap' || hitEv.platform === 'gang') ? 1e9 : null),
      quoteToken: null,
    };
    const { error } = await sb.from('case_collection_tokens').insert({
      collection_id: colId, token_address: addr, platform: meta.platform,
      note: `T205 窗外验证成员（${m.src} 首拦 ${m.reason === 'factor_gate_act_low' ? 'FP act_low' : 'AF1 act_front_low'} @ ${new Date(m.t).toISOString().slice(11, 19)}）`,
      token_meta: meta, sync_state: 'pending',
    });
    if (error) throw new Error(error.message);
    inserted++;
  }
  console.log(`插入 ${inserted} 行 / 无 token_create 跳过 ${noMeta} / 集合 id=${colId}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
