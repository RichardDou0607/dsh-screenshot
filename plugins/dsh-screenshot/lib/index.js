/**
 * dsh-screenshot — 宿主（node 侧）半份。
 *
 * 1. 加载心跳：写入 .host-loaded.json，用于确认剖面补丁层是否真的把本插件装进来了。
 * 2. 原生截图路由：在现有 webServer 上注册 /dsh-screenshot/*，
 *    用 macOS 自带 /usr/sbin/screencapture -i 打开系统十字光标框选，
 *    把 PNG 字节回传给浏览器半份（浏览器里拿不到子进程能力）。
 * 3. 可选隐藏本窗口：?hide=1 时先隐藏 DeepSeek Harness 自己，再打开十字光标，
 *    截图结束后必定恢复（含取消与异常路径），避免把应用窗口截进画面。
 *
 * 浏览器半份优先使用原生路由（框选即完成，且能截到应用窗口之外的内容），
 * 原生不可用时回退到 navigator.mediaDevices.getDisplayMedia + 应用内裁剪。
 *
 * @module dsh-screenshot
 */
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Plugin root, derived from this module's own location. */
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Loading heartbeat written on every host-side activation. */
const HEARTBEAT = join(PLUGIN_ROOT, ".host-loaded.json");
/** Route prefix owned by this plugin on the shared web server. */
const ROUTE_PREFIX = "/dsh-screenshot";
/** macOS interactive screenshot tool. */
const SCREENCAPTURE = "/usr/sbin/screencapture";
/** AppleScript bridge, used for window visibility control. */
const OSASCRIPT = "/usr/bin/osascript";
/** Interactive region selection, silent, PNG output, written to the given path. */
const CAPTURE_ARGS = ["-i", "-x", "-t", "png"];
/** A human may take a while to drag a region; abort well beyond that. */
const CAPTURE_TIMEOUT_MS = 300000;
/** Window-visibility scripts are fast; anything slower is a failure, not a wait. */
const VISIBILITY_TIMEOUT_MS = 8000;
/** Settle time after hiding so the hide animation cannot appear in the capture. */
const HIDE_SETTLE_MS = 320;
/** Restore attempts before giving up on showing the application again. */
const SHOW_ATTEMPTS = 3;
/** Cross-origin guard header: a custom header forces a preflight, which this route never grants. */
const GUARD_HEADER = "x-dsh-screenshot";
/** Response header reporting whether the application was hidden for one capture. */
const HIDDEN_HEADER = "x-dsh-screenshot-hidden";

/** Every candidate heartbeat location, so one denied path cannot hide a successful load. */
function heartbeatPaths() {
	const paths = [HEARTBEAT];
	try {
		paths.push(join(homedir(), ".dsh", "dsh-screenshot-host.json"));
	} catch (error) {
		/* no home directory: keep the plugin-local path only */
	}
	paths.push(join(tmpdir(), "dsh-screenshot-host.json"));
	return paths;
}

/** Record that the host half is live (best-effort; never breaks activation). */
function writeHeartbeat() {
	const payload = JSON.stringify({
		loadedAt: new Date().toISOString(),
		pid: process.pid,
		platform: process.platform,
		native: process.platform === "darwin" && existsSync(SCREENCAPTURE),
		hide: hideSupported()
	}, null, 2) + "\n";
	const failures = [];
	for (const path of heartbeatPaths()) {
		try {
			writeFileSync(path, payload, "utf8");
		} catch (error) {
			failures.push(path + ": " + (error instanceof Error ? error.message : String(error)));
		}
	}
	if (failures.length > 0) console.error("[dsh-screenshot] heartbeat failures:", failures.join(" | "));
	console.error("[dsh-screenshot] host half activated: pid=" + String(process.pid));
}

/** Whether the native interactive capture is usable on this host. */
function nativeAvailable() {
	return process.platform === "darwin" && existsSync(SCREENCAPTURE);
}

/** Whether window hiding can be attempted on this host. */
function hideSupported() {
	return process.platform === "darwin" && existsSync(OSASCRIPT);
}

