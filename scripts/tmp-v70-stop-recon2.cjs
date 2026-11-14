// v70 停机对账二遍：success 过滤+卡账本净额+链上 balanceOf 终裁（两嫌疑票）
const { dbManager } = require('../src/services/dbManager.js');
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';

async function main() {
  const c = await dbManager.getClient();
  const { data: trades } = await c.from('trades')
    .select('token_symbol,token_address,trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,sold_cards,metadata,created_at')
    .eq('experiment_id', EXP)
    .order('created_at', { ascending: true })
    .limit(500);

  const byTok = {};
  for (const t of trades || []) {
    if (t.trade_status !== 'success') continue; // 停机对账红线：只记 success
    const k = t.token_address;
    byTok[k] = byTok[k] || { sym: t.token_symbol || '', buyN: 0, sellN: 0, buyBnb: 0, sellBnb: 0, cardsBought: 0, cardsSold: 0 };
    const isBuy = /buy/i.test(t.trade_direction || '');
    const inBnb = (t.input_currency || '').toUpperCase() === 'BNB';
    const outBnb = (t.output_currency || '').toUpperCase() === 'BNB';
    const bnb = inBnb ? Number(t.input_amount || 0) : outBnb ? Number(t.output_amount || 0) : 0;
    if (isBuy) {
      byTok[k].buyN++; byTok[k].buyBnb += bnb;
      const mt = t.metadata || {};
      const cards = (mt.cardTrade && mt.cardTrade.cards) || mt.cards || 0;
      byTok[k].cardsBought += Number(cards) || 0;
    } else {
      byTok[k].sellN++; byTok[k].sellBnb += bnb;
      byTok[k].cardsSold += Number(t.sold_cards) || 0;
    }
  }

  console.log('=== success 口径对账（卡账本）===');
  const suspects = [];
  for (const [k, v] of Object.entries(byTok)) {
    const netCards = v.cardsBought - v.cardsSold;
    const open = netCards > 0 || (v.buyN > 0 && v.cardsBought === 0 && v.cardsSold === 0 && v.sellN === 0);
    if (open) suspects.push(k);
    console.log(`${k} ${(v.sym || '').padEnd(10)} 买${v.buyN}/${v.buyBnb.toFixed(4)}BNB(${v.cardsBought}卡) 卖${v.sellN}/${v.sellBnb.toFixed(4)}BNB(${v.cardsSold}卡) 净卡=${netCards}${open ? ' ←未清' : ''}`);
  }
  console.log('嫌疑未清:', suspects.join(' ') || '无');

  // 链上 balanceOf 终裁
  if (suspects.length) {
    const { JsonRpcProvider, Contract } = require('ethers');
    const provider = new JsonRpcProvider('https://bsc-dataseed.binance.org');
    const erc20 = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];
    const { data: exps } = await c.from('experiments').select('config').eq('id', EXP).limit(1);
    const wallet = (exps[0].config || {}).wallet || {};
    const walletAddr = wallet.address || (typeof wallet === 'string' ? wallet : null);
    console.log('\n=== 链上 balanceOf（钱包', walletAddr, '）===');
    for (const addr of suspects) {
      try {
        const ct = new Contract(addr, erc20, provider);
        const [bal, dec] = await Promise.all([ct.balanceOf(walletAddr), ct.decimals()]);
        console.log(`${addr} 链上余额 = ${Number(bal) / 10 ** Number(dec)} (${bal.toString()} raw / ${dec} dec)`);
      } catch (e) { console.log(`${addr} 链上查询失败: ${e.message}`); }
    }
  }
  await dbManager.close?.();
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
