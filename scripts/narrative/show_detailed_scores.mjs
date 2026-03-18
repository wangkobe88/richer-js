import fs from 'fs';

/**
 * 展示所有代币的详细叙事评分
 */
function showAllScores() {
  const data = JSON.parse(fs.readFileSync('../../narrative_analysis/combined_narrative_scores.json', 'utf-8'));

  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    代币叙事详细评分 (89个代币)                              ║');
  console.log('║                评分维度: 内容(35) + 可信度(30) + 传播力(20) + 完整性(15)             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  for (const [expId, expData] of Object.entries(data)) {
    console.log(`\n═══ 实验 ${expId} ═══`);
    console.log(`代币数: ${expData.tokens.length}\n`);

    console.log('┌──────┬─────────────┬────────────────────────────┬────┬────┬────┬────┬────┬─────┐');
    console.log('│ 等级 │ 代币        │ 叙事内容摘要               │内  │可  │传  │完  │总分│位数 │');
    console.log('│      │             │                            │容  │信  │播  │整  │    │     │');
    console.log('├──────┼─────────────┼────────────────────────────┼────┼────┼────┼────┼────┼─────┤');

    expData.tokens.forEach(t => {
      const level = t.narrative_category === 'high' ? '🟢高' : t.narrative_category === 'mid' ? '🟡中' : '🔴低';
      const summary = ((t.twitterText || t.introEn || t.introCn || '')).substring(0, 28).replace(/\n/g, ' ');

      console.log(`│ ${level} │ ${t.symbol.padEnd(11)} │ ${summary.padEnd(26)} │ ` +
                    `${String(t.scores.content).padStart(2)} │ ` +
                    `${String(t.scores.credibility).padStart(2)} │ ` +
                    `${String(t.scores.virality).padStart(2)} │ ` +
                    `${String(t.scores.completeness).padStart(2)} │ ` +
                    `${String(t.narrative_score).padStart(3)} │ ` +
                    `${String(t.narrative_score).padStart(3)} │`);
    });

    console.log('└──────┴─────────────┴────────────────────────────┴────┴────┴────┴────┴────┴─────┘');
  }

  // 按等级统计
  console.log('\n\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                            等级分布统计                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const stats = { high: [], mid: [], low: [] };
  for (const [expId, expData] of Object.entries(data)) {
    expData.tokens.forEach(t => {
      stats[t.narrative_category].push({
        exp: expId,
        symbol: t.symbol,
        score: t.narrative_score,
        content: t.scores.content,
        credibility: t.scores.credibility,
        virality: t.scores.virality,
        completeness: t.scores.completeness
      });
    });
  }

  ['high', 'mid', 'low'].forEach(level => {
    const label = level === 'high' ? '🟢 高质量 (≥60分)' : level === 'mid' ? '🟡 中质量 (40-59分)' : '🔴 低质量 (<40分)';
    console.log(`\n${label} - ${stats[level].length}个:`);

    stats[level].sort((a, b) => b.score - a.score).slice(0, 10).forEach((t, i) => {
      console.log(`  ${i + 1}. [${t.exp}] ${t.symbol} (${t.score}分)`);
      console.log(`     内容:${t.content} 可信:${t.credibility} 传播:${t.virality} 完整:${t.completeness}`);
    });

    if (stats[level].length > 10) {
      console.log(`  ... 还有 ${stats[level].length - 10} 个`);
    }
  });

  console.log('\n═══ 评分标准说明 ═══');
  console.log('  内容质量(35): 是否有明确主题、具体信息、足够文本长度');
  console.log('  可信度(30):   是否来自官方账号(Binance/CZ等)、有外部链接');
  console.log('  传播力(20):   Twitter互动数据、是否提到热点平台');
  console.log('  完整性(15):   是否有Twitter内容、Intro字段、外部链接');
}

showAllScores();
