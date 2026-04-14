const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 蹭热度代币列表
const copycatTokens = [
  { symbol: 'HappyHorse', address: '0x5a4568d757ea0f05e8f943058c881f2449f34444' },
  { symbol: '自己', address: '0x57b723905e96ec41f4dcd4e32a05a4bc79f7777' },
  { symbol: 'FREEOIL', address: '0x7fe0cf6b4d35346b6f9b3d4be94e39d488b7777' },
  { symbol: '币圈MBTI', address: '0xb80f82b9a9750c05a2df7e61e11e1b94f74ff44' },
  { symbol: '英雄主义', address: '0xcf08d3aa6a86de6dbfd7ba05f1cb4d9c47934444' },
  { symbol: 'YFI', address: '0x5ac27519e35f5e80b7f4425a8f6695303e44ffff' },
  { symbol: '爱', address: '0x88234fa4904dde1576c1423df7338f532fff4444' },
  { symbol: 'Rootless', address: '0x760607bc56c10d7eb3a5df40b0e08bc21b7777' },
  { symbol: '韧性基因', address: '0x996fa091fd7520ceff5c2579e92a7d99f7f7777' },
  { symbol: 'Prediction time', address: '0x49bd02487ee3754900d59b6f9ea0f4b1777777' },
  { symbol: 'predict', address: '0x7ae4d22c9bfa028e18bb9899547e1f4246004444' },
  { symbol: '大女主', address: '0x0a01145e07f8b7b168cba9f7e74b9eb38e3e7777' },
  { symbol: '精神灯塔', address: '0x7c19d25e6520e0030f93de7c2dbcb7a8027777' },
  { symbol: '预测章鱼', address: '0x859506605e4fca168c00b4e5d6729873697777' },
  { symbol: 'PREDICT THE WORLD', address: '0x6a375886d3caa4fac3072b0472c0b0e00e7777' },
  { symbol: '钻石手', address: '0x6985a3351a7cfd7fdc6c4debfb371163d0a8ffff' },
  { symbol: '共富', address: '0x1638d0ac3a5398c32520e9e6b938df7356dcffff' },
  { symbol: '10000x', address: '0x32855ac465c550bfc60aff57e421a04772b14444' },
  { symbol: '10亿', address: '0x30806e62bf4882b72789b0745798741a777777' },
  { symbol: 'RektRealty', address: '0x14a66dbca7138d4ea4a7dcd0e85ad4f8777777' },
  { symbol: '信念', address: '0xc8f807b9244c3e4525b62c18c2ce4c15e177777' },
  { symbol: 'BUIDL', address: '0x5d43c3b89a92565db7abf755277e637e29904444' },
  { symbol: '信任', address: '0x256ba1e8509eafe04c91b9a254293362c7777' }
];

async function triggerNarrativeAnalysis() {
  let successCount = 0;
  let errorCount = 0;

  for (const token of copycatTokens) {
    try {
      console.log(`[${copycatTokens.indexOf(token) + 1}/${copycatTokens.length}] 触发叙事分析: ${token.symbol} (${token.address})`);

      const response = await fetch('http://localhost:3010/api/narrative/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: token.address,
          ignoreExpired: false,
          ignoreCache: true
        })
      });

      const result = await response.json();

      if (result.success) {
        const rating = result.data?.rating || result.data?.llmAnalysis?.summary?.rating || 'unknown';
        const reason = result.data?.reason || result.data?.llmAnalysis?.summary?.reason || 'N/A';

        console.log(`  ✓ 成功 - Rating: ${rating}, Reason: ${reason.substring(0, 50)}...`);
        successCount++;
      } else {
        console.log(`  ✗ 失败 - ${result.error}`);
        errorCount++;
      }
    } catch (error) {
      console.log(`  ✗ 异常 - ${error.message}`);
      errorCount++;
    }

    // 避免API限流，延迟一下
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('========================================');
  console.log(`完成! 成功: ${successCount}, 失败: ${errorCount}`);
  console.log('========================================');
}

triggerNarrativeAnalysis();
