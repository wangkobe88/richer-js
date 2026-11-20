#!/usr/bin/env node
// 0x5629 团队扩簇进 G5 cheatCrew 的误伤实测：bt-v150（10-12 高峰窗，ladder v32 含 G5v1）+ bt-v141（11 月对照窗）
// 增量口径：团队足迹票中，G5v1 六址之外的团队钱包（19 址）足迹票的成交面 Σpnl = 扩名单的增量代价/收益
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXPS = [
  { tag: 'bt-v150(10-12高峰窗,v32+G5)', name: 'bt-v150-ladder-v32-cards4-36h-win1012' },
  { tag: 'bt-v141(11-02对照窗)', name: 'bt-v141-all-changes-33h' },
  { tag: 'bt-v109(10月中基底)', name: 'bt-v109-全体系-长周期v68基底-1112' },
];

async function main() {
  const sb = dbManager.getClient();
  const teamTokens = JSON.parse(fs.readFileSync('/tmp/tmp-5629-team-tokens.json', 'utf8'));
  const TT = new Map(teamTokens.map(x => [x.token, x])); // token -> {teamWallets, wallets}
  const g5v1 = JSON.parse(fs.readFileSync('config/rosters/cheat-crew-wallets.json', 'utf8')).wallets;
  const G5 = new Set(g5v1);
  const g5v1Only = new Set(['0x06f0a63c7f3df29d855c84c6cbfc55f35abc1cfc', '0x0b2259e10d494f848ea1458acb39152ad9865424', '0x727864fad9aef9b1049b1a724c66d2f91ecc0bf2', '0x27ac0351e225a15fb13d6b84a8dc31d799d0fe76', '0x66c81cf68a6bfb01a1885be28f01a588be477231', '0x1bd3c9ac6f9a4204aa7ededcf3a7afe16b3f644e']);

  for (const { tag, name } of EXPS) {
    const { data: eds } = await sb.from('experiments').select('id,experiment_name,status').ilike('experiment_name', `%${name}%`).limit(3);
    if (!eds || !eds.length) { console.log(`\n### ${tag}: 实验未找到（${name}）`); continue; }
    const ed = eds[0];
    const { data: trades, error: tErr } = await sb.from('trades').select('token_address,trade_direction,trade_status,input_amount,output_amount,input_currency,output_currency,created_at,metadata')
      .eq('experiment_id', ed.id).order('created_at').limit(5000);
    if (tErr) { console.log(`\n### ${tag} trades 拉取失败: ${tErr.message}`); continue; }
    // ep 口径：per token 成交后净额（input BNB − output BNB，buy=input bnb / sell=output bnb）+ metadata.profit 字段兜底
    const buys = trades.filter(t => t.trade_direction === 'buy');
    const tok = new Map();
    for (const t of trades) {
      let o = tok.get(t.token_address); if (!o) { o = { pnl: 0, buyN: 0, legs: 0, buys: [], sells: [] }; tok.set(t.token_address, o); }
      o.legs++;
      if (t.trade_direction === 'buy') {
        o.buyN++;
        const bnb = (t.input_currency === 'BNB' ? +t.input_amount : +t.output_amount) || 0;
        o.buys.push({ at: t.executed_at || t.created_at, bnb, tok: +(t.input_currency === 'BNB' ? t.output_amount : t.input_amount) || 0 });
      } else {
        const bnb = (t.output_currency === 'BNB' ? +t.output_amount : +t.input_amount) || 0;
        o.sells.push({ at: t.executed_at || t.created_at, bnb });
      }
    }
    // per token ep = Σ卖出 BNB − Σ买入 BNB（BNB 域盈亏，未实现仓位按 0 计——与回测报告同向近似）
    for (const [k, o] of tok) {
      o.pnl = o.sells.reduce((s, x) => s + x.bnb, 0) - o.buys.reduce((s, x) => s + x.bnb, 0);
    }
    const tokens = [...tok.keys()];
    const nTeam = tokens.filter(t => TT.has(t));
    console.log(`\n### ${tag}  ${ed.experiment_name} id=${ed.id.slice(0, 8)} status=${ed.status}`);
    console.log(`成交票=${tokens.length} 买腿=${buys.length} 总Σpnl=${[...tok.values()].reduce((s, o) => s + o.pnl, 0).toFixed(3)}`);

    // 团队足迹票（22 钱包口径）
    let teamPnl = 0, teamN = 0;
    const byLayer = { '≥3': { n: 0, pnl: 0 }, '2': { n: 0, pnl: 0 }, '1': { n: 0, pnl: 0 } };
    const rows = [];
    for (const t of nTeam) {
      const o = tok.get(t), x = TT.get(t);
      const ws = x.wallets || [];
      const hitV1 = ws.filter(w => G5.has(w));          // 该票到场钱包中 G5v1 名单者
      const hitNew = ws.filter(w => !G5.has(w));         // 22 址中 v1 之外的（增量名单）
      const layer = x.teamWallets >= 3 ? '≥3' : String(x.teamWallets);
      byLayer[layer].n++; byLayer[layer].pnl += o.pnl;
      teamPnl += o.pnl; teamN++;
      rows.push({ t, n: x.teamWallets, pnl: o.pnl, v1: hitV1.length, newW: hitNew.length, ws });
    }
    console.log(`团队足迹成交票=${teamN} Σpnl=${teamPnl.toFixed(3)}（分层: ≥3钱包 ${byLayer['≥3'].n}票 ${byLayer['≥3'].pnl.toFixed(3)} / 2钱包 ${byLayer['2'].n}票 ${byLayer['2'].pnl.toFixed(3)} / 1钱包 ${byLayer['1'].n}票 ${byLayer['1'].pnl.toFixed(3)}）`);
    // 增量面：hitNew>0 且 hitV1==0（纯新增钱包足迹，G5v1 现状拦不住的票）
    const inc = rows.filter(r => r.newW > 0 && r.v1 === 0);
    const incPnl = inc.reduce((s, r) => s + r.pnl, 0);
    console.log(`【增量面】仅新钱包(非v1名单)足迹成交票=${inc.length} Σpnl=${incPnl.toFixed(3)} —— 扩到22址会新拦这些`);
    inc.sort((a, b) => a.pnl - b.pnl);
    for (const r of inc) console.log(`   ${r.t} 团队${r.n}钱包 pnl=${r.pnl.toFixed(4)} 新钱包=${r.newW} ${r.ws.filter(w => !G5.has(w)).slice(0, 3).map(w => w.slice(0, 10)).join(',')}`);
    // 已含 v1 钱包但仍成交的（G5 现状应拦——观察，可能是纯卖到场/买入额0 的假阳性）
    const v1Hit = rows.filter(r => r.v1 > 0);
    if (v1Hit.length) console.log(`（观察）含v1名单钱包足迹却成交的票=${v1Hit.length} Σpnl=${v1Hit.reduce((s, r) => s + r.pnl, 0).toFixed(3)} —— G5语义=名单钱包有买入才拦，到场≠买入`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
