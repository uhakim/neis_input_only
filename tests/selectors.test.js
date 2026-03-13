import test from "node:test";
import assert from "node:assert/strict";
import { buildSelectorAttempts, findUnmatchedNames } from "../src/lib/selectors.js";

test("buildSelectorAttempts prioritizes text, role, and selector candidates", () => {
  const attempts = buildSelectorAttempts({
    text: "출결",
    role: "link",
    name: "출결",
    selector: "a.menu-attendance",
    title: "출결관리",
    hrefIncludes: "attendance",
  });

  assert.deepEqual(attempts, [
    { type: "text", query: "출결" },
    { type: "role", role: "link", name: "출결" },
    { type: "selector", query: "a.menu-attendance" },
    { type: "selector", query: "[title=\"출결관리\"]" },
    { type: "selector", query: "a[href*=\"attendance\"]" },
  ]);
});

test("findUnmatchedNames detects names missing from the current page", () => {
  const unmatched = findUnmatchedNames(
    ["홍길동", " 김영희 ", "이철수"],
    ["홍길동", "김영희"],
  );

  assert.deepEqual(unmatched, ["이철수"]);
});
