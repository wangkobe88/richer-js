#!/usr/bin/env node
/** 评3（high）161 票语料导出——东西方主题归类用（twitter_info + prestage ipInfo 轻量抽取） */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

(async () => {
  const c = dbManager.getClient();
  const list = JSON.parse(fs.readFileSync('/tmp/r3-addrs.json', 'utf8'));
  console.log('清单:', list.length);
  const out = [];
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    const { data, error } = await c.from('token_narrative')
      .select('token_address,token_symbol,token_category,twitter_info,prestage_result,stage_final_result')
      .in('token_address', chunk.map(x => x.addr));
    if (error) throw new Error(error.message);
    const byAddr = new Map((data || []).map(r => [r.token_address, r]));
    for (const item of chunk) {
      const r = byAddr.get(item.addr);
      if (!r) { out.push({ symbol: item.symbol, addr: item.addr, missing: true }); continue; }
      const pr = r.prestage_result || {};
      const ip = pr && pr.details && pr.details.ipInfo ? {
        name: pr.details.ipInfo.name, desc: pr.details.ipInfo.desc,
        tier: pr.details.ipInfo.tier, type: pr.details.ipInfo.type,
      } : null;
      const tw = r.twitter_info || null;
      out.push({
        symbol: item.symbol, addr: item.addr, category: r.token_category,
        rating: r.stage_final_result ? r.stage_final_result.rating : null,
        ip,
        tw: tw ? {
          text: (tw.text || '').slice(0, 400),
          author: tw.author_name || null,
          replyText: tw.in_reply_to && tw.in_reply_to.text ? tw.in_reply_to.text.slice(0, 200) : null,
        } : null,
      });
    }
    console.log(`  ${Math.min(i + 80, list.length)}/${list.length}`);
  }
  fs.writeFileSync(require('path').join(__dirname, '../data/analysis-82093ca3-r3-corpus.json'), JSON.stringify(out));
  console.log('导出', out.length, '→ data/analysis-82093ca3-r3-corpus.json');
  console.log('有 ipInfo:', out.filter(x => x.ip).length, '有 twitter:', out.filter(x => x.tw).length, '缺行:', out.filter(x => x.missing).length);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
