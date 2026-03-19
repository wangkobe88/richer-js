# 叙事分析目录结构

## 目录说明

### `llm_analysis/` - LLM叙事分析模块
主要的LLM叙事分析代码和配置

#### 核心文件
- **`analyze_narratives_llm.mjs`** - LLM分析主脚本，使用V5.10 Prompt分析代币叙事质量
- **`prompt-template-v4.mjs`** - V5.10版本的Prompt模板（两维度评分：叙事背景+传播力，优化情感叙事+边界情况修复+推文时效性检测+媒体权威性检测+限定范围影响力处理+外部平台链接处理+大IP关联标准+评估步骤优化+加密相关账号识别）
- **`twitter_blacklist.mjs`** - 推特用户黑名单配置
- **`fetch_and_save_human_annotations.mjs`** - 从数据库获取人工标注数据

#### 数据文件 (`llm_analysis/data/`)
- **`llm_cache.json`** - LLM分析缓存（运行时生成）
- **`rule_cache.json`** - 规则评分缓存
- **`llm_analysis_log.json`** - 详细分析日志
- **`llm_prompt_log.json`** - Prompt和响应日志
- **`archive/`** - 归档目录

### `data/` - 原始数据和结果

#### 核心数据文件
- **`all_narratives_combined.json`** - 所有实验的代币数据（含twitterUrl、intro等）
- **`combined_narrative_scores.json`** - 规则评分结果
- **`tweets_with_content.json`** - 推文内容数据库（371条推文）
- **`human_judged_tokens_from_db.json`** - 从数据库导出的人工标注（163个代币）
- **`human_judged_by_experiment.json`** - 按实验分组的人工标注
- **`experiment_tokens_full.json`** - 完整实验代币数据

#### 输出文件
- **`llm_narrative_scores.json`** - LLM分析结果（按实验分组）

## 使用方法

### 1. 从数据库获取最新人工标注
```bash
node scripts/narrative/llm_analysis/fetch_and_save_human_annotations.mjs
```

### 2. 运行LLM叙事分析
```bash
node scripts/narrative/llm_analysis/analyze_narratives_llm.mjs
```

### 3. 清除缓存重新分析
```bash
rm -f scripts/narrative/llm_analysis/data/llm_cache.json
node scripts/narrative/llm_analysis/analyze_narratives_llm.mjs
```

## 评分标准 (V5.3)

### 维度
1. **叙事背景 (50分)** - 按影响力层级评分（情感叙事有溢价）
   - 币安/官方权威：35-50分
   - 世界级/加密重大事件：30-44分
   - 平台级影响力（加密相关）：25-34分
   - 平台级影响力（一般）：20-29分
   - **社区级情感叙事（强情感共鸣）**：20-34分
   - 社区级影响力（加密相关）：10-24分
   - 社区级影响力（一般）：5-19分
   - 情感溢价加分：叙事具备强情感共鸣时+5分

2. **传播力 (50分)** - meme潜力+社交属性+情感共鸣+FOMO+内容丰富度
   - 具备病毒传播属性+内容丰富：40-50分
   - 有较强传播性+内容较丰富：30-39分
   - 有一定传播性：15-29分
   - 传播力弱：0-14分

### 评级
- **high**: 叙事背景≥35 且 总分≥75
- **mid**: 叙事背景≥20 且 总分≥50
- **low**: 总分<50 或 触发伪叙事模式
- **unrated**: 内容无法理解或推文包含链接但无法评估

## 数据流程

```
数据库 (experiment_tokens.human_judges)
  ↓ fetch_and_save_human_annotations.mjs
human_judged_tokens_from_db.json
  ↓ analyze_narratives_llm.mjs (使用地址匹配)
  ↓
LLM分析 + 人工标注 + 规则评分
  ↓
llm_narrative_scores.json (输出结果)
```

## 关键配置

- `.env`: SUPABASE_URL, SUPABASE_ANON_KEY
- Prompt版本: V5.10
- LLM模型: deepseek-ai/DeepSeek-V3
- 超时时间: 5分钟

## 历史版本

- V1-V3: 已废弃
- V4: 删除代币实质维度，简化为两维度
- V4.5: 优化评分阈值和unrated条件
- V4.6: 增加情感叙事评分权重，社区级情感叙事可达20-34分
- V4.7: 修复边界情况：语言检查优先级最高、无价值内容检测、外部平台链接处理、口号式强关联识别
- V4.8: 增加推文时效性检测（超过2周的推文直接low）
- V4.9: 增加媒体权威性检测（区分平台官方和普通媒体，平台官方命名有权威性）
- V5.0: 增加限定范围影响力处理（商场广告等极低影响力）
- V5.1: 增加外部平台链接处理（X社区/抖音等链接给unrated）+ 将website信息传递给LLM
- V5.2: 增加大IP关联标准（世界级大IP需要强证据才能建立关联，否则视为蹭热度）
- V5.3: 优化评估步骤顺序（提前判断推文关联度，确保"有链接但无法理解"正确返回unrated）
- V5.4: 增加时间判断修复（必须明确知道推文发布时间才能判断，createdAt为空时跳过）
- V5.5: 增加纯链接推文处理（推文仅包含链接且未提及代币 → unrated）
- V5.6: 明确标注推文和介绍（【推文】vs【介绍英文】vs【介绍中文】，避免混淆）
- V5.7: 增加完全无信息处理（无推文+intro只是名字+无website → unrated）
- V5.8: 优化大IP关联标准（区分"大IP官方背书"vs"基于大IP相关事件的叙事"，后者不需要官方认可）
- V5.9: 修复泛泛情感概念蹭热点问题（区分"有价值的情感叙事"vs"泛泛的情感概念"，加强纯谐音梗和蹭热搜检测）
- V5.10: 当前版本，修复加密相关账号识别（明确@cz_binance是CZ、Trust Wallet是币安旗下，个人创业故事的核心隐喻不算伪关联）
