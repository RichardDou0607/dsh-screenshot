import { test } from "node:test";
import assert from "node:assert/strict";
import { findOwnBlocks, namesOurEntry, withoutOurBlocks, withOurBlock, ENTRY_PATH } from "../scripts/patch-entry.mjs";

const OUR_BLOCK = [
	"# >>> dsh-screenshot plugin >>>",
	"- insert:",
	"    - id: dsh-screenshot",
	"      name: '" + ENTRY_PATH + "'",
	"# <<< dsh-screenshot plugin <<<"
].join("\n");

test("only rows naming this plugin's entry are recognised", () => {
	assert.equal(namesOurEntry("      name: '" + ENTRY_PATH + "'"), true);
	assert.equal(namesOurEntry("      name: 'dsh-screenshot'"), false, "a managed bundle row must not be touched");
	assert.equal(namesOurEntry("    - id: whale-pet"), false);
});

test("a foreign entry inside the markers survives unmount", () => {
	// 真实事故回放：插件管理器把 - id: whale-pet 追加到文件末尾，正好落在两个标记之间
	const fixture = [
		"- id: ui-theme",
		"  config:",
		"    preference: system",
		"",
		"# >>> dsh-screenshot plugin >>>",
		"- insert:",
		"    - id: dsh-screenshot",
		"      name: '" + ENTRY_PATH + "'",
		"- id: whale-pet",
		"  disabled: true",
		"",
		"# <<< dsh-screenshot plugin <<<"
	].join("\n");
	const result = withoutOurBlocks(fixture);
	assert.equal(result.removed, 1);
	assert.ok(!result.text.includes("dsh-screenshot"), "our rows are gone");
	assert.ok(result.text.includes("- id: whale-pet"), "the foreign entry survives");
	assert.ok(result.text.includes("disabled: true"));
	assert.ok(result.text.includes("- id: ui-theme"), "unrelated entries survive");
	assert.ok(!result.text.includes("# >>> dsh-screenshot plugin >>>"), "our markers are gone");
});

test("a managed bundle row is never removed", () => {
	const fixture = ["- insert:", "    - id: dsh-screenshot", "      name: 'dsh-screenshot'"].join("\n");
	const result = withoutOurBlocks(fixture);
	assert.equal(result.removed, 0);
	assert.equal(result.text.trim(), fixture.trim());
});

test("mount is idempotent and unmount is exact", () => {
	const base = ["- id: ui-theme", "  config:", "    preference: system", ""].join("\n");
	const once = withOurBlock(base);
	const twice = withOurBlock(once);
	assert.equal(once, twice, "mounting twice yields one block");
	assert.equal(findOwnBlocks(once.split("\n")).length, 1);
	assert.ok(once.includes("- id: ui-theme"), "existing entries keep their place");
	const cleared = withoutOurBlocks(twice);
	assert.equal(cleared.removed, 1);
	assert.equal(cleared.text.trim(), base.trim());
});

test("a foreign list item between markers is reported as one block, not two", () => {
	const fixture = ["- insert:", "    - id: dsh-screenshot", "      name: '" + ENTRY_PATH + "'", "- id: whale-pet", "  disabled: true"].join("\n");
	assert.equal(findOwnBlocks(fixture.split("\n")).length, 1);
});
