# DeepSeek Harness for Android/Termux

> 在 **Android 手机 Termux 环境** 原生运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的一键部署项目 · One-click deployment of DeepSeek Harness on **Android/Termux**.
>
> 点击下方语言标题切换 · Click a language below to view its README.

---

<details open>
<summary><b>🇨🇳 中文</b> · 点击收起/展开中文说明</summary>

## 这是什么

在 Android 手机上原生运行 DeepSeek Harness（`@deepseek-ai/dsh`，DeepSeek 官方的 agent harness，类 Claude Code）。通过 **Web UI**（`http://127.0.0.1:3080`）在手机浏览器里使用，agent 可在手机上真实执行 bash 命令。

> ⚠️ **需要 Termux**：必须在 Android 手机的 Termux 终端里安装运行。**不要用 Google Play 版 Termux**（已过时）。

### 一、安装 Termux

- **F-Droid（推荐）**：<https://f-droid.org/en/packages/com.termux/>
- **GitHub Releases**：<https://github.com/termux/termux-app/releases>

打开 Termux 后执行 `pkg update -y`。

### 二、一键安装

```bash
pkg install -y git
git clone https://github.com/FunnelCakes/deepseek-harness-android.git
cd deepseek-harness-android
bash setup.sh
```

### 三、使用

```bash
bash ~/dsh/start_dsh.sh   # 启动并自动拉起浏览器
bash ~/dsh/stop_dsh.sh    # 停止
```

打开 <http://127.0.0.1:3080>，在 **Models** 页填入你的 **DeepSeek API Key**（存于 `~/.dsh/.credentials.yaml`，0600 权限），即可开始。

### 四、setup.sh 自动修复的 Android 兼容问题

| 问题 | 现象 | 修复 |
|---|---|---|
| node-pty 无法编译 | `Undefined variable android_ndk_path` | 修补 node-gyp 缓存 `common.gypi` |
| koffi 无法编译 | `statx` 相关 `__u32` 编译错误 | `-target aarch64-linux-android30` |
| npm 拦截构建脚本 | node-pty/koffi 无产物 | `--allow-scripts` 放行 |
| `link()` 被禁 | 会话/附件保存报 `EACCES` | 改为 `rename()`（原子、同目录） |
| PTY 终端检测失败 | `unsupported on platform android` | subprocess 把 android 视同 linux |
| sharp 无法加载 | `Could not load sharp module` | 安装 `@img/sharp-wasm32` wasm 回退 |
| HMR 启动崩溃 | `--expose-internals is required` | 包装脚本加 `--expose-internals` |
| bash 工具不可用 | `SANDBOX_UNAVAILABLE` | 权限模式设 `danger-full-access` |
| 前端不适配竖屏 | 桌面布局、触控目标小等 | `apply-frontend.sh` 注入移动端 CSS/JS |

### 五、安全说明

- 服务只监听 `127.0.0.1`（本机），不走局域网。
- API Key 存 `~/.dsh/.credentials.yaml`（0600），不进日志、不进进程环境。
- `danger-full-access` 关闭了进程沙箱（Android 无 bwrap/landlock 替代），agent 可执行任意命令——仅建议个人设备使用。
- 升级 dsh 或 Node 后需重跑 `setup.sh`。

### 六、常见问题

- **页面白屏/打不开**：确认在 Termux 环境；看日志 `~/dsh/storage/dsh.log`。
- **`AbortSignal.any is not a function`**：浏览器过旧，`apply-frontend.sh` 已注入 polyfill。
- **模型没反应**：检查 Models 页 API Key 与 `~/.dsh/.credentials.yaml`。
- **换机/重装**：重跑 `bash setup.sh`。

### 七、作者测试环境与兼容性

- **测试设备**：华为 Mate 60（ALN-AL80），HarmonyOS 4.2.0（build 4.2.0.186），**无 root**，Termux（Node v26，aarch64）。
- 不同手机 / ROM 的差异可能导致额外问题，例如：部分 ROM 通过 SELinux 禁用 `link()` 系统调用（会话/附件无法持久化，本脚本已改为 `rename()` 修复）、命名空间沙箱权限不同、bwrap/landlock 是否可用等。
- `setup.sh` 覆盖了通用 Android 场景，但个别机型可能需要额外适配。

