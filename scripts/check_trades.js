require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function checkTradingData() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  // 检查交易数据
  const { data: trades, error } = await supabase
    .from('experiment_trades')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (error) {
    console.log('查询错误:', error.message);
    return;
  }

  console.log('交易数据总数: ' + (trades?.length || 0));

  if (trades && trades.length > 0) {
    // 按代币分组
    const byToken = new Map();
    trades.forEach(t => {
      const addr = t.token_address;
      if (!byToken.has(addr)) {
        byToken.set(addr, []);
      }
      byToken.get(addr).push(t);
    });

    console.log('\n有交易的代币数量: ' + byToken.size);
    console.log('\n代币交易详情:');

    let count = 0;
    for (const [addr, tokenTrades] of byToken) {
      const buys = tokenTrades.filter(t => (t.action === 'BUY' || t.trade_type === 'buy'));
      const sells = tokenTrades.filter(t => (t.action === 'SELL' || t.trade_type === 'sell'));

      console.log((count + 1) + '. ' + (tokenTrades[0].token_symbol || '(null)') + ' (' + addr.slice(0, 10) + '...)');
      console.log('   买入: ' + buys.length + ' 笔, 卖出: ' + sells.length + ' 笔');

      if (buys.length > 0) {
        console.log('   首次买入时间: ' + (new Date(buys[0].created_at || buys[0].executed_at).toISOString()));
        console.log('   买入原因: ' + (buys[0].reason || '(null)'));

        if (buys[0].metadata) {
          console.log('   买入 metadata:');
          const meta = buys[0].metadata;
          Object.keys(meta).forEach(k => {
            console.log('     ' + k + ': ' + JSON.stringify(meta[k]));
          });
        }
      }

      count++;
      if (count >= 15) {
        console.log('... (还有 ' + (byToken.size - 15) + ' 个代币)');
        break;
      }
    }
  } else {
    console.log('没有交易数据');
  }
}

checkTradingData().catch(console.error);
