/**
 * Response Parser - LLM响应解析器
 * 包含各种LLM响应的解析方法
 */

/**
 * 解析 Stage 1 响应
 * @param {string} content - LLM响应内容
 * @returns {Object} 解析结果
 */
export function parseStage1Response(content) {
  // 多种策略尝试提取JSON
  let jsonStr = null;

  // 策略1: 尝试提取markdown代码块中的JSON
  const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1];
    console.log('[NarrativeAnalyzer] Stage 1: 使用代码块策略提取JSON');
  }

  // 策略2: 尝试提取第一个完整的JSON对象（使用括号匹配）
  if (!jsonStr) {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (content[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          jsonStr = content.substring(start, i + 1);
          console.log('[NarrativeAnalyzer] Stage 1: 使用括号匹配策略提取JSON');
          break;
        }
      }
    }
  }

  // 策略3: 使用正则表达式匹配（兼容性后备方案）
  if (!jsonStr) {
    const regexMatch = content.match(/\{[\s\S]*\}/);
    if (regexMatch) {
      jsonStr = regexMatch[0];
      console.log('[NarrativeAnalyzer] Stage 1: 使用正则策略提取JSON');
    }
  }

  // 如果所有策略都失败，打印原始响应并抛出错误
  if (!jsonStr) {
    console.error('[NarrativeAnalyzer] Stage 1: 无法提取JSON，原始响应:', content);
    throw new Error('Stage 1: 无法提取JSON');
  }

  /**
   * 尝试解析JSON，处理中文引号问题
   */
  const tryParseJSON = (str) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  };

  // 首先尝试直接解析
  let result = tryParseJSON(jsonStr);

  // 如果失败，尝试修复中文引号问题
  if (!result) {
    console.log('[NarrativeAnalyzer] Stage 1: 直接解析失败，尝试修复中文引号');
    const fixedJsonStr = jsonStr.replace(/"/g, "'").replace(/"/g, "'");
    result = tryParseJSON(fixedJsonStr);
  }

  if (!result) {
    console.error('[NarrativeAnalyzer] Stage 1: JSON解析失败，提取的字符串:', jsonStr);
    throw new Error('Stage 1: JSON解析失败 - 无法修复格式错误');
  }

  if (typeof result.pass !== 'boolean') {
    throw new Error('Stage 1: pass字段必须是boolean');
  }

  // 必须包含stage字段：0=通过，1=第一阶段触发，2=第二阶段触发，3=第三阶段触发
  if (result.stage === undefined) {
    throw new Error('Stage 1: stage字段缺失');
  }

  return {
    pass: result.pass,
    reason: result.reason || '',
    stage: result.stage,
    scenario: result.scenario || 0,  // stage=3时对应的场景编号
    entities: result.entities || {}
  };
}

/**
 * 解析事件分析响应（新框架第一阶段）
 * @param {string} content - LLM响应内容
 * @returns {Object} 解析结果
 */
export function parseEventResponse(content) {
  // 多种策略尝试提取JSON
  let jsonStr = null;

  // 策略1: 尝试提取markdown代码块中的JSON
  const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1];
    console.log('[NarrativeAnalyzer] EventAnalysis: 使用代码块策略提取JSON');
  }

  // 策略2: 尝试提取第一个完整的JSON对象（使用括号匹配）
  if (!jsonStr) {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (content[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          jsonStr = content.substring(start, i + 1);
          console.log('[NarrativeAnalyzer] EventAnalysis: 使用括号匹配策略提取JSON');
          break;
        }
      }
    }
  }

  // 策略3: 使用正则表达式匹配（兼容性后备方案）
  if (!jsonStr) {
    const regexMatch = content.match(/\{[\s\S]*\}/);
    if (regexMatch) {
      jsonStr = regexMatch[0];
      console.log('[NarrativeAnalyzer] EventAnalysis: 使用正则策略提取JSON');
    }
  }

  // 如果所有策略都失败，打印原始响应并抛出错误
  if (!jsonStr) {
    console.error('[NarrativeAnalyzer] EventAnalysis: 无法提取JSON，原始响应:', content);
    throw new Error('EventAnalysis: 无法提取JSON');
  }

  /**
   * 尝试解析JSON，处理中文引号问题
   */
  const tryParseJSON = (str) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  };

  // 首先尝试直接解析
  let result = tryParseJSON(jsonStr);

  // 如果失败，尝试修复中文引号问题
  if (!result) {
    console.log('[NarrativeAnalyzer] EventAnalysis: 直接解析失败，尝试修复中文引号');
    // 将中文引号替换为英文单引号（在JSON字符串中是合法的）
    const fixedJsonStr = jsonStr.replace(/"/g, "'").replace(/"/g, "'");
    result = tryParseJSON(fixedJsonStr);
  }

  if (!result) {
    console.error('[NarrativeAnalyzer] EventAnalysis: JSON解析失败，提取的字符串:', jsonStr);
    throw new Error(`EventAnalysis: JSON解析失败 - 无法修复格式错误`);
  }

  if (typeof result.pass !== 'boolean') {
    throw new Error('EventAnalysis: pass字段必须是boolean');
  }

  // 必须包含stage字段：0=通过，1=事件分析触发
  if (result.stage === undefined) {
    throw new Error('EventAnalysis: stage字段缺失');
  }

  return {
    pass: result.pass,
    reason: result.reason || '',
    stage: result.stage,
    scenario: result.scenario || 0,  // 保留兼容性
    entities: result.entities || {},
    eventAnalysis: result.eventAnalysis || null  // 新字段：事件分析结果
  };
}

