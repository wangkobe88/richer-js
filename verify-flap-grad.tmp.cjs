// 临时脚本（182 跑）：验证 flap 毕业市值锚——峰值市值接近锚的 token，断流前尾部市值是否收敛
// 判定：max(price)*supply ≥ 50 BNB 的 token，看尾部（最后3笔可靠价均值）市值分布
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

(async () => {
  const client = dbManager.getClient();
  // 1. tokens + supply
  const tokens = [];
  for (let off = 0; ; off += 1000) {
    const { data: page, error } = await client
      .from('experiment_tokens')
      .select('token_address, token_symbol, raw_api_data')
      .eq('experiment_id', '572033ad-831e-4f60-9985-f6e4f63739c1')
      .range(off, off + 999);
    if (error) throw error;
    if (!page || !page.length) break;
    tokens.push(...page);
    if (page.length < 1000) break;
  }
  const supply = new Map();
  let noSupply = 0;
  for (const t of tokens) {
    const s = Number(t.raw_api_data?.totalSupply || 0);
    if (s > 0) supply.set(t.token_address, s); else noSupply++;
  }
  console.log(`tokens=${tokens.length} 有supply=${supply.size} 缺supply=${noSupply}`);

  // 2. 全量 ticks 拉到内存（79k 行）
  const ticks = [];
  for (let off = 0; ; off += 1000) {
    const { data: page, error } = await client
      .from('wss_price_ticks')
      .select('token_address, price_bnb, block_time')
      .eq('price_outlier', false)
      .order('block_time', { ascending: true })
      .range(off, off + 999);
    if (error) throw error;
    if (!page || !page.length) break;
    ticks.push(...page);
    if (page.length < 1000) break;
  }
  console.log(`ticks=${ticks.length}`);

  // 3. 每 token 聚合：max 价 + 尾部 3 笔均价
  const agg = new Map();
  for (const tk of ticks) {
    const p = parseFloat(tk.price_bnb);
    if (!(p > 0)) continue;
    let a = agg.get(tk.token_address);
    if (!a) { a = { max: 0, tail: [] }; agg.set(tk.token_address, a); }
    if (p > a.max) a.max = p;
    a.tail.push(p); if (a.tail.length > 3) a.tail.shift();  // 正序推入=尾部3笔
  }
  // 4. 峰值市值 ≥ 50 BNB 的 token：尾部市值分布
  const rows = [];
  for (const [addr, a] of agg) {
    const s = supply.get(addr);
    if (!s) continue;
    const peakCap = a.max * s;
    if (peakCap >= 50) {
      const tailCap = (a.tail.reduce((x, y) => x + y, 0) / a.tail.length) * s;
      rows.push({ addr: addr.slice(0, 10), peakCap, tailCap, tailPctOfPeak: tailCap / peakCap * 100 });
    }
  }
  rows.sort((x, y) => y.peakCap - x.peakCap);
  console.log(`\n峰值市值≥50 BNB 的 token：${rows.length} 个`);
  console.log('addr        peakCap(BNB)  tailCap(BNB)  tail/peak%');
  for (const r of rows.slice(0, 25)) {
    console.log(`${r.addr}  ${r.peakCap.toFixed(1).padStart(10)}  ${r.tailCap.toFixed(1).padStart(11)}  ${r.tailPctOfPeak.toFixed(0).padStart(8)}`);
  }
  // 5. 尾部市值收敛统计（毕业断流者尾部应 ≈ 锚）
  const tailCaps = rows.map(r => r.tailCap).sort((a, b) => a - b);
  if (tailCaps.length) {
    const q = (p) => tailCaps[Math.floor(p * (tailCaps.length - 1))];
    console.log(`\ntailCap 分布：min=${tailCaps[0].toFixed(1)} P25=${q(0.25).toFixed(1)} P50=${q(0.5).toFixed(1)} P75=${q(0.75).toFixed(1)} max=${tailCaps[tailCaps.length - 1].toFixed(1)} BNB`);
    const near72 = tailCaps.filter(v => v >= 60 && v <= 85).length;
    console.log(`tailCap∈[60,85]（≈毕业锚72邻域）：${near72}/${tailCaps.length}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
