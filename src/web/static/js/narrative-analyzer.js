/**
 * 叙事分析页面逻辑 - 新版
 */

class NarrativeAnalyzer {
  constructor() {
    this.addressInput = document.getElementById('addressInput');
    this.analyzeBtn = document.getElementById('analyzeBtn');
    this.reanalyzeBtn = document.getElementById('reanalyzeBtn');
    this.debugToggleBtn = document.getElementById('debugToggleBtn');
    this.ignoreExpiredCheckbox = document.getElementById('ignoreExpired');
    this.errorSection = document.getElementById('errorSection');
    this.loadingSection = document.getElementById('loadingSection');
    this.resultSection = document.getElementById('resultSection');
    this.debugInfoCard = document.getElementById('debugInfoCard');
    this.currentAddress = null;

    // 绑定事件
    this.reanalyzeBtn.addEventListener('click', () => this.reanalyze());
    this.debugToggleBtn.addEventListener('click', () => this.toggleDebugInfo());

    // 卡片body元素
    this.precheckCardBody = document.getElementById('precheckCardBody');
    this.prestageCardBody = document.getElementById('prestageCardBody');
    this.stage1CardBody = document.getElementById('stage1CardBody');
    this.stage2CardBody = document.getElementById('stage2CardBody');
    this.dataSourceCardBody = document.getElementById('dataSourceCardBody');
    this.tweetCard = document.getElementById('tweetCard');
    this.tweetCardBody = document.getElementById('tweetCardBody');
    this.rawDataCard = document.getElementById('rawDataCard');
    this.rawDataCardBody = document.getElementById('rawDataCardBody');
    this.debugCardBody = document.getElementById('debugCardBody');

    this.init();
  }

