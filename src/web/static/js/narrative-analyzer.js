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
    this.stage3CardBody = document.getElementById('stage3CardBody');
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

      // 发起分析请求，等待完成后一次性展示
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
        const gmgnLink = document.getElementById('gmgnLink');

        tokenIcon.textContent = token.icon || (token.symbol || '?')[0].toUpperCase();
        // 始终显示 symbol，如果有 name 则一起显示
        const name = token.name || '';
        const symbol = token.symbol || '';
        if (name && symbol) {
          loadingTokenSymbol.innerHTML = `${name} <span style="color: #666;">(${symbol})</span>`;
        } else if (symbol) {
          loadingTokenSymbol.textContent = symbol;
        } else {
          loadingTokenSymbol.textContent = name || '未知代币';
        }
        loadingTokenAddress.innerHTML = `<a href="#" onclick="navigator.clipboard.writeText('${address}').then(() => { this.textContent = '✅ 已复制'; setTimeout(() => { this.textContent = '${address.slice(0, 8)}...${address.slice(-6)}'; }, 2000); }); return false;" style="color: #7f8c8d; text-decoration: none; cursor: pointer;" title="点击复制完整地址">${address.slice(0, 8)}...${address.slice(-6)}</a>`;
        tokenBasicInfo.style.display = 'block';

        // 生成 GMGN 链接 - 根据地址格式自动判断链类型
        let chain = (token.chain || 'bsc').toLowerCase();
        // 如果地址以 0x 开头（EVM 链），且 chain 是 sol，则修正为 bsc
        if (address.startsWith('0x') && chain === 'sol') {
          chain = 'bsc';
        }
        const gmgnUrl = `https://gmgn.ai/${chain}/token/${address}`;
        gmgnLink.querySelector('a').href = gmgnUrl;
        gmgnLink.style.display = 'block';
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
    this.hideResult();  // 重置旧的显示结果
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

    console.log('[NarrativeAnalyzer] displayResult called');
    console.log('[NarrativeAnalyzer] llmAnalysis:', llmAnalysis ? 'exists' : 'null');
    console.log('[NarrativeAnalyzer] stage3:', llmAnalysis?.stage3 ? 'exists' : 'null');

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

    // 6. 更新 Stage 3 卡片
    console.log('[NarrativeAnalyzer] About to call updateStage3Card');
    this.updateStage3Card(llmAnalysis);

    // 7. 更新数据源卡片
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

    // 规则验证结果（简洁显示，详细结果在"预检查"卡片）
    let rulesHtml = '';
    if (parsed.rulesValidationPassed) {
      rulesHtml = `
        <div style="margin-top: 12px;">
          <span style="font-size: 11px; padding: 4px 8px; background: #d4edda; color: #155724; border-radius: 4px;">✅ 规则验证通过</span>
          <span style="font-size: 11px; color: #999; margin-left: 6px;">（地址验证 + 名称匹配）</span>
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
    // 更新代币名字显示 - 始终显示 symbol
    const tokenNameElement = document.getElementById('tokenName');
    if (tokenNameElement && token) {
      const rawApiData = token.raw_api_data || {};
      const name = rawApiData.name || rawApiData.token_name || '';
      const symbol = token.symbol || rawApiData.symbol || rawApiData.token_symbol || '';

      // 始终显示 symbol，如果有 name 则一起显示
      if (name && symbol) {
        tokenNameElement.innerHTML = `${name} <span style="color: #666; font-size: 0.9em;">(${symbol})</span>`;
      } else if (symbol) {
        tokenNameElement.textContent = symbol;
      } else {
        tokenNameElement.textContent = name || '未知代币';
      }
    }
    // 更新评级徽章
    const ratingBadge = document.getElementById('ratingBadge');
    const ratingIcon = document.getElementById('ratingIcon');
    const ratingText = document.getElementById('ratingText');

    // 从 summary 获取最终评级
    const summary = llmAnalysis.summary || {};
    const category = summary.category || 'unrated';
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
    // 根据 llmAnalysis 中实际存在的阶段来判断，而不是依赖 debugInfo.analysisStage
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
    if (llmAnalysis.stage1) {
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
    if (llmAnalysis.stage2) {
      pathSteps.push({ label: 'Stage 2', status: 'completed', icon: '✅' });
    } else {
      pathSteps.push({ label: 'Stage 2', status: 'skip', icon: '○' });
    }

    // Stage 3
    if (llmAnalysis.stage3) {
      pathSteps.push({ label: 'Stage 3', status: 'completed', icon: '✅' });
    } else {
      pathSteps.push({ label: 'Stage 3', status: 'skip', icon: '○' });
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

    // 更新元数据 - 第二行：日期和实验ID
    const overviewMeta = document.getElementById('overviewMeta');
    const metaItems = [];
    if (meta?.analyzedAt) {
      metaItems.push(`📅 ${this.formatDate(meta.analyzedAt)}`);
    }
    if (meta?.sourceExperimentId) {
      metaItems.push(`🏷️ ${meta.sourceExperimentId.slice(0, 8)}`);
    }
    overviewMeta.innerHTML = metaItems.join('  |  ');

    // 更新链接区域 - 第一行：地址 + GMGN 链接
    const overviewMetaLinks = document.getElementById('overviewMetaLinks');
    let chain = (token?.chain || 'bsc').toLowerCase();
    // 如果地址以 0x 开头（EVM 链），且 chain 是 sol，则修正为 bsc
    if (this.currentAddress.startsWith('0x') && chain === 'sol') {
      chain = 'bsc';
    }
    const gmgnUrl = `https://gmgn.ai/${chain}/token/${this.currentAddress}`;
    const shortAddr = `${this.currentAddress.slice(0, 8)}...${this.currentAddress.slice(-6)}`;
    overviewMetaLinks.innerHTML = `
      <span style="display: inline-flex; align-items: center; gap: 12px;">
        <span>🔗 <a href="#" onclick="navigator.clipboard.writeText('${this.currentAddress}').then(() => { this.textContent = '✅ 已复制'; setTimeout(() => { this.textContent = '${shortAddr}'; }, 1500); }); return false;" style="color: inherit; text-decoration: none; cursor: pointer;" title="${this.currentAddress}">${shortAddr}</a></span>
        <span><a href="${gmgnUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: rgba(255,255,255,0.3); border-radius: 6px; text-decoration: none; font-size: 11px; color: white;"><img src="/static/gmgn.png" style="width: 14px; height: 14px;" alt="GMGN"> GMGN</a></span>
      </span>
    `;
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
    } else if (!isFail) {
      // 事件分析通过 - 显示事件详情
      // 适配新框架：数据直接在parsedOutput下
      // 旧框架：parsed.eventAnalysis.eventDescription
      // 新框架：parsed.eventDescription
      const eventDesc = parsed.eventDescription || parsed.eventAnalysis?.eventDescription || {};
      const eventClass = parsed.eventClassification || parsed.eventAnalysis?.eventClassification || {};
      const propMarkers = parsed.propertyMarkers || parsed.eventAnalysis?.propertyMarkers || {};

      // 获取事件类别名称
      const categoryName = eventClass.primaryCategoryName || eventDesc.类别 || eventClass.primaryCategory || '-';
      const confidence = eventClass.confidence || '-';

      // 构建显示内容
      resultHtml = `
        <div class="stage-result-box">
          <strong>✅ 事件定义成功</strong><br><br>
          <strong>事件主题：</strong>${eventDesc.eventTheme || eventDesc.主题 || '-'}<br>
          <strong>事件主体：</strong>${eventDesc.eventSubject || eventDesc.主体 || '-'}<br>
          <strong>事件类别：</strong>${categoryName}<br>
          <strong>置信度：</strong>${confidence}<br>
          <strong>时效性：</strong>${eventDesc.eventTiming || eventDesc.时效性 || '-'}<br>
          ${eventDesc.isLargeIP ? '<strong>🔥 超大IP事件</strong><br>' : ''}
        </div>
      `;

      // 如果有性质标记，显示出来
      if (propMarkers.discovery || propMarkers.marketing || propMarkers.speculative) {
        const markers = [];
        if (propMarkers.discovery) markers.push('发现型');
        if (propMarkers.marketing) markers.push('营销性');
        if (propMarkers.speculative) markers.push('推测性');
        if (markers.length > 0) {
          resultHtml += `
            <div class="stage-result-box" style="margin-top: 8px;">
              <strong>性质标记：</strong>${markers.join('、')}
            </div>
          `;
        }
      }

      // 显示关键实体
      if (eventDesc.keyEntities && Array.isArray(eventDesc.keyEntities)) {
        resultHtml += `
          <div class="stage-result-box" style="margin-top: 8px;">
            <strong>关键实体：</strong>${eventDesc.keyEntities.join('、')}
          </div>
        `;
      }

      // 显示关键数据
      if (eventDesc.keyData) {
        const keyData = eventDesc.keyData;
        const dataItems = [];
        if (keyData.heatLevel) dataItems.push(`热度：${keyData.heatLevel}`);
        if (keyData.spreadData) dataItems.push(`传播：${keyData.spreadData}`);
        if (keyData.anySpecificNumbers) dataItems.push(`数据：${keyData.anySpecificNumbers}`);
        if (dataItems.length > 0) {
          resultHtml += `
            <div class="stage-result-box" style="margin-top: 8px;">
              <strong>关键数据：</strong>${dataItems.join(' | ')}
            </div>
          `;
        }
      }
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

    // 检查是否通过/失败
    const pass = parsed.raw?.pass;
    const blockReason = parsed.raw?.blockReason;

    // 如果未通过，显示阻断原因
    let isFailed = pass === false;
    let failHtml = '';
    if (isFailed) {
      const categoryConfig = {
        'high': { icon: '🟢', text: '高质量' },
        'mid': { icon: '🟡', text: '中质量' },
        'low': { icon: '🔴', text: '低质量' },
        'fail': { icon: '⛔', text: '未通过' }
      };

      // 获取分量等级来确定显示文本
      const magnitudeLevel = parsed.raw?.magnitudeLevel || '-';
      const magnitudeText = {
        'S': 'S级（超大IP）',
        'A': 'A级（知名KOL/公众人物）',
        'B': 'B级（普通KOL）',
        'C': 'C级（普通人）',
        'D': 'D级（低热度）',
        'E': 'E级（极低热度）'
      };

      failHtml = `
        <div class="stage-result-box">
          <strong>🚫 Stage 2 阻断</strong><br>
          <span style="font-size: 13px; color: #666;">
            ${blockReason || '未达到评分标准'}
          </span><br><br>
          <span style="font-size: 12px; color: #999;">
            分量等级：${magnitudeText[magnitudeLevel] || magnitudeLevel}
          </span>
        </div>
      `;
    }

    const category = stage2.category || parsed.category || 'unrated';

    // 适配新框架：数据在 raw.categoryAnalysis 下
    const categoryAnalysis = parsed.raw?.categoryAnalysis || {};
    const totalScore = categoryAnalysis.totalScore || 0;
    const categoryName = categoryAnalysis.categoryName || '未知类别';
    const magnitudeLevel = categoryAnalysis.magnitudeLevel || '-';
    const magnitudeScore = categoryAnalysis.magnitudeScore || 0;
    const weightScore = categoryAnalysis.weightScore || 0;
    const timelinessScore = categoryAnalysis.timelinessScore || 0;
    const meaningfulness = categoryAnalysis.meaningfulness || '';
    const meaningfulnessReason = categoryAnalysis.meaningfulnessReason || '';

    // 阻断检查信息
    const blockChecks = parsed.raw?.blockChecks || {};
    const passedChecks = blockChecks.passedChecks || [];
    const hardBlocks = blockChecks.hardBlocks || [];
    const softBlocks = blockChecks.softBlocks || [];

    // 将A-E类转换为质量评级
    let qualityCategory = 'unrated';
    if (category === 'A' && totalScore >= 70) qualityCategory = 'high';
    else if (category === 'A' || category === 'B') qualityCategory = 'mid';
    else if (category === 'low') qualityCategory = 'low';

    // 评级显示
    const categoryConfig = {
      'high': { icon: '🟢', text: '高质量' },
      'mid': { icon: '🟡', text: '中质量' },
      'low': { icon: '🔴', text: '低质量' }
    };
    const config = categoryConfig[qualityCategory] || { icon: '⚪', text: '未评级' };

    // 分数详情
    let scoresHtml = '';
    scoresHtml = `
      <div class="score-detail">
        <div class="score-detail-header">
          <label>综合得分</label>
          <value>${totalScore}/100</value>
        </div>
        <div class="score-bar">
          <div class="score-bar-fill ${qualityCategory}" style="width: ${totalScore}%"></div>
        </div>
      </div>
    `;

    // 子维度分数（量级、权重、时效性）
    scoresHtml += `
      <div class="sub-scores">
        <div class="sub-score-item">
          <span class="sub-score-label">量级评分 (${magnitudeLevel}级)</span>
          <div class="sub-score-bar">
            <div class="sub-score-fill" style="width: ${magnitudeScore}%"></div>
          </div>
          <span class="sub-score-value">${magnitudeScore}</span>
        </div>
      </div>
      <div class="sub-scores">
        <div class="sub-score-item">
          <span class="sub-score-label">权重评分</span>
          <div class="sub-score-bar">
            <div class="sub-score-fill" style="width: ${weightScore}%"></div>
          </div>
          <span class="sub-score-value">${weightScore}</span>
        </div>
      </div>
      <div class="sub-scores">
        <div class="sub-score-item">
          <span class="sub-score-label">时效评分</span>
          <div class="sub-score-bar">
            <div class="sub-score-fill" style="width: ${timelinessScore}%"></div>
          </div>
          <span class="sub-score-value">${timelinessScore}</span>
        </div>
      </div>
    `;

    // 意义性分析
    if (meaningfulness || meaningfulnessReason) {
      scoresHtml += `
        <div style="margin-top: 12px; padding: 12px; background: ${meaningfulness === '有意义' ? '#d4edda' : '#f8f9fa'}; border-radius: 6px; font-size: 13px;">
          <strong>意义性判断：</strong>${meaningfulness || '未知'}
          ${meaningfulnessReason ? `<br><span style="color: #555;">${meaningfulnessReason}</span>` : ''}
        </div>
      `;
    }

    // 阻断检查信息
    if (hardBlocks.length > 0 || softBlocks.length > 0 || passedChecks.length > 0) {
      let checksHtml = '<div style="margin-top: 12px; padding: 12px; background: #f8f9fa; border-radius: 6px; font-size: 12px;"><strong>阻断检查：</strong>';
      if (hardBlocks.length > 0) {
        checksHtml += `<br><span style="color: #dc3545;">❌ 硬性阻断：${hardBlocks.join(', ')}</span>`;
      }
      if (softBlocks.length > 0) {
        checksHtml += `<br><span style="color: #ffc107;">⚠️ 软性阻断：${softBlocks.join(', ')}</span>`;
      }
      if (passedChecks.length > 0) {
        checksHtml += `<br><span style="color: #28a745;">✅ 通过检查：${passedChecks.join(', ')}</span>`;
      }
      checksHtml += '</div>';
      scoresHtml += checksHtml;
    }

    // 理由（如果有额外reasoning）
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

    // Stage 2 状态显示：通过/未通过
    let statusClass, statusIcon, statusText;
    if (isFailed) {
      statusClass = 'fail';
      statusIcon = '⛔';
      statusText = '未通过';
    } else if (pass === true) {
      statusClass = 'pass';
      statusIcon = '✅';
      statusText = '通过';
    } else {
      statusClass = 'skip';
      statusIcon = '○';
      statusText = '未知状态';
    }

    this.stage2CardBody.innerHTML = `
      <div class="stage-status ${statusClass}">
        <span>${statusIcon}</span>
        <span>${statusText}</span>
      </div>
      ${failHtml}
      ${scoresHtml}
      ${reasoningHtml}
      ${timingHtml}
      ${llmDetailsHtml}
    `;
  }

  updateStage3Card(llmAnalysis) {
    try {
      const stage3 = llmAnalysis.stage3;

      console.log('[NarrativeAnalyzer] updateStage3Card called, stage3:', stage3 ? 'exists' : 'null');
      console.log('[NarrativeAnalyzer] stage3CardBody element:', this.stage3CardBody);

      if (!stage3) {
        this.stage3CardBody.innerHTML = `
          <div class="stage-status skip">
            <span>⏭️</span>
            <span>未执行</span>
          </div>
          <div class="stage-result-box empty">
            ${llmAnalysis.stage2?.category === 'low' ? 'Stage 2 检测到低质量，跳过代币分析' : 'Stage 3 未执行'}
          </div>
        `;
        return;
      }

      const parsed = stage3.parsedOutput || {};
      const category = stage3.category || parsed.category || 'unrated';

      // 适配新框架：数据在 raw 下
      const rawData = parsed.raw || {};
      const totalScore = rawData.total_score || parsed.total_score || 0;
      const breakdown = rawData.breakdown || parsed.breakdown || {};
      const reasoning = rawData.reasoning || parsed.reasoning || '';

      console.log('[NarrativeAnalyzer] Stage 3 data:', { category, totalScore, breakdownKeys: Object.keys(breakdown) });

    // 评级显示
    const categoryConfig = {
      'high': { icon: '🟢', text: '高质量' },
      'mid': { icon: '🟡', text: '中质量' },
      'low': { icon: '🔴', text: '低质量' }
    };
    const config = categoryConfig[category] || { icon: '⚪', text: '未评级' };

    // 分数详情
    let scoresHtml = '';
    scoresHtml = `
      <div class="score-detail">
        <div class="score-detail-header">
          <label>综合得分</label>
          <value>${totalScore}/100</value>
        </div>
        <div class="score-bar">
          <div class="score-bar-fill ${category}" style="width: ${totalScore}%"></div>
        </div>
      </div>
    `;

    // 详细分解（事件、关联、质量）
    if (breakdown.eventScore !== undefined || breakdown.relevanceScore !== undefined || breakdown.qualityScore !== undefined) {
      scoresHtml += '<div class="sub-scores">';

      if (breakdown.eventScore !== undefined) {
        const eventWeight = (breakdown.eventWeight || 0.6) * 100;
        scoresHtml += `
          <div class="sub-score-item">
            <span class="sub-score-label">事件传播 (${eventWeight.toFixed(0)}%)</span>
            <div class="sub-score-bar">
              <div class="sub-score-fill" style="width: ${(breakdown.eventScore / 60 * 100)}%"></div>
            </div>
            <span class="sub-score-value">${breakdown.eventScore?.toFixed(1) || 0}</span>
          </div>
        `;
      }

      if (breakdown.relevanceScore !== undefined) {
        const relevanceWeight = (breakdown.relevanceWeight || 0.2) * 100;
        scoresHtml += `
          <div class="sub-score-item">
            <span class="sub-score-label">关联强度 (${relevanceWeight.toFixed(0)}%)</span>
            <div class="sub-score-bar">
              <div class="sub-score-fill" style="width: ${(breakdown.relevanceScore / 20 * 100)}%"></div>
            </div>
            <span class="sub-score-value">${breakdown.relevanceScore?.toFixed(1) || 0}/20</span>
          </div>
        `;
      }

      if (breakdown.qualityScore !== undefined) {
        const qualityWeight = (breakdown.qualityWeight || 0.2) * 100;
        scoresHtml += `
          <div class="sub-score-item">
            <span class="sub-score-label">名称质量 (${qualityWeight.toFixed(0)}%)</span>
            <div class="sub-score-bar">
              <div class="sub-score-fill" style="width: ${(breakdown.qualityScore / 20 * 100)}%"></div>
            </div>
            <span class="sub-score-value">${breakdown.qualityScore?.toFixed(1) || 0}/20</span>
          </div>
        `;
      }

      scoresHtml += '</div>';
    }

    // 计算说明
    if (breakdown.eventScore !== undefined && breakdown.relevanceScore !== undefined && breakdown.qualityScore !== undefined) {
      // 新格式：eventScore 是 Stage 2 原始分，需要乘以权重
      // relevanceScore 和 qualityScore 是最终得分（满分20），直接使用
      const eventPart = (breakdown.eventScore * (breakdown.eventWeight || 0.6)).toFixed(1);
      const relevancePart = breakdown.relevanceScore.toFixed(1);
      const qualityPart = breakdown.qualityScore.toFixed(1);

      scoresHtml += `
        <div style="margin-top: 12px; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 12px; text-align: center;">
          <strong>综合计算：</strong>事件分${breakdown.eventScore}×0.6=${eventPart} + 关联分${relevancePart} + 质量分${qualityPart} = 总分${totalScore}分
        </div>
      `;
    }

    // 理由
    const reasoningHtml = reasoning ? `
      <div style="margin-top: 16px; padding: 14px; background: #f8f9fa; border-radius: 8px; font-size: 14px; line-height: 1.6;">
        <strong>分析理由：</strong><br>
        ${reasoning}
      </div>
    ` : '';

    console.log('[NarrativeAnalyzer] Stage 3 HTML parts:', {
      hasScoresHtml: scoresHtml.length > 0,
      hasReasoningHtml: reasoningHtml.length > 0,
      scoresLength: scoresHtml.length,
      reasoningLength: reasoningHtml.length
    });

    // 耗时
    let timingHtml = '';
    if (stage3.startedAt && stage3.finishedAt) {
      const duration = this.calculateDuration(stage3.startedAt, stage3.finishedAt);
      timingHtml = `
        <div class="stage-timing">
          <div class="timing-item">
            <span>⏱️</span>
            <span>耗时: ${duration}</span>
          </div>
          <div class="timing-item">
            <span>🤖</span>
            <span>${stage3.model || 'Unknown'}</span>
          </div>
        </div>
      `;
    }

    // LLM详情区域
    let llmDetailsHtml = '';
    if (stage3.prompt || stage3.rawOutput || !stage3.prompt) {
      const hasPrompt = !!stage3.prompt;
      const hasRawOutput = !!stage3.rawOutput;
      const needsReanalyze = !hasPrompt && !hasRawOutput;

      let promptSection = '';
      if (hasPrompt) {
        promptSection = `
          <button class="expand-btn" onclick="this.nextElementSibling.classList.toggle('active'); this.textContent = this.nextElementSibling.classList.contains('active') ? '收起 Prompt' : '展开 Prompt'">
            ▼ 展开 Prompt
          </button>
          <div class="expand-content" style="max-height: 300px; overflow-y: auto;">
            ${this.escapeHtml(stage3.prompt)}
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
            ${JSON.stringify(stage3.rawOutput, null, 2)}
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
            ${promptSection}
            ${rawOutputSection}
          </div>
        `;
      }
    }

    console.log('[NarrativeAnalyzer] About to set stage3CardBody.innerHTML, element:', this.stage3CardBody);

    this.stage3CardBody.innerHTML = `
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

    console.log('[NarrativeAnalyzer] stage3CardBody.innerHTML set, length:', this.stage3CardBody.innerHTML.length);
  } catch (error) {
    console.error('[NarrativeAnalyzer] Error in updateStage3Card:', error);
    console.error('[NarrativeAnalyzer] Error stack:', error.stack);
  }
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
