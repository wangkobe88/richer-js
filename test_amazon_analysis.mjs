import { NarrativeAnalyzer } from './src/narrative/analyzer/NarrativeAnalyzer.mjs';

const address = '0x45f1c3c8264c6c32d5defa4df1027febb3044444';

async function test() {
  console.log('开始分析代币:', address);
  const result = await NarrativeAnalyzer.analyze(address);
  console.log('分析结果:');
  console.log('  Category:', result.category);
  console.log('  Total Score:', result.total_score);
  
  const fr = result.fetchResults || {};
  console.log('  Fetch Results:');
  console.log('    Twitter Info:', !!fr.twitterInfo);
  console.log('    Amazon Info:', !!fr.amazonInfo);
  
  if (fr.amazonInfo) {
    console.log('    Amazon Title:', fr.amazonInfo.title?.substring(0, 50));
  }
}

test().catch(console.error);
