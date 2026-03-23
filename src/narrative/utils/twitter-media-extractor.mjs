/**
 * Twitter 媒体提取器
 * 从推文数据中提取图片、视频等媒体信息
 */

/**
 * Twitter 媒体提取器
 */
export class TwitterMediaExtractor {

  /**
   * 从推文数据中提取图片 URL
   * @param {Object} tweetData - getTweetDetailGraphQL 返回的推文数据
   * @returns {Array<{url: string, media_key: string, width: number, height: number}>}
   */
  static extractImageUrls(tweetData) {
    if (!tweetData || !tweetData.media) {
      return [];
    }

    return tweetData.media.images || [];
  }

  /**
   * 从推文数据中提取视频信息
   * @param {Object} tweetData - getTweetDetailGraphQL 返回的推文数据
   * @returns {Array<{type: string, media_key: string}>}
   */
  static extractVideoInfo(tweetData) {
    if (!tweetData || !tweetData.media) {
      return [];
    }

    return tweetData.media.videos || [];
  }

  /**
   * 检查推文是否包含媒体
   * @param {Object} tweetData - getTweetDetailGraphQL 返回的推文数据
   * @returns {boolean}
   */
  static hasMedia(tweetData) {
    if (!tweetData || !tweetData.media) {
      return false;
    }
    return tweetData.media.has_media || false;
  }

  /**
   * 检查推文是否包含图片
   * @param {Object} tweetData - getTweetDetailGraphQL 返回的推文数据
   * @returns {boolean}
   */
  static hasImages(tweetData) {
    const images = this.extractImageUrls(tweetData);
    return images.length > 0;
  }

  /**
   * 检查推文是否包含视频
   * @param {Object} tweetData - getTweetDetailGraphQL 返回的推文数据
   * @returns {boolean}
   */
  static hasVideos(tweetData) {
    const videos = this.extractVideoInfo(tweetData);
    return videos.length > 0;
  }

  /**
   * 获取推文的媒体摘要
   * @param {Object} tweetData - getTweetDetailGraphQL 返回的推文数据
   * @returns {Object} 媒体摘要
   */
  static getMediaSummary(tweetData) {
    const images = this.extractImageUrls(tweetData);
    const videos = this.extractVideoInfo(tweetData);

    return {
      has_media: images.length > 0 || videos.length > 0,
      image_count: images.length,
      video_count: videos.length,
      first_image_url: images.length > 0 ? images[0].url : null
    };
  }
}
