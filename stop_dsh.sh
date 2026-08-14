#!/data/data/com.termux/files/usr/bin/bash
# 停止 DeepSeek Harness (dsh) Web 服务
if pkill -f "deepseek-ai/dsh/lib/bin.js" 2>/dev/null; then
  echo "[dsh] 已停止"
else
  echo "[dsh] 未发现运行中的 dsh"
fi
