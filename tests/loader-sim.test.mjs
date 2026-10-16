import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, "..", "plugins", "dsh-screenshot");
const clientPath = join(pluginDir, "lib", "client.js");
const manifestPath = join(pluginDir, "package.json");

function fakeReact() {
	return {
		createElement(type, props, ...children) {
			return { type, props, children };
		}
	};
}

function fakePrimitives() {
	const Icon = () => null;
	return { IconFullscreenOutlineRegular: Icon };
}

function fakeRequire(id) {
	if (id === "react") return fakeReact();
	if (id === "@deepseek-ai/dsh-client-ui-primitives") return fakePrimitives();
	throw new Error("unexpected require: " + id);
}

async function loadBundle() {
	const registrations = [];
	globalThis.window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } };
	await import(pathToFileURL(clientPath).href + "?case=" + String(Math.random()));
	assert.equal(registrations.length, 1, "the bundle must register exactly one factory");
	const registration = registrations[0];
	return { registration, exports: registration.factory(fakeRequire) };
}

function translateFrom(dict) {
	return (key, params) => {
		const template = dict[key] === undefined ? key : dict[key];
		if (params === undefined) return template;
		return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
	};
}

function createHarness() {
	const dictionaries = [];
	const contributions = [];
	const locale = {
		register(ns, dicts) {
			dictionaries.push({ ns, dicts });
			return () => {};
		},
		bind(ns) {
			const found = dictionaries.find((entry) => entry.ns === ns);
			return translateFrom(found === undefined ? {} : found.dicts.zh);
		}
	};
	const commandUi = {
		register(contribution) {
			contributions.push(contribution);
			return () => {};
		}
	};
	const services = { locale, commandUi, sessions: { scope: () => undefined } };
	const ctx = {
		get(name) {
			return services[name];
		},
		effect(fn) {
			const disposer = fn();
			return typeof disposer === "function" ? disposer : () => {};
		},
		inject(_deps, callback) {
			callback(ctx);
		}
	};
	return { ctx, dictionaries, contributions, services };
}

function testLabels(zh) {
	return {
		title: zh["crop.title"],
		hint: zh["crop.hint"],
		confirm: zh["crop.confirm"],
		cancel: zh["crop.cancel"],
		cancelled: zh["notice.cancelled"],
		unsupported: zh["notice.unsupported"],
		failed: zh["notice.failed"],
		composerLocked: zh["notice.composerLocked"],
		composerUnavailable: zh["notice.composerUnavailable"],
		sessionsUnavailable: zh["notice.sessionsUnavailable"],
		intakeRefused: zh["notice.intakeRefused"],
		hideFailed: zh["notice.hideFailed"],
		hideUnavailable: zh["notice.hideUnavailable"],
		unknown: zh["notice.unknown"]
	};
}

