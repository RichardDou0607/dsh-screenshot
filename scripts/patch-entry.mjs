/**
 * 剖面补丁层的精确编辑（mount / unmount / status）。
 *
 * 教训：早期脚本用「标记块整块删除」，一旦别的内容（例如插件管理器写入的
 * `- id: whale-pet`）落在两个标记之间，就会被一起删掉。这里改为**按行范围精确匹配**：
 * 只识别「顶层 - insert: 且其行内 name 指向本插件 entry.js」的块，其他行一律不动。
 *
 * 用法：
 *   node scripts/patch-entry.mjs mount    [--profile-dir <dir>]
 *   node scripts/patch-entry.mjs unmount  [--profile-dir <dir>]
 *   node scripts/patch-entry.mjs status   [--profile-dir <dir>]
 *
 * @module dsh-screenshot/patch-entry
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, derived from this script's location. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Absolute entry the profile patch mounts for a manual install. */
export const ENTRY_PATH = join(REPO_ROOT, "plugins", "dsh-screenshot", "lib", "entry.js");
/** Loader entry id used for the manual install. */
export const ENTRY_ID = "dsh-screenshot";
/** Marker comments owned by this plugin (removed and rewritten on every edit). */
export const MARK_BEGIN = "# >>> dsh-screenshot plugin >>>";
export const MARK_END = "# <<< dsh-screenshot plugin <<<";

/** Replace a Windows path separator so matching works on every platform. */
function normalize(text) {
	return text.replaceAll("\\", "/");
}

/**
 * Whether one patch line names this plugin's manual entry.
 * @param line - one line of the patch file.
 * @returns whether the line is the `name:` row of our insert.
 */
export function namesOurEntry(line) {
	const normalized = normalize(line);
	if (!normalized.includes("name:")) return false;
	return normalized.includes("/plugins/dsh-screenshot/lib/entry.js");
}

/**
 * Locate this plugin's own patch blocks.
 * A block starts at a top-level `- insert:` line and ends before the next top-level line.
 * @param lines - patch file split into lines.
 * @returns line ranges (start inclusive, end exclusive) owned by this plugin.
 */
export function findOwnBlocks(lines) {
	const ranges = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index].trim() !== "- insert:") continue;
		if (lines[index] !== lines[index].trimStart()) continue;
		let end = index + 1;
		while (end < lines.length && lines[end].trim() !== "" && lines[end] !== lines[end].trimStart() && !lines[end].trimStart().startsWith("#")) end += 1;
		const body = lines.slice(index, end);
		if (body.some((line) => namesOurEntry(line))) ranges.push({ start: index, end: end });
		index = end - 1;
	}
	return ranges;
}

/**
 * Remove this plugin's blocks and marker comments from one patch document.
 * @param text - current patch document.
 * @returns the document without our rows, plus how many blocks were removed.
 */
export function withoutOurBlocks(text) {
	const lines = text.split("\n");
	const ranges = findOwnBlocks(lines);
	const drop = new Set();
	for (const range of ranges) for (let index = range.start; index < range.end; index += 1) drop.add(index);
	for (let index = 0; index < lines.length; index += 1) if (lines[index].trim() === MARK_BEGIN || lines[index].trim() === MARK_END) drop.add(index);
	const kept = lines.filter((_line, index) => !drop.has(index));
	// collapse runs of blank lines left behind
	const collapsed = [];
	for (const line of kept) {
		if (line.trim() === "" && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "") continue;
		collapsed.push(line);
	}
	return { text: collapsed.join("\n").replace(/\n+$/, "") + "\n", removed: ranges.length };
}

/**
 * Insert this plugin's block at the end of one patch document.
 * @param text - current patch document.
 * @returns the document with exactly one block for this plugin.
 */
export function withOurBlock(text) {
	const base = withoutOurBlocks(text).text.replace(/\n+$/, "\n");
	const block = [MARK_BEGIN, "- insert:", "    - id: " + ENTRY_ID, "      name: '" + ENTRY_PATH + "'", MARK_END, ""].join("\n");
	return base.trimEnd() + "\n\n" + block;
}

/** Resolve the profile directory from the argument or the environment. */
function profileDirFrom(argv) {
	const at = argv.indexOf("--profile-dir");
	if (at !== -1 && argv[at + 1] !== undefined) return resolve(argv[at + 1]);
	const fromEnv = process.env.DSH_SCREENSHOT_PROFILE_DIR;
	return fromEnv !== undefined && fromEnv !== "" ? resolve(fromEnv) : join(homedir(), ".dsh", "profiles", "desktop");
}

/** Copy the patch file aside before writing. */
function backup(file) {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const target = file + ".bak-dsh-screenshot-" + stamp;
	copyFileSync(file, target);
	return target;
}

function main() {
	const [command] = process.argv.slice(2);
	const dir = profileDirFrom(process.argv.slice(2));
	const file = join(dir, "cordis.patch.yml");
	if (!existsSync(file)) {
		console.error("找不到补丁文件：" + file);
		process.exitCode = 1;
		return;
	}
	const current = readFileSync(file, "utf8");
	if (command === "status") {
		const blocks = findOwnBlocks(current.split("\n"));
		console.log("补丁文件：" + file);
		console.log("本插件条目：" + (blocks.length === 0 ? "未挂载" : String(blocks.length) + " 块（entry.js 路径挂载）"));
		console.log("标记注释：" + (current.includes(MARK_BEGIN) ? "存在" : "不存在"));
		return;
	}
	if (command === "mount") {
		const next = withOurBlock(current);
		if (next === current) {
			console.log("已是目标状态，未改动。");
			return;
		}
		console.log("已备份：" + backup(file));
		writeFileSync(file, next, "utf8");
		console.log("已挂载：" + ENTRY_PATH);
		console.log("生效：dsh-hmr 约 1 秒内热挂载；客户端刷新页面后加载。");
		return;
	}
	if (command === "unmount") {
		const result = withoutOurBlocks(current);
		if (result.removed === 0 && !current.includes(MARK_BEGIN)) {
			console.log("补丁层没有本插件的挂载条目，无需处理。");
			return;
		}
		console.log("已备份：" + backup(file));
		writeFileSync(file, result.text, "utf8");
		console.log("已移除本插件的 " + String(result.removed) + " 个插入块（其他条目未被触碰）。");
		return;
	}
	console.error("用法：node scripts/patch-entry.mjs <mount|unmount|status> [--profile-dir <dir>]");
	process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
