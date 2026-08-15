#!/usr/bin/env node
/**
 * patch-dsh-android-link.js
 *
 * 修复 Android/Termux 上 link(2) 被 SELinux 拒绝导致的 EACCES 报错：
 *
 *   EACCES: permission denied, link '.../session.jsonl.zstd.xxx.tmp' -> '.../session.jsonl.zstd'
 *
 * 根因：部分 Android 设备（含大量原厂 ROM）的 SELinux 对 app 私有数据全局禁止硬链接，
 * 任何 link() 都返回 EACCES（rename() 正常）。dsh 三处用 link() 做“原子发布 / no-replace”
 * 的路径都会因此失败：
 *
 *   1. dsh-session-persistence-jsonl/lib/index.js —— 会话日志发布（旧版 dsh，rc.6 已改为 rename）
 *   2. dsh-attachment-local/lib/index.js           —— 附件内容寻址去重（rc.6 已改为 rename）
 *   3. dsh-fs-local/lib/index.js                   —— write 工具“新建文件”（createIfAbsent 分支，rc.6 仍未修）
 *
 * 本脚本对三处做版本兼容、幂等的就地修补：
 *   - 1、2：link(...) -> rename(...)（与 rc.6 的上游修复一致），并同步修正 node:fs/promises 的导入；
 *   - 3：link 失败（EACCES/EPERM/EMLINK/ENOSYS/ENOTSUP）时回退到“无硬链接的 no-replace 发布”
 *        （O_EXCL 原子占位 + 同目录 rename 原子填充），保留“不覆盖已存在文件”的语义。
 *
 * 用法：
 *   node patch-dsh-android-link.js [--root <@deepseek-ai 包目录>]
 *
 * 默认自动定位：npm 全局安装（npm root -g）下的 dsh 依赖目录；也可用 --root 指向
 * 目标机器的 <...>/@deepseek-ai 目录（例如把本脚本拷到部署机上执行）。
 * 重复执行安全：已修补的文件会跳过。
 *
 * 修补后需要重启 dsh 进程才生效（代码在启动时加载）。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

/** 确保 node:fs/promises 的导入里有 rename 且去掉不再使用的 link（仅作用于该导入行）。 */
function ensureFsPromisesRename(src) {
	return src.replace(/^(import \{)([^}]*)(\} from "node:fs\/promises";)$/m, (whole, pre, body, post) => {
		const names = body.split(",").map((s) => s.trim()).filter(Boolean);
		const idx = names.indexOf("link");
		if (idx !== -1) names.splice(idx, 1);
		if (!names.includes("rename")) {
			if (idx !== -1) names.splice(idx, 0, "rename");
			else names.unshift("rename");
		}
		return pre + names.join(", ") + post;
	});
}

/** 无硬链接的 no-replace 发布：O_CREAT|O_EXCL 原子占位（EEXIST=并发创建者已抢先），再同目录 rename 原子填充。 */
const FALLBACK_HELPERS = [
	"/** [dsh-android-link-fix] link(2) 被拒绝或不支持的错误码：Android SELinux 全局禁硬链接（EACCES），部分 FUSE 挂载未实现（ENOSYS/ENOTSUP）。 */",
	"function isHardLinkUnavailable(error) {",
	"\treturn error instanceof Error && typeof error.code === \"string\" && (error.code === \"EACCES\" || error.code === \"EPERM\" || error.code === \"EMLINK\" || error.code === \"ENOSYS\" || error.code === \"ENOTSUP\" || error.code === \"EOPNOTSUPP\");",
	"}",
	"/**",
	" * [dsh-android-link-fix] 无硬链接的 no-replace 发布回退：先用 O_CREAT|O_EXCL 原子占位（EEXIST 表示并发创建者已抢先），",
	" * 再用同目录 rename 原子填充。占位与填充之间崩溃会留下空占位文件，已在错误路径尽力清理。",
	" */",
	"async function publishNoReplaceNoHardlink(tempPath, absolutePath, displayPath) {",
	"\tlet guard;",
	"\ttry {",
	"\t\tguard = await open(absolutePath, \"wx\", 384);",
	"\t} catch (error) {",
	"\t\tif (isEEXIST(error)) throw new FsError(`cannot overwrite existing \"${displayPath}\" without reading it first`, \"FS_NOT_OBSERVED\", { cause: error });",
	"\t\tthrow new FsError(`cannot write \"${displayPath}\": ${errorMessage(error)}`, \"FS_IO_ERROR\", { cause: error });",
	"\t}",
	"\ttry {",
	"\t\tawait guard.close();",
	"\t\tawait rename(tempPath, absolutePath);",
	"\t} catch (error) {",
	"\t\t/* v8 ignore next -- 占位清理只在 reserve/fill 二次故障时可达 */",
	"\t\tawait rm(absolutePath, { force: true }).catch(() => {});",
	"\t\tthrow error;",
	"\t}",
	"}",
].join("\n");