  init() {
    this.analyzeBtn.addEventListener('click', () => this.analyze());
    this.addressInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.analyze();
      }
    });

    // 从URL获取地址参数
    const urlParams = new URLSearchParams(window.location.search);
    const address = urlParams.get('address');
    if (address) {
      this.addressInput.value = address;
      this.analyze();
    }
  }

  async analyze() {
    const address = this.addressInput.value.trim();
    if (!address) {
      this.showError('请输入代币地址');
      return;
    }

    this.currentAddress = address;
    this.hideError();
    this.showLoading();
    this.hideResult();

    const ignoreExpired = this.ignoreExpiredCheckbox?.checked || false;

    try {
      // 先获取代币基础信息
      await this.fetchAndShowTokenInfo(address);

      const response = await fetch('/api/narrative/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address, ignoreExpired })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || '分析失败');
      }

      this.displayResult(data.data);
    } catch (error) {
      this.showError(error.message);
    } finally {
      this.hideLoading();
    }
  }

  async fetchAndShowTokenInfo(address) {
    try {
      const response = await fetch(`/api/narrative/token/${address}`);
      const data = await response.json();

      if (data.success && data.data) {
        const token = data.data;
        const tokenIcon = document.getElementById('tokenIcon');
        const loadingTokenSymbol = document.getElementById('loadingTokenSymbol');
        const loadingTokenAddress = document.getElementById('loadingTokenAddress');
        const tokenBasicInfo = document.getElementById('tokenBasicInfo');

        tokenIcon.textContent = token.icon || (token.symbol || '?')[0].toUpperCase();
        loadingTokenSymbol.textContent = token.name || token.symbol || '未知代币';
        loadingTokenAddress.textContent = `${address.slice(0, 8)}...`;
        tokenBasicInfo.style.display = 'block';
      }
    } catch (error) {
      console.warn('获取代币信息失败:', error);
      // 失败不影响分析流程，继续执行
    }
  }

  async reanalyze() {
    if (!this.currentAddress) {
      return;
    }

    this.hideError();
    this.showLoading();

    const ignoreExpired = this.ignoreExpiredCheckbox?.checked || false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      const response = await fetch(`/api/narrative/reanalyze/${this.currentAddress}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ignoreExpired }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || '重新分析失败');
      }

      this.displayResult(data.data);
    } catch (error) {
      if (error.name === 'AbortError') {
        this.showError('请求超时，分析时间过长，请稍后重试');
      } else {
        this.showError(error.message);
      }
    } finally {
      this.hideLoading();
    }
  }

  displayResult(data) {
    const { token, llmAnalysis, debugInfo, meta, twitter, classifiedUrls, fetchErrors } = data;

    // 保存数据用于调试信息切换
    this.lastData = { llmAnalysis, debugInfo, fetchErrors };

    // 1. 更新分析概览卡片
    this.updateOverviewCard(token, llmAnalysis, debugInfo, meta);

    // 2. 更新预检查卡片
    this.updatePrecheckCard(llmAnalysis);

    // 3. 更新 PreStage 卡片
    this.updatePrestageCard(llmAnalysis);

    // 4. 更新 Stage 1 卡片
    this.updateStage1Card(llmAnalysis);

    // 5. 更新 Stage 2 卡片
    this.updateStage2Card(llmAnalysis);

    // 6. 更新数据源卡片
    this.updateDataSourceCard(debugInfo, classifiedUrls);

    // 7. 更新推文卡片
    this.updateTweetCard(twitter);

    // 8. 更新原始数据卡片
    this.updateRawDataCard(token);

    // 9. 更新调试信息卡片
    this.updateDebugCard(llmAnalysis, debugInfo, fetchErrors);

    this.showResult();
  }

  updatePrecheckCard(llmAnalysis) {
    const precheck = llmAnalysis.preCheck;

    if (!precheck) {
      this.precheckCardBody.innerHTML = `
        <div class="stage-status skip">
          <span>⏭️</span>
          <span>未触发</span>
        </div>
        <div class="stage-result-box empty">
          预检查规则未触发，进入正常分析流程
        </div>
      `;
      return;
    }

    const category = precheck.category || 'unknown';
    const categoryConfig = {
      'low': { icon: '🚫', text: '不通过', statusClass: 'fail' },
      'high': { icon: '✅', text: '直接通过', statusClass: 'pass' },
      'unknown': { icon: '❓', text: '未知', statusClass: 'skip' }
    };

    const config = categoryConfig[category] || categoryConfig.unknown;

    let resultHtml = '';
    if (category === 'low') {
      resultHtml = `
        <div class="stage-result-box">
          <strong>🚫 预检查规则触发</strong><br>
          <span style="font-size: 13px; color: #666;">
            ${precheck.reason || '符合预检查阻断规则'}
          </span>
        </div>
      `;
    } else if (category === 'high') {
      resultHtml = `
        <div class="stage-result-box">
          <strong>✅ 预检查直接通过</strong><br>
          <span style="font-size: 13px; color: #666;">
            ${precheck.reason || '符合预检查通过规则'}
          </span>
        </div>
      `;
    }

    // 规则验证详情（地址验证、名称匹配等）
    let rulesHtml = '';
    if (precheck.result) {
      const result = precheck.result;
      const details = [];

      // 地址验证状态
      if (result.addressVerified !== undefined) {
        details.push({
          label: '地址验证',
          value: result.addressVerified ? '✅ 通过' : '❌ 未通过',
          pass: result.addressVerified
        });
      }

      // 名称匹配状态
      if (result.nameMatch !== undefined && result.nameMatch !== null) {
        details.push({
          label: '名称匹配',
          value: result.nameMatch ? '✅ 匹配' : '❌ 不匹配',
          pass: result.nameMatch
        });
      }

      // 验证阶段
      if (result.validationStage) {
        const stageMap = {
          'address': '地址验证阶段',
          'name': '名称验证阶段',
          'both': '完整验证'
        };
        details.push({
          label: '验证阶段',
          value: stageMap[result.validationStage] || result.validationStage,
          pass: null
        });
      }

      // 额外详情
      if (result.details) {
        if (result.details.addressReason) {
          details.push({
            label: '地址原因',
            value: result.details.addressReason,
            pass: null
          });
        }
        if (result.details.nameReason) {
          details.push({
            label: '名称原因',
            value: result.details.nameReason,
            pass: null
          });
        }
      }

      if (details.length > 0) {
        rulesHtml = '<div style="margin-top: 12px;">';
        details.forEach(d => {
          const color = d.pass === false ? '#e74c3c' : d.pass === true ? '#27ae60' : '#666';
          rulesHtml += `
            <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 12px;">
              <span style="color: #666;">${d.label}:</span>
              <span style="color: ${color}; font-weight: ${d.pass !== null ? 'bold' : 'normal'};">${d.value}</span>
            </div>
          `;
        });
        rulesHtml += '</div>';
      }
    }

    // 如果有评分结果，显示分数
    let scoresHtml = '';
    if (precheck.result && precheck.result.scores) {
      const scores = precheck.result.scores;
      scoresHtml = `
        <div style="margin-top: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 12px;">
          <strong>预检查评分：</strong><br>
          可信度: ${scores.credibility || 0} | 传播力: ${scores.virality || 0}
        </div>
      `;
    }

    this.precheckCardBody.innerHTML = `
      <div class="stage-status ${config.statusClass}">
        <span>${config.icon}</span>
        <span>${config.text}</span>
      </div>
      ${resultHtml}
      ${rulesHtml}
      ${scoresHtml}
    `;
  }

  updatePrestageCard(llmAnalysis) {
    const prestage = llmAnalysis.prestage;

    if (!prestage) {
      this.prestageCardBody.innerHTML = `
        <div class="stage-status skip">
          <span>⏭️</span>
          <span>未执行</span>
        </div>
        <div class="stage-result-box empty">
          非账号/社区代币，无需前置LLM判断
        </div>
      `;
      return;
    }

    const parsed = prestage.parsedOutput || {};
    const tokenType = parsed.tokenType || 'unknown';

    // 根据币种类型显示不同状态
    const typeConfig = {
      'meme': { icon: '🎭', text: 'Meme币', statusClass: 'pass' },
      'project': { icon: '🏗️', text: '项目币', statusClass: 'pass' },
      'unknown': { icon: '❓', text: '未知类型', statusClass: 'skip' }
    };

    const config = typeConfig[tokenType] || typeConfig.unknown;

    // 币种类型判断详情
    let resultHtml = '';
    if (tokenType === 'meme') {
      resultHtml = `
        <div class="stage-result-box">
          <strong>✅ 判断为 Meme 币</strong><br>
          <span style="font-size: 13px; color: #666;">
            将进入两阶段分析流程（事件分析 → 代币分析）
          </span>
        </div>
      `;
    } else if (tokenType === 'project') {
      resultHtml = `
        <div class="stage-result-box">
          <strong>✅ 判断为项目币</strong><br>
          <span style="font-size: 13px; color: #666;">
            使用简化流程分析（不进行事件分析）
          </span>
        </div>
      `;
    }

    // 账号摘要（如果有）
    let summaryHtml = '';
    if (parsed.accountSummary) {
      summaryHtml = `
        <div style="margin-top: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 12px;">
          <strong>账号摘要：</strong><br>
          ${parsed.accountSummary.substring(0, 150)}...
        </div>
      `;
    }

    // 规则验证结果
    let rulesHtml = '';
    if (parsed.addressVerified !== undefined || parsed.nameMatch !== undefined) {
      rulesHtml = `
        <div style="margin-top: 12px;">
          <div style="font-size: 12px; color: #666; margin-bottom: 6px;">规则验证结果：</div>
          ${parsed.addressVerified ? '<span style="font-size: 11px; padding: 4px 8px; background: #d4edda; color: #155724; border-radius: 4px;">✅ 地址验证通过</span>' : ''}
          ${parsed.nameMatch ? '<span style="font-size: 11px; padding: 4px 8px; background: #d4edda; color: #155724; border-radius: 4px; margin-left: 4px;">✅ 名称匹配通过</span>' : ''}
        </div>
      `;
    }

    // 耗时
    let timingHtml = '';
    if (prestage.startedAt && prestage.finishedAt) {
      const duration = this.calculateDuration(prestage.startedAt, prestage.finishedAt);
      timingHtml = `
        <div class="stage-timing">
          <div class="timing-item">
            <span>⏱️</span>
            <span>耗时: ${duration}</span>
          </div>
          <div class="timing-item">
            <span>🤖</span>
            <span>${prestage.model || 'Unknown'}</span>
          </div>
        </div>
      `;
    }

    // LLM详情区域（prompt和raw output）
    let llmDetailsHtml = '';
    if (prestage.prompt || prestage.rawOutput) {
      const hasPrompt = !!prestage.prompt;
      const hasRawOutput = !!prestage.rawOutput;

      let promptSection = '';
      if (hasPrompt) {
        promptSection = `
          <button class="expand-btn" onclick="this.nextElementSibling.classList.toggle('active'); this.textContent = this.nextElementSibling.classList.contains('active') ? '收起 Prompt' : '展开 Prompt'">
            ▼ 展开 Prompt
          </button>
          <div class="expand-content" style="max-height: 300px; overflow-y: auto;">
            ${this.escapeHtml(prestage.prompt)}
          </div>
        `;
      }

      let rawOutputSection = '';
      if (hasRawOutput) {
        rawOutputSection = `
          <button class="expand-btn" onclick="this.nextElementSibling.classList.toggle('active'); this.textContent = this.nextElementSibling.classList.contains('active') ? '收起原始响应' : '展开原始响应'">
            ▼ 展开原始响应
          </button>
          <div class="expand-content" style="max-height: 300px; overflow-y: auto;">
            ${JSON.stringify(prestage.rawOutput, null, 2)}
          </div>
        `;
      }

      if (hasPrompt || hasRawOutput) {
        llmDetailsHtml = `
          <div style="margin-top: 16px; border-top: 1px solid #ecf0f1; padding-top: 16px;">
            <div style="font-size: 14px; font-weight: 600; color: #2c3e50; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🤖</span>
              <span>LLM 调用详情</span>
            </div>
            <div style="display: grid; gap: 8px;">
              ${promptSection}
              ${rawOutputSection}
            </div>
          </div>
        `;
      }
    }

    this.prestageCardBody.innerHTML = `
      <div class="stage-status ${config.statusClass}">
        <span>${config.icon}</span>
        <span>${config.text}</span>
      </div>
      ${resultHtml}
      ${summaryHtml}
      ${rulesHtml}
      ${timingHtml}
      ${llmDetailsHtml}
    `;
  }

  updateOverviewCard(token, llmAnalysis, debugInfo, meta) {
    // 更新代币名字显示
    const tokenNameElement = document.getElementById('tokenName');
    if (tokenNameElement && token) {
      const rawApiData = token.raw_api_data || {};
      const name = rawApiData.name || rawApiData.token_name || token.symbol || '未知代币';
      tokenNameElement.textContent = name;
    }
    // 更新评级徽章
    const ratingBadge = document.getElementById('ratingBadge');
    const ratingIcon = document.getElementById('ratingIcon');
    const ratingText = document.getElementById('ratingText');

    const category = llmAnalysis.category || 'unrated';
    ratingBadge.className = 'rating-badge ' + category;

    const categoryConfig = {
      'high': { icon: '🟢', text: '高质量' },
      'mid': { icon: '🟡', text: '中质量' },
      'low': { icon: '🔴', text: '低质量' },
      'unrated': { icon: '⚪', text: '未评级' }
    };

    const config = categoryConfig[category] || categoryConfig.unrated;
    ratingIcon.textContent = config.icon;
    ratingText.textContent = config.text;

    // 更新分数显示
    const scoresDisplay = document.getElementById('scoresDisplay');
    const summary = llmAnalysis.summary || {};

    if (summary.total_score !== undefined) {
      scoresDisplay.innerHTML = `
        <div class="score-bar">
          <div class="score-bar-label">
            <span>总分</span>
            <span>${summary.total_score}/100</span>
          </div>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width: ${summary.total_score}%"></div>
          </div>
        </div>
      `;
    } else {
      scoresDisplay.innerHTML = '';
    }

    // 更新分析路径
    const analysisPath = document.getElementById('analysisPath');
    const stage = debugInfo?.analysisStage || 0;
    const pathSteps = [];

    // 预检查
    if (llmAnalysis.preCheck) {
      pathSteps.push({ label: '预检查', status: 'completed', icon: '⚡' });
    } else {
      pathSteps.push({ label: '预检查', status: 'skip', icon: '○' });
    }

    // PreStage（币种类型判断）
    if (llmAnalysis.prestage) {
      const prestageParsed = llmAnalysis.prestage.parsedOutput || {};
      const tokenType = prestageParsed.tokenType || 'unknown';
      const icon = tokenType === 'meme' ? '🎭' : tokenType === 'project' ? '🏗️' : '🎯';
      pathSteps.push({ label: 'PreStage', status: 'completed', icon: icon });
    } else {
      pathSteps.push({ label: 'PreStage', status: 'skip', icon: '○' });
    }

    // Stage 1
    if (stage >= 1) {
      const stage1Parsed = llmAnalysis.stage1?.parsedOutput || {};
      // 兼容新旧框架
      const isFail = stage1Parsed.hasOwnProperty('pass')
        ? (stage1Parsed.pass === false)
        : (llmAnalysis.stage1?.category === 'low');
      if (isFail) {
        pathSteps.push({ label: 'Stage 1', status: 'fail', icon: '⛔' });
      } else {
        pathSteps.push({ label: 'Stage 1', status: 'completed', icon: '✅' });
      }
    } else {
      pathSteps.push({ label: 'Stage 1', status: 'skip', icon: '○' });
    }

    // Stage 2
    if (stage >= 2) {
      pathSteps.push({ label: 'Stage 2', status: 'completed', icon: '✅' });
    } else {
      pathSteps.push({ label: 'Stage 2', status: 'skip', icon: '○' });
    }

    analysisPath.innerHTML = pathSteps.map((step, i) => {
      const stepClass = step.status === 'completed' ? 'path-step completed' :
                        step.status === 'fail' ? 'path-step active' :
                        'path-step';
      return `<span class="${stepClass}">${step.icon} ${step.label}</span>` +
             (i < pathSteps.length - 1 ? '<span class="path-arrow">→</span>' : '');
    }).join('');

    // 更新理由（优先级：summary > prestage > stage1 > preCheck）
    const overviewReasoning = document.getElementById('overviewReasoning');
    if (summary?.reasoning) {
      overviewReasoning.textContent = summary.reasoning;
    } else if (summary?.reason) {
      // Stage 1 低质量检测使用 reason 字段
      overviewReasoning.textContent = summary.reason;
    } else if (llmAnalysis.prestage?.parsedOutput?.reason) {
      // Web3原生IP早期的理由
      overviewReasoning.textContent = llmAnalysis.prestage.parsedOutput.reason;
    } else if (llmAnalysis.stage1?.parsedOutput?.reason) {
      // Stage 1 的理由
      overviewReasoning.textContent = llmAnalysis.stage1.parsedOutput.reason;
    } else if (llmAnalysis.preCheck?.result?.reasoning) {
      overviewReasoning.textContent = llmAnalysis.preCheck.result.reasoning;
    } else if (!summary && !llmAnalysis.prestage && !llmAnalysis.stage1 && !llmAnalysis.stage2) {
      // 旧数据格式，没有分析详情
      overviewReasoning.textContent = '此为旧版分析结果，缺少分析理由。点击右上角"重新分析"获取完整数据。';
      overviewReasoning.style.color = '#e67e22';
    } else {
      overviewReasoning.textContent = '暂无分析理由';
    }

    // 更新元数据
    const overviewMeta = document.getElementById('overviewMeta');
    const metaItems = [];
    if (meta?.analyzedAt) {
      metaItems.push(`📅 ${this.formatDate(meta.analyzedAt)}`);
    }
    if (meta?.sourceExperimentId) {
      metaItems.push(`🏷️ ${meta.sourceExperimentId.slice(0, 8)}`);
    }
    overviewMeta.textContent = metaItems.join('  |  ');
  }

  updateStage1Card(llmAnalysis) {
    const stage1 = llmAnalysis.stage1;

    if (!stage1) {
      this.stage1CardBody.innerHTML = `
        <div class="stage-status skip">
          <span>⏭️</span>
          <span>未执行</span>
        </div>
        <div class="stage-result-box empty">
          ${llmAnalysis.preCheck ? '预检查已触发，跳过 Stage 1' : 'Stage 1 未执行'}
        </div>
      `;
      return;
    }

    const parsed = stage1.parsedOutput || {};

    // 兼容新旧框架：
    // 旧框架：category === 'low' 表示低质量
    // 新框架：parsed.pass === false 表示事件分析未通过
    const isOldFramework = !parsed.hasOwnProperty('pass');
    const isFail = isOldFramework ? (stage1.category === 'low') : (parsed.pass === false);

    const statusClass = isFail ? 'fail' : 'pass';
    const statusText = isFail ? '未通过' : '通过';
    const statusIcon = isFail ? '⚠️' : '✅';

    let resultHtml = '';
    if (isFail && parsed) {
      // 事件分析未通过或低质量检测触发
      const eventAnalysis = parsed.eventAnalysis || {};
      resultHtml = `
        <div class="stage-result-box">
          <strong>失败原因：</strong>
          ${parsed.reason || (eventAnalysis.blockReason || '未知原因')}
        </div>
      `;
    } else if (!isFail && parsed.eventAnalysis) {
      // 事件分析通过 - 显示事件详情和评分
      const eventDesc = parsed.eventAnalysis.eventDescription || {};
      const score = parsed.eventAnalysis.propagationScore;
      const breakdown = parsed.eventAnalysis.scoreBreakdown || {};

      resultHtml = `
        <div class="stage-result-box">
          <strong>✅ 事件完整且有传播潜力</strong><br><br>
          <strong>事件主题：</strong>${eventDesc.主题 || '-'}<br>
          <strong>事件主体：</strong>${eventDesc.主体 || '-'}<br>
          <strong>事件类别：</strong>${eventDesc.类别 || '-'}<br>
          <strong>时效性：</strong>${eventDesc.时效性 || '-'}<br><br>
          <strong>传播潜力评分：</strong>${score || 0}/100 分
          ${breakdown.sourceWeight !== undefined ? `<br><span style="font-size: 12px; color: #666;">
            信息源 ${breakdown.sourceWeight} + 事件影响 ${breakdown.eventImpact} +
            时效加分 ${breakdown.timelinessBonus} + 类别权重 ${breakdown.categoryWeight}
          </span>` : ''}
        </div>
      `;
    } else if (!isFail) {
      // 旧框架 - 未触发低质量场景
      resultHtml = `
        <div class="stage-result-box">
          ✅ 未触发8种低质量场景，内容通过初步检查
        </div>
      `;
    }

    // 识别的实体（保留用于兼容旧数据）
    let entitiesHtml = '';
    if (parsed.entities && !parsed.eventAnalysis) {
      const entities = parsed.entities;
      const entityEntries = Object.entries(entities);
      if (entityEntries.length > 0) {
        entitiesHtml = '<div class="entities-list">';
        entityEntries.forEach(([type, list]) => {
          const labelMap = {
            'tweet1': '主推文',
            'quoted_tweet': '引用推文',
            'website_tweet': 'Website推文',
            'website': 'Website',
            'amazon': 'Amazon'
          };
          const label = labelMap[type] || type;
          if (Array.isArray(list) && list.length > 0) {
            list.forEach(entity => {
              entitiesHtml += `
                <div class="entity-item">
                  <span class="entity-label">${label}:</span>
                  <span>${entity}</span>
                </div>
              `;
            });
          }
        });
        entitiesHtml += '</div>';
      }
    }

    // 计算耗时
    let timingHtml = '';
    if (stage1.startedAt && stage1.finishedAt) {
      const duration = this.calculateDuration(stage1.startedAt, stage1.finishedAt);
      timingHtml = `
        <div class="stage-timing">
          <div class="timing-item">
            <span>⏱️</span>
            <span>耗时: ${duration}</span>
          </div>
          <div class="timing-item">
            <span>🤖</span>
            <span>${stage1.model || 'Unknown'}</span>
          </div>
        </div>
      `;
    }

    // LLM详情区域
    let llmDetailsHtml = '';
    if (stage1.prompt || stage1.rawOutput || !stage1.prompt) {
      // 即使没有 prompt 也显示区域，提示用户可能需要重新分析
      const hasPrompt = !!stage1.prompt;
      const hasRawOutput = !!stage1.rawOutput;
      const needsReanalyze = !hasPrompt && !hasRawOutput;

      let promptSection = '';
      if (hasPrompt) {
        promptSection = `
          <button class="expand-btn" onclick="this.nextElementSibling.classList.toggle('active'); this.textContent = this.nextElementSibling.classList.contains('active') ? '收起 Prompt' : '展开 Prompt'">
            ▼ 展开 Prompt
          </button>
          <div class="expand-content" style="max-height: 300px; overflow-y: auto;">
            ${this.escapeHtml(stage1.prompt)}
          </div>
        `;
      } else {
        promptSection = `
          <div style="padding: 10px; background: #fff3cd; border-radius: 6px; font-size: 12px; color: #856404;">
            ⚠️ Prompt 未保存（旧数据），请点击右上角"重新分析"按钮获取完整数据
          </div>
        `;
      }

      let rawOutputSection = '';
      if (hasRawOutput) {
        rawOutputSection = `
          <button class="expand-btn" onclick="this.nextElementSibling.classList.toggle('active'); this.textContent = this.nextElementSibling.classList.contains('active') ? '收起原始响应' : '展开原始响应'">
            ▼ 展开原始响应
          </button>
          <div class="expand-content" style="max-height: 300px; overflow-y: auto;">
            ${JSON.stringify(stage1.rawOutput, null, 2)}
          </div>
        `;
      }

      if (hasPrompt || hasRawOutput || needsReanalyze) {
        llmDetailsHtml = `
          <div style="margin-top: 16px; border-top: 1px solid #ecf0f1; padding-top: 16px;">
            <div style="font-size: 14px; font-weight: 600; color: #2c3e50; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🤖</span>
              <span>LLM 调用详情</span>
            </div>
            <div style="display: grid; gap: 8px;">
              ${promptSection}
              ${rawOutputSection}
            </div>
          </div>
        `;
      }
    }

    this.stage1CardBody.innerHTML = `
      <div class="stage-status ${statusClass}">
        <span>${statusIcon}</span>
        <span>${statusText}</span>
      </div>
      ${resultHtml}
      ${entitiesHtml}
      ${timingHtml}
      ${llmDetailsHtml}
    `;
  }

  updateStage2Card(llmAnalysis) {
    const stage2 = llmAnalysis.stage2;

    if (!stage2) {
      this.stage2CardBody.innerHTML = `
        <div class="stage-status skip">
          <span>⏭️</span>
          <span>未执行</span>
        </div>
        <div class="stage-result-box empty">
          ${llmAnalysis.stage1?.category === 'low' ? 'Stage 1 检测到低质量，跳过详细评分' : 'Stage 2 未执行'}
        </div>
      `;
      return;
    }

    const parsed = stage2.parsedOutput || {};
    const category = stage2.category || 'unrated';

    // 评级显示
    const categoryConfig = {
      'high': { icon: '🟢', text: '高质量' },
      'mid': { icon: '🟡', text: '中质量' },
      'low': { icon: '🔴', text: '低质量' }
    };
    const config = categoryConfig[category] || { icon: '⚪', text: '未评级' };

    // 分数详情
    let scoresHtml = '';
    if (parsed.scores) {
      const scores = parsed.scores;
      scoresHtml = `
        <div class="score-detail">
          <div class="score-detail-header">
            <label>综合得分</label>
            <value>${scores.total_score || 0}/100</value>
          </div>
          <div class="score-bar">
            <div class="score-bar-fill ${category}" style="width: ${scores.total_score || 0}%"></div>
          </div>
        </div>
      `;

      // 子维度分数 - 新格式
      if (scores.event_propagation_score !== undefined) {
        scoresHtml += `
          <div class="sub-scores">
            <div class="sub-score-item">
              <span class="sub-score-label">事件传播 (60%)</span>
              <div class="sub-score-bar">
                <div class="sub-score-fill" style="width: ${scores.event_propagation_score}%"></div>
              </div>
              <span class="sub-score-value">${scores.event_propagation_score}</span>
            </div>
          </div>
        `;
      }
      if (scores.relevance_score !== undefined) {
        scoresHtml += `
          <div class="sub-scores">
            <div class="sub-score-item">
              <span class="sub-score-label">关联强度 (20%)</span>
              <div class="sub-score-bar">
                <div class="sub-score-fill" style="width: ${(scores.relevance_score / 20 * 100)}%"></div>
              </div>
              <span class="sub-score-value">${scores.relevance_score}/20</span>
            </div>
          </div>
        `;
      }
      if (scores.token_name_quality_score !== undefined) {
        scoresHtml += `
          <div class="sub-scores">
            <div class="sub-score-item">
              <span class="sub-score-label">名称质量 (20%)</span>
              <div class="sub-score-bar">
                <div class="sub-score-fill" style="width: ${(scores.token_name_quality_score / 20 * 100)}%"></div>
              </div>
              <span class="sub-score-value">${scores.token_name_quality_score}/20</span>
            </div>
          </div>
        `;
      }

      // 代币名称分析详情
      if (parsed.token_name_analysis) {
        const tna = parsed.token_name_analysis;
        scoresHtml += `
          <div style="margin-top: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 12px;">
            <strong>名称质量详情：</strong><br>
            长度: ${tna.length_score || 0}/8 |
            meme适配: ${tna.meme_fit_score || 0}/8 |
            传播性: ${tna.virality_score || 0}/4 |
            总分: ${tna.total || 0}/20
            ${tna.triggered_floor_limit ? ' <span style="color: #dc3545;">(触碰底线)</span>' : ''}
            ${tna.notes ? `<br><span style="color: #666;">${tna.notes}</span>` : ''}
          </div>
        `;
      }

      // 事件信息
      if (parsed.event_info) {
        const ei = parsed.event_info;
        scoresHtml += `
          <div style="margin-top: 8px; padding: 10px; background: #e7f3ff; border-radius: 6px; font-size: 12px;">
            <strong>事件信息：</strong><br>
            类别: ${ei.event_category || '未知'}
            ${ei.timeliness ? `| 时效: ${ei.timeliness}` : ''}
          </div>
        `;
      }
    }

    // 理由
    const reasoningHtml = parsed.reasoning ? `
      <div style="margin-top: 16px; padding: 14px; background: #f8f9fa; border-radius: 8px; font-size: 14px; line-height: 1.6;">
        <strong>分析理由：</strong><br>
        ${parsed.reasoning}
      </div>
    ` : '';

    // 耗时
    let timingHtml = '';
    if (stage2.startedAt && stage2.finishedAt) {
      const duration = this.calculateDuration(stage2.startedAt, stage2.finishedAt);
      timingHtml = `
        <div class="stage-timing">
          <div class="timing-item">
            <span>⏱️</span>
            <span>耗时: ${duration}</span>
          </div>
          <div class="timing-item">
            <span>🤖</span>
            <span>${stage2.model || 'Unknown'}</span>
          </div>
        </div>
      `;
    }

    // LLM详情区域
    let llmDetailsHtml = '';
    if (stage2.prompt || stage2.rawOutput || !stage2.prompt) {
      const hasPrompt = !!stage2.prompt;
      const hasRawOutput = !!stage2.rawOutput;
      const needsReanalyze = !hasPrompt && !hasRawOutput;

      let promptSection = '';
      if (hasPrompt) {
        promptSection = `
          <button class="expand-btn" onclick="this.nextElementSibling.classList.toggle('active'); this.textContent = this.nextElementSibling.classList.contains('active') ? '收起 Prompt' : '展开 Prompt'">
            ▼ 展开 Prompt
          </button>
          <div class="expand-content" style="max-height: 300px; overflow-y: auto;">
            ${this.escapeHtml(stage2.prompt)}
          </div>
        `;
      } else {
        promptSection = `
          <div style="padding: 10px; background: #fff3cd; border-radius: 6px; font-size: 12px; color: #856404;">
            ⚠️ Prompt 未保存（旧数据），请点击右上角"重新分析"按钮获取完整数据
          </div>
        `;
      }

      let rawOutputSection = '';
      if (hasRawOutput) {
        rawOutputSection = `
          <button class="expand-btn" onclick="this.nextElementSibling.classList.toggle('active'); this.textContent = this.nextElementSibling.classList.contains('active') ? '收起原始响应' : '展开原始响应'">
            ▼ 展开原始响应
          </button>
          <div class="expand-content" style="max-height: 300px; overflow-y: auto;">
            ${JSON.stringify(stage2.rawOutput, null, 2)}
          </div>
        `;
      }

      if (hasPrompt || hasRawOutput || needsReanalyze) {
        llmDetailsHtml = `
          <div style="margin-top: 16px; border-top: 1px solid #ecf0f1; padding-top: 16px;">
            <div style="font-size: 14px; font-weight: 600; color: #2c3e50; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
              <span>🤖</span>
              <span>LLM 调用详情</span>
            </div>
            <div style="display: grid; gap: 8px;">
              ${promptSection}
              ${rawOutputSection}
            </div>
          </div>
        `;
      }
    }

    this.stage2CardBody.innerHTML = `
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="font-size: 36px;">${config.icon}</span>
        <div style="font-size: 20px; font-weight: bold; color: #2c3e50; margin-top: 8px;">
          ${config.text}
        </div>
      </div>
      ${scoresHtml}
      ${reasoningHtml}
      ${timingHtml}
      ${llmDetailsHtml}
    `;
  }

  updateDataSourceCard(debugInfo, classifiedUrls) {
    if (!debugInfo?.urlExtractionResult && !classifiedUrls) {
      this.dataSourceCardBody.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📎</div>
          <div class="empty-state-text">无数据源信息</div>
        </div>
      `;
      return;
    }

    // URL提取结果统计
    let summaryHtml = '';
    if (debugInfo.urlExtractionResult) {
      const total = debugInfo.urlExtractionResult.total_urls || 0;
      const classified = debugInfo.urlExtractionResult.classified_urls || {};
      summaryHtml = `
        <div class="url-extraction-summary">
          <div class="url-stat">
            <div class="url-stat-value">${total}</div>
            <div class="url-stat-label">提取URL总数</div>
          </div>
          <div class="url-stat">
            <div class="url-stat-value">${(classified.twitter || []).length}</div>
            <div class="url-stat-label">Twitter</div>
          </div>
          <div class="url-stat">
            <div class="url-stat-value">${(classified.websites || []).length}</div>
            <div class="url-stat-label">网站</div>
          </div>
          <div class="url-stat">
            <div class="url-stat-value">${(classified.github || []).length}</div>
            <div class="url-stat-label">GitHub</div>
          </div>
        </div>
      `;
    }

    // URL列表
    let urlsHtml = '';
    if (classifiedUrls && !this.isEmptyUrls(classifiedUrls)) {
      const dataFetchResults = debugInfo?.dataFetchResults || {};

      urlsHtml = '<div class="url-list">';
      this.buildUrlsList(classifiedUrls, dataFetchResults).forEach(item => {
        urlsHtml += `
          <div class="url-item ${item.success === false ? 'error' : 'success'}">
            <div class="url-platform-icon">${item.icon}</div>
            <div class="url-info">
              <div class="url-platform-name">${item.platform} ${item.type ? `<span style="color: #999;">(${item.type})</span>` : ''}</div>
              <div class="url-link">
                <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.url}</a>
              </div>
            </div>
            <div style="text-align: right;">
              <div class="url-status ${item.success === false ? 'error' : 'success'}">
                ${item.success === false ? '❌ 失败' : '✅ 成功'}
              </div>
              ${item.timing ? `<div class="url-timing">${item.timing}</div>` : ''}
              ${item.error ? `<div class="url-timing" style="color: #dc3545;">${item.error}</div>` : ''}
            </div>
          </div>
        `;
      });
      urlsHtml += '</div>';
    }

    this.dataSourceCardBody.innerHTML = `
      ${summaryHtml}
      ${urlsHtml || '<div class="empty-state"><div class="empty-state-text">未发现任何链接</div></div>'}
    `;
  }

  updateTweetCard(twitter) {
    if (!twitter || !twitter.text) {
      this.tweetCard.style.display = 'none';
      return;
    }

    this.tweetCard.style.display = 'block';

    const authorInitial = (twitter.author_name || twitter.author_screen_name || 'U')[0].toUpperCase();

    let metricsHtml = '';
    const metrics = twitter.metrics || {};
    if (metrics.like_count || metrics.retweet_count || metrics.reply_count) {
      metricsHtml = `
        <div class="tweet-metrics">
          ${metrics.reply_count ? `<div class="tweet-metric">💬 ${this.formatNumber(metrics.reply_count)}</div>` : ''}
          ${metrics.retweet_count ? `<div class="tweet-metric">🔄 ${this.formatNumber(metrics.retweet_count)}</div>` : ''}
          ${metrics.like_count ? `<div class="tweet-metric">❤️ ${this.formatNumber(metrics.like_count)}</div>` : ''}
        </div>
      `;
    }

    let translationHtml = '';
    if (twitter.translated_text) {
      translationHtml = `
        <div class="tweet-translation">
          <strong>翻译：</strong>${twitter.translated_text}
        </div>
      `;
    }

    // 显示被回复的推文
    let inReplyToHtml = '';
    if (twitter.in_reply_to && twitter.in_reply_to.text) {
      const replyAuthorInitial = (twitter.in_reply_to.author_name || twitter.in_reply_to.author_screen_name || 'U')[0].toUpperCase();
      inReplyToHtml = `
        <div style="margin-bottom: 16px; padding: 12px; background: #f0f0f0; border-left: 3px solid #3498db; border-radius: 6px;">
          <div style="font-size: 11px; color: #7f8c8d; margin-bottom: 8px;">↩️ 回复的推文</div>
          <div class="tweet-author" style="margin-bottom: 8px;">
            <div class="tweet-author-avatar" style="width: 24px; height: 24px; font-size: 10px;">${replyAuthorInitial}</div>
            <div>
              <div style="font-weight: 600; font-size: 13px;">${twitter.in_reply_to.author_name || twitter.in_reply_to.author_screen_name || '未知'}</div>
              <div style="font-size: 11px; color: #7f8c8d;">@${twitter.in_reply_to.author_screen_name || ''}</div>
            </div>
          </div>
          <div style="font-size: 13px; line-height: 1.5; color: #555;">${this.escapeHtml(twitter.in_reply_to.text)}</div>
          ${twitter.in_reply_to.formatted_created_at ? `<div style="font-size: 11px; color: #999; margin-top: 6px;">📅 ${twitter.in_reply_to.formatted_created_at}</div>` : ''}
        </div>
      `;
    }

    this.tweetCardBody.innerHTML = `
      ${inReplyToHtml}
      <div class="tweet-author">
        <div class="tweet-author-avatar">${authorInitial}</div>
        <div>
          <div style="font-weight: 600;">${twitter.author_name || twitter.author_screen_name || '未知'}</div>
          <div style="font-size: 12px; color: #7f8c8d;">@${twitter.author_screen_name || ''}</div>
        </div>
      </div>
      <div class="tweet-content">${this.escapeHtml(twitter.text)}</div>
      ${translationHtml}
      <div class="tweet-meta">
        <span>📅 ${this.formatDate(twitter.created_at)}</span>
        ${metricsHtml}
      </div>
    `;
  }

  updateRawDataCard(token) {
    if (!token || !token.raw_api_data) {
      this.rawDataCard.style.display = 'none';
      return;
    }

    this.rawDataCard.style.display = 'block';

    const rawData = token.raw_api_data;

    // 计算数据大小
    const dataSize = JSON.stringify(rawData).length;
    const sizeKB = (dataSize / 1024).toFixed(2);

    // 提取关键字段用于摘要
    const summaryItems = [];

    if (rawData.symbol) {
      summaryItems.push(`<div class="raw-data-summary-item"><span class="label">Symbol:</span><span class="value">${rawData.symbol}</span></div>`);
    }
    if (rawData.name) {
      summaryItems.push(`<div class="raw-data-summary-item"><span class="label">名称:</span><span class="value">${rawData.name}</span></div>`);
    }
    if (rawData.chain) {
      summaryItems.push(`<div class="raw-data-summary-item"><span class="label">链:</span><span class="value">${rawData.chain}</span></div>`);
    }
    if (rawData.holders !== undefined) {
      summaryItems.push(`<div class="raw-data-summary-item"><span class="label">持有人:</span><span class="value">${rawData.holders}</span></div>`);
    }
    if (rawData.market_cap || rawData.fdv) {
      const marketCap = rawData.market_cap || rawData.fdv;
      summaryItems.push(`<div class="raw-data-summary-item"><span class="label">市值:</span><span class="value">$${parseFloat(marketCap).toLocaleString()}</span></div>`);
    }

    this.rawDataCardBody.innerHTML = `
      <div class="raw-data-summary">
        ${summaryItems.join('')}
        <div class="raw-data-summary-item"><span class="label">数据大小:</span><span class="value">${sizeKB} KB</span></div>
      </div>
      <div class="raw-data-content">
        <div class="raw-data-viewer">${this.escapeHtml(JSON.stringify(rawData, null, 2))}</div>
        <button class="raw-data-copy-btn" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent).then(() => { this.textContent = '✅ 已复制'; setTimeout(() => this.textContent = '📋 复制原始数据', 2000); })">📋 复制原始数据</button>
      </div>
    `;
  }

  updateDebugCard(llmAnalysis, debugInfo, fetchErrors) {
    if (!llmAnalysis && !debugInfo) {
      this.debugCardBody.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📝</div>
          <div class="empty-state-text">无调试信息</div>
        </div>
      `;
      return;
    }

    let debugHtml = '';

    // URL提取日志
    if (debugInfo?.urlExtractionResult) {
      const total = debugInfo.urlExtractionResult.total_urls || 0;
      debugHtml += `
        <div class="debug-log">
          <div class="debug-log-title">📎 URL提取日志</div>
          <div class="debug-log-content">
            <div class="debug-log-item info">✓ 从数据源提取到 ${total} 个URL</div>
          </div>
        </div>
      `;
    }

    // 数据获取日志
    if (debugInfo?.dataFetchResults) {
      const dataFetch = debugInfo.dataFetchResults;
      const logs = Object.entries(dataFetch).map(([platform, result]) => {
        if (result?.success) {
          const duration = result.started_at && result.finished_at ?
            this.calculateDuration(result.started_at, result.finished_at) : '';
          return `<div class="debug-log-item success">✓ ${platform}: 成功${duration ? ` (${duration})` : ''}</div>`;
        } else {
          return `<div class="debug-log-item error">✗ ${platform}: 失败 - ${result?.error || 'Unknown error'}</div>`;
        }
      }).join('');

      debugHtml += `
        <div class="debug-log">
          <div class="debug-log-title">🌐 数据获取日志</div>
          <div class="debug-log-content">${logs}</div>
        </div>
      `;
    }

    // LLM调用日志
    const llmCalls = [];
    if (llmAnalysis.stage1) {
      const s1 = llmAnalysis.stage1;
      llmCalls.push({
        stage: 'Stage 1',
        model: s1.model,
        startedAt: s1.startedAt,
        finishedAt: s1.finishedAt,
        success: s1.success
      });
    }
    if (llmAnalysis.stage2) {
      const s2 = llmAnalysis.stage2;
      llmCalls.push({
        stage: 'Stage 2',
        model: s2.model,
        startedAt: s2.startedAt,
        finishedAt: s2.finishedAt,
        success: s2.success
      });
    }

    if (llmCalls.length > 0) {
      const callLogs = llmCalls.map(call => {
        const duration = call.startedAt && call.finishedAt ?
          this.calculateDuration(call.startedAt, call.finishedAt) : 'N/A';
        const status = call.success ? '✅ 成功' : '❌ 失败';
        return `
          <div class="llm-call-log">
            <span class="stage">${call.stage}</span>
            <span class="details">${call.model || 'Unknown'} | ${duration} | ${status}</span>
          </div>
        `;
      }).join('');

      debugHtml += `
        <div class="debug-log">
          <div class="debug-log-title">🤖 LLM调用日志</div>
          <div class="debug-log-content">${callLogs}</div>
        </div>
      `;
    }

    this.debugCardBody.innerHTML = debugHtml || '<div class="empty-state"><div class="empty-state-text">无调试信息</div></div>';
  }

  buildUrlsList(classifiedUrls, dataFetchResults) {
    const platformConfig = {
      twitter: { label: 'Twitter/X', icon: '🐦' },
      weibo: { label: '微博', icon: '📱' },
      youtube: { label: 'YouTube', icon: '▶️' },
      tiktok: { label: 'TikTok', icon: '🎵' },
      douyin: { label: '抖音', icon: '🎵' },
      bilibili: { label: 'Bilibili', icon: '📺' },
      github: { label: 'GitHub', icon: '💻' },
      amazon: { label: 'Amazon', icon: '📦' },
      telegram: { label: 'Telegram', icon: '✈️' },
      discord: { label: 'Discord', icon: '💬' },
      websites: { label: '网站', icon: '🌐' }
    };

    const typeLabelMap = {
      'tweet': '推文',
      'account': '账号',
      'post': '帖子',
      'video': '视频',
      'repository': '仓库',
      'product': '商品',
      'channel': '频道',
      'server': '服务器',
      'website': '网页'
    };

    const items = [];

    for (const [platform, urls] of Object.entries(classifiedUrls)) {
      if (!urls || urls.length === 0) continue;

      const config = platformConfig[platform] || platformConfig.websites;

      urls.forEach(urlInfo => {
        const fetchResult = dataFetchResults[platform];
        const timing = fetchResult?.startedAt && fetchResult?.finishedAt ?
          this.calculateDuration(fetchResult.startedAt, fetchResult.finishedAt) : null;

        items.push({
          icon: config.icon,
          platform: config.label,
          type: typeLabelMap[urlInfo.type] || urlInfo.type,
          url: urlInfo.url,
          success: fetchResult?.success,
          error: fetchResult?.error,
          timing: timing
        });
      });
    }

    return items;
  }

  isEmptyUrls(classifiedUrls) {
    if (!classifiedUrls) return true;
    return Object.values(classifiedUrls).every(arr => !arr || arr.length === 0);
  }

  showLoading() {
    this.loadingSection.classList.add('active');
    this.analyzeBtn.disabled = true;
    this.reanalyzeBtn.disabled = true;
  }

  hideLoading() {
    this.loadingSection.classList.remove('active');
    this.analyzeBtn.disabled = false;
    this.reanalyzeBtn.disabled = false;
  }

  showResult() {
    this.resultSection.classList.add('active');
    this.reanalyzeBtn.style.display = 'inline-block';
    this.debugToggleBtn.style.display = 'inline-block';
  }

  hideResult() {
    this.resultSection.classList.remove('active');
    this.reanalyzeBtn.style.display = 'none';
    this.debugToggleBtn.style.display = 'none';
    this.resultSection.classList.remove('show-debug');
  }

  toggleDebugInfo() {
    this.resultSection.classList.toggle('show-debug');
    this.debugToggleBtn.classList.toggle('active');

    const isExpanded = this.resultSection.classList.contains('show-debug');
    this.debugInfoCard.style.display = isExpanded ? 'block' : 'none';

    // 如果调试卡片是空的，先更新一次
    if (isExpanded && this.debugInfoCard.querySelector('.empty-state')) {
      // 需要保存当前数据以便后续更新调试卡片
      // 这里假设数据已经存在，可以在 displayResult 时保存
      if (this.lastData) {
        this.updateDebugCard(this.lastData.llmAnalysis, this.lastData.debugInfo, this.lastData.fetchErrors);
      }
    }
  }

  showError(message) {
    this.errorSection.textContent = message;
    this.errorSection.classList.add('active');
  }

  hideError() {
    this.errorSection.classList.remove('active');
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  }

  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  calculateDuration(startedAt, finishedAt) {
    try {
      const start = new Date(startedAt);
      const end = new Date(finishedAt);
      const ms = end - start;
      if (ms < 1000) return `${ms}ms`;
      return `${(ms / 1000).toFixed(2)}s`;
    } catch {
      return 'N/A';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  window.narrativeAnalyzer = new NarrativeAnalyzer();
});
