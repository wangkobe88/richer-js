/**
 * 图片下载器
 * 下载图片并转换为 base64 格式，用于多模态 LLM 分析
 */

/**
 * 图片下载器
 */
export class ImageDownloader {

  // 默认配置
  static DEFAULT_OPTIONS = {
    maxSize: 5 * 1024 * 1024,  // 5MB
    timeout: 10000,              // 10秒
    maxRetries: 2,
    retryDelay: 1000
  };

  /**
   * 下载图片并转换为 base64
   * @param {string} imageUrl - 图片 URL
   * @param {Object} options - 选项
   * @param {number} options.maxSize - 最大文件大小（字节），默认 5MB
   * @param {number} options.timeout - 请求超时（毫秒），默认 10000
   * @param {number} options.maxRetries - 最大重试次数，默认 2
   * @returns {Promise<{base64: string, mimeType: string, size: number}|null>}
   */
  static async downloadAsBase64(imageUrl, options = {}) {
    const config = { ...this.DEFAULT_OPTIONS, ...options };

    console.log(`[ImageDownloader] 下载图片: ${imageUrl}`);

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await this._fetchAndConvert(imageUrl, config);
        console.log(`[ImageDownloader] 下载成功: ${result.size} 字节, ${result.mimeType}`);
        return result;

      } catch (error) {
        if (attempt === config.maxRetries) {
          console.error(`[ImageDownloader] 下载失败 (${attempt + 1}/${config.maxRetries + 1}):`, error.message);
          return null;
        }

        console.warn(`[ImageDownloader] 下载失败，重试 (${attempt + 1}/${config.maxRetries + 1}):`, error.message);
        await this._sleep(config.retryDelay * (attempt + 1));
      }
    }

    return null;
  }

  /**
   * 获取图片的 MIME 类型
   * @param {string} url - 图片 URL
   * @returns {string} MIME 类型
   */
  static getMimeType(url) {
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    const mimeTypes = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'image/jpeg';
  }

  /**
   * 下载并转换图片
   * @private
   */
  static async _fetchAndConvert(imageUrl, config) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    try {
      const response = await fetch(imageUrl, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const size = buffer.byteLength;

      // 检查文件大小
      if (size > config.maxSize) {
        throw new Error(`图片太大: ${(size / 1024 / 1024).toFixed(2)}MB > ${(config.maxSize / 1024 / 1024).toFixed(2)}MB`);
      }

      // 转换为 base64
      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = this.getMimeType(imageUrl);

      return {
        base64: base64,
        mimeType: mimeType,
        size: size,
        dataUrl: `data:${mimeType};base64,${base64}`
      };

    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * 延时函数
   * @private
   */
  static _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 批量下载图片
   * @param {Array<string>} imageUrls - 图片 URL 列表
   * @param {Object} options - 选项
   * @returns {Promise<Array<{url: string, base64: string, mimeType: string, size: number}|null>>}
   */
  static async batchDownload(imageUrls, options = {}) {
    console.log(`[ImageDownloader] 批量下载 ${imageUrls.length} 张图片`);

    const results = [];
    for (const url of imageUrls) {
      const result = await this.downloadAsBase64(url, options);
      results.push(result ? { url, ...result } : null);
      // 避免请求过快
      await this._sleep(200);
    }

    const successCount = results.filter(r => r !== null).length;
    console.log(`[ImageDownloader] 批量下载完成: 成功 ${successCount}/${imageUrls.length}`);

    return results;
  }
}