**欢迎提 issue / PR 适配更多环境**：如果你在其它品牌、系统版本或 root 状态下遇到问题，欢迎在 [Issues](https://github.com/FunnelCakes/deepseek-harness-android/issues) 提交，或提交 Pull Request 补充对应机型的修复。

### 参考

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- [deepseek-harness Discussion #136 — Android/Termux 部署](https://github.com/deepseek-ai/deepseek-harness/discussions/136)
- [Termux Wiki](https://wiki.termux.com/)

</details>

---

<details>
<summary><b>🇬🇧 English</b> · click to expand/collapse</summary>

## What is this

Run [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`@deepseek-ai/dsh`, DeepSeek's official agent harness, Claude Code–like) natively on Android. Use it through the **Web UI** at `http://127.0.0.1:3080` in your mobile browser; the agent can run real bash commands on the phone.

> ⚠️ **Termux required**: install and run inside the **Termux terminal on your Android phone**. Do **NOT** use the Google Play version (outdated).

### 1. Install Termux

- **F-Droid (recommended)**: <https://f-droid.org/en/packages/com.termux/>
- **GitHub Releases**: <https://github.com/termux/termux-app/releases>

Run `pkg update -y` after opening Termux.

### 2. One-click setup

```bash
pkg install -y git
git clone https://github.com/FunnelCakes/deepseek-harness-android.git
cd deepseek-harness-android
bash setup.sh
```

### 3. Usage

```bash
bash ~/dsh/start_dsh.sh   # start & auto-open browser
bash ~/dsh/stop_dsh.sh    # stop
```

Open <http://127.0.0.1:3080>, enter your **DeepSeek API Key** in the **Models** page (stored at `~/.dsh/.credentials.yaml`, mode 0600), and start chatting.

### 4. Android issues auto-fixed by setup.sh

| Issue | Symptom | Fix |
|---|---|---|
| node-pty fails to build | `Undefined variable android_ndk_path` | patch node-gyp cache `common.gypi` |
| koffi fails to build | `statx` `__u32` compile error | `-target aarch64-linux-android30` |
| npm blocks build scripts | no node-pty/koffi output | allow via `--allow-scripts` |
| `link()` blocked | `EACCES` saving sessions/attachments | use `rename()` (atomic, same-dir) |
| PTY terminal detection fails | `unsupported on platform android` | treat android as linux in subprocess |
| sharp fails to load | `Could not load sharp module` | install `@img/sharp-wasm32` wasm fallback |
| HMR crashes on start | `--expose-internals is required` | wrapper script adds `--expose-internals` |
| bash tool unavailable | `SANDBOX_UNAVAILABLE` | permission mode `danger-full-access` |
| Frontend not mobile-ready | desktop layout, small touch targets | `apply-frontend.sh` injects mobile CSS/JS |

### 5. Security notes

- The service listens only on `127.0.0.1` (local, not LAN).
- API Key is stored at `~/.dsh/.credentials.yaml` (0600), never in logs or process env.
- `danger-full-access` disables the process sandbox (no bwrap/landlock on Android); the agent can run any command — personal devices only.
- Re-run `setup.sh` after upgrading dsh or Node.

### 6. FAQ

- **Blank screen / cannot open**: make sure it's Termux; check `~/dsh/storage/dsh.log`.
- **`AbortSignal.any is not a function`**: old browser; `apply-frontend.sh` injects a polyfill.
- **Model not responding**: check the API Key in Models page and `~/.dsh/.credentials.yaml`.
- **Reinstall / new device**: re-run `bash setup.sh`.

### 7. Author's test environment & compatibility

- **Tested device**: Huawei Mate 60 (ALN-AL80), HarmonyOS 4.2.0 (build 4.2.0.186), **no root**, Termux (Node v26, aarch64).
- Different phones / ROMs may behave differently, e.g. some ROMs block the `link()` syscall via SELinux (sessions/attachments fail to persist — this script switches to `rename()` to fix it), namespace-sandbox permissions vary, and bwrap/landlock may or may not be available.
- `setup.sh` covers the common Android cases, but specific devices may need extra tweaks.

**Issues & PRs welcome**: if you hit a problem on another brand / OS version / root state, please open an [issue](https://github.com/FunnelCakes/deepseek-harness-android/issues) or submit a pull request with a fix for your environment.

### References

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- [deepseek-harness Discussion #136 — Android/Termux deployment](https://github.com/deepseek-ai/deepseek-harness/discussions/136)
- [Termux Wiki](https://wiki.termux.com/)

</details>

---

## License

MIT