/**
 * 解析JSON响应（通用方法，用于Stage 2和Stage 3）
 * @param {string} content - LLM响应内容
 * @returns {Object} 解析结果
 */
export function parseJSONResponse(content) {
  // 检查 content 是否为 null 或 undefined
  if (!content || typeof content !== 'string') {
    throw new Error(`Invalid content for JSON parsing: ${typeof content}`);
  }

  // 多种策略尝试提取JSON
  let jsonStr = null;

  // 策略1: 尝试提取markdown代码块中的JSON
  const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1];
  }

  // 策略2: 尝试提取第一个完整的JSON对象（使用括号匹配）
  if (!jsonStr) {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (content[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          jsonStr = content.substring(start, i + 1);
          break;
        }
      }
    }
  }

  // 策略3: 使用正则表达式匹配（兼容性后备方案）
  if (!jsonStr) {
    const regexMatch = content.match(/\{[\s\S]*\}/);
    if (regexMatch) {
      jsonStr = regexMatch[0];
    }
  }

  // 如果所有策略都失败，抛出错误
  if (!jsonStr) {
    console.error('[NarrativeAnalyzer] JSON解析: 无法提取JSON，原始响应:', content);
    throw new Error('JSON解析: 无法提取JSON');
  }

  /**
   * 尝试解析JSON，处理中文引号问题
   */
  const tryParseJSON = (str) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  };

  // 首先尝试直接解析
  let result = tryParseJSON(jsonStr);

  // 如果失败，尝试修复中文引号问题
  if (!result) {
    const fixedJsonStr = jsonStr.replace(/"/g, "'").replace(/"/g, "'");
    result = tryParseJSON(fixedJsonStr);
  }

  if (!result) {
    console.error('[NarrativeAnalyzer] JSON解析: 解析失败，提取的字符串:', jsonStr);
    throw new Error('JSON解析: 解析失败');
  }

  return result;
}

/**
 * 格式化返回结果
 * @param {Object} record - 数据库记录
 * @returns {Object} 格式化后的结果
 */
export function formatResult(record) {
  if (!record) return null;

  // 构建基础结果
  const result = {
    token: {
      address: record.token_address,
      symbol: record.token_symbol,
      name: record.raw_api_data?.name || record.token_symbol || '',
      icon: (record.raw_api_data?.name || record.token_symbol || '?')[0]?.toUpperCase()
    },
    category: record.llm_prestage_category || record.llm_stage1_category || record.llm_stage2_category || record.llm_stage3_category || 'unrated',
    reasoning: '',
    scores: null,
    total_score: null,
    metadata: {}
  };

  // 解析 reasoning
  const parsedOutput = record.llm_stage3_parsed_output || record.llm_stage2_parsed_output || record.llm_stage1_parsed_output || record.llm_prestage_parsed_output;
  if (parsedOutput) {
    if (parsedOutput.reasoning) {
      result.reasoning = parsedOutput.reasoning;
    } else if (parsedOutput.reason) {
      result.reasoning = parsedOutput.reason;
    }
  }

  // 解析 scores
  if (parsedOutput && parsedOutput.scores) {
    result.scores = parsedOutput.scores;
  }

  // 解析 total_score
  if (parsedOutput && parsedOutput.total_score !== undefined) {
    result.total_score = parsedOutput.total_score;
  }

  // 添加元数据
  result.metadata = {
    analyzedAt: record.analyzed_at,
    experimentId: record.experiment_id,
    promptVersion: record.prompt_version,
    isValid: record.is_valid,
    preCheckTriggered: !!record.pre_check_category
  };

  return result;
}
