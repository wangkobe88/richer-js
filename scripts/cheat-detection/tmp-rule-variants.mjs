#!/usr/bin/env node
// tmp：D3.1 规则变体网格实验（本地零配额——对 D3.0 存档 answersRaw 逐变体评估）
// 结论只用于选综合规则形状；定稿进 cheat-result-mapper.js 后 replay.mjs 复核
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { mapCheatAnswers, PHENOMENON_IDS, LEVEL_ORDER } = require('../../src/market-analysis/cheat-result-mapper.js');

const fx = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8')).cases;
const exp = Object.fromEntries(fx.map((c) => [c.caseId, c.expect?.verdict]));
const a = JSON.parse(readFileSync(resolve(HERE, 'data/cd-run-2026-10-31T01-09-58-065Z.json'), 'utf8'));

const tickets = [];
for (const r of a.results) {
  if (r.error || !r.answersRaw) continue;
  const m = mapCheatAnswers(r.answersRaw);
  tickets.push({ id: r.caseId, want: exp[r.caseId], lv: m.ruleAudit.levels, retail: m.retailParticipation });
}
const L = (t, id) => LEVEL_ORDER[t.lv[id]];
const ge = (t, id, min) => L(t, id) >= LEVEL_ORDER[min];

// 变体表：每条 = {name, cheat: (t)=>bool, healthy: (t)=>bool}
// 判定序：cheat 臂（按序∨）→ healthy 臂 → unhealthy 兜底
const V = {
  v0_d30_with_retail: {
    cheat: (t) => ge(t, 'coordinated_sell_back', 'moderate') || ge(t, 'creator_front_run', 'strong')
      || (ge(t, 'quota_ladder_heat', 'moderate') && (t.retail ?? 0) <= 3)
      || (ge(t, 'same_block_buy_burst', 'moderate') && ge(t, 'equal_amount_split', 'moderate') && (t.retail ?? 0) <= 3),
    healthy: (t) => (t.retail ?? 0) >= 6 && ge(t, 'second_wave_absorption', 'weak') && ge(t, 'sell_dispersion', 'moderate'),
  },
  v1_strong_only: {
    cheat: (t) => ge(t, 'creator_front_run', 'strong') || ge(t, 'equal_amount_split', 'strong') || ge(t, 'coordinated_sell_back', 'strong'),
    healthy: (t) => ge(t, 'sell_dispersion', 'moderate') && ge(t, 'second_wave_absorption', 'moderate'),
  },
  v2_v1_plus_sb: {
    cheat: (t) => ge(t, 'creator_front_run', 'strong') || ge(t, 'equal_amount_split', 'strong') || ge(t, 'coordinated_sell_back', 'strong')
      || (ge(t, 'same_block_buy_burst', 'strong') && !ge(t, 'sell_dispersion', 'moderate')),
    healthy: (t) => ge(t, 'sell_dispersion', 'moderate') && ge(t, 'second_wave_absorption', 'moderate'),
  },
  v3_v2_modCounter: {
    cheat: (t) => ge(t, 'creator_front_run', 'strong') || ge(t, 'equal_amount_split', 'strong') || ge(t, 'coordinated_sell_back', 'strong')
      || (ge(t, 'same_block_buy_burst', 'strong') && !ge(t, 'sell_dispersion', 'moderate'))
      || (ge(t, 'coordinated_sell_back', 'moderate') && !ge(t, 'sell_dispersion', 'weak')),
    healthy: (t) => ge(t, 'sell_dispersion', 'moderate') && ge(t, 'second_wave_absorption', 'moderate'),
  },
  v4_v3_eqsb: {
    cheat: (t) => ge(t, 'creator_front_run', 'strong') || ge(t, 'equal_amount_split', 'strong') || ge(t, 'coordinated_sell_back', 'strong')
      || (ge(t, 'same_block_buy_burst', 'strong') && !ge(t, 'sell_dispersion', 'moderate'))
      || (ge(t, 'coordinated_sell_back', 'moderate') && !ge(t, 'sell_dispersion', 'weak'))
      || (ge(t, 'equal_amount_split', 'moderate') && ge(t, 'same_block_buy_burst', 'moderate') && !ge(t, 'sell_dispersion', 'weak')),
    healthy: (t) => ge(t, 'sell_dispersion', 'moderate') && ge(t, 'second_wave_absorption', 'moderate'),
  },
  v5_v3_health_loose: {
    cheat: (t) => ge(t, 'creator_front_run', 'strong') || ge(t, 'equal_amount_split', 'strong') || ge(t, 'coordinated_sell_back', 'strong')
      || (ge(t, 'same_block_buy_burst', 'strong') && !ge(t, 'sell_dispersion', 'moderate'))
      || (ge(t, 'coordinated_sell_back', 'moderate') && !ge(t, 'sell_dispersion', 'weak')),
    healthy: (t) => ge(t, 'sell_dispersion', 'moderate'),
  },
  v6_strong_disp_only: {
    cheat: (t) => ge(t, 'creator_front_run', 'strong') || ge(t, 'equal_amount_split', 'strong') || ge(t, 'coordinated_sell_back', 'strong')
      || !ge(t, 'sell_dispersion', 'moderate'),
    healthy: (t) => ge(t, 'sell_dispersion', 'moderate') && ge(t, 'second_wave_absorption', 'moderate'),
  },
};

