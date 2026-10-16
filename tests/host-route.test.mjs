import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hostPath = join(here, "..", "plugins", "dsh-screenshot", "lib", "index.js");

async function loadHost() {
	const module = await import(pathToFileURL(hostPath).href + "?case=" + String(Math.random()));
	return module.__testing;
}

function fakeResponse() {
	return {
		status: undefined,
		headers: undefined,
		body: undefined,
		writeHead(status, headers) {
			this.status = status;
			this.headers = headers;
		},
		end(body) {
			this.body = body;
		}
	};
}

async function call(testing, options) {
	const request = {
		method: options.method === undefined ? "GET" : options.method,
		url: options.url,
		headers: options.headers === undefined ? {} : options.headers
	};
	const response = fakeResponse();
	await testing.handleRequest(request, response);
	const parsed = typeof response.body === "undefined" ? undefined : JSON.parse(Buffer.isBuffer(response.body) ? response.body.toString("utf8") : String(response.body));
	return { status: response.status, headers: response.headers, body: parsed, raw: response.body };
}

test("status reports the native capability without touching the crosshair", async () => {
	const testing = await loadHost();
	const response = await call(testing, { url: "/dsh-screenshot/status" });
	assert.equal(response.status, 200);
	assert.equal(response.body.ok, true);
	assert.equal(typeof response.body.platform, "string");
	assert.equal(response.body.native, process.platform === "darwin" && existsSync("/usr/sbin/screencapture"));
});

test("a GET on the capture route is refused before any capture runs", async () => {
	const testing = await loadHost();
	const response = await call(testing, { url: "/dsh-screenshot/native-region" });
	assert.equal(response.status, 405);
});

test("a POST without the guard header is refused", async () => {
	const testing = await loadHost();
	const response = await call(testing, { method: "POST", url: "/dsh-screenshot/native-region" });
	assert.equal(response.status, 400);
	assert.match(response.body.error, /x-dsh-screenshot/);
});

test("a foreign origin is refused on every route", async () => {
	const testing = await loadHost();
	const forStatus = await call(testing, { url: "/dsh-screenshot/status", headers: { origin: "https://evil.example" } });
	assert.equal(forStatus.status, 403);
	const forCapture = await call(testing, { method: "POST", url: "/dsh-screenshot/native-region", headers: { origin: "https://evil.example", "x-dsh-screenshot": "1" } });
	assert.equal(forCapture.status, 403);
});

test("loopback and app origins are accepted", async () => {
	const testing = await loadHost();
	for (const origin of ["dsh-app://app", "http://127.0.0.1:19387", "http://localhost:3000"]) {
		const response = await call(testing, { url: "/dsh-screenshot/status", headers: { origin: origin } });
		assert.equal(response.status, 200, origin + " must be accepted");
	}
});

test("unknown routes answer 404", async () => {
	const testing = await loadHost();
	const response = await call(testing, { url: "/dsh-screenshot/other" });
	assert.equal(response.status, 404);
});

test("the status route never exposes the capture payload", async () => {
	const testing = await loadHost();
	const response = await call(testing, { url: "/dsh-screenshot/status" });
	assert.equal(response.raw.includes("PNG"), false);
	assert.equal(response.headers["cache-control"], "no-store");
});

test("status advertises the window-hiding capability", async () => {
	const testing = await loadHost();
	const response = await call(testing, { url: "/dsh-screenshot/status" });
	assert.equal(response.status, 200);
	assert.equal(typeof response.body.hide, "boolean");
	assert.equal(response.body.hide, testing.hideSupported());
	assert.equal(response.body.hide, process.platform === "darwin" && existsSync("/usr/bin/osascript"));
});

test("the hide flag never runs a capture on a GET", async () => {
	const testing = await loadHost();
	const response = await call(testing, { url: "/dsh-screenshot/native-region?hide=1" });
	assert.equal(response.status, 405);
});

test("AppleScript helpers stay pure and correct", async () => {
	const testing = await loadHost();
	assert.equal(testing.parseVisibility("true\n"), true);
	assert.equal(testing.parseVisibility(" FALSE "), false);
	assert.equal(testing.parseVisibility("garbage"), undefined);
	assert.equal(testing.parseVisibility(""), undefined);
	assert.equal(testing.systemEventsTarget(4321), "first process whose unix id is 4321");
	assert.match(testing.systemEventsTarget(0), /process "DeepSeek Harness"/);
	assert.equal(testing.HIDDEN_HEADER, "x-dsh-screenshot-hidden");
});

test("the host resolves the window-owning application pid", async () => {
	const testing = await loadHost();
	const pid = testing.applicationPid();
	assert.ok(Number.isSafeInteger(pid) && pid > 0, "the host must resolve its parent application pid");
	assert.equal(pid, process.ppid);
});
