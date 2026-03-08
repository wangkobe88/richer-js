const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkTokens() {
  const expId = '543f039c-c1bd-45ba-94fa-b1490c123513';

  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('experiment_id', expId)
    .order('created_at', { ascending: true });

  // 按代币分组
  const tokenMap = new Map();
  trades.forEach(t => {
    if (!tokenMap.has(t.token_address)) {
      tokenMap.set(t.token_address, []);
    }
    tokenMap.get(t.token_address).push(t);
  });

  // 检查所有代币的条件
  console.log('【所有代币的条件检查】');
  console.log('');
  console.log('代币          ratio>=0.7  earlyReturn>80  age<=2.5  备注');
  console.log('─'.repeat(65));

  for (const [addr, tokenTrades] of tokenMap) {
    const buy = tokenTrades.find(t => t.trade_direction === 'buy');
    const symbol = tokenTrades[0].token_symbol;

    if (!buy) continue;

    const metadata = buy.metadata?.factors || {};
    const trend = metadata.trendFactors || {};

    const ratio = trend.trendRiseRatio || 0;
    const earlyReturn = trend.earlyReturn || 0;
    const age = trend.age || 0;

    const ratioPass = ratio >= 0.7;
    const earlyPass = earlyReturn > 80;
    const agePass = age <= 2.5;

    const ratioMark = ratioPass ? '✓' : '✗';
    const earlyMark = earlyPass ? '✓' : '✗';
    const ageMark = agePass ? '✓' : '✗';

    let notes = [];
    if (!ratioPass) notes.push(`ratio=${ratio.toFixed(2)}`);
    if (!earlyPass) notes.push(`earlyReturn=${earlyReturn.toFixed(0)}`);
    if (!agePass) notes.push(`age=${age.toFixed(2)}`);

    console.log(`${symbol.padEnd(12)} ${ratioMark.padStart(10)} ${earlyMark.padStart(13)} ${ageMark.padStart(9)}  ${notes.join(', ')}`);
  }
}

checkTokens().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