console.log('n =', tickets.length, '（cheat/unhealthy/healthy =',
  ['cheat', 'unhealthy', 'healthy'].map((k) => tickets.filter((t) => t.want === k).length).join('/'), '）\n');
for (const [name, rule] of Object.entries(V)) {
  const ok = { cheat: 0, unhealthy: 0, healthy: 0 };
  const tot = { cheat: 0, unhealthy: 0, healthy: 0 };
  const wrong = [];
  for (const t of tickets) {
    if (!t.want) continue;
    tot[t.want] += 1;
    const got = rule.cheat(t) ? 'cheat' : (rule.healthy(t) ? 'healthy' : 'unhealthy');
    if (got === t.want) ok[t.want] += 1; else wrong.push(`${t.id}:${t.want}→${got}`);
  }
  const all = tot.cheat + tot.unhealthy + tot.healthy;
  const allOk = ok.cheat + ok.unhealthy + ok.healthy;
  console.log(`${name.padEnd(22)} ${allOk}/${all}  cheat ${ok.cheat}/${tot.cheat} unhealthy ${ok.unhealthy}/${tot.unhealthy} healthy ${ok.healthy}/${tot.healthy}`);
  console.log(`  错票: ${wrong.join(' ') || '无'}`);
}

// 漏检 cheat 票形状（v5 规则下）——验证「缺强档指纹+卖分散」假设
console.log('\n== v5 漏检 cheat 票的现象档位 ==');
for (const t of tickets) {
  if (t.want !== 'cheat') continue;
  const v5cheat = ge(t, 'creator_front_run', 'strong') || ge(t, 'equal_amount_split', 'strong') || ge(t, 'coordinated_sell_back', 'strong')
    || (ge(t, 'same_block_buy_burst', 'strong') && !ge(t, 'sell_dispersion', 'moderate'))
    || (ge(t, 'coordinated_sell_back', 'moderate') && !ge(t, 'sell_dispersion', 'weak'));
  if (v5cheat) continue;
  const short = ['same_block_buy_burst', 'equal_amount_split', 'coordinated_sell_back', 'quota_ladder_heat', 'creator_front_run', 'second_wave_absorption', 'sell_dispersion']
    .map((id) => `${id.slice(0, 2)}${{ 0: 'n', 1: 'w', 2: 'm', 3: 's' }[L(t, id)]}`).join(' ');
  console.log(`  ${t.id}: ${short}`);
}
