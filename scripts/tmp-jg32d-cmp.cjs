#!/usr/bin/env node
// JG-32d：双臂对拍分析（本地——两实验信号/成交是小结果集）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const ARMS = [
  ['A现行', '2b5e194b-98bb-4f5d-8d9b-a8d5884ae58b'],
  ['B无FP', 'c4e9f11a-9ce9-46f5-969b-9a935cd16789'],
];
const SYM = {
  '0xf38f48cfe9e84920e7de4d47823a0fba95a87777': '登天猫', '0x988fd57771e0993500c736e032a0e944700c7777': 'Greg',
  '0x9c07ea66cbdc29c0e4d11b68ba597d5b20917777': '赵娜丽莎', '0xece9cd98e00ac9a56e3f7ab0e4d4df803e587777': '麦麦',
  '0x6fe44c149140f7827213fdeb9ca00d0c85397777': 'AGI', '0xd0451a539ce2d4321f72e7f1e91c65db8ed87777': '大祭司',
  '0xebbc6754c85e9af69f8939e77fc7cbc284ca7777': 'MEME', '0xcb1d32fadc28f1dda6a6a799d109396cbfda7777': 'Taz',
  '0x1d7d9f2c5480fe49b919c41d1c3952cd92f07777': '金额AI', '0x3b2748dfab3c2bc9beab4666cb35af3193be7777': '丁真',
  '0xa2b3b5a7a52595793b733e8eb4cc4bde5f797777': '뿌까', '0x995b32765ea74ab7b05b57789fb00c96e6407777': '牢大',
  '0xcadc767df602ce53d42255cefbd8d8e63a747777': '模拟人生', '0x5c83f64b15e1b26e8890c5fa4e4e2c60089c7777': '大表鸽',
  '0x2893a7961216a58ce2051dbd9cd4f2d515747777': '万锅共酱会', '0xa878e6d446f8906f98203662e595117eb0657777': 'SI',
  '0x993816917954aa30b634a262f68c15d60db17777': '女大', '0x841b41f3f5266e2931fba12f841a2dbeea2d7777': '人生指南',
  '0x5316e94be2689e4feb4664c79aaf95c01c5d7777': '沫沫', '0xe2417e493d109f7d8ee9094ef45b104ffbae7777': '太和殿金像',
  '0x153f8335b1fcda68e459463a5899dd736fd27777': 'QAFILA', '0xa72df2039229d697abf15da34c515d28f3bb7777': 'OON',
  '0xe6765c897daecfecdd4687d49907828a1a2f7777': '黄鲸', '0xf37fe6de269801669bdee0e6825a3df107267777': '驴党',
};
(async () => {
  const sb = dbManager.getClient();
  const out = {};
  for (const [arm, exp] of ARMS) {
    const { data: sigs } = await sb.from('strategy_signals').select('token_address,created_at,signal_type,action,executed,reason,metadata')
      .eq('experiment_id', exp).eq('signal_type', 'BUY').order('created_at');
    const { data: trades } = await sb.from('trades').select('token_address,trade_type,amount_bnb,price_bnb,profit_loss,trade_time,metadata')
      .eq('experiment_id', exp).order('trade_time');
    out[arm] = { sigs: sigs || [], trades: trades || [] };
    console.log(`\n═══ ${arm}（${exp.slice(0,8)}）═══ BUY 信号 ${(sigs||[]).length} 行 | trades ${(trades||[]).length} 行`);
  }
  // 按票聚合
  const byTok = {};
  for (const [arm] of ARMS) for (const s of out[arm].sigs) {
    const a = s.token_address;
    byTok[a] = byTok[a] || { sym: SYM[a] || a.slice(0, 8) };
    byTok[a][arm] = byTok[a][arm] || { n: 0, fpArms: {}, af1: 0, cheat: 0, bp: 0, passN: 0, stages: [] };
    const e = byTok[a][arm]; e.n++;
    const md = s.metadata || {};
    const fc = md.factorCheck;
    if (fc && fc.reason) e.fpArms[fc.reason] = (e.fpArms[fc.reason] || 0) + 1;
    if (fc && fc.pass) e.passN++;
    // AF1/cheat/BP 段
    for (const k of ['actFrontGate', 'cheatCheck', 'buyPoint']) {
      if (md[k]) {
        const st = md[k].status || md[k].result || md[k].grade || JSON.stringify(md[k]).slice(0, 40);
        e.stages.push(`${k}:${st}`);
      }
    }
  }
  for (const [arm] of ARMS) for (const t of out[arm].trades) {
    const a = t.token_address;
    byTok[a] = byTok[a] || { sym: SYM[a] || a.slice(0, 8) };
    byTok[a][arm] = byTok[a][arm] || { n: 0, fpArms: {}, stages: [] };
    const e = byTok[a][arm];
    if (t.trade_type === 'buy') { e.bought = (e.bought || 0) + 1; e.buyP = t.price_bnb; }
    else { e.pnl = ((e.pnl || 0) + Number(t.profit_loss || 0)); }
  }
  console.log('\n═══ 按票对照 ═══');
  for (const [addr, v] of Object.entries(byTok)) {
    const A = v['A现行'] || {}, B = v['B无FP'] || {};
    const aFp = Object.entries(A.fpArms || {}).map(([k, n]) => `${k}×${n}`).join(',') || '-';
    const bFp = Object.entries(B.fpArms || {}).map(([k, n]) => `${k}×${n}`).join(',') || '-';
    console.log(`${v.sym}\tA: 信号${A.n || 0} FP拒[${aFp}] 成交${A.bought || 0} pnl${(A.pnl || 0).toFixed(4)}\tB: 信号${B.n || 0} FP拒[${bFp}] 成交${B.bought || 0} pnl${(B.pnl || 0).toFixed(4)}`);
    if ((B.stages || []).length) console.log(`   B 门链段: ${(B.stages || []).slice(0, 6).join(' | ')}`);
  }
  // 汇总
  for (const [arm] of ARMS) {
    const sigs = out[arm].sigs, trades = out[arm].trades;
    const buys = trades.filter(t => t.trade_type === 'buy');
    const sells = trades.filter(t => t.trade_type === 'sell');
    const totalPnl = sells.reduce((s, t) => s + Number(t.profit_loss || 0), 0);
    const sigTokens = new Set(sigs.map(s => s.token_address));
    const fpRejected = new Set(sigs.filter(s => s.metadata?.factorCheck?.reason).map(s => s.token_address));
    const af1Rej = new Set(sigs.filter(s => { const a = s.metadata?.actFrontGate; return a && (a.rejected || a.status === 'rejected'); }).map(s => s.token_address));
    const bpRej = new Set(sigs.filter(s => { const b = s.metadata?.buyPoint; return b && b.status === 'assessed' && !b.pass; }).map(s => s.token_address));
    const cheatRej = new Set(sigs.filter(s => { const c = s.metadata?.cheatCheck; return c && c.grade === 'cheat'; }).map(s => s.token_address));
    console.log(`\n[${arm}] 信号票 ${sigTokens.size} | FP拒票 ${fpRejected.size} | AF1拒票 ${af1Rej.size} | cheat拒票 ${cheatRej.size} | BP拒票 ${bpRej.size} | 买入票 ${new Set(buys.map(t => t.token_address)).size} | 卖出毛pnl ${totalPnl.toFixed(4)} BNB`);
  }
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
