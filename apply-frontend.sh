#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# 应用前端移动端适配到 dsh 的 index.html
# -----------------------------------------------------------------------------
# 注入内容：
#   1. viewport meta 加 viewport-fit=cover, interactive-widget=resizes-content
#   2. <style id="dsh-mobile-adapt">（来自 patches/mobile.css）
#   3. 移动端 JS（来自 patches/mobile.js）：AbortSignal.any polyfill、
#      tooltip 气泡重吸附、触摸松手销毁、抽屉点击遮罩关闭、
#      子代理下拉/上下文用量面板的 fixed 视口内重定位
#   4. manifest display: fullscreen → standalone（PWA 键盘跟随必需）：
#      fullscreen 沉浸模式下键盘弹出不收缩视口、无几何信号，composer 被盖住；
#      standalone 恢复系统栏与正常键盘行为，输入框随键盘上移（实测验证）。
# 幂等：已注入且内容一致则跳过；patches 内容变化时原地刷新，无需先删旧标签。
# =============================================================================
set -euo pipefail

HTML="${1:-/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CSS_FILE="$HERE/patches/mobile.css"
JS_FILE="$HERE/patches/mobile.js"

[ -f "$HTML" ] || { echo "[apply-frontend] 未找到 index.html: $HTML"; exit 1; }
[ -f "$CSS_FILE" ] && [ -f "$JS_FILE" ] || { echo "[apply-frontend] 缺少 patches/mobile.css 或 patches/mobile.js"; exit 1; }

python3 - "$HTML" "$CSS_FILE" "$JS_FILE" <<'PY'
import sys, re
html, cssf, jsf = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(html, encoding='utf-8').read()
css = open(cssf, encoding='utf-8').read().rstrip()
js = open(jsf, encoding='utf-8').read().rstrip()

changed = []

# 1) viewport meta
if 'interactive-widget' not in s:
    old = '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    new = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />'
    if old in s:
        s = s.replace(old, new)
        changed.append('viewport meta')
    else:
        print('  [skip] viewport meta 已处理或格式未知')

# 2) <style id="dsh-mobile-adapt">：已存在则原地刷新内容，否则注入
#    注意 css 头注释里也含 <style id="dsh-mobile-adapt"> 字样，须用完整开标签定位；
#    比较与替换都包含 </style> 闭合标签，避免残留多余闭合。
STYLE_ID = 'dsh-mobile-adapt'
CLOSE = '</style>'
style = '<style id="%s">\n%s\n    %s' % (STYLE_ID, css, CLOSE)
if STYLE_ID in s:
    start = s.index('<style id="%s">' % STYLE_ID)
    end = s.index(CLOSE, start)
    if s[start:end + len(CLOSE)] != style:
        s = s[:start] + style + s[end + len(CLOSE):]
        changed.append('mobile CSS (updated)')
    else:
        print('  [skip] dsh-mobile-adapt 已是最新')
elif '<title>DeepSeek Harness</title>' in s:
    s = s.replace('<title>DeepSeek Harness</title>', '<title>DeepSeek Harness</title>\n    ' + style, 1)
    changed.append('mobile CSS')
else:
    print('  [skip] 未找到 <title> 注入点')

# 3) 移动端 JS：已存在（含 polyfill 标记）则原地刷新内容，否则在 module 脚本前注入
MARKER = 'AbortSignal.any polyfill'
script = '<script>\n' + js + '\n    </script>'
if MARKER in s:
    target = None
    for m in re.finditer(r'<script>[\s\S]*?</script>', s):
        if MARKER in m.group(0):
            target = m
            break
    if target is not None:
        if target.group(0) != script:
            s = s[:target.start()] + script + s[target.end():]
            changed.append('mobile JS (updated)')
        else:
            print('  [skip] mobile JS 已是最新')
    else:
        print('  [skip] 找到标记但未找到 <script> 块，跳过')
elif '<script type="module"' in s:
    s = s.replace('<script type="module"', script + '\n    <script type="module"', 1)
    changed.append('mobile JS')
else:
    print('  [skip] 未找到 <script type="module"> 注入点')

open(html, 'w', encoding='utf-8').write(s)
if changed:
    print('  已注入: ' + ', '.join(changed))
else:
    print('  无改动（可能已全部应用）')
PY

# 4) manifest: display fullscreen → standalone（PWA 键盘跟随必需，幂等）
MANIFEST="$(dirname "$HTML")/manifest.webmanifest"
if [ -f "$MANIFEST" ]; then
  if grep -q '"display": "fullscreen"' "$MANIFEST"; then
    sed -i 's/"display": "fullscreen"/"display": "standalone"/' "$MANIFEST"
    echo "  [ok]   manifest display: fullscreen -> standalone（PWA 键盘跟随必需）"
  else
    echo "  [skip] manifest display 已是 standalone 或格式未知"
  fi
else
  echo "  [skip] 未找到 manifest.webmanifest"
fi

echo "[apply-frontend] 完成。重启 dsh 服务后生效：bash ~/dsh/stop_dsh.sh && bash ~/dsh/start_dsh.sh"
