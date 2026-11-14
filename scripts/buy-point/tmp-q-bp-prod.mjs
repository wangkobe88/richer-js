import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const r = await c.from('strategy_signals')
  .select('token_address,created_at,metadata')
  .eq('experiment_id', '029bd863-55e5-4319-91d5-10803a6a9a82')
  .in('token_address', ['0xea62a97fe03b20a143672184847b0c11e46d7777','0x6d5d4537f3ac5bf044207166af4638673c367777','0xc1763b4c7e284da879c213cbc32a86de1f307777'])
  .eq('action','buy').eq('executed',true);
for (const row of r.data ?? []) {
  const cc = row.metadata?.cheatCheck ?? {};
  console.log('===', row.token_address.slice(0,10), row.created_at);
  console.log('cheat 版本字段:', cc.questionVersion ?? cc.questionsVersion ?? cc.version ?? '(无)', '| grade 版本:', cc.gradeVersion ?? '(无)');
  console.log('levels keys:', Object.keys(cc.levels ?? {}).join(','));
  const an = cc.anchors ?? {};
  console.log('D3.67 十键在场？:', ['burstLastGapSec','burstSecSinceWaveEnd','burstExitWaveFromDt','burstExitWaveBuyBnb','burstExitWaveWallets','burstWaveWalletNetBnb','burstWaveSellBackPct','burstWaveWalletAvgBnb','burstWaveWalletMedianBnb'].filter(k=>k in an).join(',') || '无（旧版信号）');
}
await dbManager.close?.();
