#!/data/data/com.termux/files/usr/bin/bash
# =============================================================================
# 应用前端移动端适配到 dsh 的 index.html
# -----------------------------------------------------------------------------
# 注入内容：
#   1. viewport meta 加 viewport-fit=cover, interactive-widget=resizes-content
#   2. <style id="dsh-mobile-adapt">（来自 patches/mobile.css）
#   3. 移动端 JS（来自 patches/mobile.js）：AbortSignal.any polyfill、
#      tooltip 气泡重吸附、触摸松手销毁、抽屉点击遮罩关闭
# 幂等：已注入则跳过。
# =============================================================================
set -euo pipefail

HTML="${1:-/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CSS_FILE="$HERE/patches/mobile.css"
JS_FILE="$HERE/patches/mobile.js"

[ -f "$HTML" ] || { echo "[apply-frontend] 未找到 index.html: $HTML"; exit 1; }
[ -f "$CSS_FILE" ] && [ -f "$JS_FILE" ] || { echo "[apply-frontend] 缺少 patches/mobile.css 或 patches/mobile.js"; exit 1; }

python3 - "$HTML" "$CSS_FILE" "$JS_FILE" <<'PY'
import sys
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

# 2) 注入 <style id="dsh-mobile-adapt">
if 'dsh-mobile-adapt' not in s:
    style = '<style id="dsh-mobile-adapt">\n' + css + '\n    </style>'
    if '<title>DeepSeek Harness</title>' in s:
        s = s.replace('<title>DeepSeek Harness</title>', '<title>DeepSeek Harness</title>\n    ' + style, 1)
        changed.append('mobile CSS')
    else:
        print('  [skip] 未找到 <title> 注入点')
else:
    print('  [skip] dsh-mobile-adapt 已存在')

# 3) 注入移动端 JS（module 脚本之前）
if 'AbortSignal.any polyfill' not in s:
    script = '<script>\n' + js + '\n    </script>'
    if '<script type="module"' in s:
        s = s.replace('<script type="module"', script + '\n    <script type="module"', 1)
        changed.append('mobile JS')
    else:
        print('  [skip] 未找到 <script type="module"> 注入点')
else:
    print('  [skip] mobile JS 已存在')

open(html, 'w', encoding='utf-8').write(s)
if changed:
    print('  已注入: ' + ', '.join(changed))
else:
    print('  无改动（可能已全部应用）')
PY

echo "[apply-frontend] 完成。重启 dsh 服务后生效：bash ~/dsh/stop_dsh.sh && bash ~/dsh/start_dsh.sh"
