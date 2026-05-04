/**
 * 加密工具类
 * 用于处理敏感数据（如私钥）的加密和解密
 *
 * v2: 使用随机 salt 增强安全性，兼容旧格式数据
 */

const crypto = require('crypto');
require('dotenv').config({ path: '../../config/.env' });

class CryptoUtils {
  constructor() {
    this.encryptionKey = process.env.ENCRYPTION_KEY || this.generateKey();
    this.algorithm = 'aes-256-cbc';
    this.ivLength = 16;
    this.saltLength = 16;
  }

  /**
   * 生成加密密钥
   * @returns {string} base64编码的密钥
   */
  generateKey() {
    const key = crypto.randomBytes(32);
    console.warn('⚠️ 未设置ENCRYPTION_KEY环境变量，已生成临时密钥');
    console.warn('🔑 请在.env文件中设置 ENCRYPTION_KEY');
    return key.toString('base64');
  }

  /**
   * 根据 salt 派生加密密钥
   * @param {Buffer|string} salt - 盐值
   * @returns {Buffer} 派生密钥
   */
  _deriveKey(salt) {
    return crypto.scryptSync(this.encryptionKey, salt, 32);
  }

  /**
   * 加密文本
   * @param {string} text - 要加密的文本
   * @returns {string} 加密后的文本（base64编码）
   * 格式: base64(salt_hex:iv_hex:encrypted_hex)
   */
  encrypt(text) {
    try {
      if (!text) return text;

      const salt = crypto.randomBytes(this.saltLength);
      const key = this._deriveKey(salt);
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);

      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const result = salt.toString('hex') + ':' + iv.toString('hex') + ':' + encrypted;
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
   * 兼容旧格式 base64(iv_hex:encrypted_hex) 和新格式 base64(salt_hex:iv_hex:encrypted_hex)
   */
  decrypt(encryptedText) {
    try {
      if (!encryptedText) return encryptedText;

      const combined = Buffer.from(encryptedText, 'base64').toString('utf8');
      const parts = combined.split(':');

      let salt, ivHex, encrypted;
      if (parts.length === 3) {
        // 新格式: salt:iv:encrypted
        [salt, ivHex, encrypted] = parts;
      } else if (parts.length === 2) {
        // 旧格式: iv:encrypted (兼容)，salt 固定为 'salt'
        [ivHex, encrypted] = parts;
        salt = 'salt';
      } else {
        throw new Error('无效的加密数据格式');
      }

      const saltBuf = (salt === 'salt') ? salt : Buffer.from(salt, 'hex');
      const ivBuf = Buffer.from(ivHex, 'hex');
      const key = this._deriveKey(saltBuf);

      const decipher = crypto.createDecipheriv(this.algorithm, key, ivBuf);
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

    const encryptedConfig = JSON.parse(JSON.stringify(config));

    if (encryptedConfig.wallet && encryptedConfig.wallet.privateKey) {
      encryptedConfig.wallet.privateKey = this.encrypt(encryptedConfig.wallet.privateKey);
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

    const decryptedConfig = JSON.parse(JSON.stringify(config));

    if (decryptedConfig.wallet &&
        decryptedConfig.wallet.privateKeyEncrypted &&
        decryptedConfig.wallet.privateKey) {
      try {
        decryptedConfig.wallet.privateKey = this.decrypt(decryptedConfig.wallet.privateKey);
      } catch (error) {
        console.error('私钥解密失败:', error);
        throw new Error('私钥解密失败，请检查ENCRYPTION_KEY配置');
      }
      delete decryptedConfig.wallet.privateKeyEncrypted;
    }

    return decryptedConfig;
  }
}

module.exports = {
  CryptoUtils
};
