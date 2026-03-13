import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDateTokens,
  extractValueWithPattern,
  handlePostSaveConfirmation,
  navigateToAttendancePage,
} from "../src/lib/attendance.js";

function createLocator(foundCount, state) {
  return {
    first() {
      return this;
    },
    async count() {
      return foundCount;
    },
    async click() {
      state.clicked += 1;
    },
  };
}

function createFrame(url, options) {
  return {
    url() {
      return url;
    },
    getByText(text) {
      return createLocator(options.texts.includes(text) ? 1 : 0, options.state);
    },
    getByRole(role, config) {
      return createLocator(
        options.roles.some((entry) => entry.role === role && entry.name === config.name) ? 1 : 0,
        options.state,
      );
    },
    locator(selector) {
      return createLocator(options.selectors.includes(selector) ? 1 : 0, options.state);
    },
  };
}

test("navigateToAttendancePage clicks matching candidates in order", async () => {
  const state = { clicked: 0, waitCalls: 0 };
  const page = {
    frames() {
      return [
        createFrame("frame://main", {
          texts: ["학생생활", "출결", "학급"],
          roles: [],
          selectors: [],
          state,
        }),
      ];
    },
    async waitForTimeout() {
      state.waitCalls += 1;
    },
  };

  await navigateToAttendancePage(
    page,
    {
      navigationSteps: [
        {
          name: "학생생활",
          candidates: [{ text: "학생생활" }],
          successSignals: [{ text: "출결" }],
        },
        {
          name: "출결",
          candidates: [{ text: "출결" }],
          successSignals: [{ text: "학급" }],
        },
      ],
    },
    {
      info: async () => {},
      warn: async () => {},
    },
  );

  assert.equal(state.clicked, 2);
});

test("extractValueWithPattern pulls student names from aria labels", () => {
  const pattern = /성명\s+(?<name>[^\s]+)/u;
  const name = extractValueWithPattern("12행 성명 김도현 ", pattern);
  assert.equal(name, "김도현");
});

test("buildDateTokens returns day and month tokens for grid selectors", () => {
  assert.deepEqual(buildDateTokens("2026-03-13"), {
    day: "13",
    dayPadded: "13",
    month: "3",
    monthPadded: "03",
    year: "2026",
  });
});

test("buildDateTokens also accepts dotted attendance dates", () => {
  assert.deepEqual(buildDateTokens("2026.03.05."), {
    day: "5",
    dayPadded: "05",
    month: "3",
    monthPadded: "03",
    year: "2026",
  });
});

test("handlePostSaveConfirmation accepts the confirm dialog when confirm button exists", async () => {
  const state = { evaluateCalls: 0, waitCalls: 0 };
  const page = {
    async evaluate() {
      state.evaluateCalls += 1;
      return { found: true, clicked: true };
    },
    async waitForTimeout() {
      state.waitCalls += 1;
    },
  };

  const result = await handlePostSaveConfirmation(
    page,
    {
      info: async () => {},
      warn: async () => {},
    },
    500,
  );

  assert.equal(result, true);
  assert.equal(state.evaluateCalls, 1);
  assert.equal(state.waitCalls, 0);
});

test("handlePostSaveConfirmation returns false when no confirm dialog appears", async () => {
  const state = { evaluateCalls: 0, waitCalls: 0 };
  const page = {
    async evaluate() {
      state.evaluateCalls += 1;
      return { found: false };
    },
    async waitForTimeout() {
      state.waitCalls += 1;
    },
  };

  const result = await handlePostSaveConfirmation(
    page,
    {
      info: async () => {},
      warn: async () => {},
    },
    450,
  );

  assert.equal(result, false);
  assert.ok(state.evaluateCalls >= 1);
  assert.ok(state.waitCalls >= 1);
});
