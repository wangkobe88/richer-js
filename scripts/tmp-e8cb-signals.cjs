#!/usr/bin/env node
// 0xe8cb 取证第二步：实验上下文 + 信号门链判定 + 团伙钱包跨票惯犯检查（wss_events creator 轻查询）
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xe8cb59a8c2118292c38ebd6061d05c09a9227777';
const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';
const CREW = ['0x00261fb340ad40fceb180779085b532c93278f0f','0x821c0340b5970388ec22849e9e9eebd00b7a9202','0x559ebb1ecddf4271773e0ed501eed809c6a5c420','0xfca40484045a2e92ce73a73893ad213b281254db','0x5b216a11391d7b7b21de0f58e9b8d21e3e343766','0xdcaf3559cfc61a2920d0da3b1edc68bf125a21c2','0x339626ffc3a0631a27c2a9d164071411b8c608c3','0x67cba25c36968343f9468baebc688d2293520485','0x7b0db6c2a4f83f9021607e95c073075dca21d270','0xe7d7e2446ac76ff2c422d344c35219ce094b207b','0xc73267c9daa3461dd7b8f9a07112a65323311720','0xc72e66943c9d8f3f6eb12f2dbdc9448af517d1b7'];

async function main() {
  const sb = dbManager.getClient();

  // 1. 实验行
  const { data: exp } = await sb.from('experiments').select('id,name,trading_mode,status,created_at,config').eq('id', EXP).limit(1);
  const e = exp && exp[0];
  if (e) {
    const cfg = e.config || {};
    console.log(`=== 实验 ${e.name} mode=${e.trading_mode} status=${e.status} created=${e.created_at}`);
    console.log(`窗口: backtest.startTime=${cfg.backtest?.startTime} endTime=${cfg.backtest?.endTime} src=${cfg.backtest?.sourceExperimentId}`);
    console.log(`门链灰度: factorCheck=${cfg.fourmemeWs?.buyPointCheck?.factorCheck?.enabled} actFront=${cfg.cheatCheck?.actFrontGate?.enabled} cheat=${cfg.fourmemeWs?.cheatCheck?.enabled} bp=${cfg.fourmemeWs?.buyPointCheck?.enabled}`);
  }

  // 2. 本 token 全部信号行（含门链 metadata）
  const sigs = [];
  for (let off = 0; ; off += 500) {
    const { data, error } = await sb.from('strategy_signals')
      .select('id,created_at,signal_type,action,reason,executed,metadata')
      .eq('experiment_id', EXP).eq('token_address', TOKEN)
      .order('created_at', { ascending: true }).range(off, off + 499);
    if (error) throw error;
    if (!data.length) break;
    sigs.push(...data);
    if (data.length < 500) break;
  }
  console.log(`\n=== 本票信号 ${sigs.length} 行 ===`);
  for (const s of sigs) {
    const m = s.metadata || {};
    const parts = [];
    if (m.signalGate) parts.push(`gate:${JSON.stringify(m.signalGate)}`);
    for (const k of ['factorCheck', 'actFrontGate', 'cheatCheck', 'buyPoint']) {
      const seg = m[k];
      if (!seg) continue;
      parts.push(`${k}:{status:${seg.status ?? seg.info?.status} grade:${seg.grade ?? ''} reason:${(seg.reason || seg.reasons || seg.info?.reason || seg.rule || '').toString().slice(0, 120)}}`);
    }
    if (m.strategyName) parts.push(`leg:${m.strategyName}`);
    console.log(`\n[${s.created_at.slice(11, 19)}] ${s.signal_type} ${(m.execution_status || '')} executed=${s.executed} ${s.reason || ''}`);
    parts.forEach(p => console.log('   ' + p));
  }

  // 3. 惯犯检查：团伙钱包是否是其它票的 creator（wss_events 低频表）
  console.log(`\n=== 团伙钱包跨票 creator 检查（wss_events token_create）===`);
  for (let i = 0; i < CREW.length; i += 12) {
    const batch = CREW.slice(i, i + 12);
    const { data: creates, error } = await sb.from('wss_events')
      .select('token_address,block_time,payload')
      .eq('kind', 'token_create')
      .in('payload->>creator', batch)
      .order('block_time', { ascending: true }).limit(50);
    if (error) { console.log('creator 查询失败: ' + error.message); break; }
    if (creates) {
      if (!creates.length && i === 0) console.log('(无 —— 12 钱包均不是任何票的 creator)');
      for (const c of creates) console.log(`${c.block_time} ${c.token_address} sym=${c.payload?.symbol}`);
    }
  }

  // 4. 本票 creator 0x6171 的跨票记录
  const { data: cCreates } = await sb.from('wss_events')
    .select('token_address,block_time,payload').eq('kind', 'token_create')
    .eq('payload->>creator', '0x6171a48aff0705702fec5a48c15478f2db58995c')
    .order('block_time', { ascending: true }).limit(20);
  console.log(`\n=== creator 0x6171…995c 名下 token_create ${cCreates?.length ?? 0} 行 ===`);
  for (const c of cCreates || []) console.log(`${c.block_time} ${c.token_address} sym=${c.payload?.symbol}`);

  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
