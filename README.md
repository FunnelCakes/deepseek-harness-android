# DeepSeek Harness for Android / Termux

在 **Android 手机（Termux 环境）** 上原生运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`@deepseek-ai/dsh`，DeepSeek 官方的 agent harness），提供**一键安装脚本**，自动完成所有 Android 兼容性修复。

DeepSeek Harness 是 DeepSeek 发布的 agent 运行时（"Everything is a Plugin"，类 Claude Code）。本项目把它装到手机上，通过 **Web UI**（`http://127.0.0.1:3080`）在手机浏览器/Chrome 中使用。

> ⚠️ **需要 Termux**：本方案必须在 **Android 手机的 Termux 终端**里安装运行，普通电脑、云服务器或模拟器请用官方原生安装方式。

---

## 一、环境要求

| 项目 | 要求 |
|---|---|
| 设备 | Android 手机（ARM64） |
| 终端 | **Termux**（必须在 Termux 内执行，不是 PC） |
| 网络 | 可访问 GitHub / npm / DeepSeek API |
| 时间 | 首次安装约 10~20 分钟（含原生编译） |

### 如何安装 Termux

> ❗ 不要从 Google Play 下载 Termux（Play 版本已过时且不再维护）。官方渠道：

- **F-Droid（推荐）**：<https://f-droid.org/en/packages/com.termux/>
- **GitHub Releases**：<https://github.com/termux/termux-app/releases>

安装后打开 Termux，执行 `pkg update -y` 完成基础初始化（首次会提示安装存储权限，可 `termux-setup-storage` 授权）。

---

## 二、一键安装

在 Termux 里依次执行：

```bash
pkg install -y git
git clone https://github.com/FunnelCakes/deepseek-harness-android.git
cd deepseek-harness-android
bash setup.sh
```

脚本会自动完成：

1. 安装构建依赖（cmake / clang / make / binutils / pkg-config / python / nodejs）
2. 修补 node-gyp 缓存的 `common.gypi`（定义 `android_ndk_path`，修复 **node-pty** 原生构建）
3. 用 `-target aarch64-linux-android30` 编译目标安装 dsh（修复 **koffi** 的 `statx` 编译），并放行 npm 构建脚本
4. 修补 **`link()` → `rename()`**（华为 EMUI 等 ROM 禁 hardlink，否则会话/附件无法持久化）
5. 修补 subprocess 终端检测（android 视同 linux，PTY 终端可用）
6. 安装 **sharp WebAssembly 回退**（android-arm64 无原生预编译）
7. 重建 `/usr/bin/dsh` 包装脚本（加 `--expose-internals`，HMR 必需）
8. 写入启动/停止脚本与权限模式配置

## 三、使用

```bash
# 启动服务（自动拉起手机浏览器打开 Web UI）
bash ~/dsh/start_dsh.sh

# 停止服务
bash ~/dsh/stop_dsh.sh
```

启动后浏览器打开 <http://127.0.0.1:3080>，首次使用：

1. 点击 **Models** 页面
2. 填入你的 **DeepSeek API Key**（存于 `~/.dsh/.credentials.yaml`，权限 0600）
3. 开始对话，agent 可在手机上真实执行 bash 命令

## 四、本项目包含的 Android 修复

DeepSeek Harness 官方并非为 Android/Termux 适配，直接安装会遇到多个坑，`setup.sh` 全部自动修复：

| 问题 | 现象 | 修复 |
|---|---|---|
| node-pty 无法编译 | `gyp: Undefined variable android_ndk_path` | 修补 node-gyp 缓存 `common.gypi` |
| koffi 无法编译 | `statx` 相关的 `__u32` 编译错误 | 用 `android30` 编译目标 |
| npm 拦截构建脚本 | node-pty / koffi 无产物 | `--allow-scripts` 放行 |
| `link()` 被禁 | 会话/附件保存报 `EACCES` | 补丁改为 `rename()`（原子、同目录） |
| PTY 终端检测失败 | `unsupported on platform android` | subprocess 把 android 视同 linux |
| sharp 无法加载 | `Could not load sharp module` | 安装 `@img/sharp-wasm32` WebAssembly 回退 |
| HMR 启动崩溃 | `--expose-internals is required` | 包装脚本加 `--expose-internals` |
| bash 工具不可用 | `SANDBOX_UNAVAILABLE` | 权限模式设 `danger-full-access` |

> 相关社区讨论：[deepseek-harness Discussion #136 — Could not run in Android/Termux](https://github.com/deepseek-ai/deepseek-harness/discussions/136)

## 五、安全说明

- 服务**只监听 `127.0.0.1`**（本机），不走局域网。
- **API Key** 存在 `~/.dsh/.credentials.yaml`（0600 属主独占），不进日志、不进进程环境。
- `danger-full-access` **关闭了进程沙箱**（Android 无 root 无法用 bwrap/landlock），agent 可执行任意命令——**仅建议个人设备使用**。
- 升级 dsh 或 Node 版本后，`setup.sh` 的补丁需要**重跑**。

## 六、常见问题

- **启动后页面白屏 / 无法打开**：确认是 Termux 环境；`bash ~/dsh/start_dsh.sh` 看日志 `~/dsh/storage/dsh.log`。
- **报 `AbortSignal.any is not a function`**：手机浏览器过旧，需在 `dist/index.html` 注入 polyfill（详见前端适配说明）。
- **模型一直没反应**：检查 Models 页 API Key 是否正确、`~/.dsh/.credentials.yaml` 是否存在。
- **换机/重装**：重新执行 `bash setup.sh` 即可。

## 七、前端竖屏适配（可选补充）

默认 dsh Web UI 是桌面端布局，手机上建议额外注入移动端适配样式（侧栏抽屉化、触控目标 ≥44px、作曲栏重排等）与 `AbortSignal.any` polyfill。本仓库主脚本聚焦后端修复；前端适配的 CSS/脚本片段可参考本会话部署记录按需注入 `dsh-web-frontend/dist/index.html`。

## 八、参考

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- [Termux Wiki](https://wiki.termux.com/)

## License

MIT（随 DeepSeek Harness 项目同协议；本仓库为部署脚本与文档）。
