// 一次性：v100 第 19 批收口（6 issue + 4 accept + batches.19 reviewed + reviewLog 追加）
// ——文本级手术保留原数字格式（绝不能 JSON.stringify 全文件重写）。
const fs = require('fs');
const p = '/Users/nobody1/Desktop/Codes/richer-js/scripts/cheat-detection/data/v100-review-cases.json';
let s = fs.readFileSync(p, 'utf8');

const NOTES = {
  181: '第19批 issue：买在 crash 上——锚 chg5=-17.47/maxDn5=-13.16 买点本地窗急跌，BP entry_shape=normal_dip·0.40 误判放行（crash 漏拦族，idx19 BP 候选 C 同族攒批）；cheat stall_burst 豁免+BP act=burst 档双通道放行，成交 -0.0067',
  182: '第19批 issue：价格设定问题，买在了高点——锚 chg5=+25.99/chg10=+25.99/secSinceAth=0（5 秒拉升 +26% 此刻即 ATH 贴顶），BP spike·0.99 已判贴顶但 BP68 起 spike 判型不拦、统一门 28.5（curVs=22.6）放行；价格基准线立法方向同族（idx95 运行期更低价格滚动基准）待裁',
  183: '第19批 review 接受当前结果（cheat activity_high 豁免、BP 放行，+0.0009 平出）',
  184: '第19批 review 接受当前结果（almost_launch 9.2 买入 +0.0077，本批 almost_launch 域两笔全正之一）',
  185: '第19批 issue：买在 burst 的 crash 上——stall_burst 豁免放行（A 强四现象 equal+coordSell+pump+spike 全中）+BP normal_dip·0.80/act=burst 档放行；minVs=0（回发行价地板后拉起 +10.8 买入，secSinceAth=737 回落段），成交 -0.0052；burst 族第 9 例+crash 漏拦族交叉',
  186: '第19批 review 接受当前结果（unhealthy L_insider_sell60 臂被 activity_high 豁免、BP spike 判型不拦，-0.0019 小亏）',
  187: '第19批 review 接受当前结果（T127 quote 盘案赵公主本尊，cheat activity_high 豁免放行 -0.0011）',
  188: '第19批 issue：卖错了——内联卖腿[7] peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -25 AND marketCap < 8.1（cards:1）早卖错过后续；用户裁定「这个卖出臂要删除」（2026-11-11「记录一下，可以先不处理」=先记录暂不执行）；同族 mc>=8.1 档[8]与 -45/-35/-15 档[9][10][11][14]未点名不动；bt-v100 已 completed，处理时=实验 config sellStrategies 18→17 删腿。附：本票买点锚 chg5=-26.92/chg10=-39.79 本身也在急跌中被 normal_dip·0.64 放行（crash 漏拦族同批第 4 例留档）',
  189: '第19批 issue：「为什么只有下跌卖出没有买入？」=盘面形状：锚 win30BuyN=0/win30SellN=3/win60SellBnb=0.22——买点前 30 秒盘面零买单、纯卖砸落，系统仍买入。链路：cheat stall_burst 豁免（A 强 pump）+BP act=burst 档（BP67 不拦）+actTotalBnb >= 0.1 门为买卖合计口径、纯卖盘也能凑 0.1（T133 盲点留档）。币是不是有问题=是：burst 波尾死盘——买入后 4 笔卖 0.02~0.10B 砸落即 3m48s 零成交（11:21:09→11:24:57 仅尘埃买 0.0097B），T118 流动性止损 30s(≥0.02B) 36s 保命 -7.9%。BUY 信号/成交行 DB+API 均在场（11:21:04 P1·首买 executed 0.05B；页面缺行解读不成立）；burst 族第 10 例',
  190: '第19批 issue：买在暴跌 crash 后的小反弹阶段——首点（锚 11:24:41 chg5=-44.67/chg10=-41.73）entry_gate crash·0.88 正确拒；后续反弹点位被放行成交 -0.0098。BP59/BP63 判例（急跌后小反弹仍算 crash、258e 本尊立法票）未在反弹点延续：crash 域应覆盖暴跌后首段反弹，v100 生产在后续点位判 normal_dip 放行=该判例的生产漏拦首例',
};
const V_OLD = '"verdict": null,';
const R_OLD = '"reviewedRound": null,';

