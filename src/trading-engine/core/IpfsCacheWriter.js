/**
 * IpfsCacheWriter —— 语料补采 IPFS 结果写叙事侧缓存（2026-10-15 live 提速②b）
 *
 * 뮤오23 案：引擎侧语料补采（TokenCorpusEnricher）裸 fetch IPFS 解包出 metadata
 * 后即丢弃，叙事直调 ipfs 段对同一 URL 再解包一次（实测 miss 时 309-8051ms）。
 * 本 writer 把补采已拿到的 raw metadata JSON upsert 进 external_resource_cache
 * （resourceType='ipfs_metadata'，与叙事侧 fetchIpfsMetadata 同键同值形状）——
 * fire 直调 ipfs 段塌缩为一次 DB 读。upsert 顺带覆盖 markFailed 冷却行（把直调
 * 从 1h 冷却救出，额外收益）。
 *
 * 键与读侧严格对齐：key = normalizeIpfsRef(metaUrl)（两侧原始输入同为链上 meta
 * 字段原串；S3 直链/非 IPFS 形态返回 null 不写——叙事侧也不读该缓存）。
 * CJS 跨界叙事 ESM 用 dynamic import（_dataPrefetchFetchers 先例），结果模块级
 * 惰性缓存；只写成功值、不 markFailed（补采失败语义保持：不留冷却行）。
 * write 内部自 catch：缓存写失败只 warn，绝不影响补采链（性能增强 fail-open）。
 */

/** 惰性 ESM 依赖（首次 write 时加载一次；模块级共享） */
let _esm = null;

async function _loadEsm() {
  if (_esm) return _esm;
  const [{ normalizeIpfsRef }, { ExternalResourceCache }, { getCacheTTL }] = await Promise.all([
    import('../../narrative/utils/ipfs-metadata-fetcher.mjs'),
    import('../../narrative/db/ExternalResourceCache.mjs'),
    import('../../narrative/db/cache-ttl-config.mjs'),
  ]);
  _esm = { normalizeIpfsRef, ExternalResourceCache, getCacheTTL };
  return _esm;
}

/**
 * 创建 IPFS 缓存 writer
 * @param {Object|null} logger 引擎 logger（logger.warn(experimentId, tag, msg) 形状）；null=静默
 * @returns {{ write: (metaUrl: string, metadata: Object) => Promise<boolean> }}
 *          write 永不 reject：成功 true；非 IPFS 键/加载失败/DB 失败 false
 */
function createIpfsCacheWriter(logger = null) {
  return {
    async write(metaUrl, metadata) {
      try {
        if (!metaUrl || !metadata || typeof metadata !== 'object') return false;
        const { normalizeIpfsRef, ExternalResourceCache, getCacheTTL } = await _loadEsm();
        const key = normalizeIpfsRef(metaUrl);
        if (!key) return false; // S3 直链等非 IPFS 引用：叙事侧不读此缓存，不写
        const ttl = getCacheTTL('ipfs_metadata').ttl;
        const okResult = await ExternalResourceCache.set(key, 'ipfs_metadata', metadata, { ttl });
        if (!okResult) logger?.warn?.(null, 'IpfsCacheWriter', `缓存写入未成功 | ${key}`);
        return okResult;
      } catch (error) {
        logger?.warn?.(null, 'IpfsCacheWriter', `IPFS 缓存共用写入失败（不影响语料补采）| ${error.message}`);
        return false;
      }
    },
  };
}

module.exports = { createIpfsCacheWriter };