/** Run the interactive capture into one file; resolves when the child exits. */
function runScreencapture(file) {
	return new Promise((resolve, reject) => {
		execFile(SCREENCAPTURE, [...CAPTURE_ARGS, file], { timeout: CAPTURE_TIMEOUT_MS }, (error) => {
			if (error !== null && error !== undefined) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

/** Run one osascript invocation and return its stdout. */
function runOsascript(args, timeoutMs = VISIBILITY_TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		execFile(OSASCRIPT, args, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => {
			if (error !== null && error !== undefined) {
				reject(error);
				return;
			}
			resolve(typeof stdout === "string" ? stdout : "");
		});
	});
}

/** Resolve a value after the given delay. */
function delay(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * PID of the desktop application process that owns the window.
 * The host runs as that application's child, so the parent pid is the window owner.
 * @returns the pid, or 0 when it cannot be determined.
 */
function applicationPid() {
	const pid = process.ppid;
	return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
}

/**
 * System Events target naming the application process.
 * @param pid - window-owner pid; 0 falls back to the bundle's process name.
 * @returns one AppleScript object reference.
 */
function systemEventsTarget(pid = applicationPid()) {
	return pid > 0 ? `first process whose unix id is ${String(pid)}` : `process "DeepSeek Harness"`;
}

/**
 * Parse one AppleScript boolean result.
 * @param text - stdout of a `get visible of ...` query.
 * @returns true/false, or undefined for anything else.
 */
function parseVisibility(text) {
	const normalized = String(text).trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	return undefined;
}

/** Read the application's current visibility, or undefined when it cannot be read. */
async function readApplicationVisible() {
	try {
		const stdout = await runOsascript(["-e", `tell application "System Events" to get visible of ${systemEventsTarget()}`]);
		return parseVisibility(stdout);
	} catch (error) {
		return undefined;
	}
}

/** Hide the application through AppKit (no Automation consent needed). */
async function hideViaAppKit() {
	const pid = applicationPid();
	if (pid === 0) throw new Error("cannot resolve the application pid for AppKit hiding");
	const script = `ObjC.import("AppKit"); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${String(pid)}); if (app && !app.isNil()) app.hide;`;
	await runOsascript(["-l", "JavaScript", "-e", script]);
}

/** Show and activate the application through AppKit. */
async function showViaAppKit() {
	const pid = applicationPid();
	if (pid === 0) throw new Error("cannot resolve the application pid for AppKit activation");
	const script = `ObjC.import("AppKit"); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${String(pid)}); if (app && !app.isNil()) { app.unhide; app.activateWithOptions(0); }`;
	await runOsascript(["-l", "JavaScript", "-e", script]);
}

/**
 * Hide the desktop application so it cannot appear in the capture.
 * @returns whether the application is hidden afterwards.
 */
async function hideApplication() {
	if (!hideSupported()) return false;
	try {
		await runOsascript(["-e", `tell application "System Events" to set visible of ${systemEventsTarget()} to false`]);
	} catch (error) {
		/* fall through to the AppKit path */
	}
	if ((await readApplicationVisible()) === false) return true;
	try {
		await hideViaAppKit();
	} catch (error) {
		/* both mechanisms failed; the caller reports it and captures as-is */
	}
	await delay(150);
	return (await readApplicationVisible()) === false;
}

/**
 * Show the desktop application again and bring it forward.
 * @returns whether the application is visible afterwards.
 */
async function showApplication() {
	if (!hideSupported()) return false;
	for (let attempt = 0; attempt < SHOW_ATTEMPTS; attempt += 1) {
		try {
			await runOsascript(["-e", `tell application "System Events" to set visible of ${systemEventsTarget()} to true`]);
			await runOsascript(["-e", `tell application "System Events" to set frontmost of ${systemEventsTarget()} to true`]);
		} catch (error) {
			/* fall through to the AppKit path */
		}
		if ((await readApplicationVisible()) === true) return true;
		try {
			await showViaAppKit();
		} catch (error) {
			/* retry */
		}
		await delay(200);
	}
	return (await readApplicationVisible()) === true;
}

/**
 * Open the system crosshair and return the captured PNG bytes.
 * @param options - `hide` hides the application for the duration of the capture.
 * @returns capture outcome: bytes (null when the user cancelled), whether the app was hidden, and whether hiding was requested but failed.
 */
async function captureRegion(options = {}) {
	const wantHide = options.hide === true && hideSupported();
	const dir = await mkdtemp(join(tmpdir(), "dsh-screenshot-"));
	const file = join(dir, "capture.png");
	let hidden = false;
	try {
		if (wantHide) {
			hidden = await hideApplication();
			if (hidden) await delay(HIDE_SETTLE_MS);
		}
		await runScreencapture(file);
		let bytes = null;
		try {
			const read = await readFile(file);
			bytes = read.byteLength === 0 ? null : read;
		} catch (error) {
			/* the user cancelled: screencapture writes no file */
			bytes = null;
		}
		return { bytes, hidden, hideFailed: wantHide && !hidden };
	} finally {
		if (hidden) await showApplication().catch(() => false);
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

/** Whether one request may use this route (loopback/app-origin callers only). */
function originAllowed(req) {
	const origin = req.headers.origin;
	if (origin === undefined || origin === null || origin === "") return true;
	if (origin === "dsh-app://app") return true;
	try {
		const url = new URL(origin);
		return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]";
	} catch (error) {
		return false;
	}
}

/** Send one JSON response. */
function sendJson(res, status, payload) {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(body.byteLength),
		"cache-control": "no-store"
	});
	res.end(body);
}

/**
 * Route handler for /dsh-screenshot/*.
 * @param req - incoming request.
 * @param res - response writer owned by this handler.
 */
async function handleRequest(req, res) {
	let parsedUrl = null;
	try {
		parsedUrl = new URL(req.url ?? "/", "http://localhost");
	} catch (error) {
		sendJson(res, 400, { ok: false, error: "malformed request url" });
		return;
	}
	const pathname = parsedUrl.pathname;
	if (!originAllowed(req)) {
		sendJson(res, 403, { ok: false, error: "origin refused" });
		return;
	}
	if (pathname === ROUTE_PREFIX + "/status") {
		sendJson(res, 200, {
			ok: true,
			native: nativeAvailable(),
			hide: hideSupported(),
			platform: process.platform,
			tool: SCREENCAPTURE
		});
		return;
	}
	if (pathname === ROUTE_PREFIX + "/native-region") {
		if (req.method !== "POST") {
			sendJson(res, 405, { ok: false, error: "use POST for the interactive capture" });
			return;
		}
		if (req.headers[GUARD_HEADER] !== "1") {
			sendJson(res, 400, { ok: false, error: "missing " + GUARD_HEADER + " header" });
			return;
		}
		if (!nativeAvailable()) {
			sendJson(res, 501, { ok: false, error: "native interactive capture is macOS-only" });
			return;
		}
		const wantHide = parsedUrl.searchParams.get("hide") === "1" && hideSupported();
		try {
			const outcome = await captureRegion({ hide: wantHide });
			const hiddenHeader = wantHide ? (outcome.hidden ? "ok" : "failed") : "off";
			if (outcome.bytes === null) {
				res.writeHead(204, { "cache-control": "no-store", [HIDDEN_HEADER]: hiddenHeader });
				res.end();
				return;
			}
			res.writeHead(200, {
				"content-type": "image/png",
				"content-length": String(outcome.bytes.byteLength),
				"cache-control": "no-store",
				[HIDDEN_HEADER]: hiddenHeader
			});
			res.end(outcome.bytes);
			return;
		} catch (error) {
			sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
			return;
		}
	}
	sendJson(res, 404, { ok: false, error: "unknown screenshot route" });
}

/**
 * Host plugin body: heartbeat plus the native capture route.
 * @param ctx - host plugin context.
 */
function apply(ctx) {
	writeHeartbeat();
	ctx.inject(["webServer"], (scope) => {
		const webServer = scope.get("webServer");
		if (webServer === undefined || webServer === null || typeof webServer.register !== "function") return;
		scope.effect(() => {
			try {
				return webServer.register({
					kind: "prefix",
					path: ROUTE_PREFIX,
					handler: (request, response) => handleRequest(request, response)
				});
			} catch (error) {
				/* a hot reload can re-apply while the previous route is still registered */
				console.error("[dsh-screenshot] capture route already registered:", error instanceof Error ? error.message : String(error));
				return () => {};
			}
		}, "dsh-screenshot: native capture route");
	});
}

/** Test-only surface; the host loader reads only `apply`. */
const __testing = {
	handleRequest,
	nativeAvailable,
	hideSupported,
	hideApplication,
	showApplication,
	readApplicationVisible,
	parseVisibility,
	systemEventsTarget,
	applicationPid,
	originAllowed,
	ROUTE_PREFIX,
	HIDDEN_HEADER,
	SCREENCAPTURE
};

export { apply, __testing };
