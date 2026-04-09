/**
 * 图片下载器
 * 下载图片并转换为 base64 格式，用于多模态 LLM 分析
 * 支持自动压缩以优化 LLM 处理效率和成本
 */

import sharp from 'sharp';

/**
 * 图片下载器
 */
export class ImageDownloader {

  // 默认配置
  static DEFAULT_OPTIONS = {
    maxSize: 5 * 1024 * 1024,     // 5MB（原始图片最大尺寸）
    timeout: 10000,                // 10秒
    maxRetries: 2,
    retryDelay: 1000,
    // 压缩配置
    compress: true,                // 是否启用压缩
    maxWidth: 1024,                // 压缩后最大宽度（保持文字可读性）
    maxHeight: 1024,               // 压缩后最大高度
    quality: 85,                   // JPEG/WebP 质量（1-100）
    targetSize: 100 * 1024,        // 目标压缩大小 100KB
    format: 'webp'                 // 压缩格式：'webp' 或 'jpeg'
  };

  /**
   * 下载图片并转换为 base64
   * @param {string} imageUrl - 图片 URL
   * @param {Object} options - 选项
   * @param {number} options.maxSize - 最大文件大小（字节），默认 5MB
   * @param {number} options.timeout - 请求超时（毫秒），默认 10000
   * @param {number} options.maxRetries - 最大重试次数，默认 2
   * @param {boolean} options.compress - 是否压缩图片，默认 true
   * @param {number} options.maxWidth - 压缩后最大宽度，默认 1024
   * @param {number} options.maxHeight - 压缩后最大高度，默认 1024
   * @param {number} options.quality - 压缩质量（1-100），默认 85
   * @param {number} options.targetSize - 目标压缩大小（字节），默认 100KB
   * @param {string} options.format - 压缩格式（'webp' 或 'jpeg'），默认 'webp'
   * @returns {Promise<{base64: string, mimeType: string, size: number, compressed?: boolean, originalSize?: number}|null>}
   */
  static async downloadAsBase64(imageUrl, options = {}) {
    const config = { ...this.DEFAULT_OPTIONS, ...options };

    console.log(`[ImageDownloader] 下载图片: ${imageUrl}`);

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        let result = await this._fetchAndConvert(imageUrl, config);
        const originalSize = result.size;

        // 执行压缩
        if (config.compress && result.size > config.targetSize) {
          result = await this._compressImage(result, config);
          const compressionRatio = ((1 - result.size / originalSize) * 100).toFixed(1);
          console.log(`[ImageDownloader] 压缩完成: ${originalSize} → ${result.size} 字节 (节省 ${compressionRatio}%)`);
        } else {
          console.log(`[ImageDownloader] 下载成功: ${result.size} 字节, ${result.mimeType}`);
        }

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
   * 压缩图片
   * @private
   * @param {Object} imageResult - 图片对象 { base64, mimeType, size }
   * @param {Object} config - 压缩配置
   * @returns {Promise<Object>} 压缩后的图片对象
   */
  static async _compressImage(imageResult, config) {
    try {
      // 将 base64 转换为 Buffer
      const imageBuffer = Buffer.from(imageResult.base64, 'base64');

      // 创建 sharp 实例
      let sharpInstance = sharp(imageBuffer);

      // 获取原始图片信息
      const metadata = await sharpInstance.metadata();

      // 计算缩放比例（保持宽高比）
      let width = metadata.width;
      let height = metadata.height;
      const aspectRatio = width / height;

      if (width > config.maxWidth || height > config.maxHeight) {
        if (aspectRatio > 1) {
          // 横向图片
          width = Math.min(width, config.maxWidth);
          height = Math.round(width / aspectRatio);
        } else {
          // 纵向图片
          height = Math.min(height, config.maxHeight);
          width = Math.round(height * aspectRatio);
        }
        sharpInstance = sharpInstance.resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // 根据配置选择输出格式
      const outputFormat = config.format || 'webp';
      const outputMimeType = outputFormat === 'webp' ? 'image/webp' : 'image/jpeg';

      // 设置压缩参数
      sharpInstance = sharpInstance.toFormat(outputFormat, {
        quality: config.quality,
        effort: 6  // WebP 压缩力度（0-6，越高越慢但压缩率更好）
      });

      // 执行压缩
      const compressedBuffer = await sharpInstance.toBuffer();
      const compressedBase64 = compressedBuffer.toString('base64');

      console.log(`[ImageDownloader] 图片压缩: ${metadata.width}x${metadata.height} → ${width}x${height}, ${imageResult.mimeType} → ${outputMimeType}`);

      return {
        base64: compressedBase64,
        mimeType: outputMimeType,
        size: compressedBuffer.length,
        dataUrl: `data:${outputMimeType};base64,${compressedBase64}`,
        compressed: true,
        originalSize: imageResult.size
      };

    } catch (error) {
      console.warn(`[ImageDownloader] 压缩失败，使用原始图片:`, error.message);
      return imageResult;
    }
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
