/**
 * 图片下载器
 * 下载图片并转换为 base64 格式，用于多模态 LLM 分析
 * 支持自动压缩以优化 LLM 处理效率和成本
 */

// sharp 延迟导入，避免未安装时阻塞整个模块加载
let sharp = null;
async function getSharp() {
  if (sharp === null) {
    try {
      const mod = await import('sharp');
      sharp = mod.default || mod;
    } catch (e) {
      console.warn('[ImageDownloader] sharp 未安装，图片压缩功能不可用:', e.message);
      sharp = false;
    }
  }
  return sharp || null;
}

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
      const sharpLib = await getSharp();
      if (!sharpLib) {
        console.warn('[ImageDownloader] sharp 不可用，跳过压缩');
        return imageResult;
      }

      // 将 base64 转换为 Buffer
      const imageBuffer = Buffer.from(imageResult.base64, 'base64');

      // 创建 sharp 实例
      let sharpInstance = sharpLib(imageBuffer);

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
   * Jev 图片 API 归一化（dl-v2 形状，2026-10-26 图片直连架构）
   *
   * 硬限制镜像（docs.typesafe.ai/images——任一不符整个请求 400 无部分答案）：
   * PNG/JPEG 静态图 / 宽高各 280–1568px / 总像素 78,400–2,458,624 / 单文件 ≤16MiB；
   * API 剥 EXIF 且不应用 orientation → 必须 .rotate() 把像素转正。
   * 归一化策略：EXIF 转正 → 长边 >1568 等比缩 → 短边 <280 等比放大（宽高比
   * ≤1568/280≈5.6 时单次缩放可同时满足两界）→ 极端宽高比放大必破长边上界 →
   * 白底 letterbox 补短边（不裁内容）→ baseline JPEG q85。
   *
   * @param {Buffer} buffer - 原始图片字节（任意 sharp 可读格式）
   * @returns {Promise<{base64:string, mimeType:'image/jpeg', size:number, width:number, height:number}|null>}
   *   sharp 不可用 / 图片损坏 / 产物越界（理论不可能，fail-closed 防线）→ null（无图语义不冒充）
   */
  static async normalizeForJev(buffer) {
    const sharpLib = await getSharp();
    if (!sharpLib) {
      console.warn('[ImageDownloader] sharp 不可用，无法归一化 Jev 图片');
      return null;
    }

    const MIN_EDGE = 280;
    const MAX_EDGE = 1568;
    const MAX_PIXELS = 2458624; // 1568×1568（总像素上界，API 硬限）
    const MAX_BYTES = 16 * 1024 * 1024;

    try {
      const meta = await sharpLib(buffer).metadata();
      let width = meta.width;
      let height = meta.height;
      // orientation ≥5 = 旋转 90°/270°：rotate() 转正后宽高互换，先按转正后口径算
      if (meta.orientation && meta.orientation >= 5) { [width, height] = [height, width]; }
      if (!width || !height) return null;

      // 长边超界 → 等比缩进 1568 盒
      if (Math.max(width, height) > MAX_EDGE) {
        const scale = MAX_EDGE / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      // 短边不足 280：等比放大；极端宽高比（放大后长边破界）→ 白底补边到 280
      let extend = null;
      if (Math.min(width, height) < MIN_EDGE) {
        const scale = MIN_EDGE / Math.min(width, height);
        const scaledW = Math.round(width * scale);
        const scaledH = Math.round(height * scale);
        if (Math.max(scaledW, scaledH) <= MAX_EDGE) {
          width = scaledW;
          height = scaledH;
        } else if (width >= height) {
          // 极端横幅：等比缩到宽 1568（内容高 inner），上下补白到总高 280——
          // resize 目标=内容尺寸，extend 补白（fill 拉伸会破坏图内容）
          const inner = Math.max(1, Math.round(height * (MAX_EDGE / width)));
          const padTotal = MIN_EDGE - inner;
          const padTop = Math.floor(padTotal / 2);
          extend = { top: padTop, bottom: padTotal - padTop, left: 0, right: 0, background: '#ffffff' };
          width = MAX_EDGE;
          height = inner;
        } else {
          // 极端竖条：等比缩到高 1568（内容宽 inner），左右补白到总宽 280
          const inner = Math.max(1, Math.round(width * (MAX_EDGE / height)));
          const padTotal = MIN_EDGE - inner;
          const padLeft = Math.floor(padTotal / 2);
          extend = { top: 0, bottom: 0, left: padLeft, right: padTotal - padLeft, background: '#ffffff' };
          width = inner;
          height = MAX_EDGE;
        }
      }

      let pipeline = sharpLib(buffer)
        .rotate() // EXIF orientation 转正进像素（API 剥 EXIF 不自动应用）
        .resize(width, height, { fit: 'fill' }); // 等比缩放目标（fill 保精确界内）
      if (extend) pipeline = pipeline.extend(extend);
      const outBuffer = await pipeline
        .jpeg({ quality: 85, progressive: false }) // baseline JPEG（API 只收 PNG/JPEG）
        .toBuffer();

      // 产物越界二次校验（fail-closed 防线：越界图发出去=整个请求 400 无部分答案）
      const outMeta = await sharpLib(outBuffer).metadata();
      const w = outMeta.width, h = outMeta.height;
      if (w < MIN_EDGE || w > MAX_EDGE || h < MIN_EDGE || h > MAX_EDGE || w * h > MAX_PIXELS) {
        console.warn(`[ImageDownloader] 归一化产物越界 ${w}x${h}，放弃（无图语义）`);
        return null;
      }
      if (outBuffer.length > MAX_BYTES) {
        console.warn(`[ImageDownloader] 归一化产物 ${outBuffer.length} 字节超 16MiB，放弃`);
        return null;
      }

      return {
        base64: outBuffer.toString('base64'),
        mimeType: 'image/jpeg',
        size: outBuffer.length,
        width: w,
        height: h,
      };
    } catch (error) {
      console.warn('[ImageDownloader] Jev 图片归一化失败:', error.message);
      return null;
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
