// 一次性（182 跑）：13d7 crash 特征清晰度排查（用户「感觉还是有点模糊，怕误伤」）
// ——crash 锚五票对照矩阵：13d7/LOVE/2ef6（拦截族）vs a813/f485/28ad（normal_dip 正例）。
const { dbManager } = require('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const TOKENS = [
  { exp: V97, addr: '0x13d7a62693e2860ba4bd51d6c9c75edc53427777', key: '13d7-用户补充(拦)' },
  { exp: V94, addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', key: 'LOVE-拦' },
  { exp: V96, addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', key: '2ef6-拦' },
  { exp: V94, addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', key: 'a813-正例(放)' },
  { exp: V94, addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', key: 'f485-正例(放)' },
  { exp: V95, addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', key: '28ad-正例(放)' },
];

async function main() {
  const client = await dbManager.getClient();
  console.log('crash 四臂（BP58 二修）：curVsAth≤-25 ∨ chg30≤-25 ∨ nearMaxDn5≤-15 ∨ curVsMinGap≤2pp → 进入形态复核；BP59 第三轴：chg5 深负+chg5≈chg10 同深无铺垫=急跌进行时');
  console.log('票 | curVs | athVs | curVsAth | chg5 | chg10 | chg30 | nearDn5 | nearUp5 | minGap | 末10笔价格序列');
  for (const t of TOKENS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
    if (!sigs || !sigs.length) { console.log(`${t.key} 无信号`); continue; }
    const anchorMs = Date.parse(sigs[0].created_at);
    const rows = [];
    let fromId = 0;
    for (;;) {
      const { data, error } = await client.from('wss_price_ticks')
        .select('id,block_time,price_bnb,bnb_amount,trade_type').eq('token_address', t.addr)
        .gt('id', fromId).order('id', { ascending: true }).limit(1000);
      if (error) throw error;
      if (!data || !data.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
      fromId = data[data.length - 1].id;
    }
    const win = rows.filter((x) => Date.parse(x.block_time) <= anchorMs).slice(-3000);
    const { data: creates } = await client.from('wss_events')
      .select('token_address,payload').eq('kind', 'token_create').eq('token_address', t.addr);
    const p = (creates && creates[0] && creates[0].payload) || {};
    const snap = buildBuyPointSnapshot(win, { address: t.addr, symbol: p.symbol, name: p.name, platform: 'fourmeme' }, { anchorTickCount: win.length, signalInfo: null });
    const a = snap.buyDerived || {};
    const g = (k) => { const v = a[k]; return v == null ? '?' : Number(v).toFixed(1); };
    const tail = win.filter((r) => r.price_bnb > 0).slice(-10).map((r) => Number(r.price_bnb).toExponential(2)).join(' ');
    console.log(`${t.key} | curVs ${g('currentVsLaunchPct')} | ath ${g('athVsLaunchPct')} | vsAth ${g('curVsAthPct')} | chg5 ${g('chg5Pct')} | chg10 ${g('chg10Pct')} | chg30 ${g('chg30Pct')} | nDn5 ${g('nearMaxDn5Pct')} | nUp5 ${g('nearMaxUp5Pct')} | minGap ${g('curVsMinGapPct')}`);
    console.log(`    末10可靠价: ${tail}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
