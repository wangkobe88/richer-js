/**
 * 加密工具类
 * 用于处理敏感数据（如私钥）的加密和解密
 * 从 rich-js 拷贝而来
 */

const crypto = require('crypto');
require('dotenv').config();

class CryptoUtils {
  constructor() {
    // 从环境变量获取加密密钥，如果不存在则生成一个
    this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateKey();

    // 确保密钥长度为32字节（256位）
    this.key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
    this.algorithm = 'aes-256-cbc';
    this.ivLength = 16;
  }

  /**
   * 生成加密密钥
   * @returns {string} base64编码的密钥
   */
  generateKey() {
    const key = crypto.randomBytes(32);
    console.warn('⚠️ 未设置ENCRYPTION_KEY环境变量，已生成临时密钥');
    console.log('🔑 请在.env文件中设置 ENCRYPTION_KEY=', key.toString('base64'));
    return key.toString('base64');
  }

  /**
   * 加密文本
   * @param {string} text - 要加密的文本
   * @returns {string} 加密后的文本（base64编码）
   */
  encrypt(text) {
    try {
      if (!text) return text;

      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // 将iv和加密数据合并，然后用base64编码
      const result = iv.toString('hex') + ':' + encrypted;
      return Buffer.from(result).toString('base64');
    } catch (error) {
      console.error('加密失败:', error);
      throw new Error('数据加密失败');
    }
  }

  /**
   * 解密文本
   * @param {string} encryptedText - 加密的文本（base64编码）
   * @returns {string} 解密后的文本
   */
  decrypt(encryptedText) {
    try {
      if (!encryptedText) return encryptedText;

      // 先base64解码
      const combined = Buffer.from(encryptedText, 'base64').toString('utf8');

      // 分离iv和加密数据
      const [ivHex, encrypted] = combined.split(':');
      const iv = Buffer.from(ivHex, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('解密失败:', error);
      throw new Error('数据解密失败');
    }
  }

  /**
   * 加密配置对象中的敏感字段
   * @param {Object} config - 配置对象
   * @returns {Object} 加密后的配置对象
   */
  encryptConfig(config) {
    if (!config || typeof config !== 'object') {
      return config;
    }

    const encryptedConfig = JSON.parse(JSON.stringify(config)); // 深拷贝

    // 加密钱包配置中的私钥
    if (encryptedConfig.wallet && encryptedConfig.wallet.privateKey) {
      encryptedConfig.wallet.privateKey = this.encrypt(encryptedConfig.wallet.privateKey);
      // 添加标记表示已加密
      encryptedConfig.wallet.privateKeyEncrypted = true;
    }

    return encryptedConfig;
  }

  /**
   * 解密配置对象中的敏感字段
   * @param {Object} config - 配置对象
   * @returns {Object} 解密后的配置对象
   */
  decryptConfig(config) {
    if (!config || typeof config !== 'object') {
      return config;
    }

    const decryptedConfig = JSON.parse(JSON.stringify(config)); // 深拷贝

    // 解密钱包配置中的私钥
    if (decryptedConfig.wallet &&
        decryptedConfig.wallet.privateKeyEncrypted &&
        decryptedConfig.wallet.privateKey) {
      try {
        decryptedConfig.wallet.privateKey = this.decrypt(decryptedConfig.wallet.privateKey);
      } catch (error) {
        console.error('私钥解密失败:', error);
        throw new Error('私钥解密失败，请检查ENCRYPTION_KEY配置');
      }
      // 移除加密标记
      delete decryptedConfig.wallet.privateKeyEncrypted;
    }

    return decryptedConfig;
  }
}

module.exports = {
  CryptoUtils
};
