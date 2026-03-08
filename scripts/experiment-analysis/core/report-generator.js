/**
 * 报告生成器
 * 生成各种格式的分析报告
 */

class ReportGenerator {
  constructor() {
    this.sections = [];
  }

  /**
   * 添加一个章节
   */
  addSection(title, content) {
    this.sections.push({ title, content });
    return this;
  }

  /**
   * 生成文本报告
   */
  generateText() {
    let output = '';
    const width = 70;

    // 标题
    output += '╔' + '═'.repeat(width - 2) + '╗\n';
    output += '║' + ' '.repeat(width - 2) + '║\n';

    this.sections.forEach((section, index) => {
      if (index === 0) {
        // 第一个作为主标题
        const centeredTitle = this.centerText(section.title, width - 2);
        output += '║' + centeredTitle + '║\n';
        output += '╚' + '═'.repeat(width - 2) + '╝\n\n';
      } else {
        // 其他作为章节标题
        const subTitle = ' ' + section.title + ' ';
        output += '╔' + '═'.repeat(width - 2) + '╗\n';
        output += '║' + this.centerText(subTitle, width - 2) + '║\n';
        output += '╚' + '═'.repeat(width - 2) + '╝\n\n';
      }

      // 内容
      output += section.content + '\n\n';
    });

    output += '═'.repeat(width) + '\n';
    return output;
  }

  /**
   * 生成JSON报告
   */
  generateJSON() {
    return JSON.stringify({
      sections: this.sections,
      generatedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * 生成HTML报告
   */
  generateHTML() {
    let html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>实验分析报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; background: #1a1a2e; color: #eee; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #4ade80; border-bottom: 2px solid #4ade80; padding-bottom: 10px; }
    h2 { color: #60a5fa; margin-top: 30px; border-left: 4px solid #60a5fa; padding-left: 10px; }
    .section { background: #16162a; padding: 20px; margin: 20px 0; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #0f0f1a; color: #4ade80; }
    tr:hover { background: #1f1f3a; }
    .positive { color: #4ade80; }
    .negative { color: #f87171; }
    .neutral { color: #9ca3af; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px; }
    .badge-high { background: #166534; color: #4ade80; }
    .badge-medium { background: #1e40af; color: #60a5fa; }
    .badge-low { background: #9a3412; color: #fb923c; }
    pre { background: #0f0f1a; padding: 15px; border-radius: 6px; overflow-x: auto; }
    code { font-family: 'Monaco', 'Menlo', monospace; font-size: 13px; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
    .stat-card { background: #0f0f1a; padding: 15px; border-radius: 8px; }
    .stat-label { color: #9ca3af; font-size: 14px; }
    .stat-value { font-size: 24px; font-weight: bold; margin-top: 5px; }
  </style>
</head>
<body>
  <div class="container">
`;

    this.sections.forEach((section, index) => {
      if (index === 0) {
        html += `<h1>${section.title}</h1>`;
      } else {
        html += `<h2>${section.title}</h2>`;
      }
      html += `<div class="section">${this.contentToHTML(section.content)}</div>`;
    });

    html += `
  </div>
</body>
</html>`;
    return html;
  }

  /**
   * 将文本内容转换为HTML
   */
  contentToHTML(content) {
    // 转换表格
    content = content.replace(/([│├┼│─\n]+[^\n]+\|[^\n]+\n?)+/g, (match) => {
      return this.textTableToHTML(match);
    });

    // 转换换行
    content = content.replace(/\n/g, '<br>');

    return content;
  }

  /**
   * 文本表格转HTML
   */
  textTableToHTML(text) {
    const lines = text.trim().split('\n').filter(l => l.trim() && !l.includes('─'));
    if (lines.length < 2) return text;

    const html = ['<table>'];

    // 表头
    const headers = lines[0].split('│').map(h => h.trim()).filter(h => h);
    html.push('<thead><tr>');
    headers.forEach(h => html.push(`<th>${h}</th>`));
    html.push('</tr></thead><tbody>');

    // 表体
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split('│').map(c => c.trim()).filter(c => c);
      html.push('<tr>');
      cells.forEach(c => {
        let className = '';
        if (c.includes('+') && c.includes('%')) className = 'positive';
        else if (c.includes('-') && c.includes('%')) className = 'negative';
        html.push(`<td class="${className}">${c}</td>`);
      });
      html.push('</tr>');
    }

    html.push('</tbody></table>');
    return html.join('');
  }

  /**
   * 居中文本
   */
  centerText(text, width) {
    const len = this.displayWidth(text);
    const padding = Math.max(0, width - len);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
  }

  /**
   * 计算显示宽度（中文字符占2个位置）
   */
  displayWidth(str) {
    let width = 0;
    for (const char of str) {
      width += (char >= '\u4e00' && char <= '\u9fa5') ? 2 : 1;
    }
    return width;
  }

  /**
   * 清空章节
   */
  clear() {
    this.sections = [];
    return this;
  }
}

module.exports = { ReportGenerator };
