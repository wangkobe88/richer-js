/**
 * 叙事分析页面逻辑
 */

class NarrativeAnalyzer {
  constructor() {
    this.addressInput = document.getElementById('addressInput');
    this.analyzeBtn = document.getElementById('analyzeBtn');
    this.reanalyzeBtn = document.getElementById('reanalyzeBtn');
    this.errorSection = document.getElementById('errorSection');
    this.loadingSection = document.getElementById('loadingSection');
    this.resultSection = document.getElementById('resultSection');
    this.rawDataToggle = document.getElementById('rawDataToggle');
    this.rawDataContent = document.getElementById('rawDataContent');
    this.currentAddress = null;

    // 调试信息元素
    this.twitterDataToggle = document.getElementById('twitterDataToggle');
    this.llmInputToggle = document.getElementById('llmInputToggle');
    this.llmOutputToggle = document.getElementById('llmOutputToggle');
    this.debugContent = document.getElementById('debugContent');
    this.twitterDataBox = document.getElementById('twitterDataBox');
    this.llmInputBox = document.getElementById('llmInputBox');
    this.llmOutputBox = document.getElementById('llmOutputBox');
    this.twitterDataContent = document.getElementById('twitterDataContent');
    this.llmInputContent = document.getElementById('llmInputContent');
    this.llmOutputContent = document.getElementById('llmOutputContent');

    this.init();
  }

