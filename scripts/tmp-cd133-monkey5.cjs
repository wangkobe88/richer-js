const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const REBOOT = new Date('2026-11-02T07:47:41Z').getTime();
async function main() {
  const client = dbManager.getClient();
  // 1) 全库 symbol=猴子币 的 token 有几张
  const ev = await client.from('wss_events').select('token_address, payload, block_time')
    .eq('kind', 'token_create').eq('payload->>symbol', '猴子币').limit(20);
  console.log('== 全库 symbol=猴子币 token_create ' + (ev.data || []).length + ' 张:');
  for (const r of ev.data || []) console.log('  ' + r.token_address + ' create=' + r.block_time + ' creator=' + (r.payload || {}).creator);
  // 2) 这些 token 的 cheat_detection 行数
  const toks = (ev.data || []).map(r => r.token_address);
  if (toks.length) {
    const cd = await client.from('cheat_detection').select('token_address, created_at, snapshot_digest')
      .in('token_address', toks).order('created_at', { ascending: true }).limit(50);
    console.log('\n== 这些票的 cheat_detection 行:');
    for (const r of cd.data || []) {
      const d = r.snapshot_digest || {};
      console.log('  ' + r.token_address.slice(0, 10) + ' ' + r.created_at + ' grade=' + d.grade + ' v=' + d.gradeVersion + ' tickCount=' + d.tickCount);
    }
  }
  // 3) d827 在 07:47 重启后的 ticks（collector 是否持续处理）
  const t = await client.from('wss_price_ticks').select('id, block_time, trade_type')
    .eq('token_address', '0xd827bc26713cb6412f4d163766938dee3d0c7777')
    .gte('block_time', '2026-11-02T07:47:41+00:00')
    .order('id', { ascending: true }).limit(5);
  const tCnt = await client.from('wss_price_ticks').select('id', block_time='x') .limit(0); // noop 防语法错误
  console.log('\n== d827 07:47 后首 5 笔 ticks: ' + (t.data || []).length);
  for (const r of t.data || []) console.log('  ' + r.block_time + ' ' + r.trade_type + ' id=' + r.id);
  // 4) 对照组：07:47 后首析的行里，token 创建于 07:47 前的有几张（=重启后旧票仍在视野的证据）
  const cdAll = await client.from('cheat_detection').select('token_address, created_at, snapshot_digest')
    .gte('created_at', '2026-11-02T07:47:41+00:00').order('created_at', { ascending: true }).limit(400);
  console.log('\n== 07:47 后 cheat_detection 共 ' + (cdAll.data || []).length + ' 行，抽 token 首析行:');
  const firstSeen = new Map();
  for (const r of cdAll.data || []) if (!firstSeen.has(r.token_address)) firstSeen.set(r.token_address, r);
  const tokens = [...firstSeen.keys()];
  let oldTokens = 0, newTokens = 0;
  const oldExamples = [];
  for (const tok of tokens) {
    const evc = await client.from('wss_events').select('payload').eq('token_address', tok).eq('kind', 'token_create').limit(1);
    const ts = ((evc.data[0] || {}).payload || {}).eventTsSec;
    if (!ts) continue;
    if (ts * 1000 < REBOOT) { oldTokens++; if (oldExamples.length < 5) oldExamples.push(tok.slice(0, 10) + '@' + new Date(ts * 1000).toISOString().slice(11, 19)); }
    else newTokens++;
  }
  console.log('  首析 token 总数=' + tokens.length + '；创建于 07:47 前(旧票)=' + oldTokens + '；之后(新票)=' + newTokens);
  if (oldExamples.length) console.log('  旧票被首析例: ' + oldExamples.join(' / '));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
