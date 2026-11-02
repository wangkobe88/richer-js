// CZ 语料 RIKI 簇（rated high）+ Ragu 本尊 市场结局对照（单票小读取）
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const db = dbManager.getClient();
  const ADDRS = ['0xfb509519','0xbc482460','0xfb97490e','0x47eb90f2','0x4704e74e','0x3d45ae57'];
  // 取全地址
  const { data: tn, error: e0 } = await db.from('token_narrative')
    .select('token_address,token_symbol,final_result')
    .gte('analyzed_at','2026-10-29T06:00').lte('analyzed_at','2026-10-29T12:00')
    .in('token_symbol',['RIKI','RAGU','Ragu']);
  if (e0) throw e0;
  console.log('=== RIKI/RAGU 全地址', tn.length, '个');
  const addrs = tn.map(r=>r.token_address);
  for (const r of tn) {
    const { data: tk, error } = await db.from('wss_price_ticks')
      .select('price_bnb,block_time,trade_type,trader_address')
      .eq('token_address', r.token_address)
      .order('block_time',{ascending:true}).limit(3000);
    if (error) throw error;
    if (!tk.length) { console.log(`${r.token_symbol} ${r.token_address.slice(0,8)}… rating=${r.final_result?.rating} | 无 ticks`); continue; }
    let peak=0,peakTs=null; const traders=new Set();
    for (const t of tk){const p=Number(t.price_bnb);if(p>peak){peak=p;peakTs=t.block_time;}traders.add(t.trader_address);}
    const first=Number(tk[0].price_bnb), last=Number(tk[tk.length-1].price_bnb);
    console.log(`${r.token_symbol} ${r.token_address.slice(0,8)}… rating=${r.final_result?.rating} | 首 ticks=${tk.length} | 峰=${(peak/first).toFixed(1)}x@${peakTs?.slice(11,19)} 距峰=${(((last-peak)/peak)*100).toFixed(0)}% traders=${traders.size} 窗=${tk[0].block_time.slice(11,19)}→${tk[tk.length-1].block_time.slice(11,16)}`);
  }
  // 我们有没有买过（今天全部实验）
  const { data: tr, error: e2 } = await db.from('trades')
    .select('experiment_id,token_address,direction,price_bnb,quantity,trade_time,status,error')
    .in('token_address', addrs.length?addrs:['0x0000000000000000000000000000000000000000'])
    .gte('trade_time','2026-10-29');
  if (e2) console.log('trades err:', e2.message);
  else { console.log('=== 今日这些票的 trades:', tr.length); for (const t of tr) console.log(JSON.stringify(t).slice(0,220)); }
  process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
