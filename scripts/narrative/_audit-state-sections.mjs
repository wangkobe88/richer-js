#!/usr/bin/env node
/**
 * 临时审计（2026-10-03，state 保真缺口量化）：161 票线上 stage1_prompt.state 的
 * 语料节构成——binance_square_info/instagram_info 等不持久化为列，重建 state 必缺
 * 这些节（币安智能案实证：线上 675 vs 重建 466 字符）。输出每票的节类型清单
 * /tmp/state-sections.json，供与 r2/ctrl 校准结果交叉：含非 twitter 节的票其
 * r1/r2/ctrl 绝对评级不可信（净效应两臂同缺口仍自洽）。纯读不写 DB。
 *
 * 用法（182 项目根）：node scripts/narrative/_audit-state-sections.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(resolve(__dirname, '../..'));

const { NarrativeRepository } = await import('../../src/narrative/db/NarrativeRepository.mjs');

const tickets = JSON.parse(readFileSync('/tmp/r3-addrs.json', 'utf8'));
const supabase = NarrativeRepository.getSupabase();

const out = [];
for (let i = 0; i < tickets.length; i += 50) {
  const batch = tickets.slice(i, i + 50);
  const { data, error } = await supabase.from('token_narrative')
    .select('token_address, token_symbol, stage1_prompt')
    .in('token_address', batch.map(t => t.addr));
  if (error) throw new Error(error.message);
  for (const row of data) {
    let sections = null, len = null;
    try {
      const p = typeof row.stage1_prompt === 'string' ? JSON.parse(row.stage1_prompt) : row.stage1_prompt;
      const st = p?.state || '';
      len = st.length;
      // 中文节头【xxx】+ 英文头 [XXX]
      sections = [...new Set([...st.matchAll(/【([^】]{1,12})】/g)].map(m => m[1]))];
    } catch (e) { sections = ['__parse_fail__']; }
    out.push({ addr: row.token_address, symbol: row.token_symbol, len, sections });
  }
}
writeFileSync('/tmp/state-sections.json', JSON.stringify(out, null, 1));
const withNonTw = out.filter(r => (r.sections || []).some(s => !/主推文|父推|推文互动|作者粉丝数|发布时间|相关账号|账号推文/.test(s)));
console.log(`共 ${out.length} 行已写 /tmp/state-sections.json；含非主推文节（广场/IG/网站/视频等）${withNonNonTwCount(withNonTw)} 票`);
function withNonNonTwCount(arr) { return arr.length; }
for (const r of withNonNonTw) console.log(`  ${r.symbol} ${r.addr} 节:${r.sections.filter(s => !/主推文|父推|推文互动|作者粉丝数|发布时间|相关账号|账号推文/.test(s)).join('/')}`);
process.exit(0);
