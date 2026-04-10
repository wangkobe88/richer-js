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
   * 清理JSON字符串中的潜在问题
   */
  const cleanJSONString = (str) => {
    let cleaned = str;

    // 移除BOM标记
    cleaned = cleaned.replace(/^\uFEFF/, '');

    // 移除控制字符（除了换行、制表符等常用字符）
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return cleaned;
  };

  /**
   * 修复JSON字符串中的常见问题
   */
  const fixCommonJSONIssues = (str) => {
    let fixed = str;
    const stringValueRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    fixed = fixed.replace(stringValueRegex, (match, content) => {
      if (content.includes('\n') || content.includes('\r')) {
        const escaped = content
          .replace(/\\/g, '\\\\')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        return '"' + escaped + '"';
      }
      return match;
    });
    return fixed;
  };

  // 先清理JSON字符串
  jsonStr = cleanJSONString(jsonStr);

  /**
   * 尝试解析JSON，处理各种格式问题
   */
  const tryParseJSON = (str) => {
    try {
      return { success: true, data: JSON.parse(str) };
    } catch (e) {
      return { success: false, error: e.message, errorObj: e };
    }
  };

  // 首先尝试直接解析
  let parseResult = tryParseJSON(jsonStr);
  let result = parseResult.success ? parseResult.data : null;
  let parseError = parseResult.success ? null : parseResult.error;

  // 如果失败，尝试修复常见的JSON问题
  if (!result) {
    console.log('[NarrativeAnalyzer] Stage 1: 直接解析失败，尝试修复常见问题');
    const fixedJsonStr = fixCommonJSONIssues(jsonStr);
    parseResult = tryParseJSON(fixedJsonStr);
    result = parseResult.success ? parseResult.data : null;
    if (result) {
      console.log('[NarrativeAnalyzer] Stage 1: 修复常见问题后成功');
    } else {
      parseError = parseResult.error;
    }
  }

  // 如果仍然失败，尝试修复中文引号问题
  if (!result) {
    console.log('[NarrativeAnalyzer] Stage 1: 仍然失败，尝试修复中文引号');
    const fixedJsonStr = jsonStr.replace(/"/g, "'").replace(/"/g, "'");
    parseResult = tryParseJSON(fixedJsonStr);
    result = parseResult.success ? parseResult.data : null;
    if (!result) parseError = parseResult.error;
  }

  // 如果仍然失败，尝试使用Function构造器
  if (!result) {
    console.log('[NarrativeAnalyzer] Stage 1: 仍然失败，尝试Function构造器');
    try {
      const jsonFunc = new Function('return ' + jsonStr);
      result = jsonFunc();
      console.log('[NarrativeAnalyzer] Stage 1: Function构造器方式成功');
    } catch (e) {
      console.log('[NarrativeAnalyzer] Stage 1: Function构造器方式也失败:', e.message);
      if (!parseError) parseError = e.message;
    }
  }

  if (!result) {
    console.error('[NarrativeAnalyzer] Stage 1: JSON解析失败');
    console.error('[NarrativeAnalyzer] 解析错误:', parseError);
    console.error('[NarrativeAnalyzer] 提取的JSON字符串前500字符:', jsonStr.substring(0, 500));
    throw new Error(`Stage 1: JSON解析失败 - ${parseError || '未知错误'}`);
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
   * 清理JSON字符串中的潜在问题
   */
  const cleanJSONString = (str) => {
    let cleaned = str;

    // 移除BOM标记
    cleaned = cleaned.replace(/^\uFEFF/, '');

    // 移除控制字符（除了换行、制表符等常用字符）
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return cleaned;
  };

  /**
   * 修复JSON字符串中的常见问题
   */
  const fixCommonJSONIssues = (str) => {
    let fixed = str;
    const stringValueRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    fixed = fixed.replace(stringValueRegex, (match, content) => {
      if (content.includes('\n') || content.includes('\r')) {
        const escaped = content
          .replace(/\\/g, '\\\\')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        return '"' + escaped + '"';
      }
      return match;
    });
    return fixed;
  };

  // 先清理JSON字符串
  jsonStr = cleanJSONString(jsonStr);

  /**
   * 尝试解析JSON，处理各种格式问题
   */
  const tryParseJSON = (str) => {
    try {
      return { success: true, data: JSON.parse(str) };
    } catch (e) {
      return { success: false, error: e.message, errorObj: e };
    }
  };

  // 首先尝试直接解析
  let parseResult = tryParseJSON(jsonStr);
  let result = parseResult.success ? parseResult.data : null;
  let parseError = parseResult.success ? null : parseResult.error;

  // 如果失败，尝试修复常见的JSON问题
  if (!result) {
    console.log('[NarrativeAnalyzer] EventAnalysis: 直接解析失败，尝试修复常见问题');
    const fixedJsonStr = fixCommonJSONIssues(jsonStr);
    parseResult = tryParseJSON(fixedJsonStr);
    result = parseResult.success ? parseResult.data : null;
    if (result) {
      console.log('[NarrativeAnalyzer] EventAnalysis: 修复常见问题后成功');
    } else {
      parseError = parseResult.error;
    }
  }

  // 如果仍然失败，尝试修复中文引号问题
  if (!result) {
    console.log('[NarrativeAnalyzer] EventAnalysis: 仍然失败，尝试修复中文引号');
    const fixedJsonStr = jsonStr.replace(/"/g, "'").replace(/"/g, "'");
    parseResult = tryParseJSON(fixedJsonStr);
    result = parseResult.success ? parseResult.data : null;
    if (!result) parseError = parseResult.error;
  }

  // 如果仍然失败，尝试使用Function构造器
  if (!result) {
    console.log('[NarrativeAnalyzer] EventAnalysis: 仍然失败，尝试Function构造器');
    try {
      const jsonFunc = new Function('return ' + jsonStr);
      result = jsonFunc();
      console.log('[NarrativeAnalyzer] EventAnalysis: Function构造器方式成功');
    } catch (e) {
      console.log('[NarrativeAnalyzer] EventAnalysis: Function构造器方式也失败:', e.message);
      if (!parseError) parseError = e.message;
    }
  }

  if (!result) {
    console.error('[NarrativeAnalyzer] EventAnalysis: JSON解析失败');
    console.error('[NarrativeAnalyzer] 解析错误:', parseError);
    console.error('[NarrativeAnalyzer] 提取的JSON字符串前500字符:', jsonStr.substring(0, 500));
    throw new Error(`EventAnalysis: JSON解析失败 - ${parseError || '未知错误'}`);
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
   * 清理JSON字符串中的潜在问题
   */
  const cleanJSONString = (str) => {
    let cleaned = str;

    // 移除BOM标记
    cleaned = cleaned.replace(/^\uFEFF/, '');

    // 移除控制字符（除了换行、制表符等常用字符）
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return cleaned;
  };

  /**
   * 修复JSON字符串中的常见问题
   * 主要是处理LLM可能返回的未正确转义的换行符
   */
  const fixCommonJSONIssues = (str) => {
    let fixed = str;

    // 尝试修复JSON字符串值中的未转义换行符
    // 这个正则匹配JSON字符串值内部的多行内容
    // 策略：找到所有字符串值，检查其中是否有未转义的换行符
    const stringValueRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;

    fixed = fixed.replace(stringValueRegex, (match, content) => {
      // 检查内容中是否有未转义的换行符（\n不是实际换行，\\n才是转义的）
      // 实际换行符是\n（一个字符），转义的是\\n（两个字符）
      if (content.includes('\n') || content.includes('\r')) {
        // 将实际的换行符替换为\\n
        const escaped = content
          .replace(/\\/g, '\\\\')  // 先转义已有的反斜杠
          .replace(/\n/g, '\\n')    // 转义换行符
          .replace(/\r/g, '\\r')    // 转义回车符
          .replace(/\t/g, '\\t');   // 转义制表符
        return '"' + escaped + '"';
      }
      return match;
    });

    return fixed;
  };

  // 先清理JSON字符串
  jsonStr = cleanJSONString(jsonStr);

  /**
   * 尝试解析JSON，处理各种格式问题
   */
  const tryParseJSON = (str) => {
    try {
      return { success: true, data: JSON.parse(str) };
    } catch (e) {
      return { success: false, error: e.message, errorObj: e };
    }
  };

  // 首先尝试直接解析
  let parseResult = tryParseJSON(jsonStr);
  let result = parseResult.success ? parseResult.data : null;
  let parseError = parseResult.success ? null : parseResult.error;
  let errorObj = parseResult.errorObj || null;

  // 如果失败，尝试修复常见的JSON问题（未转义的换行符等）
  if (!result) {
    console.log('[NarrativeAnalyzer] JSON解析: 直接解析失败，尝试修复常见问题');
    const fixedJsonStr = fixCommonJSONIssues(jsonStr);
    parseResult = tryParseJSON(fixedJsonStr);
    result = parseResult.success ? parseResult.data : null;
    if (result) {
      console.log('[NarrativeAnalyzer] JSON解析: 修复常见问题后成功');
    } else {
      parseError = parseResult.error;
      errorObj = parseResult.errorObj;
    }
  }

  // 如果仍然失败，尝试修复中文引号问题
  if (!result) {
    console.log('[NarrativeAnalyzer] JSON解析: 直接解析失败，尝试修复中文引号');
    const fixedJsonStr = jsonStr.replace(/"/g, "'").replace(/"/g, "'");
    parseResult = tryParseJSON(fixedJsonStr);
    result = parseResult.success ? parseResult.data : null;
    if (!result && !parseError) parseError = parseResult.error;
  }

  // 如果仍然失败，尝试使用eval方式（作为最后手段）
  if (!result) {
    console.log('[NarrativeAnalyzer] JSON解析: 仍然失败，尝试使用Function构造器方式');
    try {
      // 使用Function构造器作为eval的替代方案
      // 这比eval稍微安全一些，但仍然需要注意安全问题
      // 由于LLM返回的内容是受控的，这里使用是相对安全的
      const jsonFunc = new Function('return ' + jsonStr);
      result = jsonFunc();
      console.log('[NarrativeAnalyzer] JSON解析: Function构造器方式成功');
    } catch (e) {
      console.log('[NarrativeAnalyzer] JSON解析: Function构造器方式也失败:', e.message);
      if (!parseError) parseError = e.message;
    }
  }

  if (!result) {
    console.error('[NarrativeAnalyzer] JSON解析: 解析失败');
    console.error('[NarrativeAnalyzer] 解析错误:', parseError);
    if (errorObj) {
      console.error('[NarrativeAnalyzer] 错误堆栈:', errorObj.stack);
    }
    console.error('[NarrativeAnalyzer] 提取的JSON字符串长度:', jsonStr.length);
    console.error('[NarrativeAnalyzer] JSON字符串前500字符:', jsonStr.substring(0, 500));
    console.error('[NarrativeAnalyzer] JSON字符串后500字符:', jsonStr.substring(Math.max(0, jsonStr.length - 500)));
    throw new Error(`JSON解析: 解析失败 - ${parseError || '未知错误'}`);
  }

  return result;
}

/**
 * 从数据库记录构造 llmAnalysis 对象
 * @param {Object} record - 数据库记录
 * @returns {Object} llmAnalysis 对象
 */
export function buildLLMAnalysis(record) {
  if (!record) return null;

  // 预检查数据
  const preCheck = record.pre_check_category ? {
    category: record.pre_check_category,
    reason: record.pre_check_reason,
    result: record.pre_check_result
  } : null;

  // PreStage 数据
  const prestage = record.llm_prestage_category ? {
    category: record.llm_prestage_category,
    parsedOutput: record.llm_prestage_parsed_output,
    model: record.llm_prestage_model,
    prompt: record.llm_prestage_prompt,
    rawOutput: record.llm_prestage_raw_output,
    startedAt: record.llm_prestage_started_at,
    finishedAt: record.llm_prestage_finished_at,
    success: record.llm_prestage_success,
    error: record.llm_prestage_error
  } : null;

  // Stage 1 数据
  const stage1 = (record.llm_stage1_parsed_output || record.llm_stage1_category) ? {
    category: record.llm_stage1_category || record.llm_stage1_parsed_output?.eventClassification?.primaryCategory || record.llm_stage1_parsed_output?.category,
    parsedOutput: record.llm_stage1_parsed_output,
    model: record.llm_stage1_model,
    prompt: record.llm_stage1_prompt,
    rawOutput: record.llm_stage1_raw_output,
    startedAt: record.llm_stage1_started_at,
    finishedAt: record.llm_stage1_finished_at,
    success: record.llm_stage1_success,
    error: record.llm_stage1_error
  } : null;

  // Stage 2 数据
  const stage2 = (record.llm_stage2_parsed_output || record.llm_stage2_category) ? {
    category: record.llm_stage2_category || record.llm_stage2_parsed_output?.raw?.categoryAnalysis?.category || record.llm_stage2_parsed_output?.category,
    parsedOutput: record.llm_stage2_parsed_output,
    model: record.llm_stage2_model,
    prompt: record.llm_stage2_prompt,
    rawOutput: record.llm_stage2_raw_output,
    startedAt: record.llm_stage2_started_at,
    finishedAt: record.llm_stage2_finished_at,
    success: record.llm_stage2_success,
    error: record.llm_stage2_error
  } : null;

  // Stage 3 数据 - 只要有 parsed_output 就认为 stage3 存在
  const stage3 = (record.llm_stage3_parsed_output || record.llm_stage3_category) ? {
    category: record.llm_stage3_category || record.llm_stage3_parsed_output?.raw?.category || record.llm_stage3_parsed_output?.category,
    parsedOutput: record.llm_stage3_parsed_output,
    model: record.llm_stage3_model,
    prompt: record.llm_stage3_prompt,
    rawOutput: record.llm_stage3_raw_output,
    startedAt: record.llm_stage3_started_at,
    finishedAt: record.llm_stage3_finished_at,
    success: record.llm_stage3_success,
    error: record.llm_stage3_error
  } : null;

  // 获取最终评级和评分 - 优先使用最后执行的阶段
  // 三阶段架构：优先级应该是 stage3 > stage2 > stage1 > prestage
  // 注意：需要从 parsed_output.raw 中获取正确的 category
  const stage3Category = record.llm_stage3_parsed_output?.raw?.category || record.llm_stage3_category;
  const stage2Category = record.llm_stage2_parsed_output?.raw?.categoryAnalysis?.category || record.llm_stage2_category;
  const stage1Category = record.llm_stage1_parsed_output?.eventClassification?.primaryCategory || record.llm_stage1_category;
  const prestageCategory = record.llm_prestage_parsed_output?.tokenType || record.llm_prestage_category;

  // 如果预检查触发且有明确分类（low/high），直接使用预检查分类
  const preCheckCategory = record.pre_check_category;
  // 如果Stage 2存在但未通过（pass=false），则评级为low
  const stage2Pass = record.llm_stage2_parsed_output?.raw?.pass;
  let category;
  if (preCheckCategory && preCheckCategory !== 'unrated') {
    category = preCheckCategory;
  } else if (stage2 !== null && stage2Pass === false) {
    category = 'low';
  } else {
    category = stage3Category || stage2Category || stage1Category || prestageCategory || 'unrated';
  }
  const parsedOutput = record.llm_stage3_parsed_output || record.llm_stage2_parsed_output || record.llm_stage1_parsed_output || record.llm_prestage_parsed_output;

  let reasoning = '';
  if (parsedOutput) {
    if (parsedOutput.reasoning) {
      reasoning = parsedOutput.reasoning;
    } else if (parsedOutput.reason) {
      reasoning = parsedOutput.reason;
    }
  }
  // 预检查触发时，从预检查结果中获取reasoning
  if (!reasoning && record.pre_check_result) {
    reasoning = record.pre_check_result.reasoning || record.pre_check_reason || '';
  }

  const summary = {
    category: category,
    reasoning: reasoning,
    total_score: parsedOutput?.total_score ?? record.pre_check_result?.total_score,
    scores: parsedOutput?.scores ?? record.pre_check_result?.scores
  };

  return {
    preCheck,
    prestage,
    stage1,
    stage2,
    stage3,
    summary
  };
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
      icon: (record.raw_api_data?.name || record.token_symbol || '?')[0]?.toUpperCase(),
      raw_api_data: record.raw_api_data || null,  // 添加原始代币数据
      chain: record.raw_api_data?.chain || null  // 添加链信息
    },
    category: (record.pre_check_category && record.pre_check_category !== 'unrated')
      ? record.pre_check_category
      : (record.llm_stage3_category || record.llm_stage2_category || record.llm_stage1_category || record.llm_prestage_category || 'unrated'),
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
  // 预检查触发时，从预检查结果中获取reasoning
  if (!result.reasoning && record.pre_check_result) {
    result.reasoning = record.pre_check_result.reasoning || record.pre_check_reason || '';
  }

  // 解析 scores
  if (parsedOutput && parsedOutput.scores) {
    result.scores = parsedOutput.scores;
  }
  // 预检查的scores
  if (!result.scores && record.pre_check_result?.scores) {
    result.scores = record.pre_check_result.scores;
  }

  // 解析 total_score
  if (parsedOutput && parsedOutput.total_score !== undefined) {
    result.total_score = parsedOutput.total_score;
  }
  // 预检查的total_score
  if (result.total_score === null && record.pre_check_result?.total_score !== undefined) {
    result.total_score = record.pre_check_result.total_score;
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
