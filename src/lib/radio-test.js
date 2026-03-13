import fs from "node:fs/promises";
import path from "node:path";
import { assertLoggedIn, attachToLoggedInBrowser, findNicePage } from "./browser.js";
import { AutomationError } from "./errors.js";
import { ensureDir } from "./io.js";
import { clickAttendanceTypeOptionDomRobust } from "./popup-actions.js";
import { waitForSignals } from "./selectors.js";

async function collectRadioProbeState(page, requestedType) {
  return page.evaluate((type) => {
    const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
    const dialogs = Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']"));
    const attendanceDialog = dialogs.find((dialog) => normalize(dialog.textContent).includes("일일출결입력"));

    if (!attendanceDialog) {
      return {
        popupOpen: false,
        requestedType: type,
        dialogTexts: dialogs.map((dialog) => normalize(dialog.textContent).slice(0, 200)),
      };
    }

    const relevantNodes = Array.from(attendanceDialog.querySelectorAll("*"))
      .filter((element) => {
        const hay = [
          normalize(element.textContent),
          normalize(element.getAttribute("aria-label")),
          normalize(element.getAttribute("title")),
          normalize(element.getAttribute("role")),
          normalize(element.className),
        ].join(" ");
        return (
          hay.includes("결석") ||
          hay.includes(type) ||
          hay.includes("radio") ||
          hay.includes("라디오")
        );
      })
      .slice(0, 80)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          role: element.getAttribute("role"),
          text: normalize(element.textContent),
          ariaLabel: normalize(element.getAttribute("aria-label")),
          title: normalize(element.getAttribute("title")),
          className: normalize(element.className),
          checked: "checked" in element ? Boolean(element.checked) : null,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });

    return {
      popupOpen: true,
      requestedType: type,
      relevantNodes,
    };
  }, requestedType);
}

async function saveProbeArtifact(projectRoot, fileName, payload) {
  const artifactDir = path.join(projectRoot, "artifacts", "radio-test");
  await ensureDir(artifactDir);
  const filePath = path.join(artifactDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export async function runRadioTest({
  attachConfig,
  selectorsConfig,
  logger,
  projectRoot,
  requestedType = "질병",
}) {
  const { browser, context } = await attachToLoggedInBrowser(attachConfig, logger);
  const page = await findNicePage(context, attachConfig, logger);

  try {
    await assertLoggedIn(page, selectorsConfig);
    await page.bringToFront();

    if (!selectorsConfig.dialog?.openSignals?.length) {
      throw new AutomationError("Dialog open signals are missing from selector config.");
    }

    await waitForSignals(page, selectorsConfig.dialog.openSignals, 3000);

    const beforeState = await collectRadioProbeState(page, requestedType);
    const beforeJsonPath = await saveProbeArtifact(projectRoot, "before.json", beforeState);
    const beforeScreenshotPath = path.join(projectRoot, "artifacts", "radio-test", "before.png");
    await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
    await logger.info("Saved radio-test before artifacts.", {
      beforeJsonPath,
      beforeScreenshotPath,
    });

    await clickAttendanceTypeOptionDomRobust(page, requestedType, logger);
    await page.waitForTimeout(400);

    const afterState = await collectRadioProbeState(page, requestedType);
    const afterJsonPath = await saveProbeArtifact(projectRoot, "after.json", afterState);
    const afterScreenshotPath = path.join(projectRoot, "artifacts", "radio-test", "after.png");
    await page.screenshot({ path: afterScreenshotPath, fullPage: true });
    await logger.info("Saved radio-test after artifacts.", {
      afterJsonPath,
      afterScreenshotPath,
    });
  } finally {
    if (browser.isConnected()) {
      await logger.info("Leaving the logged-in browser session open after radio test.");
    }
  }
}
