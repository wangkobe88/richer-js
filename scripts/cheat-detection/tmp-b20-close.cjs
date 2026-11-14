// 一次性：v100 第 20 批收口（4 issue + 6 accept + batches.20 reviewed + reviewLog/顶层 reviews 双追加）
// ——并行会话已追加批 18 条目+顶层 reviews 数组，锚点以批 18 尾为准。
const fs = require('fs');
const p = '/Users/nobody1/Desktop/Codes/richer-js/scripts/cheat-detection/data/v100-review-cases.json';
let s = fs.readFileSync(p, 'utf8');

const NOTES = {
  191: '第20批 issue：burst 识别错误（拒向首例）——bt-v100 首判 sbw=burst+波有力全过（gap=314s/buy=2.43B≥0.7/wallets=9）但 CD396 第四腿 burstExitVsLaunchPct=113.9>40 拒豁免→cheat 拒（A强 pump+J_hold+L_insider_sell46，holdingsBalance=strong 同在）；用户判定应算 burst=与 CD396「起来起点价≤40」立法直接张力（高位横盘后流量波 vs 跌到很低再起来），攒批待裁；附 live 侧同票 09:14/09:16 两行 sbw 摆动 burst→none（CD319 同版方差族）',
  192: '第20批 issue：发布价格太低的代币——首笔 0.1923B@4.1271e-9=-8.2% vs FM 常量（低开票）；T130 地板已生效（bp launch=4.1271e-9=min(常量,首买价)）；58s 新票 secSinceAth=3/chg10=+16.2/spike·0.95 贴顶判型不拦，curVs=23.2 过 28.5 门成交 -0.0032；launch 基准线族低开向样本（idx95 滚动基准/idx143 高开向同池待裁）',
  193: '第20批 review 接受当前结果（healthy 直过、act=mid·0.48 不在拦域，-0.0081）',
  194: '第20批 review 接受当前结果（stall_burst 豁免放行 +0.0027 本批唯一正）',
  195: '第20批 issue：crash 之后的小反弹——chg10=-29.8/chg30=-29.7 暴跌后 17s（secSinceAth=17）chg5 已收敛 -3.9 的反弹段买入，BP normal_dip·0.71 放行成交 -0.0071；BP59/BP63 判例反弹段漏拦第 2 例（idx190 同族）；⚠BP63 判读句张力：chg5 明显浅于 chg10 的收敛形状本票成立仍不可接受=「收敛≠跌势已止」反向样本，攒批待裁',
  196: '第20批 review 接受当前结果（healthy 直过 -0.0043）',
  197: '第20批 review 接受当前结果（cheat 硬拒 A强 spike+J_hold；flap 票 0x1417…ffff；后续点位小亏 -0.0046）',
  198: '第20批 issue：burst 识别错误（放行向）——stall_burst 豁免放行（A强 pump+J_hold+N_no_retail_entry0.0 零散户入口锚在场仍豁免）；98min 沉积盘（spanSec=5888/idlePct=74.5/maxChg5=+48.3 在 80min 前）+买点前 30s 零买纯卖（win30BuyN=0/win30SellN=2，idx189 同款纯卖盘）+routerBuyPct60=null；用户判定非 burst=对倒组拉盘族（19/72/81/96/185/189 同向）；burst 族放行向再+1',
  199: '第20批 review 接受当前结果（BP ③桶 famous_monopoly·0.62 首点正确拒——cheat activity_high 豁免后 BP 门接力拦；后续点位小亏 -0.004）',
  200: '第20批 review 接受当前结果（羊王 BP31 案本尊 0x5a8d94c6；L_insider_sell100 臂被 activity_high 豁免，-0.0027）',
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
  const rEnd = s.indexOf('\n', ri);
  s = s.slice(0, rEnd) + '\n      "note": ' + JSON.stringify(note) + ',' + s.slice(rEnd);
  s = s.slice(0, ri) + '"reviewedRound": 1,' + s.slice(ri + R_OLD.length);
  s = s.slice(0, vi) + '"verdict": "' + (isIssue ? 'issue' : 'accept') + '",' + s.slice(vi + V_OLD.length);
}

const bOld = `"20": {
      "range": [
        191,
        200
      ],
      "status": "pending",
      "reviews": []
    },`;
const bNew = `"20": {
      "range": [
        191,
        200
      ],
      "status": "reviewed",
      "reviews": [
        {
          "round": 1,
          "reviewedAt": "2026-11-11（UTC+8，第 20 批）",
          "coveredIdx": [
            191,
            200
          ],
          "summary": "四案 issue（191 burst 拒向首例=CD396 第四腿 exitVs=113.9>40 拒掉用户判定真 burst/192 发布价太低低开票 T130 地板已生效/195 crash 后小反弹第 2 例含 BP63 收敛句张力/198 burst 放行向 98min 沉积+零买纯卖盘），六案 accept（193/194/196/197/199/200）；191/198 取证=bt-v100 信号元数据+live 双行 sbw 摆动"
        }
      ]
    },`;
if (!s.includes(bOld)) throw new Error('batches.20 block not matched');
s = s.replace(bOld, bNew);

// reviewLog 追加（锚=批 18 条目尾，当前末条）
const rlAnchor = `初始价格太低（180，idx143 我靠同族 T130 锚族第二例）"
    }
  ],`;
const rlNew = `初始价格太低（180，idx143 我靠同族 T130 锚族第二例）"
    },
    {
      "round": 1,
      "date": "2026-11-11",
      "time": "2026-11-11（UTC+8，第 20 批）",
      "covered": "batch 20 全批 10 票（idx 191-200，重构后文件；混合形状：2 cheat 硬拒+1 BP ③桶拒+7 豁免/直过成交）",
      "outcome": "4 issue（191/192/195/198）+ 6 accept（193/194/196/197/199/200）",
      "resolutions": "全部先记录不动手修。归族：burst 识别两向（191=拒向首例：CD396 第四腿 exitVs=113.9>40 拒掉真 burst 与立法直接张力+live 双行 sbw 摆动 burst→none；198=放行向：98min 沉积+买点前 30s 零买纯卖+零散户入口锚仍豁免）；launch 基准线族（192 低开向：T130 地板已生效仍被点名，与 idx95 滚动基准/idx143 高开向三向同池）；crash 反弹段漏拦第 2 例（195，含 BP63「chg5 收敛=可接受」判读句反向张力）；199 famous_monopoly ③桶判对样本入 accept"
    }
  ],`;
if (!s.includes(rlAnchor)) throw new Error('reviewLog anchor not matched');
s = s.replace(rlAnchor, rlNew);

// 顶层 reviews 追加（并行会话新结构，同款简条目）
const rvOld = `        178
      ]
    }
  ]
}`;
const rvNew = `        178
      ]
    },
    {
      "round": 1,
      "batch": "20",
      "date": "2026-11-11",
      "idx": "191-200",
      "issues": [
        191,
        192,
        195,
        198
      ],
      "accepts": [
        193,
        194,
        196,
        197,
        199,
        200
      ]
    }
  ]
}`;
if (!s.includes(rvOld)) throw new Error('top-level reviews anchor not matched');
s = s.replace(rvOld, rvNew);

JSON.parse(s);
fs.writeFileSync(p, s);
console.log('OK 第 20 批收口：4 issue + 6 accept + batches.20 reviewed + reviewLog/顶层 reviews 双追加');
