// 一次性查询：0xcfc3…7777 叙事 stage1 state（语料段）抽查
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = '0xcfc39a869380200949685d16197e93f100207777';

async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select('token_symbol,raw_api_data,stage1_prompt,stage2_prompt,stage_final_result')
    .eq('token_address', ADDR)
    .maybeSingle();
  if (error) throw error;
  if (!data) { console.log('无行'); return; }

  console.log('token_symbol =', data.token_symbol);
  const raw = data.raw_api_data || {};
  console.log('raw_api_data keys =', Object.keys(raw));
  console.log('raw name =', raw.name, '| symbol =', raw.symbol, '| desc =', String(raw.description || raw.desc || '').slice(0, 500));
  console.log('raw twitter =', raw.twitter_url || raw.twitterUrl, '| website =', raw.website || raw.websiteUrl);

  const p1 = data.stage1_prompt;
  const st1 = typeof p1 === 'string' ? p1 : (p1 && p1.state);
  const s = String(st1 || '');
  console.log('\n=== stage1 state 长度', s.length, '===');
  console.log(s.slice(0, 5000));
  console.log('\n... [截断] ...\n');
  const i = s.indexOf('TWITTER');
  if (i >= 0) console.log('=== TWITTER 段 ===\n' + s.slice(i, i + 4000));

  const p2 = data.stage2_prompt;
  const st2 = typeof p2 === 'string' ? p2 : (p2 && p2.state);
  const s2 = String(st2 || '');
  console.log('\n=== stage2 state 长度', s2.length, '===');
  const gates = s2.match(/J1\.5[0-9]|用户接纳度|web3_user_acceptability|meme 币/g);
  console.log('stage2 state 关键词命中:', gates ? [...new Set(gates)] : null);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
