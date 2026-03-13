import fs from "node:fs/promises";
import path from "node:path";
import { assertLoggedIn, attachToLoggedInBrowser, findNicePage } from "./browser.js";
import { AutomationError } from "./errors.js";
import { ensureDir } from "./io.js";
import { handlePostSaveConfirmationRobust } from "./popup-actions.js";

async function collectConfirmProbeState(page) {
  return page.evaluate(() => {
    const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
    const dialogs = Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']"));

    const confirmationDialog = dialogs.find((dialog) => {
      const text = normalize(dialog.textContent);
      return text.includes("해당자료를 저장하시겠습니까?") || (text.includes("확인") && text.includes("취소"));
    });

    return {
      dialogCount: dialogs.length,
      confirmationOpen: Boolean(confirmationDialog),
      dialogTexts: dialogs.map((dialog) => normalize(dialog.textContent).slice(0, 300)),
    };
  });
}

async function saveProbeArtifact(projectRoot, fileName, payload) {
  const artifactDir = path.join(projectRoot, "artifacts", "confirm-test");
  await ensureDir(artifactDir);
  const filePath = path.join(artifactDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export async function runConfirmTest({
  attachConfig,
  selectorsConfig,
  logger,
  projectRoot,
}) {
  const { browser, context } = await attachToLoggedInBrowser(attachConfig, logger);
  const page = await findNicePage(context, attachConfig, logger);

  try {
    await assertLoggedIn(page, selectorsConfig);
    await page.bringToFront();

    const beforeState = await collectConfirmProbeState(page);
    if (!beforeState.confirmationOpen) {
      throw new AutomationError("Save confirmation dialog is not open. Open it first, then run confirm-test.");
    }

    const beforeJsonPath = await saveProbeArtifact(projectRoot, "before.json", beforeState);
    const beforeScreenshotPath = path.join(projectRoot, "artifacts", "confirm-test", "before.png");
    await page.screenshot({ path: beforeScreenshotPath, fullPage: true });
    await logger.info("Saved confirm-test before artifacts.", {
      beforeJsonPath,
      beforeScreenshotPath,
    });

    const accepted = await handlePostSaveConfirmationRobust(page, logger, 4000);
    await page.waitForTimeout(500);

    const afterState = await collectConfirmProbeState(page);
    const afterJsonPath = await saveProbeArtifact(projectRoot, "after.json", afterState);
    const afterScreenshotPath = path.join(projectRoot, "artifacts", "confirm-test", "after.png");
    await page.screenshot({ path: afterScreenshotPath, fullPage: true });
    await logger.info("Saved confirm-test after artifacts.", {
      accepted,
      afterJsonPath,
      afterScreenshotPath,
    });
  } finally {
    if (browser.isConnected()) {
      await logger.info("Leaving the logged-in browser session open after confirm test.");
    }
  }
}
