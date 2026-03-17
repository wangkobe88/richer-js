import fs from 'fs';

/**
 * 展示所有已对比的代币详情
 */
class ShowAllCompared {
  constructor() {
    this.humanData = JSON.parse(fs.readFileSync('narrative_analysis/human_judged_tokens.json', 'utf-8'));
    this.machineScores = JSON.parse(fs.readFileSync('narrative_analysis/narrative_scores_v3.json', 'utf-8'));
    this.machineMap = new Map(this.machineScores.map(s => [s.token, s]));
  }

  showAll() {
    console.log('=== 所有已对比代币详情 ===\n');

    const compared = [];

    this.humanData.forEach(token => {
      const machineScore = this.machineMap.get(token.token_symbol);
      if (!machineScore) {
        compared.push({
          token: token.token_symbol,
          human: token.human_judges?.category || '未标注',
          machine: '无推文数据',
          status: 'no_tweet'
        });
        return;
      }

      const humanCat = token.human_judges?.category;
      if (!humanCat) return;

      const agree = humanCat.split('_')[0] === machineScore.category;

      compared.push({
        token: token.token_symbol,
        human: humanCat,
        machine: machineScore.category,
        machineScore: machineScore.total_score,
        agree: agree,
        author: machineScore.user || 'N/A',
        text: machineScore.text?.substring(0, 60) + (machineScore.text?.length > 60 ? '...' : ''),
        scores: machineScore.scores
      });
    });

    // 按一致性分组
    const agreed = compared.filter(c => c.agree && c.machine !== '无推文数据');
    const disagreed = compared.filter(c => !c.agree && c.machine !== '无推文数据');
    const noTweet = compared.filter(c => c.machine === '无推文数据');

    console.log(`=== 统计汇总 ===`);
    console.log(`总代币数: ${this.humanData.length}`);
    console.log(`有推文数据: ${compared.length - noTweet.length}`);
    console.log(`无推文数据: ${noTweet.length}`);
    console.log(`一致: ${agreed.length}`);
    console.log(`不一致: ${disagreed.length}\n`);

    console.log('=== ✅ 一致案例 ===');
    agreed.forEach(item => {
      console.log(`\n【${item.human}】${item.token} → 机器${item.machine} (${item.machineScore}分)`);
      console.log(`  作者: ${item.author}`);
      console.log(`  内容: ${item.text}`);
    });

    console.log('\n\n=== ❌ 不一致案例 ===');
    disagreed.forEach(item => {
      console.log(`\n【${item.human}】${item.token} → 机器${item.machine} (${item.machineScore}分)`);
      console.log(`  作者: ${item.author}`);
      console.log(`  内容: ${item.text}`);
      console.log(`  评分: 内容${item.scores?.content}/35, 可信${item.scores?.credibility}/30, 传播${item.scores?.virality}/20, 完整${item.scores?.completeness}/15`);
    });

    console.log('\n\n=== ⚪ 无推文数据 ===');
    noTweet.slice(0, 20).forEach(item => {
      console.log(`【${item.human}】${item.token}`);
    });
    if (noTweet.length > 20) {
      console.log(`... 还有 ${noTweet.length - 20} 个`);
    }

    // 保存完整列表
    fs.writeFileSync(
      'narrative_analysis/all_compared_tokens.json',
      JSON.stringify(compared, null, 2)
    );

    console.log('\n\n完整数据已保存到 narrative_analysis/all_compared_tokens.json');
  }
}

// 执行
new ShowAllCompared().showAll();
