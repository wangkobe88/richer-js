const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../config/.env") });
const COMMIT = process.argv.includes("--commit");
const SRC = "4cb7267e-c694-4f27-9728-1cb265e7998d"; // v16 live both（GMGN 门首跑版）

async function main() {
  const { ExperimentFactory } = require("../src/trading-engine/factories/ExperimentFactory");
  const factory = ExperimentFactory.getInstance();
  const src = await factory.load(SRC);
  if (!src) throw new Error("源实验不存在: " + SRC);
  if (src.status !== "stopped") throw new Error("源实验未停止: " + src.status);
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (cfg.platform !== "both") throw new Error("源 platform != both: " + cfg.platform);
  if (cfg.virtual !== undefined) throw new Error("源带 virtual 段（应为 live）");
  if (!cfg.wallet?.executorId) throw new Error("源 wallet.executorId 缺失");
  const buy = cfg.strategiesConfig?.buyStrategies?.[0];
  if (!buy) throw new Error("买腿缺失");
  // 源形状锁定（v16 谱系：v15 策略 + live wallet）
  if (!buy.condition.includes("holderTrendSlope > 0") || !buy.condition.includes("marketCap < 15000"))
    throw new Error("源 fire condition 非 v15/v16 形状: " + buy.condition);
  if (buy.gmgnCheckCondition !== "gmgnBundlerWalletRatio <= 75")
    throw new Error("源 gmgnCheckCondition 非 v15/v16 形状: " + buy.gmgnCheckCondition);
  if (!(cfg.positionManagement?.perCardBNB > 0)) throw new Error("源 perCardBNB 缺失");
  const sellLegs = cfg.strategiesConfig?.sellStrategies || [];
  if (sellLegs.length !== 11) throw new Error("源卖腿数=" + sellLegs.length + " 期望 11");
  if (!(cfg.fourmemeWs?.visionPrefetch?.enabled === true)) throw new Error("源 visionPrefetch 未开");

  // ── v17 变更（单一变量：+数据预取门。YOYO号案 0xa16c…7777：fire→上链 10.4s 里
  //    叙事直调 8.95s 是延迟主体，vision 6.24s 最大单段；预取门过门即后台预取宣告
  //    推文+vision，fire 直调命中同缓存塌缩该段。门 0.5 = fire 门 1.5 的 1/3，
  //    实测 API 增量约 ×1.5-2）──
  cfg.fourmemeWs = { ...cfg.fourmemeWs, dataPrefetch: { enabled: true, condition: "buyVolumeBnb >= 0.5" } };

  cfg.name = "v17-实盘-both-数据预取门-1015";
  cfg.description = "v16 + 数据预取门（单一变量）：fourmemeWs.dataPrefetch {enabled, condition='buyVolumeBnb >= 0.5'}——"
    + "tick 买腿分支过热度门即后台预取宣告推文+首图 vision（缓存幂等），fire 时叙事直调命中同缓存"
    + "塌缩 fetch+vision 段（YOYO号案实测该段 8.95s）。vision 同图缓存 TTL 同批 90→730 天。"
    + "策略/钱包/其余 config 与 v16 4cb7267e 逐字一致。源=v16 4cb7267e";

  console.log("platform:", cfg.platform, "| perCardBNB:", cfg.positionManagement.perCardBNB, "| sellLegs:", sellLegs.length);
  console.log("fire:", buy.condition);
  console.log("dataPrefetch:", JSON.stringify(cfg.fourmemeWs.dataPrefetch));
  console.log("visionPrefetch:", JSON.stringify(cfg.fourmemeWs.visionPrefetch));
  console.log("wallet:", JSON.stringify(cfg.wallet));
  if (!COMMIT) { console.log("[dry-run]"); process.exit(0); }
  const c = await factory.createFromConfig(cfg, "live");
  console.log("V17_LIVE_ID=" + c.id);
  process.exit(0);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
