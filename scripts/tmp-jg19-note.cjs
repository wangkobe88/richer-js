#!/usr/bin/env node
// 一次性：金狗集合 a8414632 双票备注追加（JG-6g 쿠우塔 / JG-21 胖橘貓），保留原 note。--write 才落库。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const JOBS = [
  {
    tag: 'JG-6g', token: '0xc0e896ddec43881055a25786c17fa5d5d6337777', symbol: '쿠우타',
    append: '；JG-6g（2026-11-22 FP39/FP40/T205 时代单票再证，tmp-jg19-fp-replay.cjs 现行 FP40 代码+生产灰度 enableTailDipExempt:true 五锚点重放）：死因链与 JG-6f 逐行零变化——02:30:40 FP34 豁免后 fam_low_exit_cooldown 拦（末卖@+37.8% 距锚55s 谷值18%>9% 差线）；02:31:58/02:32:02/02:32:09 lifecycle_sell_residual×3（簇卖占100% 卖0.43~0.51B）；02:33:46 FP 全过死 AF1 act_front_low（引擎层）。全程未破发 minVsFloor=+6.22 → JG-18 后新立法 FP39/FP40 深破豁免（<−10）不适用；athVsLaunch 104.6≥80 → T205 阶段放行域外=新立法对本票零增量，解锁链仍=FP20 族+AF1+lifecycle 三环（JG-6f 余留保持）。前向 30min +305~337%、毕业 03:44:58（×10.8 已录）。全档=金狗台账 JG-6g',
  },
  {
    tag: 'JG-21', token: '0x2335bc4868817a216be949c545f9a7e550bf7777', symbol: '胖橘貓',
    append: '；JG-21（2026-11-22，用户观点「买入点位低活跃度」已核验）：3 信号全灭——05:39:48 点火瞬间唯一高活跃触发（JG-8 口径 05:36:43 新钱包点火→176s 静默→0.572B/9s surge）被 FP27 holder_quiet_unload 拦（60s top5 卖 0.2465B∈[0.1,0.3) ∧ ath 23.7<80，surge 窗内即有反手卖压）；05:40:44/05:43:04 纯 act_low 拦（act_idle 静默 96.4~97% ∧ 吞吐 0.22~0.24B/min，surge 退潮回死盘），此后价格爬出 28.5 域再无信号（首 48min 仅 113 tick 极静票）。T205 联动：athVsLaunch 23.7~27.7<80=三灰度键理论放行面——开灰度重放两笔纯 act_low 臂 FP 放行（tmp-jg19-2335-t205.cjs），05:39:48 FP27 非 act 臂不受影响；旧快照 arms 另含 arb_bot_holdings，现行 T198b/FP36 流通腿豁免后不再命中。结局两面：全局峰值 ×8.3@06:35（vs launch +732%、锚后 +551~609%、55min 慢爬）无毕业，JG-8 已录终局全回撤（末笔 1.10x）=05:39 拒按终局看方向正确——「低活跃度买点」与「拒得对」并存，T205 放行≠必然正增量（反面校验样本）。与 JG-17 喵蛙/JG-14 铁匠同族（act 族错过买入域）样本 3，攒批不立法。全档=金狗台账 JG-21',
  },
];
(async () => {
  const sb = dbManager.getClient();
  const WRITE = process.argv.includes('--write');
  for (const j of JOBS) {
    const { data: cur, error } = await sb.from('case_collection_tokens')
      .select('id,note').eq('collection_id', COLL).eq('token_address', j.token).limit(1);
    if (error) throw new Error(error.message);
    const row = (cur || [])[0];
    if (!row) throw new Error(`${j.symbol} 不在集合`);
    if (String(row.note || '').includes(j.tag)) { console.log(`${j.tag} 已含，跳过`); continue; }
    console.log(`\n== ${j.tag} ${j.symbol} 原 note 长度: ${String(row.note || '').length}`);
    if (!WRITE) { console.log(`[dry] 将追加 ${j.append.length} 字: ${j.append.slice(0, 120)}…`); continue; }
    const { error: upErr } = await sb.from('case_collection_tokens')
      .update({ note: (row.note || '') + j.append }).eq('id', row.id);
    if (upErr) throw new Error(upErr.message);
    const { data: back } = await sb.from('case_collection_tokens').select('note').eq('id', row.id).limit(1);
    const ok = back && back[0] && String(back[0].note).includes(j.tag);
    console.log(ok ? `✅ ${j.tag} 已落（回读对账通过，长度 ${String(back[0].note).length}）` : `❌ ${j.tag} 回读失败`);
    if (!ok) process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
