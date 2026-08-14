# DeepSeek Harness for Android/Termux

[中文 | English 双语文档 →](https://FunnelCakes.github.io/deepseek-harness-android/)

在 **Android 手机（Termux 环境）** 上原生运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`@deepseek-ai/dsh`），提供一键安装脚本，自动完成全部 Android 兼容修复。

> ⚠️ **需要 Termux**：必须在 Android 手机的 Termux 终端里安装运行。**不要用 Google Play 版 Termux**（已过时），从 [F-Droid](https://f-droid.org/en/packages/com.termux/) 或 [GitHub Releases](https://github.com/termux/termux-app/releases) 下载。

## 快速开始

```bash
pkg install -y git
git clone https://github.com/FunnelCakes/deepseek-harness-android.git
cd deepseek-harness-android
bash setup.sh          # 一键安装（含全部 Android 兼容修复）
bash ~/dsh/start_dsh.sh   # 启动并拉起浏览器
```

打开 <http://127.0.0.1:3080>，在 Models 页填入 DeepSeek API Key 即可使用。

完整的中英双语文档（含修复清单、使用说明、安全提示、FAQ）见上方**双语文档**链接。

## 仓库内容

| 文件 | 说明 |
|---|---|
| `setup.sh` | 一键安装：构建依赖、common.gypi 补丁、android30 编译、link→rename、subprocess android、sharp-wasm、--expose-internals、权限模式 |
| `apply-frontend.sh` | 应用前端移动端适配（竖屏布局、触控目标、气泡吸附、抽屉交互、AbortSignal polyfill） |
| `patches/` | 移动端 CSS / JS 注入片段 |
| `start_dsh.sh` `stop_dsh.sh` | 启动（自动拉起 Chrome）/ 停止脚本 |
| `config/cordis.patch.yml` | 权限模式配置示例 |
| `docs/` | GitHub Pages 中英双语文档（带切换按钮） |

## License

MIT
