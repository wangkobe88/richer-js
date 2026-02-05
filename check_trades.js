const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || 'https://yrnvcnzfufczhivqvnjl.supabase.co';
const key = process.env.SUPABASE_ANON_KEY;

if (!key) {
  console.error('SUPABASE_ANON_KEY not found in environment');
  process.exit(1);
}

const supabase = createClient(url, key);

async function query() {
  console.log('Querying trades for experiment: 73aca84a-683c-4f6a-b66c-06378dbc48be');

  const { data, error } = await supabase
    .from('trades')
    .select('id, token_address, token_symbol')
    .eq('experiment_id', '73aca84a-683c-4f6a-b66c-06378dbc48be');

  if (error) {
    console.error('Error:', error);
    return;
  }

  const totalCount = data.length;
  const uniqueTokens = new Set(data.map(t => t.token_address));

  console.log('\n=================================');
  console.log('Total trades:', totalCount);
  console.log('Unique tokens:', uniqueTokens.size);
  console.log('=================================\n');
  console.log('All tokens:');

  const tokenCounts = {};
  data.forEach(t => {
    if (!tokenCounts[t.token_address]) {
      tokenCounts[t.token_address] = {
        symbol: t.token_symbol || 'Unknown',
        count: 0,
        address: t.token_address
      };
    }
    tokenCounts[t.token_address].count++;
  });

  Object.values(tokenCounts)
    .sort((a, b) => b.count - a.count)
    .forEach(t => {
      console.log('  -', t.symbol, '(' + t.count + ' trades)', t.address.substring(0, 10) + '...');
    });
}

query().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
