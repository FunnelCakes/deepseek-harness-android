#!/usr/bin/env bash
# ============================================================================
# dsh-rg-fix / scripts/reapply.sh
#
# Re-apply the DSH grep/glob ripgrep fix on Termux/Android.
#   Symptom : "grep/glob could not start its search command (ripgrep launch
#              failed)"
#   Root cause: @vscode/ripgrep ships prebuilt binaries only for darwin/win32/
#     linux; on Termux process.platform == 'android' the platform package
#     @vscode/ripgrep-android-arm64 is never installed, and the search tools
#     (`@deepseek-ai/dsh-tool-fs-search`) are hardwired to it, so they fail
#     even though a system `rg` exists.
#   Fix:  (1) symlink the missing platform binary to the system `rg`;
#         (2) patch resolveRgPath() in dsh-tool-fs-search to fall back to a
#             system `rg` (RG_PATH env -> `which rg` -> PATH).
#
# Idempotent: safe to run repeatedly; skips the patch when already applied.
#
# NOTE: every `npm/yarn/pnpm update dsh` wipes node_modules, re-running this
#       script after each update is REQUIRED, then restart the dsh web server
#       (the running process keeps the old module + a memoized failed promise).
#
# Usage:
#   bash scripts/reapply.sh
#   DSH_ROOT=... bash scripts/reapply.sh   # override the default DSH install dir
# ============================================================================
set -euo pipefail

DSH_ROOT="${DSH_ROOT:-/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh}"
SEARCH_LIB="$DSH_ROOT/node_modules/@deepseek-ai/dsh-tool-fs-search/lib/index.js"
PLATFORM_BIN="$DSH_ROOT/node_modules/@vscode/ripgrep-android-arm64/bin"

echo "==> DSH root: $DSH_ROOT"
if [ ! -d "$DSH_ROOT" ]; then
	echo "ERROR: DSH_ROOT not found: $DSH_ROOT" >&2
	exit 1
fi
if [ ! -f "$SEARCH_LIB" ]; then
	echo "ERROR: dsh-tool-fs-search lib not found: $SEARCH_LIB" >&2
	exit 1
fi

# ---- 0. locate a system rg ----
RG="${RG_PATH:-$(command -v rg || true)}"
if [ -z "$RG" ] || [ ! -x "$RG" ]; then
	echo "ERROR: no usable system rg (install it: pkg install ripgrep)" >&2
	exit 1
fi
echo "==> system rg: $RG ($("$RG" --version | head -1))"

# ---- 1. platform binary symlink (what @vscode/ripgrep expects) ----
echo "==> step 1/3: symlink packaged platform rg -> system rg"
mkdir -p "$PLATFORM_BIN"
ln -sf "$RG" "$PLATFORM_BIN/rg"
ls -la "$PLATFORM_BIN"

# ---- 2. patch resolveRgPath() fallback (idempotent) ----
echo "==> step 2/3: patch resolveRgPath() fallback"
node - "$SEARCH_LIB" <<'JS'
const fs = require('fs');
const lib = process.argv[2];
let src = fs.readFileSync(lib, 'utf8');

if (src.includes('resolveSystemRg')) {
  console.log('    already patched, skipping');
  process.exit(0);
}

const ORIG = [
  'function resolveRgPath() {',
  '\trgPathPromise ??= import("@vscode/ripgrep").then((module) => module.rgPath);',
  '\treturn rgPathPromise;',
  '}',
].join('\n');

const CURRENT_ORIG = [
  'function resolveRgPath() {',
  '\trgPathPromise ??= Promise.resolve().then(async () => {',
  '\t\tconst executableSidecar = `${process.execPath}-rg`;',
  '\t\tif ("pkg" in process && existsSync(executableSidecar)) return executableSidecar;',
  '\t\treturn (await import("@vscode/ripgrep")).rgPath;',
  '\t});',
  '\treturn rgPathPromise;',
  '}',
].join('\n');