  init() {
    this.analyzeBtn.addEventListener('click', () => this.analyze());
    this.reanalyzeBtn.addEventListener('click', () => this.reanalyze());
    this.rawDataToggle.addEventListener('click', () => this.toggleRawData());

    // 调试信息按钮
    this.twitterDataToggle.addEventListener('click', () => this.toggleDebugSection('twitter'));
    this.llmInputToggle.addEventListener('click', () => this.toggleDebugSection('llmInput'));
    this.llmOutputToggle.addEventListener('click', () => this.toggleDebugSection('llmOutput'));

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

    try {
      const response = await fetch('/api/narrative/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address })
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

  async reanalyze() {
    if (!this.currentAddress) {
      return;
    }

    this.hideError();
    this.showLoading();

    try {
      // 创建超时控制器（90秒超时）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      const response = await fetch(`/api/narrative/reanalyze/${this.currentAddress}`, {
        method: 'POST',
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
    const { token, twitter, llmAnalysis, meta } = data;

    // 调试日志
    console.log('[NarrativeAnalyzer] displayResult called');
    console.log('[NarrativeAnalyzer] meta:', meta);

    // 显示代币信息
    document.getElementById('tokenSymbol').textContent = token.symbol || '-';
    document.getElementById('tokenAddress').textContent = token.address || '-';

    // 显示LLM结果
    const llmResultDiv = document.getElementById('llmResult');
    llmResultDiv.className = 'llm-result ' + (llmAnalysis.category || 'unrated');

    const categoryMap = {
      'high': '🟢 高质量',
      'mid': '🟡 中质量',
      'low': '🔴 低质量',
      'unrated': '⚪ 未评级'
    };

    document.getElementById('llmCategory').textContent =
      categoryMap[llmAnalysis.category] || llmAnalysis.category;

    // 显示分数
    const summary = llmAnalysis.summary || {};
    const scoresDiv = document.getElementById('llmScores');
    if (summary.total_score) {
      scoresDiv.innerHTML = `
        <div class="score-item">
          <div class="score-label">总分</div>
          <div class="score-value">${summary.total_score}</div>
        </div>
      `;
      if (summary.credibility_score !== undefined) {
        scoresDiv.innerHTML += `
          <div class="score-item">
            <div class="score-label">叙事背景</div>
            <div class="score-value">${summary.credibility_score}</div>
          </div>
        `;
      }
      if (summary.virality_score !== undefined) {
        scoresDiv.innerHTML += `
          <div class="score-item">
            <div class="score-label">传播力</div>
            <div class="score-value">${summary.virality_score}</div>
          </div>
        `;
      }
    } else {
      scoresDiv.innerHTML = '';
    }

    // 显示理由
    document.getElementById('llmReasoning').textContent =
      summary.reasoning || '暂无分析理由';

    // 显示推文
    const twitterCard = document.getElementById('twitterCard');
    if (twitter && twitter.text) {
      twitterCard.style.display = 'block';
      document.getElementById('twitterContent').textContent = twitter.text;
      document.getElementById('twitterMeta').textContent =
        `作者: ${twitter.author_screen_name || twitter.author_name || '未知'} | ` +
        `发布时间: ${this.formatDate(twitter.created_at) || '未知'}`;
    } else {
      twitterCard.style.display = 'none';
    }

    // 显示原始数据
    document.getElementById('rawDataContent').textContent =
      JSON.stringify(token.raw_api_data, null, 2);
    this.rawDataToggle.textContent = '显示原始数据';
    this.rawDataContent.classList.remove('active');

    // 显示调试信息（推文数据、LLM输入、LLM输出）
    // 这些信息需要从后端返回，如果有的话
    this.updateDebugInfo(data);

    // 显示元数据
    const metaInfo = [];
    if (meta) {
      if (meta.fromCache) {
        metaInfo.push('来自缓存');
      }
      if (meta.analyzedAt) {
        metaInfo.push(`分析时间: ${this.formatDate(meta.analyzedAt)}`);
      }
      if (meta.promptVersion) {
        metaInfo.push(`Prompt版本: ${meta.promptVersion}`);
      }
    }
    // 确保 metaInfo 至少显示时间信息
    const metaText = metaInfo.length > 0 ? metaInfo.join(' | ') : `分析时间: ${this.formatDate(new Date().toISOString())}`;
    console.log('[NarrativeAnalyzer] metaInfo text:', metaText);

    const metaInfoElement = document.getElementById('metaInfo');
    if (metaInfoElement) {
      metaInfoElement.textContent = metaText;
    } else {
      console.error('[NarrativeAnalyzer] metaInfo element not found!');
    }

    this.showResult();
  }

  toggleRawData() {
    this.rawDataContent.classList.toggle('active');
    if (this.rawDataContent.classList.contains('active')) {
      this.rawDataToggle.textContent = '隐藏原始数据';
    } else {
      this.rawDataToggle.textContent = '显示原始数据';
    }
  }

  showLoading() {
    this.loadingSection.classList.add('active');
    this.analyzeBtn.disabled = true;
    if (this.reanalyzeBtn) {
      this.reanalyzeBtn.disabled = true;
    }
  }

  hideLoading() {
    this.loadingSection.classList.remove('active');
    this.analyzeBtn.disabled = false;
    if (this.reanalyzeBtn) {
      this.reanalyzeBtn.disabled = false;
    }
  }

  showResult() {
    this.resultSection.classList.add('active');
  }

  hideResult() {
    this.resultSection.classList.remove('active');
  }

  showError(message) {
    this.errorSection.textContent = message;
    this.errorSection.classList.add('active');
  }

  hideError() {
    this.errorSection.classList.remove('active');
  }

  updateDebugInfo(data) {
    // 显示推文数据
    if (data.twitter) {
      this.twitterDataContent.textContent = JSON.stringify(data.twitter, null, 2);
    } else {
      this.twitterDataContent.textContent = '无推文数据';
    }

    // 显示LLM输入
    if (data.debugInfo && data.debugInfo.promptUsed) {
      this.llmInputContent.textContent = data.debugInfo.promptUsed;
    } else {
      this.llmInputContent.textContent = 'LLM输入未返回（可能是缓存结果）';
    }

    // 显示LLM输出
    if (data.llmAnalysis && data.llmAnalysis.rawOutput) {
      this.llmOutputContent.textContent = JSON.stringify(data.llmAnalysis.rawOutput, null, 2);
    } else {
      this.llmOutputContent.textContent = 'LLM输出未返回';
    }
  }

  toggleDebugSection(section) {
    this.debugContent.classList.add('active');

    if (section === 'twitter') {
      this.twitterDataBox.style.display = this.twitterDataBox.style.display === 'none' ? 'block' : 'none';
      this.twitterDataToggle.textContent = this.twitterDataBox.style.display === 'none' ? '显示推文数据' : '隐藏推文数据';
    } else if (section === 'llmInput') {
      this.llmInputBox.style.display = this.llmInputBox.style.display === 'none' ? 'block' : 'none';
      this.llmInputToggle.textContent = this.llmInputBox.style.display === 'none' ? '显示LLM输入' : '隐藏LLM输入';
    } else if (section === 'llmOutput') {
      this.llmOutputBox.style.display = this.llmOutputBox.style.display === 'none' ? 'block' : 'none';
      this.llmOutputToggle.textContent = this.llmOutputBox.style.display === 'none' ? '显示LLM输出' : '隐藏LLM输出';
    }
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('zh-CN');
    } catch {
      return dateStr;
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  new NarrativeAnalyzer();
});
