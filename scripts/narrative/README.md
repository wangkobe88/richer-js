# 代币叙事分析系统

## 📁 目录结构

```
scripts/narrative/
├── README.md                          # 本文件
├── fetch_all_tweets.mjs               # 获取推文内容
├── analyze_narratives_v3.mjs          # 叙事质量分析脚本（最终版）
├── final_comparison.mjs               # 与人工标注对比分析
└── narrative_analysis_report.md       # 综合分析报告

narrative_analysis/
├── human_judged_tokens.json           # 143个已标注代币
├── tweets_from_appendix.json          # 789条推文ID
├── tweets_with_content.json           # 317条推文内容
├── narrative_scores_v3.json           # 评分结果
└── final_comparison.json              # 对比结果
```

## 🎯 快速开始

### 运行叙事分析
```bash
node scripts/narrative/analyze_narratives_v3.mjs
```

### 查看对比分析
```bash
node scripts/narrative/final_comparison.mjs
```

## 📊 评分标准 (V3最终版)

### 总分100分，四个维度：

| 维度 | 权重 | 评分要点 |
|------|------|----------|
| **内容质量** | 35分 | 主题明确(15)、信息量(10)、简洁/完整(10) |
| **可信度** | 30分 | 官方账号(20)、知名媒体(15)、引用来源(10)、外部链接(10) |
| **传播力** | 20分 | 互动数据(15)、高影响力作者(5)、时效性(5) |
| **完整性** | 15分 | 有链接(8)、有媒体(7) |

### 分类标准：
- **高质量**: ≥60分
- **中质量**: 40-59分
- **低质量**: <40分

### 高影响力账号（时效性放宽）：
- cz_binance, elonmusk, vitalikbuterin, balajis等

## 📈 验证结果

### 与人工标注对比：
- **方向一致率**: 80%
- **零误判**: 无人工高质量→机器低质量
- **完全识别**: 所有人工高质量代币都被机器识别

### 评分分布：
- 高质量: 73 (23%)
- 中质量: 194 (61%)
- 低质量: 50 (16%)

## 📝 详细报告

查看完整分析报告：[narrative_analysis_report.md](narrative_analysis_report.md)