test("manifest declares the client half the host scan needs", async () => {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	assert.equal(manifest.name, "dsh-screenshot");
	assert.equal(manifest.type, "module");
	assert.equal(manifest.dsh.client.platform, "web");
	assert.ok(Array.isArray(manifest.dsh.client.inject));
	assert.ok(manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-commands"));
	const clientExport = manifest.exports["./client"];
	assert.equal(typeof clientExport, "string");
	assert.ok(existsSync(join(pluginDir, clientExport)), "exports[./client] must resolve to a real file");
	const source = readFileSync(clientPath, "utf8");
	assert.match(source, /id:\s*"dsh-screenshot"/, "the factory id must equal the package name (graph row identity)");
});

test("bundle exposes the cordis plugin face", async () => {
	const { registration, exports } = await loadBundle();
	assert.equal(registration.id, "dsh-screenshot");
	assert.equal(typeof exports.apply, "function");
	assert.deepEqual(exports.inject, ["locale", "commandUi", "sessions"]);
});

test("apply registers the plus-menu contribution and the dictionaries", async () => {
	const { exports } = await loadBundle();
	const harness = createHarness();
	exports.apply(harness.ctx);
	assert.equal(harness.dictionaries.length, 1);
	assert.equal(harness.dictionaries[0].ns, "screenshot");
	assert.deepEqual(Object.keys(harness.dictionaries[0].dicts).sort(), ["en", "zh"]);
	assert.equal(harness.contributions.length, 2);
	const contribution = harness.contributions.find((entry) => entry.name === "screenshot");
	assert.ok(contribution !== undefined);
	assert.equal(contribution.label(), "截图");
	assert.ok(contribution.description().length > 0);
	assert.equal(typeof contribution.icon, "function");
	assert.equal(contribution.ui.kind, "action");
	assert.equal(typeof contribution.ui.run, "function");
	assert.equal(contribution.available({ sessionId: "s1" }), false, "no browser surface in node: the row stays unavailable");
});

async function flowFixture(overrides) {
	const { exports } = await loadBundle();
	const testing = exports.__testing;
	const calls = [];
	const file = { name: "screenshot-20261016-104355.png", type: "image/png" };
	const deps = {
		labels: () => testLabels(testing.zh),
		resolveComposer: () => ({ ok: true, target: { sessionId: "s1" } }),
		capture: async (_labels, options) => {
			calls.push(["capture", options !== undefined && options.hide === true]);
			return { file: file };
		},
		attach: (target, attached) => {
			calls.push(["attach", target.sessionId, attached.name]);
			return { ok: true, ids: ["draft-1"] };
		},
		notify: (target, level, text) => {
			calls.push(["notify", target.sessionId, level, text]);
		}
	};
	const merged = Object.assign(deps, overrides === undefined ? {} : overrides);
	return { testing, calls, action: testing.createScreenshotAction(merged), file };
}

test("the action captures and attaches the image to the composer", async () => {
	const { calls, action, file } = await flowFixture();
	await action({ sessionId: "s1" });
	assert.deepEqual(calls, [["capture", false], ["attach", "s1", file.name]]);
});

test("cancelling the cropper attaches nothing and stays silent", async () => {
	const { calls, action } = await flowFixture({ capture: async () => ({ file: null }) });
	await action({ sessionId: "s1" });
	assert.deepEqual(calls, []);
});

test("a refused picker reports the screen-recording hint at info level", async () => {
	const { calls, action } = await flowFixture({
		capture: async () => {
			const error = new Error("Permission denied");
			error.name = "NotAllowedError";
			throw error;
		}
	});
	await action({ sessionId: "s1" });
	assert.equal(calls.length, 1);
	const notice = calls[0];
	assert.equal(notice[0], "notify");
	assert.equal(notice[2], "info");
	assert.match(notice[3], /屏幕录制/);
});

test("an unsupported environment reports the explicit refusal", async () => {
	const { calls, action } = await flowFixture({
		capture: async () => {
			const error = new Error("getDisplayMedia is unavailable in this environment");
			error.name = "ScreenshotUnsupportedError";
			throw error;
		}
	});
	await action({ sessionId: "s1" });
	assert.equal(calls[0][2], "error");
	assert.match(calls[0][3], /getDisplayMedia/);
});

test("a capture failure reports the underlying message", async () => {
	const { calls, action } = await flowFixture({
		capture: async () => {
			throw new Error("the capture stream produced no video frame");
		}
	});
	await action({ sessionId: "s1" });
	assert.equal(calls[0][2], "error");
	assert.match(calls[0][3], /no video frame/);
});

test("a locked composer reports the refusal and attached nothing", async () => {
	const { calls, action } = await flowFixture({
		attach: () => ({ ok: false, reason: "composer-locked" })
	});
	await action({ sessionId: "s1" });
	assert.deepEqual(calls, [["capture", false], ["notify", "s1", "error", "输入框当前不接受新附件（正在发送或处于子代理会话）。"]]);
});

test("an unavailable composer never reaches the capture stage", async () => {
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (text) => warnings.push(String(text));
	try {
		const { calls, action } = await flowFixture({ resolveComposer: () => ({ ok: false, reason: "composer-unavailable" }) });
		await action({ sessionId: "s1" });
		assert.deepEqual(calls, []);
		assert.equal(warnings.length, 1);
	} finally {
		console.warn = originalWarn;
	}
});

test("attachToComposer drives createDrafts, addFiles, and focus", async () => {
	const { exports } = await loadBundle();
	const testing = exports.__testing;
	const calls = [];
	const conversation = {
		createDrafts(sessionId, files) {
			calls.push(["createDrafts", sessionId, files.length]);
			return [{ id: "draft-1" }];
		},
		releaseDraftAttachments(drafts) {
			calls.push(["release", drafts.length]);
		}
	};
	const shell = {
		addFiles(references, ids) {
			calls.push(["addFiles", references.length, ids]);
			return true;
		},
		focus() {
			calls.push(["focus"]);
		}
	};
	const result = testing.attachToComposer({ sessionId: "s1", conversation, shell }, { name: "a.png", type: "image/png" });
	assert.deepEqual(result, { ok: true, ids: ["draft-1"] });
	assert.deepEqual(calls, [["createDrafts", "s1", 1], ["addFiles", 0, ["draft-1"]], ["focus"]]);
});

test("attachToComposer releases the draft when the composer refuses", async () => {
	const { exports } = await loadBundle();
	const testing = exports.__testing;
	const calls = [];
	const conversation = {
		createDrafts: () => [{ id: "draft-9" }],
		releaseDraftAttachments: (drafts) => calls.push(["release", drafts.length])
	};
	const shell = { addFiles: () => false };
	const result = testing.attachToComposer({ sessionId: "s1", conversation, shell }, { name: "a.png", type: "image/png" });
	assert.deepEqual(result, { ok: false, reason: "composer-locked" });
	assert.deepEqual(calls, [["release", 1]]);
});

test("geometry helpers stay exact", async () => {
	const { exports } = await loadBundle();
	const testing = exports.__testing;
	assert.equal(testing.screenshotName(new Date(2026, 9, 16, 10, 43, 55)), "screenshot-20261016-104355.png");
	assert.equal(testing.screenshotName(new Date(2026, 0, 5, 3, 4, 5)), "screenshot-20260105-030405.png");
	assert.equal(testing.fitScale(1000, 500, 500, 500), 0.5);
	assert.equal(testing.fitScale(100, 100, 500, 500), 1, "never upscales");
	assert.deepEqual(testing.normalizeSelection({ x: 30, y: 40 }, { x: 10, y: 20 }, { width: 100, height: 100 }), { x: 10, y: 20, width: 20, height: 20 });
	assert.deepEqual(testing.normalizeSelection({ x: -50, y: -50 }, { x: 500, y: 500 }, { width: 100, height: 100 }), { x: 0, y: 0, width: 100, height: 100 });
	assert.equal(testing.isUsableSelection({ x: 0, y: 0, width: 1, height: 40 }), false);
	assert.equal(testing.isUsableSelection({ x: 0, y: 0, width: 2, height: 40 }), true);
	assert.deepEqual(testing.toImageRect({ x: 50, y: 25, width: 100, height: 50 }, 0.5, 800, 600), { x: 100, y: 50, width: 200, height: 100 });
	assert.deepEqual(testing.toImageRect({ x: 199, y: 99, width: 10, height: 10 }, 1, 200, 100), { x: 199, y: 99, width: 1, height: 1 });
});

test("error classification separates cancel, denial, and failure", async () => {
	const { exports } = await loadBundle();
	const testing = exports.__testing;
	const named = (name) => Object.assign(new Error(name), { name });
	assert.equal(testing.classifyCaptureError(named("AbortError")), "cancelled");
	assert.equal(testing.classifyCaptureError(named("NotAllowedError")), "denied");
	assert.equal(testing.classifyCaptureError(named("NotFoundError")), "unsupported");
	assert.equal(testing.classifyCaptureError(named("ScreenshotUnsupportedError")), "unsupported");
	assert.equal(testing.classifyCaptureError(named("TypeError")), "failed");
	assert.equal(testing.classifyCaptureError(undefined), "failed");
});

test("the locale dictionaries carry every key the flow reads", async () => {
	const { exports } = await loadBundle();
	const zh = exports.__testing.zh;
	const en = exports.__testing.en;
	const keys = ["menu.label", "menu.description", "crop.title", "crop.hint", "crop.confirm", "crop.cancel", "notice.cancelled", "notice.unsupported", "notice.failed", "notice.composerLocked", "notice.composerUnavailable", "notice.sessionsUnavailable", "notice.intakeRefused", "notice.unknown"];
	for (const key of keys) {
		assert.equal(typeof zh[key], "string", "zh missing " + key);
		assert.equal(typeof en[key], "string", "en missing " + key);
	}
	assert.ok(zh["notice.failed"].includes("{message}"));
	assert.ok(zh["notice.intakeRefused"].includes("{message}"));
});

function pipelineFixture(overrides) {
	const calls = [];
	const file = { name: "display.png", type: "image/png" };
	const seams = {
		nativeStatus: async () => {
			calls.push("nativeStatus");
			return { ok: true, platform: "darwin" };
		},
		nativeCapture: async () => {
			calls.push("nativeCapture");
			return { kind: "ok", blob: { size: 12 } };
		},
		displaySupported: () => true,
		displayCapture: async () => {
			calls.push("displayCapture");
			return file;
		}
	};
	return { calls, seams: Object.assign(seams, overrides === undefined ? {} : overrides), file };
}

test("the native host route wins when it is available", async () => {
	const { exports } = await loadBundle();
	const { calls, seams } = await pipelineFixture();
	const capture = exports.__testing.createCapturePipeline(seams);
	const outcome = await capture({});
	assert.deepEqual(calls, ["nativeStatus", "nativeCapture"]);
	assert.equal(outcome.file.type, "image/png");
	assert.match(outcome.file.name, /^screenshot-\d{8}-\d{6}\.png$/);
	assert.equal(outcome.hideFailed, false);
});

test("cancelling the system crosshair produces no file and skips the fallback", async () => {
	const { exports } = await loadBundle();
	const { calls, seams } = await pipelineFixture({ nativeCapture: async () => ({ kind: "cancelled" }) });
	const capture = exports.__testing.createCapturePipeline(seams);
	assert.deepEqual(await capture({}), { file: null });
	assert.deepEqual(calls, ["nativeStatus"]);
});

test("an unavailable host route falls back to the in-app display capture", async () => {
	const { exports } = await loadBundle();
	const { calls, seams, file } = await pipelineFixture({ nativeStatus: async () => ({ ok: false }) });
	const capture = exports.__testing.createCapturePipeline(seams);
	assert.equal((await capture({})).file, file);
	assert.deepEqual(calls, ["displayCapture"]);
});

test("a native transport failure degrades to the display capture when it exists", async () => {
	const { exports } = await loadBundle();
	const { calls, seams, file } = await pipelineFixture({
		nativeCapture: async () => {
			throw new Error("native capture failed");
		}
	});
	const capture = exports.__testing.createCapturePipeline(seams);
	assert.equal((await capture({})).file, file);
	assert.deepEqual(calls, ["nativeStatus", "displayCapture"]);
});

test("a native failure with no display fallback surfaces the native error", async () => {
	const { exports } = await loadBundle();
	const { seams } = await pipelineFixture({
		nativeCapture: async () => {
			throw new Error("native capture failed");
		},
		displaySupported: () => false
	});
	const capture = exports.__testing.createCapturePipeline(seams);
	await assert.rejects(() => capture({}), /native capture failed/);
});

test("the menu offers a hide-window row once the host reports hide support", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({
		ok: true,
		status: 200,
		json: async () => ({ ok: true, native: true, hide: true, platform: "darwin" }),
		headers: { get: () => null }
	});
	try {
		const { exports } = await loadBundle();
		const harness = createHarness();
		exports.apply(harness.ctx);
		assert.equal(exports.__testing.hideCaptureSupported(), false, "the hide row stays unavailable until the probe settles");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(harness.contributions.length, 2, "both rows are registered; the probe only gates availability");
		const plain = harness.contributions.find((entry) => entry.name === "screenshot");
		const hidden = harness.contributions.find((entry) => entry.name === "screenshot-hidden");
		assert.ok(plain !== undefined && hidden !== undefined);
		assert.equal(plain.label(), "截图");
		assert.equal(hidden.label(), "截图 · 隐藏本窗口");
		assert.equal(hidden.description(), "先隐藏 Harness 窗口，再截取屏幕");
		assert.equal(exports.__testing.hideCaptureSupported(), true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the hide-window row stays hidden when the host cannot hide", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({
		ok: true,
		status: 200,
		json: async () => ({ ok: true, native: true, hide: false, platform: "win32" }),
		headers: { get: () => null }
	});
	try {
		const { exports } = await loadBundle();
		const harness = createHarness();
		exports.apply(harness.ctx);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(exports.__testing.hideCaptureSupported(), false);
		const hidden = harness.contributions.find((entry) => entry.name === "screenshot-hidden");
		assert.ok(hidden !== undefined);
		assert.equal(hidden.available({ sessionId: "s1" }), false, "a host that cannot hide keeps the row unavailable");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("the requested hide flag reaches the host capture call", async () => {
	const { exports } = await loadBundle();
	const calls = [];
	const seams = {
		nativeStatus: async () => ({ ok: true, hide: true }),
		nativeCapture: async (options) => {
			calls.push(["nativeCapture", options.hide === true]);
			return { kind: "ok", blob: { size: 8 }, hideFailed: false };
		},
		displaySupported: () => true,
		displayCapture: async () => {
			calls.push("displayCapture");
			return null;
		}
	};
	const capture = exports.__testing.createCapturePipeline(seams);
	const outcome = await capture({}, { hide: true });
	assert.deepEqual(calls, [["nativeCapture", true]]);
	assert.match(outcome.file.name, /^screenshot-/);
});

test("a failed hide is reported alongside the captured image", async () => {
	const { exports } = await loadBundle();
	const seams = {
		nativeStatus: async () => ({ ok: true, hide: true }),
		nativeCapture: async () => ({ kind: "ok", blob: { size: 8 }, hideFailed: true }),
		displaySupported: () => true,
		displayCapture: async () => null
	};
	const outcome = await exports.__testing.createCapturePipeline(seams)({}, { hide: true });
	assert.equal(outcome.hideFailed, true);
	assert.ok(outcome.file !== null);
});

test("the fallback path reports that hiding was unavailable", async () => {
	const { exports } = await loadBundle();
	const file = { name: "fallback.png", type: "image/png" };
	const seams = {
		nativeStatus: async () => ({ ok: false }),
		nativeCapture: async () => null,
		displaySupported: () => true,
		displayCapture: async () => file
	};
	const outcome = await exports.__testing.createCapturePipeline(seams)({}, { hide: true });
	assert.equal(outcome.file, file);
	assert.equal(outcome.hideUnavailable, true);
});

test("the action surfaces the hide notices over the composer", async () => {
	const { calls, action } = await flowFixture({
		capture: async () => ({ file: { name: "shot.png", type: "image/png" }, hideFailed: true, hideUnavailable: true })
	});
	await action({ sessionId: "s1" }, { hide: true });
	assert.deepEqual(calls, [
		["notify", "s1", "info", "未能隐藏 DeepSeek Harness 窗口（系统未授权控制应用窗口），本次截图仍包含本窗口。"],
		["notify", "s1", "info", "隐藏本窗口需要 macOS 原生截图路径；本次已改用兜底方式截图，未隐藏窗口。"],
		["attach", "s1", "shot.png"]
	]);
});

test("the hide labels exist in both dictionaries", async () => {
	const { exports } = await loadBundle();
	for (const [name, dict] of [["zh", exports.__testing.zh], ["en", exports.__testing.en]]) {
		for (const key of ["menu.labelHidden", "menu.descriptionHidden", "notice.hideFailed", "notice.hideUnavailable"]) {
			assert.equal(typeof dict[key], "string", name + " missing " + key);
		}
	}
});