const PATCHED_OLD = [
  '/**',
  ' * Locate a usable system `rg` binary as a fallback.',
  ' *',
  ' * `@vscode/ripgrep` only publishes prebuilt binaries for darwin/win32/linux;',
  ' * on other platforms (Termux/Android, ...) its platform package is absent and',
  ' * `import("@vscode/ripgrep")` rejects. When that happens the search tools fall',
  ' * back to an `rg` found on `PATH` (or an explicit `RG_PATH`), keeping `grep` /',
  ' * `glob` functional wherever ripgrep is installed system-wide.',
  ' */',
  'async function resolveSystemRg() {',
  '\tif (process.env.RG_PATH) return process.env.RG_PATH;',
  '\ttry {',
  '\t\tconst { execFileSync } = await import("node:child_process");',
  '\t\tconst which = process.platform === "win32" ? "where" : "which";',
  '\t\tconst found = execFileSync(which, ["rg"], { encoding: "utf8" }).split(/\\r?\\n/)[0]?.trim();',
  '\t\tif (found) return found;',
  '\t} catch { /* no `which`/`where`; fall through to bare "rg" via PATH */ }',
  '\treturn "rg";',
  '}',
  'function resolveRgPath() {',
  '\trgPathPromise ??= import("@vscode/ripgrep")',
  '\t\t.then((module) => module.rgPath)',
  '\t\t.catch(() => resolveSystemRg());',
  '\treturn rgPathPromise;',
  '}',
].join('\n');

const PATCHED_CURRENT = [
  '/**',
  ' * Locate a usable system `rg` binary as a fallback.',
  ' *',
  ' * `@vscode/ripgrep` only publishes prebuilt binaries for darwin/win32/linux;',
  ' * on other platforms (Termux/Android, ...) its platform package is absent and',
  ' * `import("@vscode/ripgrep")` rejects. When that happens the search tools fall',
  ' * back to an `rg` found on `PATH` (or an explicit `RG_PATH`), keeping `grep` /',
  ' * `glob` functional wherever ripgrep is installed system-wide.',
  ' */',
  'async function resolveSystemRg() {',
  '\tif (process.env.RG_PATH) return process.env.RG_PATH;',
  '\ttry {',
  '\t\tconst { execFileSync } = await import("node:child_process");',
  '\t\tconst which = process.platform === "win32" ? "where" : "which";',
  '\t\tconst found = execFileSync(which, ["rg"], { encoding: "utf8" }).split(/\\r?\\n/)[0]?.trim();',
  '\t\tif (found) return found;',
  '\t} catch { /* no `which`/`where`; fall through to bare "rg" via PATH */ }',
  '\treturn "rg";',
  '}',
  'function resolveRgPath() {',
  '\trgPathPromise ??= Promise.resolve().then(async () => {',
  '\t\tconst executableSidecar = `${process.execPath}-rg`;',
  '\t\tif ("pkg" in process && existsSync(executableSidecar)) return executableSidecar;',
  '\t\ttry {',
  '\t\t\treturn (await import("@vscode/ripgrep")).rgPath;',
  '\t\t} catch {',
  '\t\t\treturn resolveSystemRg();',
  '\t\t}',
  '\t});',
  '\treturn rgPathPromise;',
  '}',
].join('\n');

let originalFound = false;
if (src.includes(ORIG)) {
  src = src.replace(ORIG, PATCHED_OLD);
  originalFound = true;
} else if (src.includes(CURRENT_ORIG)) {
  src = src.replace(CURRENT_ORIG, PATCHED_CURRENT);
  originalFound = true;
}

if (!originalFound) {
  console.error('ERROR: original resolveRgPath() not found in ' + lib);
  console.error('The code likely changed in this version; patch manually.');
  process.exit(1);
}
fs.writeFileSync(lib, src);
console.log('    patched OK');
JS

# ---- 3. verify in a fresh node process ----
echo "==> step 3/3: verify resolution in a fresh node process"
(
  cd "$(dirname "$SEARCH_LIB")"
  node -e "import('./index.js').then(async m=>{const p=await m.resolveRgPath();const {execFileSync}=await import('node:child_process');console.log('    resolved: '+p);console.log('    version:  '+execFileSync(p,['--version']).toString().split(String.fromCharCode(10))[0]);})"
)

echo
echo "==> DONE. Restart the dsh web server to activate (session data persists in ~/.dsh/sessions):"
echo "    # find it:  ps -eo pid,args | grep 'bin.js web'"
echo "    kill <pid>"
echo "    node --expose-internals $DSH_ROOT/lib/bin.js web"