for (const [idxStr, note] of Object.entries(NOTES)) {
  const anchor = `"idx": ${idxStr},`;
  const ai = s.indexOf(anchor);
  if (ai < 0) throw new Error('idx anchor not found: ' + idxStr);
  const vi = s.indexOf(V_OLD, ai);
  if (vi < 0) throw new Error('verdict null not found after idx ' + idxStr);
  const ri = s.indexOf(R_OLD, vi);
  if (ri < 0) throw new Error('reviewedRound not found after idx ' + idxStr);
  const nextIdx = s.indexOf('"idx":', ai + anchor.length);
  if (nextIdx > 0 && ri > nextIdx) throw new Error('case block overrun at idx ' + idxStr);
  const isIssue = note.includes('issue');
  // 从后往前位置化替换：note 插入 → reviewedRound → verdict
  const rEnd = s.indexOf('\n', ri);
  s = s.slice(0, rEnd) + '\n      "note": ' + JSON.stringify(note) + ',' + s.slice(rEnd);
  s = s.slice(0, ri) + '"reviewedRound": 1,' + s.slice(ri + R_OLD.length);
  s = s.slice(0, vi) + '"verdict": "' + (isIssue ? 'issue' : 'accept') + '",' + s.slice(vi + V_OLD.length);
}

// batches.19 → reviewed（先读原文锚定）
const bOld = `"19": {
      "range": [
        181,
        190
      ],
      "status": "pending",
      "reviews": []
    },`;
const bNew = `"19": {
      "range": [
        181,
        190
      ],
      "status": "reviewed",
      "reviews": [
        {
          "round": 1,
          "reviewedAt": "2026-11-11（UTC+8，第 19 批=重构后文件 idx 181-190，全批豁免票）",
          "coveredIdx": [
            181,
            190
          ],
          "summary": "六案 issue（181 买在 crash 上/182 价格设定买在高点 chg5=+26 secSinceAth=0/185 买在 burst 的 crash 上/188 卖臂删错腿用户裁定删除先记录/189 买点前 30s 零买单纯卖盘仍买入+burst 波尾死盘/190 crash 后小反弹段放行=BP59 判例生产漏拦首例），四案 accept（183/184/186/187）；idx189 含 182 取证（BUY 行在场+链上 3m48s 断流）"
        }
      ]
    },`;
if (!s.includes(bOld)) throw new Error('batches.19 block not matched');
s = s.replace(bOld, bNew);

// reviewLog 追加（锚=末条 resolutions 尾）
const rlAnchor = `burst 识别（170，案族第 8 例）"
    }
  ],`;
const rlNew = `burst 识别（170，案族第 8 例）"
    },
    {
      "round": 1,
      "date": "2026-11-11",
      "time": "2026-11-11（UTC+8，第 19 批）",
      "covered": "batch 19 全批 10 票（idx 181-190，重构后文件；全批豁免票：4 stall_burst + 6 activity_high）",
      "outcome": "6 issue（181/182/185/188/189/190）+ 4 accept（183/184/186/187）；净 -0.0152，三正七负",
      "resolutions": "全部先记录不动手修（2026-11-11 用户裁定 idx188 卖臂「记录一下，可以先不处理」同批适用）。归族：crash 漏拦（181/185/188 买点/190 反弹段=BP59 判例生产漏拦首例，连 idx19 候选 C 攒批）；launch 价格基准（182=idx95 滚动基准族）；burst 族（185/189，案族第 9/10 例——189 揭示 actTotalBnb 买卖合计口径纯卖盘也过门盲点）；卖臂删除待执行（188：config sellStrategies[7] mc<8.1 档，bt-v100 已 completed）"
    }
  ],`;
if (!s.includes(rlAnchor)) throw new Error('reviewLog anchor not matched');
s = s.replace(rlAnchor, rlNew);

JSON.parse(s); // 合法性校验
fs.writeFileSync(p, s);
console.log('OK 第 19 批收口：6 issue + 4 accept + batches.19 reviewed + reviewLog 追加');
