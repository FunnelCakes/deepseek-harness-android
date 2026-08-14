#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# 应用 JS 性能补丁到已安装的 dsh 运行时 bundle
# -----------------------------------------------------------------------------
# 内容（对应 patches/ 下 5 个补丁文件，基于 dsh 0.1.0-rc.6）：
#   01-apiproxy-history-slim.patch        history 响应瘦身：assistant/chunk 流过滤 +
#                                         超大 tool 结果/参数截断（冷重进不再随上下文变大而卡）
#   02-runtime-incremental-resync.patch   重连增量同步：保留窗口、静默补齐，
#                                         不再全量重建（从外部应用切回不再卡）
#   03-connection-history-schema.patch    history 响应新增 chunkFiltered 标志（配合 01/02）
#   04-frontend-static-cache.patch        静态资源 immutable 缓存头（整页重载不重复下载）
#   05-client-modules-cache.patch         插件 bundle immutable 缓存头（同上）
# 幂等：已应用的补丁自动跳过；版本不匹配时失败退出（提示先重跑 setup.sh）。
# =============================================================================
set -euo pipefail

DSH_PACKAGES_DIR="${DSH_PACKAGES_DIR:-/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PATCHES=(01-apiproxy-history-slim 02-runtime-incremental-resync 03-connection-history-schema 04-frontend-static-cache 05-client-modules-cache)

[ -d "$DSH_PACKAGES_DIR" ] || { echo "[apply-js-patches] 未找到 dsh 安装目录: $DSH_PACKAGES_DIR"; exit 1; }

applied=0; skipped=0; failed=0
for name in "${PATCHES[@]}"; do
  p="$HERE/patches/$name.patch"
  [ -f "$p" ] || { echo "  [FAIL] 缺少补丁文件 $p"; failed=$((failed+1)); continue; }
  if (cd "$DSH_PACKAGES_DIR" && patch -p1 -N -s -R --dry-run -i "$p" < /dev/null) >/dev/null 2>&1; then
    echo "  [skip] $name 已应用"
    skipped=$((skipped+1))
  elif (cd "$DSH_PACKAGES_DIR" && patch -p1 -N -s --dry-run -i "$p" < /dev/null) >/dev/null 2>&1; then
    if (cd "$DSH_PACKAGES_DIR" && patch -p1 -N -s -i "$p" < /dev/null) >/dev/null 2>&1; then
      echo "  [ok]   $name 已应用"
      applied=$((applied+1))
    else
      echo "  [FAIL] $name 应用失败"
      failed=$((failed+1))
    fi
  else
    echo "  [FAIL] $name 无法应用（dsh 版本不匹配？请先重跑 setup.sh 或升级后重试）"
    failed=$((failed+1))
  fi
done

echo "[apply-js-patches] 完成：应用 $applied，跳过 $skipped，失败 $failed"
[ "$failed" -eq 0 ]
