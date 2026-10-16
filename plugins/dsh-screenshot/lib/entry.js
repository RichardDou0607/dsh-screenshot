/**
 * dsh-screenshot — 宿主半份引导入口（挂载点）。
 *
 * 为什么需要它：DSH 的 profile 补丁层是**热加载**的（dsh-hmr 监听 cordis.patch.yml），
 * 插件文件在开发期被改写时，host loader 可能已经缓存过一次失败的 ESM 求值
 * （同一个 URL 的错误会被永久缓存，换 id 也无效）。这里用带 mtime 版本号的
 * 动态 import 载入真正的宿主半份，保证每次挂载都拿到磁盘上的最新构建。
 *
 * @module dsh-screenshot/entry
 */
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Inner module URL, versioned by its own mtime (never cached across edits). */
function innerHostUrl() {
	const path = fileURLToPath(new URL("./index.js", import.meta.url));
	let stamp = String(Date.now());
	try {
		stamp = String(Math.trunc(statSync(path).mtimeMs));
	} catch (error) {
		/* keep the clock stamp when the file is momentarily unreadable */
	}
	return new URL("./index.js?v=" + stamp, import.meta.url).href;
}

/**
 * Load and apply the real host half under a fresh URL.
 * @param ctx - host plugin context.
 * @returns the inner apply result.
 */
async function apply(ctx) {
	const inner = await import(innerHostUrl());
	return inner.apply(ctx);
}

export { apply };
