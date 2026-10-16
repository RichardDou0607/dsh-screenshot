import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 复核宿主 dsh-client-modules 扫描本插件所依赖的前置条件：
 * 入口 → 最近的 package.json → dsh.client 声明 → exports["./client"] → 工厂 id 与包名一致。
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(repoRoot, "plugins", "dsh-screenshot", "lib", "entry.js");

let dir = dirname(entry);
let pkgPath;
while (true) {
	const candidate = join(dir, "package.json");
	if (existsSync(candidate)) {
		pkgPath = candidate;
		break;
	}
	const parent = dirname(dir);
	if (parent === dir) break;
	dir = parent;
}
if (pkgPath === undefined) {
	console.error("FAIL: 没有找到最近的 package.json");
	process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const decl = pkg.dsh?.client;
const clientRel = pkg.exports["./client"];
const clientAbs = resolve(dirname(pkgPath), clientRel);
const clientSource = readFileSync(clientAbs, "utf8");
const idMatch = /__ModuleLoader__\.load\(\{\s*\n\s*id:\s*"([^"]+)"/.exec(clientSource);

console.log("entry               :", entry, existsSync(entry) ? "(exists)" : "(MISSING)");
console.log("nearest package.json:", pkgPath);
console.log("package name        :", pkg.name);
console.log("dsh.client.platform :", decl.platform);
console.log("dsh.client.inject   :", decl.inject.join(", "));
console.log("exports[./client]   :", clientRel, "->", existsSync(clientAbs) ? "exists" : "MISSING");
console.log("factory id          :", idMatch ? idMatch[1] : "NOT FOUND", idMatch && idMatch[1] === pkg.name ? "(matches package name)" : "(MISMATCH!)");
