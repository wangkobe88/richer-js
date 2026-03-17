/**
 * 重新设计：基于转折信号的"短拉快砸"检测
 */

function analyzeTurnSignal(sequences) {
  console.log('\n========================================');
  console.log('转折信号分析');
  console.log('========================================\n');

  // 分析60-90秒的转折特征
  const results = sequences.map(seq => {
    const window30s = seq.sequence.slice(0, 10);
    const window30_60 = seq.sequence.slice(10, 20);
    const window60_90 = seq.sequence.slice(20, 30);

    const net30s = window30s.reduce((sum, [, a]) => sum + a, 0);
    const net30_60 = window30_60.reduce((sum, [, a]) => sum + a, 0);
    const net60_90 = window60_90.reduce((sum, [, a]) => sum + a, 0);

    // 计算买入占比变化
    const buy30s = window30s.filter(([, a]) => a > 0).length;
    const buy30_60 = window30_60.filter(([, a]) => a > 0).length;
    const buy60_90 = window60_90.filter(([, a]) => a > 0).length;

    const ratio30s = buy30s / 10;
    const ratio30_60 = buy30_60 / 10;
    const ratio60_90 = buy60_90 / 10;

    // 转折信号：60-90秒买入占比下降超过30%
    const buyRatioDrop = ratio30s - ratio60_90;
    const netFlowDrop = Math.max(net30s, net30_60) - net60_90;

    // 净流入从正转负
    const turnedNegative = net30s > 0 && net30_60 > 0 && net60_90 < 0;
    const sharpDrop = net30s > 0 && net30_60 > 0 && net60_90 < Math.min(net30s, net30_60) * 0.5;

    return {
      symbol: seq.token_symbol,
      address: seq.token_address,
      change: seq.max_change_percent,
      net30s,
      net30_60,
      net60_90,
      buyRatioDrop,
      turnedNegative,
      sharpDrop,
      // 关键指标
      early_strength: Math.max(net30s, net30_60),
      mid_weakness: Math.abs(net60_90),
      turn_signal: turnedNegative || sharpDrop
    };
  });

  // 按是否出现转折信号分组
  const withTurn = results.filter(r => r.turn_signal);
  const withoutTurn = results.filter(r => !r.turn_signal);

  console.log(`【出现转折信号: ${withTurn.length}个】`);
  if (withTurn.length > 0) {
    const avgChange = withTurn.reduce((sum, r) => sum + r.change, 0) / withTurn.length;
    const highReturn = withTurn.filter(r => r.change >= 100).length / withTurn.length;
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturn * 100).toFixed(1)}%`);
  }

  console.log(`\n【无转折信号: ${withoutTurn.length}个】`);
  if (withoutTurn.length > 0) {
    const avgChange = withoutTurn.reduce((sum, r) => sum + r.change, 0) / withoutTurn.length;
    const highReturn = withoutTurn.filter(r => r.change >= 100).length / withoutTurn.length;
    console.log(`  平均涨幅: ${avgChange.toFixed(1)}%`);
    console.log(`  高涨幅占比: ${(highReturn * 100).toFixed(1)}%`);
  }

  // 检查目标代币
  const targetAddresses = [
    '0x8c647898fef0ac142db4c20135abdc125de94444',
    '0x8f879a49d193fe67dc5bf2d4fe3039dd92434444',
    '0xb249a5e86d95d62cfdb2344fcebf7c99250c4444',
    '0xee162f9f8c7695940cbc62a73006aeb4b0284444'
  ];

  const targetInResults = results.filter(r => targetAddresses.includes(r.address));

  console.log('\n【目标代币的转折特征】\n');
  targetInResults.forEach(r => {
    console.log(`${r.symbol}: +${r.change.toFixed(1)}%`);
    console.log(`  0-30s净流入: $${r.net30s.toFixed(0)}`);
    console.log(`  30-60s净流入: $${r.net30_60.toFixed(0)}`);
    console.log(`  60-90s净流入: $${r.net60_90.toFixed(0)}`);
    console.log(`  早期强度: $${r.early_strength.toFixed(0)}`);
    console.log(`  中期弱势: $${r.mid_weakness.toFixed(0)}`);
    console.log(`  转折信号: ${r.turn_signal ? '⚠️ 是' : '否'}`);
    console.log('');
  });

  return results;
}

// 在main函数中调用
const turnResults = analyzeTurnSignal(seqData.sequences);
