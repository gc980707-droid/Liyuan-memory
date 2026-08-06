import assert from "node:assert/strict";
import test from "node:test";
import { parseFallbackStatus, stripFallbackStatus } from "../web/src/statusFallback.ts";

test("识别 Markdown 角色状态栏", () => {
	const status = parseFallbackStatus(`📅 7月15日\n⏰ 16:05\n📍 1号包厢\n\n- 苏小棉的状态\n  - 👤 姓名：苏小棉\n  - 📝 当前行动：装睡\n  - 💭 当前内心：观察\n  - 👗 当前穿搭：JK\n  - 📊 粉丝数：28万`);
	assert.equal(status?.sections[0]?.title, "苏小棉的状态");
	assert.equal(status?.sections[0]?.fields.length, 5);
	assert.equal(stripFallbackStatus(`正文\n\n📅 7月15日\n- 苏小棉的状态\n- 姓名：苏小棉\n- 行动：装睡\n- 内心：观察\n- 穿搭：JK`), "正文");
});

test("普通正文不误判为状态栏", () => {
	assert.equal(parseFallbackStatus("她的状态很差。\n地点：车站\n时间：下午"), null);
});
