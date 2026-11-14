// 一次性：v100 第二批收口（9 accept + batches.2 reviewed + reviewLog 追加）——文本级手术保留原数字格式。
const fs = require('fs');
const p = '/Users/nobody1/Desktop/Codes/richer-js/scripts/cheat-detection/data/v100-review-cases.json';
let s = fs.readFileSync(p, 'utf8');

const NOTES = {
  11: '第二批 review 接受当前结果（cheat 豁免 activity_high 过、BP entry_gate 拒）',
  12: '第二批 review 接受当前结果（cheat unhealthy 拒）',
  13: '第二批 review 接受当前结果（cheat 拒）',
  14: '第二批 review 接受当前结果（cheat unhealthy 拒）',
  15: '第二批 review 接受当前结果（豁免翻案 healthy、BP 放行成交 +0.0396）',
  16: '第二批 review 接受当前结果（cheat 拒）',
  17: '第二批 review 接受当前结果（healthy 直过、BP entry_gate 拒）',
  18: '第二批 review 接受当前结果（cheat unhealthy 拒）',
  20: '第二批 review 接受当前结果（cheat 拒）',
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
  // 从后往前位置化替换：note 插入 → reviewedRound → verdict
  const rEnd = s.indexOf('\n', ri);
  s = s.slice(0, rEnd) + '\n      "note": ' + JSON.stringify(note) + ',' + s.slice(rEnd);
  s = s.slice(0, ri) + '"reviewedRound": 1,' + s.slice(ri + R_OLD.length);
  s = s.slice(0, vi) + '"verdict": "accept",' + s.slice(vi + V_OLD.length);
}

// batches.2 → reviewed
const b2old = `"2": {
      "range": [
        11,
        20
      ],
      "status": "pending",
      "reviews": []
    },`;
const b2new = `"2": {
      "range": [
        11,
        20
      ],
      "status": "reviewed",
      "reviews": [
        {
          "round": 1,
          "reviewedAt": "2026-11-10 20:54–21:57（UTC+8，含 idx19 双角度取证）",
          "coveredIdx": [
            11,
            20
          ],
          "summary": "一案 issue（idx19 Flap 0xe622…7777 双角度：cheat stall_burst 豁免波=协同拉盘腿 9/10 波钱包锚前离场回吐 82% + BP crash 接刀形状四臂贴线 miss——先记录不改，候选 A-D 留档待裁，详 case note），其余九票 accept（用户原话「其它都没问题」）；批次 3-7 用户在别处 review 跳过"
        }
      ]
    },`;
if (!s.includes(b2old)) throw new Error('batches.2 block not matched');
s = s.replace(b2old, b2new);

// reviewLog 追加第二条
const rlAnchor = `R4=0xd44e 已收录 famous roster（c5ccd066，12→13 址）"
    }
  ],`;
const rlNew = `R4=0xd44e 已收录 famous roster（c5ccd066，12→13 址）"
    },
    {
      "round": 1,
      "date": "2026-11-10",
      "time": "20:54–21:57（UTC+8，第二批；批次 3-7 用户在别处 review，本条只覆盖 batch 2）",
      "covered": "batch 2 全批 10 票（idx 11-20）",
      "outcome": "1 issue（idx19 Flap 0xe622…7777 双角度：cheat 侧 stall_burst 豁免波=协同拉盘腿 9/10 离场回吐 82%（豁免两腿由对倒组买单凑成）+ BP 侧 crash 接刀进行时形状坐实但数值四臂全贴线 miss 判 normal_dip 放行，成交 -0.0071）+ 9 accept",
      "resolutions": "先记录不改（2026-11-10 用户裁定）：CD 候选 A（波钱包锚时刻在场性腿：波量回吐 ≥70% 不算买入流量 burst）/B（买点本地窗卖主导不授予豁免）；BP 候选 C（接刀形状臂数值化：末 10s ≥3 笔同块连卖 ∧ 零有效买 ∧ chg5≈chg10 ∧ chg5≤-8% 直接进 crash 复核）/D（nearMaxDn5 -15→-10 放宽）——对拍脚本 tmp-b2-19-burst-window.cjs（182）"
    }
  ],`;
if (!s.includes(rlAnchor)) throw new Error('reviewLog anchor not matched');
s = s.replace(rlAnchor, rlNew);

JSON.parse(s); // 合法性校验
fs.writeFileSync(p, s);
console.log('OK 第二批收口：9 accept + batches.2 reviewed + reviewLog 追加');