const FALLBACK_BLOCK_NEW = [
	"\t\tif (createIfAbsent !== void 0) try {",
	"\t\t\tawait linkFile(tempPath, absolutePath);",
	"\t\t} catch (error) {",
	"\t\t\t/* [dsh-android-link-fix] 拒绝 link(2) 的文件系统（Android SELinux、部分 FUSE）回退到无硬链接的 no-replace 发布。 */",
	"\t\t\tif (isHardLinkUnavailable(error)) await publishNoReplaceNoHardlink(tempPath, absolutePath, createIfAbsent.displayPath);",
	"\t\t\telse await throwGuardedCreateFailure(error, absolutePath, createIfAbsent.displayPath, inspectPublicationTarget);",
	"\t\t}",
].join("\n");

const FALLBACK_BLOCK_OLD = [
	"\t\tif (createIfAbsent !== void 0) try {",
	"\t\t\tawait linkFile(tempPath, absolutePath);",
	"\t\t} catch (error) {",
	"\t\t\tawait throwGuardedCreateFailure(error, absolutePath, createIfAbsent.displayPath, inspectPublicationTarget);",
	"\t\t}",
].join("\n");

/** 附件祖先遍历：容忍内核拒绝打开的祖先目录（Android SELinux 禁止 app open 应用前缀之上的系统目录）。 */
const WALK_HELPERS = [
	"/**",
	" * [dsh-android-link-fix] 同 syncDirectory，但容忍内核拒绝打开的祖先目录：Android SELinux 对 app 禁止 open 应用前缀之上的系统目录（EACCES）。",
	" * 拿不到句柄就没有可同步的东西，跳过无害；应用自身的目录仍会照常 fsync。",
	" */",
	"async function syncDirectoryTolerant(path) {",
	"\tif (process.platform === \"win32\") return;",
	"\ttry {",
	"\t\tawait syncDirectory(path);",
	"\t} catch (error) {",
	"\t\tif (error && (error.code === \"EACCES\" || error.code === \"EPERM\" || error.code === \"ENOSYS\")) return;",
	"\t\tthrow error;",
	"\t}",
	"}",
].join("\n");

