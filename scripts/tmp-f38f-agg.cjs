const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
  const { data: ticks } = await sb.from('wss_price_ticks')
    .select('price_bnb,bnb_amount,trader_address,sender_address,block_number,log_index,trade_type,block_time,price_outlier')
    .eq('token_address', TOKEN).gte('block_time','2026-10-04T05:50:10Z').lte('block_time','2026-10-04T06:05:30Z')
    .order('id', {ascending:true}).limit(5000);
  // 链上真序
  ticks.sort((a,b)=> a.block_number-b.block_number || a.log_index-b.log_index);
  console.log('total rows(15min):', ticks.length);
  const SIG = new Date('2026-10-04T05:50:32Z').getTime();
  const w = t => (t.sender_address||t.trader_address||'').slice(0,10);
  // 1) 信号前快照（<=05:50:32）
  const pre = ticks.filter(t=>new Date(t.block_time).getTime()<=SIG);
  const wallets = {};
  for (const t of pre) {
    const k=w(t); wallets[k]=wallets[k]||{buy:0,sell:0,first:t.block_time,last:t.block_time};
    if(t.trade_type==='buy') wallets[k].buy+=Number(t.bnb_amount); else wallets[k].sell+=Number(t.bnb_amount);
    wallets[k].last=t.block_time;
  }
  console.log('\n== 信号前(05:50:10~32) 钱包一览 ==');
  Object.entries(wallets).sort((a,b)=>(b[1].buy+b[1].sell)-(a[1].buy+a[1].sell)).forEach(([k,v])=>{
    console.log(`${k}\t买${v.buy.toFixed(3)} 卖${v.sell.toFixed(3)}\t净${(v.buy-v.sell).toFixed(3)}\t${String(v.first).slice(11,19)}~${String(v.last).slice(11,19)}`);
  });
  // 2) 信号后各分钟段：买/卖/净/钱包数
  console.log('\n== 逐分钟流量 ==');
  for (let m=0;m<8;m++){
    const t0=new Date('2026-10-04T05:50:10Z').getTime()+m*60000, t1=t0+60000;
    const seg=ticks.filter(t=>{const x=new Date(t.block_time).getTime();return x>=t0&&x<t1;});
    const buy=seg.filter(t=>t.trade_type==='buy'), sell=seg.filter(t=>t.trade_type==='sell');
    const bBnb=buy.reduce((s,t)=>s+Number(t.bnb_amount),0), sBnb=sell.reduce((s,t)=>s+Number(t.bnb_amount),0);
    const ws=new Set(seg.map(w)); 
    const lo=Math.min(...seg.map(t=>Number(t.price_bnb))), hi=Math.max(...seg.map(t=>Number(t.price_bnb)));
    console.log(`${new Date(t0).toISOString().slice(11,16)}\t买${bBnb.toFixed(2)}B/${buy.length}笔 卖${sBnb.toFixed(2)}B/${sell.length}笔 净${(bBnb-sBnb).toFixed(2)} 钱包${ws.size}\t价${lo.toExponential(2)}~${hi.toExponential(2)}`);
  }
  // 3) 信号价买入后回撤：信号价=05:50:29 tick 价 6.268e-9；也看 6.96e-9
  const sigTicks = pre.slice(-2);
  console.log('\n信号前最后 tick:', sigTicks.map(t=>`${t.block_time} ${Number(t.price_bnb).toExponential(3)} ${t.trade_type}`).join(' | '));
  for (const entryP of [6.268e-9, 6.96e-9]) {
    const post = ticks.filter(t=>new Date(t.block_time).getTime()>SIG);
    const minP = Math.min(...post.slice(0,400).map(t=>Number(t.price_bnb)));
    const maxP = Math.max(...post.map(t=>Number(t.price_bnb)));
    console.log(`入场 ${entryP.toExponential(3)}: 信号后最低价 ${minP.toExponential(3)} (${((minP/entryP-1)*100).toFixed(1)}%) / 全窗最高 ${maxP.toExponential(3)} (+${((maxP/entryP-1)*100).toFixed(0)}%)`);
  }
  // 4) 头 60s 钱包分组：05:50:21-27 建仓组、05:50:36 拉起组的终局（到 06:05:30）
  const groups = {
    'A建仓组(0.198对+0.0661对+51a89b)': ['0xf2042e','0xe90da7','0x68f92b','0xa44039','0x51a89b'],
  };
  // B拉起组 = 05:50:36-37 首次出现的钱包
  const bWaveStart = new Date('2026-10-04T05:50:36Z').getTime(), bWaveEnd = new Date('2026-10-04T05:50:38Z').getTime();
  const preW = new Set(pre.map(w));
  const bWallets = new Set();
  ticks.filter(t=>{const x=new Date(t.block_time).getTime();return x>=bWaveStart&&x<bWaveEnd&&t.trade_type==='buy';}).forEach(t=>{
    const k=w(t); if(!preW.has(k)) bWallets.add(k);
  });
  console.log('\nB 拉起组（05:50:36~38 新进钱包）:', [...bWallets].join(','));
  for (const [name, prefixes] of Object.entries({A组:['0xf2042e','0xe90da7','0x68f92b','0xa44039','0x51a89b'], B组:[...bWallets]})) {
    let buy=0,sell=0;
    ticks.forEach(t=>{ if(prefixes.some(p=>w(t).startsWith(p))) { if(t.trade_type==='buy') buy+=Number(t.bnb_amount); else sell+=Number(t.bnb_amount);} });
    console.log(`${name}: 全窗买 ${buy.toFixed(3)}B 卖 ${sell.toFixed(3)}B → 终局净持投入 ${(buy-sell).toFixed(3)}B（回收率 ${(sell/buy*100).toFixed(0)}%）`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
