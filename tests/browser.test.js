import test from "node:test";
import assert from "node:assert/strict";
import { scoreNicePageCandidate } from "../src/lib/browser.js";

test("scoreNicePageCandidate prioritizes the NICE main window", () => {
  const attachConfig = {
    preferredUrlIncludes: ["pen.neis.go.kr/jsp/main.jsp", "pen.neis.go.kr"],
    urlIncludes: ["pen.neis.go.kr", "neis.go.kr"],
    excludeUrlIncludes: ["about:blank", "chrome://", "edge://", "newtab"],
    titleIncludes: ["NEIS"],
  };

  const blankScore = scoreNicePageCandidate("about:blank", "", attachConfig);
  const portalScore = scoreNicePageCandidate(
    "https://gw.pen.go.kr/portal/main",
    "업무포털 메인",
    attachConfig,
  );
  const niceScore = scoreNicePageCandidate(
    "https://pen.neis.go.kr/jsp/main.jsp",
    "4세대 나이스 시스템",
    attachConfig,
  );

  assert.equal(blankScore, -1);
  assert.equal(portalScore, 0);
  assert.ok(niceScore > portalScore);
});