const PACKAGES = [
	{
		name: "dsh-session-persistence-jsonl",
		file: "lib/index.js",
		fix(src) {
			const oldCall = "\t\t\tawait link(tmp, finalPath);";
			if (!src.includes(oldCall)) return { status: "already-fixed", detail: "会话发布已用 rename（rc.6 及以上无需处理）" };
			let out = src.replace(oldCall, "\t\t\tawait rename(tmp, finalPath);");
			out = ensureFsPromisesRename(out);
			return { status: "patched", detail: "会话日志发布 link(tmp, finalPath) -> rename(tmp, finalPath)", src: out };
		},
	},
	{
		name: "dsh-attachment-local",
		file: "lib/index.js",
		fix(src) {
			let out = src;
			let changed = false;
			const details = [];
			const oldCall = "\t\t\tawait link(temporary, target);";
			if (out.includes(oldCall)) {
				out = out.replace(oldCall, "\t\t\tawait rename(temporary, target);");
				out = ensureFsPromisesRename(out);
				details.push("附件去重发布 link -> rename");
				changed = true;
			}
			const oldWalk = "\t\tawait syncDirectory(parent);";
			if (out.includes(oldWalk) && !out.includes("syncDirectoryTolerant")) {
				const anchor = "async function ensureDurableDirectory(";
				if (!out.includes(anchor)) return { status: "pattern-mismatch", detail: "未找到 ensureDurableDirectory 锚点，跳过，请人工检查该文件" };
				out = out.replace(oldWalk, "\t\tawait syncDirectoryTolerant(parent);");
				out = out.replace(anchor, WALK_HELPERS + "\n\n" + anchor);
				details.push("祖先遍历容忍 EACCES/EPERM/ENOSYS");
				changed = true;
			}
			const oldUnlink = "\t\tawait unlink(temporary);";
			if (out.includes(oldUnlink)) {
				out = out.replace(oldUnlink, [
					"\t\tawait unlink(temporary).catch((cleanupError) => {",
					"\t\t\t/* [dsh-android-link-fix] rename 发布后临时文件已被移走，ENOENT 属正常，忽略。 */",
					"\t\t\tif (!(cleanupError instanceof Error && \"code\" in cleanupError && cleanupError.code === \"ENOENT\")) throw cleanupError;",
					"\t\t});",
				].join("\n"));
				details.push("发布后临时文件清理容忍 ENOENT");
				changed = true;
			}
			if (!changed) return { status: "already-fixed", detail: "附件发布已用 rename 且祖先遍历已容忍（无需处理）" };
			return { status: "patched", detail: details.join("；"), src: out };
		},
	},
	{
		name: "dsh-fs-local",
		file: "lib/index.js",
		fix(src) {
			if (src.includes("publishNoReplaceNoHardlink")) return { status: "already-fixed", detail: "已包含无硬链接发布回退（此前已修补）" };
			if (!src.includes(FALLBACK_BLOCK_OLD)) return { status: "pattern-mismatch", detail: "未找到 createIfAbsent 发布块，跳过，请人工检查该文件" };
			let out = src.replace(FALLBACK_BLOCK_OLD, FALLBACK_BLOCK_NEW);
			const anchor = "async function writeFileAtomic(";
			if (!out.includes(anchor)) return { status: "pattern-mismatch", detail: "未找到 writeFileAtomic 插入锚点，跳过，请人工检查该文件" };
			out = out.replace(anchor, FALLBACK_HELPERS + "\n\n" + anchor);
			return { status: "patched", detail: "write 工具新建文件路径：link 失败时回退到无硬链接 no-replace 发布", src: out };
		},
	},
];

function resolveRoot(optRoot) {
	const candidates = [];
	if (optRoot) candidates.push(optRoot);
	try {
		const dshPkg = require.resolve("@deepseek-ai/dsh/package.json");
		candidates.push(path.join(path.dirname(dshPkg), "node_modules", "@deepseek-ai"));
	} catch {}
	try {
		const npmRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
		candidates.push(path.join(npmRoot, "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai"));
	} catch {}
	for (const c of candidates) {
		if (PACKAGES.every((p) => fs.existsSync(path.join(c, p.name, p.file)))) return c;
	}
	return candidates[0] || null;
}

function patchPackage(root, spec) {
	const file = path.join(root, spec.name, spec.file);
	if (!fs.existsSync(file)) return { name: spec.name, status: "not-found", detail: `缺少文件: ${file}` };
	let src;
	try {
		src = fs.readFileSync(file, "utf8");
	} catch (error) {
		return { name: spec.name, status: "error", detail: `读取失败: ${error.message}` };
	}
	const result = spec.fix(src);
	if (result.status === "patched") {
		try {
			fs.writeFileSync(file, result.src);
		} catch (error) {
			return { name: spec.name, status: "error", detail: `写入失败: ${error.message}` };
		}
	}
	return { name: spec.name, status: result.status, detail: result.detail, file };
}

function main() {
	const argv = process.argv.slice(2);
	let optRoot = null;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--root") optRoot = argv[++i];
	}
	const root = resolveRoot(optRoot);
	if (!root) {
		console.error("无法定位 dsh 安装目录。请用 --root 指定 <...>/@deepseek-ai 包目录。");
		process.exit(1);
	}
	console.log(`dsh 包目录: ${root}`);
	console.log("");
	let warn = false;
	for (const spec of PACKAGES) {
		const r = patchPackage(root, spec);
		const mark = {
			patched: "[PATCHED ]",
			"already-fixed": "[OK      ]",
			"not-found": "[SKIP    ]",
			"pattern-mismatch": "[WARN    ]",
			error: "[ERROR   ]",
		}[r.status] || "[?????   ]";
		console.log(`${mark} ${r.name}: ${r.detail}`);
		if (r.status === "pattern-mismatch" || r.status === "not-found" || r.status === "error") warn = true;
	}
	console.log("");
	if (warn) {
		console.log("有文件未自动修补，请人工检查。");
		process.exit(2);
	}
	console.log("全部完成。请重启 dsh 进程使修补生效（例如：~/dsh/restart_dsh_now.sh 或重新运行 dsh web）。");
}

main();
