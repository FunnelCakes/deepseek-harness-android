#!/data/data/com.termux/files/usr/bin/bash
# 启动 DeepSeek Harness (dsh) 原生 Web UI 并在本机 Chrome 打开
set -u

PORT=3080
URL="http://127.0.0.1:${PORT}"
BASE="$HOME/dsh"
LOG_FILE="$BASE/storage/dsh.log"
mkdir -p "$BASE/storage"
umask 077

# Android/Termux 无 bwrap/landlock，需放开沙箱权限模式才能执行 bash 工具
export DSH_PERMISSION_MODE=danger-full-access

if ! command -v dsh >/dev/null 2>&1; then
  echo "[dsh] 未找到 dsh 命令，请先运行 setup.sh"
  exit 1
fi

# 已在运行 -> 直接打开 Chrome
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${PORT}"; then
  echo "[dsh] 已在运行，直接打开 Chrome"
  termux-open-url "$URL"
  exit 0
fi

nohup dsh web >"$LOG_FILE" 2>&1 &
echo "[dsh] 启动中 (pid $!)... 日志: $LOG_FILE"

for i in $(seq 1 30); do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${PORT}"; then
    echo "[dsh] 就绪，打开 Chrome"
    termux-open-url "$URL"
    exit 0
  fi
  sleep 1
done

echo "[dsh] 启动超时，最近日志："
tail -20 "$LOG_FILE"
echo "[dsh] 若提示缺少模型密钥，请在 Web UI 的 Models 页面配置 DeepSeek API Key"
exit 1
