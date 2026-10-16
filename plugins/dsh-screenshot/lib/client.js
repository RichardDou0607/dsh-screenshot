window.__ModuleLoader__.load({
	id: "dsh-screenshot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var primitives = null;
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch (error) {
			primitives = null;
		}
		//#region lib/client/locales.js
		/** Dictionary namespace owned by this plugin. */
		var NS = "screenshot";
		/** Simplified Chinese copy (the desktop default). */
		var zh = {
			"menu.label": "截图",
			"menu.description": "截取屏幕区域并插入输入框",
			"menu.labelHidden": "截图 · 隐藏本窗口",
			"menu.descriptionHidden": "先隐藏 Harness 窗口，再截取屏幕",
			"crop.title": "选择截图区域",
			"crop.hint": "拖拽选择区域，Enter 完成，Esc 取消",
			"crop.confirm": "完成",
			"crop.cancel": "取消",
			"notice.cancelled": "已取消截图。若始终无法捕获屏幕，请在「系统设置 → 隐私与安全性 → 屏幕录制」中允许本应用后重试。",
			"notice.unsupported": "当前环境不支持屏幕捕获：navigator.mediaDevices.getDisplayMedia 不可用。",
			"notice.failed": "截图失败：{message}",
			"notice.composerLocked": "输入框当前不接受新附件（正在发送或处于子代理会话）。",
			"notice.composerUnavailable": "当前会话的输入框不可用，截图未插入。",
			"notice.sessionsUnavailable": "会话服务不可用，截图未插入。",
			"notice.intakeRefused": "图片未被输入框受理：{message}",
			"notice.hideFailed": "未能隐藏 DeepSeek Harness 窗口（系统未授权控制应用窗口），本次截图仍包含本窗口。",
			"notice.hideUnavailable": "隐藏本窗口需要 macOS 原生截图路径；本次已改用兜底方式截图，未隐藏窗口。",
			"notice.unknown": "未知错误"
		};
		/** English copy. */
		var en = {
			"menu.label": "Screenshot",
			"menu.description": "Capture the screen into the composer",
			"menu.labelHidden": "Screenshot · hide window",
			"menu.descriptionHidden": "Hide the Harness window, then capture",
			"crop.title": "Select screenshot area",
			"crop.hint": "Drag to select, Enter to confirm, Esc to cancel",
			"crop.confirm": "Done",
			"crop.cancel": "Cancel",
			"notice.cancelled": "Screenshot cancelled. If capture never works, allow this app under System Settings > Privacy & Security > Screen Recording.",
			"notice.unsupported": "This environment cannot capture the screen: navigator.mediaDevices.getDisplayMedia is unavailable.",
			"notice.failed": "Screenshot failed: {message}",
			"notice.composerLocked": "The composer does not accept new attachments right now (sending, or a subagent composer is active).",
			"notice.composerUnavailable": "The current session has no usable composer; the screenshot was not attached.",
			"notice.sessionsUnavailable": "The session service is unavailable; the screenshot was not attached.",
			"notice.intakeRefused": "The composer refused the image: {message}",
			"notice.hideFailed": "Could not hide the DeepSeek Harness window (the system denied controlling the app window); this capture still contains it.",
			"notice.hideUnavailable": "Hiding this window needs the macOS native capture path; this capture used the fallback and kept the window visible.",
			"notice.unknown": "unknown error"
		};
		//#endregion
		//#region lib/client/geometry.js
		/** Smallest selection (stage pixels) that still counts as a deliberate drag. */
		var MIN_SELECTION = 2;
		/** Zero-pad one date component to two digits. */
		function pad2(value) {
			return value < 10 ? "0" + String(value) : String(value);
		}
		/** Local timestamp stamp used in generated file names. */
		function fileStamp(date) {
			return String(date.getFullYear()) + pad2(date.getMonth() + 1) + pad2(date.getDate()) + "-" + pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds());
		}
		/** Draft file name for one capture. */
		function screenshotName(date) {
			return "screenshot-" + fileStamp(date) + ".png";
		}
		/** Clamp one number into an inclusive range. */
		function clamp(value, min, max) {
			if (max < min) return min;
			return value < min ? min : value > max ? max : value;
		}
		/** Fit scale for showing one image inside a bound box; never upscales. */
		function fitScale(imageWidth, imageHeight, maxWidth, maxHeight) {
			if (imageWidth <= 0 || imageHeight <= 0) return 1;
			return Math.min(1, maxWidth / imageWidth, maxHeight / imageHeight);
		}
		/** Normalize a drag (any direction) into a clamped stage-space rectangle. */
		function normalizeSelection(start, end, bounds) {
			var left = clamp(Math.min(start.x, end.x), 0, bounds.width);
			var top = clamp(Math.min(start.y, end.y), 0, bounds.height);
			var right = clamp(Math.max(start.x, end.x), 0, bounds.width);
			var bottom = clamp(Math.max(start.y, end.y), 0, bounds.height);
			return { x: left, y: top, width: right - left, height: bottom - top };
		}
		/** Whether a drag produced a deliberate selection. */
		function isUsableSelection(rect) {
			return rect !== null && rect !== undefined && rect.width >= MIN_SELECTION && rect.height >= MIN_SELECTION;
		}
		/** Map a stage-space selection onto integer image pixels, clamped to the source. */
		function toImageRect(selection, scale, imageWidth, imageHeight) {
			var safeScale = scale > 0 ? scale : 1;
			var x = clamp(Math.round(selection.x / safeScale), 0, Math.max(0, imageWidth - 1));
			var y = clamp(Math.round(selection.y / safeScale), 0, Math.max(0, imageHeight - 1));
			var width = Math.max(1, Math.round(selection.width / safeScale));
			var height = Math.max(1, Math.round(selection.height / safeScale));
			return {
				x: x,
				y: y,
				width: Math.min(width, imageWidth - x),
				height: Math.min(height, imageHeight - y)
			};
		}
		/** Size caption for the live selection. */
		function formatSize(rect) {
			return String(rect.width) + " x " + String(rect.height);
		}
		/** Message of an unknown thrown value. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region lib/client/errors.js
		/** Classify a capture failure into the consequence the composer shows. */
		function classifyCaptureError(error) {
			var name = error !== null && error !== undefined ? error.name : void 0;
			if (name === "ScreenshotUnsupportedError") return "unsupported";
			if (name === "AbortError") return "cancelled";
			if (name === "NotAllowedError") return "denied";
			if (name === "NotFoundError") return "unsupported";
			return "failed";
		}
		/** Build the loud "this environment cannot capture" refusal. */
		function unsupportedError() {
			var error = new Error("getDisplayMedia is unavailable in this environment");
			error.name = "ScreenshotUnsupportedError";
			return error;
		}
		//#endregion
		//#region lib/client/capture.js
		/** Stop every track of one capture stream. */
		function stopTracks(stream) {
			if (stream === null || stream === undefined) return;
			var tracks = typeof stream.getTracks === "function" ? stream.getTracks() : [];
			for (var index = 0; index < tracks.length; index += 1) {
				try {
					tracks[index].stop();
				} catch (error) {
					/* the track already ended */
				}
			}
		}
		/** Resolve when one media event fires, or reject after the timeout. */
		function waitForEvent(target, event, timeoutMs) {
			return new Promise((resolve, reject) => {
				var timer = window.setTimeout(() => {
					target.removeEventListener(event, onEvent);
					reject(new Error("timed out waiting for " + event));
				}, timeoutMs);
				function onEvent() {
					window.clearTimeout(timer);
					target.removeEventListener(event, onEvent);
					resolve();
				}
				target.addEventListener(event, onEvent, { once: true });
			});
		}
		/** Wait for one painted video frame, tolerating browsers without rVFC. */
		function nextPaintedFrame(video) {
			if (typeof video.requestVideoFrameCallback === "function") {
				return new Promise((resolve) => {
					var settled = false;
					var timer = window.setTimeout(() => {
						if (settled) return;
						settled = true;
						resolve();
					}, 750);
					video.requestVideoFrameCallback(() => {
						if (settled) return;
						settled = true;
						window.clearTimeout(timer);
						resolve();
					});
				});
			}
			return new Promise((resolve) => {
				window.requestAnimationFrame(() => {
					window.requestAnimationFrame(() => {
						resolve();
					});
				});
			});
		}
		/** Draw the first frame of one capture stream onto a canvas and release the video element. */
		async function streamToCanvas(stream) {
			var video = document.createElement("video");
			video.className = "dsh-screenshot-video";
			video.muted = true;
			video.playsInline = true;
			video.setAttribute("playsinline", "");
			video.setAttribute("aria-hidden", "true");
			video.srcObject = stream;
			document.body.appendChild(video);
			try {
				await waitForEvent(video, "loadeddata", 10000);
				try {
					await video.play();
				} catch (error) {
					/* autoplay refusal still leaves decoded frames drawable */
				}
				await nextPaintedFrame(video);
				var width = video.videoWidth;
				var height = video.videoHeight;
				if (width <= 0 || height <= 0) {
					await waitForEvent(video, "resize", 2000);
					width = video.videoWidth;
					height = video.videoHeight;
				}
				if (width <= 0 || height <= 0) throw new Error("the capture stream produced no video frame");
				var canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				var context = canvas.getContext("2d", { alpha: false });
				if (context === null) throw new Error("the browser refused a 2D drawing context");
				context.drawImage(video, 0, 0, width, height);
				return canvas;
			} finally {
				video.pause();
				video.srcObject = null;
				video.remove();
			}
		}
		/** Copy one image-space rectangle out of a frame canvas. */
		function cropCanvas(source, rect) {
			if (rect === null || rect === undefined) return source;
			if (rect.x === 0 && rect.y === 0 && rect.width === source.width && rect.height === source.height) return source;
			var width = Math.max(1, rect.width);
			var height = Math.max(1, rect.height);
			var canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			var context = canvas.getContext("2d", { alpha: false });
			if (context === null) throw new Error("the browser refused a 2D drawing context");
			context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
			return canvas;
		}
		/** Encode one canvas as a PNG blob. */
		function canvasToBlob(canvas) {
			return new Promise((resolve, reject) => {
				canvas.toBlob((blob) => {
					if (blob === null) reject(new Error("the browser produced no PNG data"));
					else resolve(blob);
				}, "image/png");
			});
		}
		/** Whether this browser can capture a display surface at all. */
		function captureSupported() {
			if (typeof navigator === "undefined" || typeof document === "undefined") return false;
			var mediaDevices = navigator.mediaDevices;
			return mediaDevices !== undefined && mediaDevices !== null && typeof mediaDevices.getDisplayMedia === "function";
		}
		//#endregion
		//#region lib/client/cropper.js
		/** Stable style-tag identity, mirroring the client-plugin CSS ownership convention. */
		var STYLE_ID = "dsh-screenshot/cropper.css";
		/** Overlay styling (kept inline so the plugin owns no build step). */
		var overlayCss = [
			".dsh-screenshot-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:rgba(9,11,15,.82);font-family:inherit;user-select:none;-webkit-user-select:none}",
			".dsh-screenshot-stage{position:relative;line-height:0;box-shadow:0 24px 64px rgba(0,0,0,.55);cursor:crosshair;touch-action:none}",
			".dsh-screenshot-frame{display:block;width:100%;height:100%;pointer-events:none;-webkit-user-drag:none}",
			".dsh-screenshot-selection{position:absolute;box-sizing:border-box;border:1px solid #4d6bfe;box-shadow:0 0 0 9999px rgba(0,0,0,.55);pointer-events:none}",
			".dsh-screenshot-size{position:absolute;padding:2px 6px;border-radius:6px;background:rgba(9,11,15,.78);color:#fff;font-size:12px;line-height:16px;white-space:nowrap;pointer-events:none}",
			".dsh-screenshot-bar{display:flex;align-items:center;gap:12px}",
			".dsh-screenshot-hint{color:rgba(255,255,255,.72);font-size:13px;line-height:18px}",
			".dsh-screenshot-button{appearance:none;border:1px solid rgba(255,255,255,.28);border-radius:999px;background:rgba(255,255,255,.08);color:#fff;font-size:14px;line-height:20px;padding:7px 18px;cursor:pointer}",
			".dsh-screenshot-button:hover{background:rgba(255,255,255,.16)}",
			".dsh-screenshot-primary{border-color:transparent;background:#4d6bfe}",
			".dsh-screenshot-primary:hover{background:#5f7bff}",
			".dsh-screenshot-video{position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none}"
		].join("");
		/** Inject the overlay stylesheet once per document. */
		function ensureStyles(doc) {
			if (doc.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_ID) + "]") !== null) return;
			var tag = doc.createElement("style");
			tag.dataset.plugin = "dsh-screenshot";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = overlayCss;
			doc.head.appendChild(tag);
		}
		/**
		 * Open the modal region picker over one captured frame.
		 * @param options - captured frame canvas plus resolved copy.
		 * @returns the chosen image-space rectangle, or null when the user cancels.
		 */
		function openCropper(options) {
			var canvas = options.sourceCanvas;
			var labels = options.labels;
			return new Promise((resolve) => {
				if (typeof document === "undefined" || typeof window === "undefined") {
					resolve(null);
					return;
				}
				ensureStyles(document);
				var imageWidth = canvas.width;
				var imageHeight = canvas.height;
				var maxWidth = Math.max(240, window.innerWidth - 96);
				var maxHeight = Math.max(160, window.innerHeight - 176);
				var scale = fitScale(imageWidth, imageHeight, maxWidth, maxHeight);
				var displayWidth = Math.max(1, Math.round(imageWidth * scale));
				var displayHeight = Math.max(1, Math.round(imageHeight * scale));
				var overlay = document.createElement("div");
				overlay.className = "dsh-screenshot-overlay";
				overlay.setAttribute("role", "dialog");
				overlay.setAttribute("aria-label", labels.title);
				var stage = document.createElement("div");
				stage.className = "dsh-screenshot-stage";
				stage.style.width = String(displayWidth) + "px";
				stage.style.height = String(displayHeight) + "px";
				var frame = document.createElement("img");
				frame.className = "dsh-screenshot-frame";
				frame.alt = "";
				frame.draggable = false;
				frame.src = canvas.toDataURL("image/png");
				var selection = document.createElement("div");
				selection.className = "dsh-screenshot-selection";
				var sizeTag = document.createElement("div");
				sizeTag.className = "dsh-screenshot-size";
				stage.append(frame, selection, sizeTag);
				var bar = document.createElement("div");
				bar.className = "dsh-screenshot-bar";
				var hint = document.createElement("div");
				hint.className = "dsh-screenshot-hint";
				hint.textContent = labels.hint;
				var cancelButton = document.createElement("button");
				cancelButton.type = "button";
				cancelButton.className = "dsh-screenshot-button";
				cancelButton.textContent = labels.cancel;
				var confirmButton = document.createElement("button");
				confirmButton.type = "button";
				confirmButton.className = "dsh-screenshot-button dsh-screenshot-primary";
				confirmButton.textContent = labels.confirm;
				bar.append(hint, cancelButton, confirmButton);
				overlay.append(stage, bar);
				var previousActive = document.activeElement;
				document.body.appendChild(overlay);
				overlay.tabIndex = -1;
				try {
					overlay.focus({ preventScroll: true });
				} catch (error) {
					/* focus is best-effort: the keydown listener is window-level either way */
				}
				var rect = { x: 0, y: 0, width: displayWidth, height: displayHeight };
				var dragStart = null;
				var settled = false;
				function renderSelection() {
					selection.style.left = String(Math.round(rect.x)) + "px";
					selection.style.top = String(Math.round(rect.y)) + "px";
					selection.style.width = String(Math.max(1, Math.round(rect.width))) + "px";
					selection.style.height = String(Math.max(1, Math.round(rect.height))) + "px";
					sizeTag.textContent = formatSize(toImageRect(rect, scale, imageWidth, imageHeight));
					var top = Math.round(rect.y) - 26;
					sizeTag.style.left = String(Math.round(rect.x)) + "px";
					sizeTag.style.top = String(top < 2 ? Math.round(rect.y) + 4 : top) + "px";
				}
				renderSelection();
				function pointOf(event) {
					var box = stage.getBoundingClientRect();
					return {
						x: clamp(event.clientX - box.left, 0, box.width),
						y: clamp(event.clientY - box.top, 0, box.height)
					};
				}
				function onPointerDown(event) {
					if (event.button !== 0) return;
					event.preventDefault();
					event.stopPropagation();
					if (typeof stage.setPointerCapture === "function") stage.setPointerCapture(event.pointerId);
					dragStart = pointOf(event);
					rect = { x: dragStart.x, y: dragStart.y, width: 0, height: 0 };
					renderSelection();
				}
				function onPointerMove(event) {
					if (dragStart === null) return;
					event.preventDefault();
					rect = normalizeSelection(dragStart, pointOf(event), { width: displayWidth, height: displayHeight });
					renderSelection();
				}
				function onPointerUp(event) {
					if (dragStart === null) return;
					if (typeof stage.releasePointerCapture === "function") stage.releasePointerCapture(event.pointerId);
					dragStart = null;
					if (!isUsableSelection(rect)) rect = { x: 0, y: 0, width: displayWidth, height: displayHeight };
					renderSelection();
				}
				function confirmRect() {
					return toImageRect(rect, scale, imageWidth, imageHeight);
				}
				function onKeyDown(event) {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						finish(null);
						return;
					}
					if (event.key === "Enter") {
						event.preventDefault();
						event.stopPropagation();
						finish(confirmRect());
						return;
					}
					event.stopPropagation();
				}
				function cleanup() {
					window.removeEventListener("keydown", onKeyDown, true);
					stage.removeEventListener("pointerdown", onPointerDown);
					stage.removeEventListener("pointermove", onPointerMove);
					stage.removeEventListener("pointerup", onPointerUp);
					stage.removeEventListener("pointercancel", onPointerUp);
					cancelButton.removeEventListener("click", onCancel);
					confirmButton.removeEventListener("click", onConfirm);
					overlay.remove();
					if (previousActive !== null && previousActive !== undefined && typeof previousActive.focus === "function") {
						try {
							previousActive.focus({ preventScroll: true });
						} catch (error) {
							/* the element is gone */
						}
					}
				}
				function finish(result) {
					if (settled) return;
					settled = true;
					cleanup();
					resolve(result);
				}
				function onCancel() {
					finish(null);
				}
				function onConfirm() {
					finish(confirmRect());
				}
				stage.addEventListener("pointerdown", onPointerDown);
				stage.addEventListener("pointermove", onPointerMove);
				stage.addEventListener("pointerup", onPointerUp);
				stage.addEventListener("pointercancel", onPointerUp);
				window.addEventListener("keydown", onKeyDown, true);
				cancelButton.addEventListener("click", onCancel);
				confirmButton.addEventListener("click", onConfirm);
			});
		}
		//#endregion
		//#region lib/client/intake.js
		/** Resolve the composer face of one session, or the reason it is unavailable. */
		function resolveComposer(ctx, sessionId) {
			var sessions = ctx.get("sessions");
			if (sessions === undefined || sessions === null || typeof sessions.scope !== "function") return { ok: false, reason: "sessions-unavailable" };
			var actx = sessions.scope(sessionId);
			if (actx === undefined || actx === null) return { ok: false, reason: "composer-unavailable" };
			var conversation = actx.get("conversation");
			if (conversation === undefined || conversation === null) return { ok: false, reason: "composer-unavailable" };
			var shell = null;
			try {
				shell = conversation.input.for(actx);
			} catch (error) {
				return { ok: false, reason: "composer-unavailable" };
			}
			if (shell === undefined || shell === null) return { ok: false, reason: "composer-unavailable" };
			return { ok: true, target: { sessionId: sessionId, conversation: conversation, shell: shell } };
		}
		/** Register one captured image as a draft attachment and append it to the composer rail. */
		function attachToComposer(target, file) {
			var drafts;
			try {
				drafts = target.conversation.createDrafts(target.sessionId, [file]);
			} catch (error) {
				return { ok: false, reason: "intake-refused", message: messageOf(error) };
			}
			var ids = [];
			for (var index = 0; index < drafts.length; index += 1) ids.push(drafts[index].id);
			if (ids.length === 0) return { ok: false, reason: "intake-refused", message: "the composer created no draft attachment" };
			if (target.shell.addFiles([], ids) !== true) {
				try {
					target.conversation.releaseDraftAttachments(drafts);
				} catch (error) {
					/* already released */
				}
				return { ok: false, reason: "composer-locked" };
			}
			try {
				target.shell.focus();
			} catch (error) {
				/* focus is best-effort */
			}
			return { ok: true, ids: ids };
		}
		//#endregion
		//#region lib/client/native.js
		/** Host-side route prefix owned by this plugin's host half. */
		var NATIVE_ROUTE = "/dsh-screenshot";
		/** Cache of the host capability probe (one fetch per page load). */
		var nativeStatusPromise = null;
		/** Last resolved probe result; read synchronously by the menu availability gate. */
		var nativeStatusSnapshot = null;
		/** Ask the host half whether the native interactive capture (and window hiding) is available. */
		function fetchNativeStatus() {
			if (nativeStatusPromise === null) {
				nativeStatusPromise = (async () => {
					try {
						if (typeof fetch !== "function") return { ok: false };
						var response = await fetch(NATIVE_ROUTE + "/status", { headers: { "x-dsh-screenshot": "1" }, cache: "no-store" });
						if (response.ok !== true) return { ok: false };
						var payload = await response.json();
						return payload !== null && typeof payload === "object" && payload.native === true ? {
							ok: true,
							platform: payload.platform,
							hide: payload.hide === true
						} : { ok: false };
					} catch (error) {
						return { ok: false };
					}
				})().then((result) => {
					nativeStatusSnapshot = result;
					return result;
				});
			}
			return nativeStatusPromise;
		}
		/** Whether the host reported a usable native capture with window hiding. */
		function hideCaptureSupported() {
			return nativeStatusSnapshot !== null && nativeStatusSnapshot.ok === true && nativeStatusSnapshot.hide === true;
		}
		/** Response header the host sets to report whether the application was hidden. */
		var HIDDEN_HEADER = "x-dsh-screenshot-hidden";
		/** Run one interactive native capture through the host half. */
		async function fetchNativeCapture(options) {
			var hide = options !== null && options !== undefined && options.hide === true;
			var response = await fetch(NATIVE_ROUTE + "/native-region" + (hide ? "?hide=1" : ""), { method: "POST", headers: { "x-dsh-screenshot": "1" }, cache: "no-store" });
			if (response.status === 204) return { kind: "cancelled" };
			if (response.ok !== true) {
				var detail = "HTTP " + String(response.status);
				try {
					var payload = await response.json();
					if (payload !== null && typeof payload === "object" && typeof payload.error === "string") detail = payload.error;
				} catch (error) {
					/* non-JSON failure body */
				}
				throw new Error(detail);
			}
			var blob = await response.blob();
			if (blob.size === 0) return { kind: "cancelled" };
			return { kind: "ok", blob: blob, hideFailed: hide && response.headers.get(HIDDEN_HEADER) === "failed" };
		}
		/**
		 * Native-first capture: the host's system crosshair when available, else the in-app display capture.
		 * @param seams - capability probe, native capture, display fallback.
		 * @returns the capture function the menu action calls.
		 */
		function createCapturePipeline(seams) {
			return async function capture(labels, options) {
				var wanted = options !== null && options !== undefined ? options : {};
				var status = { ok: false };
				try {
					status = await seams.nativeStatus();
				} catch (error) {
					status = { ok: false };
				}
				if (status !== null && status !== undefined && status.ok === true) {
					var result;
					try {
						result = await seams.nativeCapture(wanted);
					} catch (error) {
						if (!seams.displaySupported()) throw error;
						var fallback = await seams.displayCapture(labels);
						return { file: fallback, hideUnavailable: wanted.hide === true };
					}
					if (result === null || result === undefined || result.kind === "cancelled") return { file: null };
					return {
						file: new File([result.blob], screenshotName(new Date()), { type: "image/png" }),
						hideFailed: result.hideFailed === true
					};
				}
				var plain = await seams.displayCapture(labels);
				return { file: plain, hideUnavailable: wanted.hide === true };
			};
		}
		//#endregion
		//#region lib/client/flow.js
		/** Copy for one attach refusal. */
		function reasonNotice(labels, reason, message) {
			if (reason === "composer-locked") return labels.composerLocked;
			if (reason === "composer-unavailable") return labels.composerUnavailable;
			if (reason === "sessions-unavailable") return labels.sessionsUnavailable;
			return labels.intakeRefused.replace("{message}", message === undefined ? labels.unknown : message);
		}
		/** In-app capture: pick a display surface, then crop one frame in the overlay. */
		async function displayCapture(labels) {
			if (!captureSupported()) throw unsupportedError();
			var stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
			var canvas;
			try {
				canvas = await streamToCanvas(stream);
			} finally {
				stopTracks(stream);
			}
			var selection = await openCropper({ sourceCanvas: canvas, labels: labels });
			if (selection === null) return null;
			var blob = await canvasToBlob(cropCanvas(canvas, selection));
			return new File([blob], screenshotName(new Date()), { type: "image/png" });
		}
		/**
		 * Build the menu action: resolve the composer, capture, attach, report.
		 * @param deps - composer resolution, capture, attach, notify, and copy.
		 * @returns the async action the menu invokes for one session.
		 */
		function createScreenshotAction(deps) {
			return async function screenshotAction(session, options) {
				var labels = deps.labels();
				var resolved = { ok: false, reason: "composer-unavailable" };
				try {
					resolved = deps.resolveComposer(session);
				} catch (error) {
					resolved = { ok: false, reason: "composer-unavailable" };
				}
				function notify(level, text) {
					if (resolved.ok !== true) {
						console.warn("[dsh-screenshot] " + text);
						return;
					}
					try {
						deps.notify(resolved.target, level, text);
					} catch (error) {
						/* noticing is best-effort */
					}
				}
				if (resolved.ok !== true) {
					notify("error", reasonNotice(labels, resolved.reason));
					return;
				}
				var captured = null;
				try {
					captured = await deps.capture(labels, options === null || options === undefined ? {} : options);
				} catch (error) {
					var kind = classifyCaptureError(error);
					if (kind === "cancelled") return;
					if (kind === "denied") {
						notify("info", labels.cancelled);
						return;
					}
					if (kind === "unsupported") {
						notify("error", labels.unsupported);
						return;
					}
					notify("error", labels.failed.replace("{message}", messageOf(error)));
					return;
				}
				if (captured === null || captured.file === null) return;
				if (captured.hideFailed === true) notify("info", labels.hideFailed);
				if (captured.hideUnavailable === true) notify("info", labels.hideUnavailable);
				var result = deps.attach(resolved.target, captured.file);
				if (result.ok !== true) notify("error", reasonNotice(labels, result.reason, result.message));
			};
		}
		//#endregion
		//#region lib/client/index.js
		/** Menu glyph: the shared fullscreen icon, with an inline fallback. */
		function fallbackIcon(props) {
			var size = props !== null && props !== undefined && props.size !== undefined ? props.size : 14;
			return react.createElement("svg", {
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				"aria-hidden": true,
				focusable: false
			}, react.createElement("path", {
				fill: "currentColor",
				d: "M2 2h4v1.5H3.5V6H2V2Zm8 0h4v4h-1.5V3.5H10V2ZM2 10h1.5v2.5H6V14H2v-4Zm10.5 0H14v4h-4v-1.5h2.5V10Z"
			}));
		}
		var CaptureIcon = primitives !== null && primitives !== undefined && typeof primitives.IconFullscreenOutlineRegular === "function" ? primitives.IconFullscreenOutlineRegular : fallbackIcon;
		/** Real seams: the host native route first, the in-app display capture as the fallback. */
		var capturePipeline = createCapturePipeline({
			nativeStatus: fetchNativeStatus,
			nativeCapture: fetchNativeCapture,
			displaySupported: captureSupported,
			displayCapture: displayCapture
		});
		/** Mount the menu contribution over the localizing locale service. */
		function apply(ctx) {
			void fetchNativeStatus();
			var locale = ctx.get("locale");
			if (locale !== undefined && locale !== null && typeof locale.register === "function") {
				ctx.effect(() => locale.register(NS, { zh: zh, en: en }), "dsh-screenshot: dictionaries");
			}
			function translate(key) {
				if (locale !== undefined && locale !== null && typeof locale.bind === "function") return locale.bind(NS)(key);
				return zh[key] !== undefined ? zh[key] : key;
			}
			function labels() {
				return {
					title: translate("crop.title"),
					hint: translate("crop.hint"),
					confirm: translate("crop.confirm"),
					cancel: translate("crop.cancel"),
					cancelled: translate("notice.cancelled"),
					unsupported: translate("notice.unsupported"),
					failed: translate("notice.failed"),
					composerLocked: translate("notice.composerLocked"),
					composerUnavailable: translate("notice.composerUnavailable"),
					sessionsUnavailable: translate("notice.sessionsUnavailable"),
					intakeRefused: translate("notice.intakeRefused"),
					hideFailed: translate("notice.hideFailed"),
					hideUnavailable: translate("notice.hideUnavailable"),
					unknown: translate("notice.unknown")
				};
			}
			ctx.inject(["commandUi", "sessions"], (scope) => {
				var commandUi = scope.get("commandUi");
				if (commandUi === undefined || commandUi === null || typeof commandUi.register !== "function") return;
				var action = createScreenshotAction({
					labels: labels,
					resolveComposer: (session) => resolveComposer(scope, session.sessionId),
					capture: (copy, options) => capturePipeline(copy, options),
					attach: (target, file) => attachToComposer(target, file),
					notify: (target, level, text) => {
						if (target !== null && target !== undefined && target.shell !== undefined && typeof target.shell.notify === "function") target.shell.notify(level, text);
					}
				});
				function composerReady(session) {
					try {
						return resolveComposer(scope, session.sessionId).ok === true;
					} catch (error) {
						return false;
					}
				}
				function runAction(session, options) {
					action(session, options).catch((error) => {
						console.error("[dsh-screenshot] capture action failed", error);
					});
				}
				scope.effect(() => commandUi.register({
					name: "screenshot",
					label: () => translate("menu.label"),
					description: () => translate("menu.description"),
					icon: CaptureIcon,
					available: (session) => captureSupported() && composerReady(session),
					ui: {
						kind: "action",
						run: (session) => runAction(session, {})
					}
				}), "dsh-screenshot: menu contribution");
				scope.effect(() => commandUi.register({
					name: "screenshot-hidden",
					label: () => translate("menu.labelHidden"),
					description: () => translate("menu.descriptionHidden"),
					icon: CaptureIcon,
					available: (session) => hideCaptureSupported() && composerReady(session),
					ui: {
						kind: "action",
						run: (session) => runAction(session, { hide: true })
					}
				}), "dsh-screenshot: hidden-window menu contribution");
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = ["locale", "commandUi", "sessions"];
		/** Test-only surface; the client module system ignores unknown exports. */
		exports.__testing = {
			NS: NS,
			zh: zh,
			en: en,
			fileStamp: fileStamp,
			screenshotName: screenshotName,
			clamp: clamp,
			fitScale: fitScale,
			normalizeSelection: normalizeSelection,
			isUsableSelection: isUsableSelection,
			toImageRect: toImageRect,
			classifyCaptureError: classifyCaptureError,
			captureSupported: captureSupported,
			resolveComposer: resolveComposer,
			attachToComposer: attachToComposer,
			createScreenshotAction: createScreenshotAction,
			createCapturePipeline: createCapturePipeline,
			displayCapture: displayCapture,
			fetchNativeStatus: fetchNativeStatus,
			fetchNativeCapture: fetchNativeCapture,
			hideCaptureSupported: hideCaptureSupported,
			reasonNotice: reasonNotice,
			apply: apply
		};
		return module.exports;
	}
});
