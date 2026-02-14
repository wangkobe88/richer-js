require('dotenv').config({ path: './config/.env' });

const { AveTokenAPI } = require('./src/core/ave-api');

async function testGetContractRisk() {
  const apiKey = process.env.AVE_API_KEY;
  const api = new AveTokenAPI(
    'https://prod.ave-api.com',
    30000,
    apiKey
  );

  // 测试代币: Valentine
  const tokenAddress = '0x0ce26b484357d20a9359a987f6e1653cb0494444';
  const chain = 'bsc';
  const tokenId = `${tokenAddress}-${chain}`;

  console.log(`Testing getContractRisk for: ${tokenId}`);
  console.log(`API Key: ${apiKey ? 'configured' : 'NOT configured'}`);

  try {
    const riskData = await api.getContractRisk(tokenId);

    console.log('\n=== Contract Risk Data ===');
    console.log('Token:', riskData.token);
    console.log('Creator Address:', riskData.creator_address || '(null/empty)');
    console.log('Creator Balance:', riskData.creator_balance);
    console.log('Owner:', riskData.owner);
    console.log('Risk Score:', riskData.risk_score);
    console.log('Is Honeypot:', riskData.is_honeypot);

    console.log('\n=== Full Response ===');
    console.log(JSON.stringify(riskData, null, 2));

  } catch (error) {
    console.error('API call failed:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
  }

  process.exit(0);
}

testGetContractRisk();
