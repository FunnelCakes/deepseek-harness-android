#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# DeepSeek Harness (dsh) 一键安装脚本 — Android / Termux
# -----------------------------------------------------------------------------
# 安装 DeepSeek 官方 agent harness (@deepseek-ai/dsh) 并在 Termux 上跑起来，
# 自动完成所有 Android 兼容修复：
#   1. 安装构建依赖 (cmake/clang/make/binutils/pkg-config/python/nodejs)
#   2. 修补 node-gyp 缓存的 common.gypi（修 node-pty 构建）
#   3. 用 android30 编译目标安装 dsh（修 koffi statx）+ 放行构建脚本
#   4. 修补 link() → rename()（华为/部分 ROM 禁 hardlink，会话/附件才能持久化）
#   5. 修补 subprocess 终端检测（android 视同 linux）
#   6. 安装 sharp WebAssembly 回退（android-arm64 无原生预编译）
#   7. 重建 /usr/bin/dsh 包装脚本（--expose-internals，HMR 必需）
#   8. 写入启动/停止脚本 + 权限模式配置
#
# 用法：
#   bash setup.sh
# 之后：
#   bash ~/dsh/start_dsh.sh     # 启动并拉起 Chrome
#   在 Web UI (http://127.0.0.1:3080) 的 Models 页配置 DeepSeek API Key
# =============================================================================
set -euo pipefail

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m[v]\033[0m %s\n' "$*"; }

DSH_NPM="@deepseek-ai/dsh"
DSH_DIR="/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh"
INSTALL_DIR="$HOME/dsh"

# ---------------------------------------------------------------- 1/8 依赖
info "1/8 安装构建依赖 (cmake clang make binutils pkg-config python nodejs)"
pkg update -y >/dev/null 2>&1 || true
pkg install -y cmake clang make binutils pkg-config python nodejs

command -v node >/dev/null 2>&1 || { warn "node 未安装，重试安装 nodejs..."; pkg install -y nodejs; }
NODE_VER="$(node -v | sed 's/^v//')"
info "Node.js v${NODE_VER}"

# ------------------------------------------------------- 2/8 准备 gyp 补丁
info "2/8 首次安装以填充 node-gyp 缓存（node-pty 原生构建会失败，属预期）"
# node-gyp 首次构建会把 node headers 解压到缓存，其中 common.gypi 引用了
# android_ndk_path 变量；Termux 无 NDK 该变量未定义 → 必须修补缓存文件。
# 先触发一次缓存填充（失败无妨），随后打补丁再正式安装。
CFLAGS="-target aarch64-linux-android30" CXXFLAGS="-target aarch64-linux-android30" \
  npm install -g --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs "$DSH_NPM" \
  >/dev/null 2>&1 || true

GYP_GIPI="$HOME/.cache/node-gyp/$NODE_VER/include/node/common.gypi"
if [ -f "$GYP_GIPI" ]; then
  info "修补 common.gypi: 定义 android_ndk_path 为空（修 node-pty 的 Undefined variable 错误）"
  python3 - "$GYP_GIPI" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
if "'android_ndk_path%': ''" not in s:
    s = s.replace("'variables': {", "'variables': {\n    'android_ndk_path%': '',", 1)
    open(p, 'w', encoding='utf-8').write(s)
print("  patched common.gypi")
PY
else
  warn "未找到 $GYP_GIPI，请确认 node 已安装；可先手动跑一次 `npm i -g @deepseek-ai/dsh` 填充缓存"
fi

# ------------------------------------------------------------- 3/8 正式安装
info "3/8 用 android30 编译目标正式安装 dsh（修 koffi statx）"
CFLAGS="-target aarch64-linux-android30" CXXFLAGS="-target aarch64-linux-android30" \
  npm install -g --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs "$DSH_NPM"
"$DSH_DIR/node_modules/node-pty/build/Release/pty.node" 2>/dev/null || true
test -f "$DSH_DIR/node_modules/node-pty/build/Release/pty.node" && ok "node-pty 编译产物就位"
test -f "$DSH_DIR/node_modules/koffi/build/koffi/android_arm64/koffi.node" && ok "koffi 编译产物就位"

# ------------------------------------------------------- 4/8 后端兼容补丁
info "4/8 后端兼容补丁"

# 4a: 会话持久化 link→rename（Android 禁 hardlink）
SJ="$DSH_DIR/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js"
if grep -q "rename(tmp, finalPath)" "$SJ" 2>/dev/null; then
  ok "  session-persistence 已修补"
else
  python3 - "$SJ" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('import { link, mkdir,', 'import { mkdir,')
s = s.replace('realpath, rm,', 'realpath, rename, rm,')
s = s.replace('await link(tmp, finalPath);', 'await rename(tmp, finalPath);')
open(p, 'w', encoding='utf-8').write(s)
print("  patched session-persistence-jsonl (link→rename)")
PY
fi

# 4b: 附件存储 link→rename
AL="$DSH_DIR/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js"
if grep -q "rename(temporary, target)" "$AL" 2>/dev/null; then
  ok "  attachment-local 已修补"
else
  python3 - "$AL" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('import { chmod, link, mkdir,', 'import { chmod, mkdir,')
s = s.replace('readFile, unlink }', 'readFile, rename, unlink }')
s = s.replace('await link(temporary, target);', 'await rename(temporary, target);')
open(p, 'w', encoding='utf-8').write(s)
print("  patched attachment-local (link→rename)")
PY
fi

# 4c: subprocess 终端检测 android 视同 linux
SP="$DSH_DIR/node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js"
if grep -q 'platform === "android"' "$SP" 2>/dev/null; then
  ok "  subprocess-local 已修补"
else
  python3 - "$SP" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace(
  'if (platform === "linux") return new LinuxProcessInspector(arch, internals);',
  'if (platform === "linux" || platform === "android") return new LinuxProcessInspector(arch, internals);')
open(p, 'w', encoding='utf-8').write(s)
print("  patched subprocess-local (android→linux)")
PY
fi

# ------------------------------------------------------ 5/8 sharp wasm 回退
info "5/8 安装 sharp WebAssembly 回退（android-arm64 无原生预编译）"
SHARP_VER="$(node -e "console.log(require('$DSH_DIR/node_modules/sharp/package.json').version)" 2>/dev/null || echo 0.35.3)"
if [ -d "$DSH_DIR/node_modules/@img/sharp-wasm32" ]; then
  ok "  sharp-wasm32 已就位 (v${SHARP_VER})"
else
  SWTMP="$(mktemp -d)"
  cd "$SWTMP"
  npm init -y >/dev/null 2>&1
  npm install "@img/sharp-wasm32@$SHARP_VER" >/dev/null 2>&1
  mkdir -p "$DSH_DIR/node_modules/@img"
  cp -r node_modules/@img/sharp-wasm32 "$DSH_DIR/node_modules/@img/"
  cp -r node_modules/@emnapi "$DSH_DIR/node_modules/" 2>/dev/null || true
  cd "$HOME"
  rm -rf "$SWTMP"
  ok "  sharp-wasm32@${SHARP_VER} 已安装"
fi

# ------------------------------------------------------ 6/8 dsh 包装脚本
info "6/8 重建 /usr/bin/dsh 包装脚本（--expose-internals，HMR 必需）"
rm -f /data/data/com.termux/files/usr/bin/dsh
cat > /data/data/com.termux/files/usr/bin/dsh <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
exec node --expose-internals /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"
EOF
chmod +x /data/data/com.termux/files/usr/bin/dsh
dsh --version && ok "dsh $(dsh --version) 可用"

# ----------------------------------------------------- 7/8 启动/停止脚本
info "7/8 写入启动/停止脚本到 $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/storage"
cp "$(dirname "$0")/start_dsh.sh" "$INSTALL_DIR/start_dsh.sh"
cp "$(dirname "$0")/stop_dsh.sh"  "$INSTALL_DIR/stop_dsh.sh"
chmod +x "$INSTALL_DIR/start_dsh.sh" "$INSTALL_DIR/stop_dsh.sh"

# 权限模式：Android 上 bwrap/landlock 命名空间沙箱不可用，bash 工具需
# danger-full-access 才能执行。写入 profile 配置层 + 启动脚本环境变量双保险。
PROFILE_PATCH="$HOME/.dsh/profiles/web/cordis.patch.yml"
mkdir -p "$(dirname "$PROFILE_PATCH")"
if ! grep -q "danger-full-access" "$PROFILE_PATCH" 2>/dev/null; then
  cat > "$PROFILE_PATCH" <<'YAML'
# Android/Termux：bwrap/landlock 命名空间沙箱不可用，需放开权限模式才能执行 bash 工具
- id: sandbox-policy
  config:
    mode: danger-full-access
YAML
  ok "  权限模式已写入 $PROFILE_PATCH"
fi

# ------------------------------------------------------- 8/8 前端适配(可选)
if [ -f "$(dirname "$0")/apply-frontend.sh" ]; then
  info "8/8 应用前端移动端适配"
  bash "$(dirname "$0")/apply-frontend.sh"
fi

# ---------------------------------------------------------------- 9/9 完成
info "9/9 完成 🎉"
cat <<EOF

安装完成！接下来：
  1) 启动服务:    bash ~/dsh/start_dsh.sh
  2) 打开 Chrome: http://127.0.0.1:3080
  3) 在 Web UI 的 Models 页面填入 DeepSeek API Key
  4) 停止服务:    bash ~/dsh/stop_dsh.sh

注意：
  - 服务只监听 127.0.0.1（本机），不走局域网。
  - API Key 存于 ~/.dsh/.credentials.yaml（0600 权限），不进日志。
  - danger-full-access 关闭了进程沙箱（Android 无替代），仅建议个人设备使用。
  - 升级 dsh 或 Node 后需重跑本脚本。
EOF
