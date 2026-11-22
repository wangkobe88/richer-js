#!/usr/bin/env node
// JG-32d 最终对拍（修正列名/metadata 解析）
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const ARMS = [['A现行', '2b5e194b-98bb-4f5d-8d9b-a8d5884ae58b'], ['B无FP', 'c4e9f11a-9ce9-46f5-969b-9a935cd16789']];
const SYM = JSON.parse(require('fs').readFileSync('/dev/null').toString() || 'null') || {
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
  '0xe6765c897daecfecdd4687d49907828a1a2f7777': '黄鲸', '0xf37fe6de269801669bdee0e6825a3df107267777': '驴党' };
(async () => {
  const sb = dbManager.getClient();
  const res = {};
  for (const [arm, exp] of ARMS) {
    const { data: sigs } = await sb.from('strategy_signals').select('token_address,metadata').eq('experiment_id', exp).eq('signal_type', 'BUY');
    const { data: trades } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,input_currency').eq('experiment_id', exp);
    res[arm] = { sigs: sigs || [], trades: trades || [] };
  }
  const byTok = {};
  for (const [arm] of ARMS) {
    for (const s of res[arm].sigs) {
      const a = s.token_address;
      byTok[a] = byTok[a] || { sym: SYM[a] || a.slice(0, 8) };
      const e = byTok[a][arm] = byTok[a][arm] || { sig: 0, fp: {}, af1: 0, cheat: 0, bp: 0, bpReasons: {}, gatePassed: 0 };
      e.sig++;
      const md = s.metadata || {};
      const fc = md.factorCheck;
      if (fc && fc.reason) e.fp[fc.reason] = (e.fp[fc.reason] || 0) + 1;
      const af = md.actFrontGate;
      if (af && String(af.path || '').startsWith('reject')) e.af1++;
      const ch = md.cheatCheck;
      if (ch && ch.grade === 'cheat') e.cheat++;
      const bp = md.buyPoint;
      if (bp && bp.status === 'assessed' && bp.passed === false) {
        e.bp++;
        const r = (bp.bucket && `bucket:${bp.bucket}`) || (bp.gate && `gate:${bp.gate}`) || 'assessed_fail';
        e.bpReasons[r] = (e.bpReasons[r] || 0) + 1;
      }
      if (md.execution_reason || md.execution_status === 'executed') e.gatePassed++;
    }
    for (const t of res[arm].trades) {
      const a = t.token_address;
      byTok[a] = byTok[a] || { sym: SYM[a] || a.slice(0, 8) };
      const e = byTok[a][arm] = byTok[a][arm] || { sig: 0, fp: {}, bpReasons: {} };
      if (t.trade_direction === 'buy' && String(t.input_currency || '').toUpperCase() === 'BNB') e.bought = (e.bought || 0) + 1, e.cost = (e.cost || 0) + Number(t.input_amount);
      if (t.trade_direction === 'sell' && String(t.output_currency || '').toUpperCase() === 'BNB') e.sold = (e.sold || 0) + 1, e.proceeds = (e.proceeds || 0) + Number(t.output_amount);
    }
  }
  console.log('═══ 按票（B 臂视角：FP 放行后死在哪层 / A 臂基线）═══');
  for (const [, v] of Object.entries(byTok)) {
    const A = v['A现行'] || {}, B = v['B无FP'] || {};
    const pnl = x => x.proceeds !== undefined ? (x.proceeds - (x.cost || 0)).toFixed(4) : '-';
    console.log(`${String(v.sym).padEnd(7)} A:${A.sig || 0}信号 FP拒${Object.keys(A.fp || {}).length}种 买${A.bought || 0} pnl${pnl(A)} | B:${B.sig || 0}信号 AF1拒${B.af1 || 0} cheat拒${B.cheat || 0} BP拒${B.bp || 0}${Object.keys(B.bpReasons || {}).length ? '(' + Object.entries(B.bpReasons).map(([k, n]) => k + '×' + n).join(',') + ')' : ''} 买${B.bought || 0} pnl${pnl(B)}`);
  }
  for (const [arm] of ARMS) {
    const toks = Object.values(byTok).map(v => v[arm]).filter(Boolean);
    const bought = toks.filter(e => e.bought);
    const net = bought.reduce((s, e) => s + (e.proceeds || 0) - (e.cost || 0), 0);
    const af1T = toks.filter(e => e.af1).length, cheatT = toks.filter(e => e.cheat).length, bpT = toks.filter(e => e.bp).length, fpT = toks.filter(e => Object.keys(e.fp || {}).length).length;
    console.log(`\n[${arm}] 票级：FP拒 ${fpT} | AF1拒 ${af1T} | cheat拒 ${cheatT} | BP拒 ${bpT} | 买入 ${bought.length} 票 | 净 ${net >= 0 ? '+' : ''}${net.toFixed(4)} BNB | 买入票胜率 ${bought.filter(e => (e.proceeds || 0) > (e.cost || 0)).length}/${bought.length}`);
  }
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
