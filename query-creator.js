const { dbManager } = require('./src/services/dbManager');

async function searchByCreatorAddress() {
  const client = dbManager.getClient();

  // List all experiments
  const { data: experiments, error: expError } = await client
    .from('experiments')
    .select('id, name')
    .limit(20);

  if (expError) {
    console.error('Query error:', expError);
  } else {
    console.log('=== 所有实验 ===');
    experiments.forEach(exp => {
      console.log(`ID: ${exp.id}, Name: ${exp.name}`);
    });
    console.log('');
  }

  // Search for tokens with 0x0ce26b48... pattern
  const { data, error } = await client
    .from('experiment_tokens')
    .select('*')
    .like('token_address', '0x0ce26b48%')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Query error:', error);
    process.exit(1);
  }

  console.log(`Searching for tokens with address pattern: 0x0ce26b48...`);
  console.log(`Found ${data.length} tokens:\n`);

  if (data.length > 0) {
    data.forEach(t => {
      console.log('--------------------------------');
      console.log('Experiment:', t.experiment_id);
      console.log('Token:', t.token_symbol);
      console.log('Token Address:', t.token_address);
      console.log('Creator:', t.creator_address);
      console.log('Status:', t.status);
    });
  } else {
    console.log('No tokens found with this address pattern');
  }

  process.exit(0);
}

searchByCreatorAddress();
