import fs from "node:fs/promises";
import path from "node:path";
import { attachToLoggedInBrowser, assertLoggedIn, findNicePage } from "./browser.js";
import { AutomationError, VerificationError } from "./errors.js";
import { ensureDir } from "./io.js";
import {
  acknowledgeInformationalAlertRobust,
  clickAttendanceTypeOptionDomRobust,
  handlePostSaveConfirmationRobust,
} from "./popup-actions.js";
import {
  findFirstMatchingLocator,
  findUnmatchedNames,
  waitForSignals,
} from "./selectors.js";

export function extractValueWithPattern(value, pattern) {
  const match = value.match(pattern);
  return match?.groups?.name ?? match?.[1] ?? "";
}

export function buildDateTokens(targetDate) {
  const normalizedTargetDate =
    typeof targetDate === "string"
      ? targetDate.replace(/\./g, "-").replace(/-$/, "")
      : targetDate;
  const date = new Date(normalizedTargetDate);
  if (Number.isNaN(date.valueOf())) {
    throw new AutomationError(`Invalid targetDate: ${targetDate}`);
  }

  return {
    day: String(date.getDate()),
    dayPadded: String(date.getDate()).padStart(2, "0"),
    month: String(date.getMonth() + 1),
    monthPadded: String(date.getMonth() + 1).padStart(2, "0"),
    year: String(date.getFullYear()),
  };
}

function resolveFieldTargetDate(fieldValue, jobConfig) {
  if (typeof fieldValue === "object" && fieldValue !== null) {
    return fieldValue.targetDate ?? fieldValue.startDate ?? jobConfig.targetDate;
  }

  return jobConfig.targetDate;
}

function replaceTemplateTokens(template, tokens) {
  return Object.entries(tokens).reduce(
    (current, [key, value]) => current.replaceAll(`\${${key}}`, String(value)),
    template,
  );
}

async function captureArtifact(page, projectRoot, stageName, logger) {
  const artifactDir = path.join(projectRoot, "artifacts");
  await ensureDir(artifactDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(artifactDir, `${stageName}-${stamp}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  await logger.info("Saved screenshot artifact.", { stageName, filePath });
}

async function clickCandidate(page, candidates, logger, stageName) {
  const matched = await findFirstMatchingLocator(page, candidates, logger);
  const force = candidates.some((candidate) => candidate.force === true);
  await matched.locator.click({ timeout: 10000, force });
  await logger.info("Clicked selector candidate.", {
    stageName,
    frame: matched.frame.url(),
    attempt: matched.attempt,
    force,
  });
}

async function clickResolvedCandidates(page, candidates, tokens, logger, stageName) {
  const resolvedCandidates = candidates.map((candidate) => ({
    ...candidate,
    text: candidate.text ? replaceTemplateTokens(candidate.text, tokens) : undefined,
    selector: candidate.selector ? replaceTemplateTokens(candidate.selector, tokens) : undefined,
    title: candidate.title ? replaceTemplateTokens(candidate.title, tokens) : undefined,
    hrefIncludes: candidate.hrefIncludes
      ? replaceTemplateTokens(candidate.hrefIncludes, tokens)
      : undefined,
    name: candidate.name ? replaceTemplateTokens(candidate.name, tokens) : undefined,
  }));

  await clickCandidate(page, resolvedCandidates, logger, stageName);
}

async function tryClickResolvedCandidates(page, candidates, tokens, logger, stageName) {
  try {
    await clickResolvedCandidates(page, candidates, tokens, logger, stageName);
    return true;
  } catch (error) {
    await logger.warn("Resolved selector candidates did not match. Continuing.", {
      stageName,
      message: error.message,
    });
    return false;
  }
}

async function fillFieldWithCandidates(page, fieldConfig, value, logger) {
  const matched = await findFirstMatchingLocator(page, fieldConfig.candidates, logger);
  await matched.locator.click({ timeout: 10000 });
  await matched.locator.fill(String(value));
  await logger.info("Filled field.", {
    field: fieldConfig.name,
    value,
    frame: matched.frame.url(),
  });
}

async function extractStudentNames(page, selectorsConfig) {
  const nameConfig = selectorsConfig.studentList?.nameCells;
  if (!nameConfig) {
    throw new AutomationError("Missing student list selector configuration.");
  }

  const matched = await findFirstMatchingLocator(page, nameConfig.candidates, {
    info: async () => {},
    warn: async () => {},
  });

  const extractor = nameConfig.extractor ?? "textContents";
  if (extractor === "ariaLabelRegex") {
    const labelPattern = new RegExp(nameConfig.ariaLabelPattern ?? "", "u");
    const labels = await matched.frame
      .locator(nameConfig.extractSelector ?? nameConfig.candidates[0].selector)
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("aria-label") || ""),
      );

    return labels
      .map((label) => extractValueWithPattern(label, labelPattern))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const values = await matched.frame
    .locator(nameConfig.extractSelector ?? nameConfig.candidates[0].selector)
    .allTextContents();
  return values.map((value) => value.trim()).filter(Boolean);
}

async function verifyContext(page, jobConfig, attendanceInput, selectorsConfig, logger) {
  const assertions = selectorsConfig.contextAssertions ?? [];
  for (const assertion of assertions) {
    const expectedValue =
      assertion.expectedFrom === "jobConfig"
        ? jobConfig[assertion.key]
        : attendanceInput[assertion.key];
    if (expectedValue === undefined) {
      continue;
    }

    const candidateValues = assertion.candidates.map((candidate) => ({
      ...candidate,
      text: candidate.text ? candidate.text.replace("${value}", String(expectedValue)) : undefined,
      selector: candidate.selector
        ? candidate.selector.replace("${value}", String(expectedValue))
        : undefined,
    }));

    await findFirstMatchingLocator(page, candidateValues, logger);
    await logger.info("Verified context signal.", {
      key: assertion.key,
      expectedValue,
    });
  }

  const actualNames = await extractStudentNames(page, selectorsConfig);
  const expectedNames = (attendanceInput.students ?? []).map((student) => student.name);

  if (selectorsConfig.studentList?.virtualized) {
    if (!actualNames.length) {
      throw new VerificationError("Student grid is visible, but no visible student names were detected.");
    }

    const visibleExpectedNames = expectedNames.filter((name) => actualNames.includes(name));
    await logger.info("Detected visible student subset in virtualized grid.", {
      visibleStudentCount: actualNames.length,
      visibleStudents: actualNames.slice(0, 10),
      visibleExpectedNames,
    });
    return;
  }

  const unmatchedNames = findUnmatchedNames(expectedNames, actualNames);
  if (unmatchedNames.length) {
    throw new VerificationError("Student list on screen does not match input.", {
      unmatchedNames,
      actualNames,
    });
  }
}

async function findAttendanceGrid(page, selectorsConfig, logger) {
  const gridCandidates = selectorsConfig.grid?.candidates;
  if (!gridCandidates?.length) {
    throw new AutomationError("Missing grid selector configuration.");
  }

  const matched = await findFirstMatchingLocator(page, gridCandidates, logger);

  if (matched.attempt?.type === "selector") {
    const visibleLocator = matched.frame.locator(`${matched.attempt.query}:visible`).first();
    if (await visibleLocator.count()) {
      const visibleBox = await visibleLocator.boundingBox().catch(() => null);
      if (visibleBox) {
        return {
          ...matched,
          locator: visibleLocator,
        };
      }
    }
  }

  return matched;
}

async function listVisibleStudentNames(page, selectorsConfig) {
  return extractStudentNames(page, selectorsConfig);
}

async function scrollGridByWheel(page, gridLocator, stepY, settleMs) {
  let box = await gridLocator.boundingBox().catch(() => null);
  if (!box) {
    const visibleCandidate = gridLocator.locator(":visible").first();
    if (await visibleCandidate.count()) {
      box = await visibleCandidate.boundingBox().catch(() => null);
    }
  }

  if (!box) {
    throw new AutomationError("Could not determine attendance grid bounding box.");
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, stepY);
  await page.waitForTimeout(settleMs);
}

async function resetGridToTop(page, selectorsConfig, logger) {
  const gridMatch = await findAttendanceGrid(page, selectorsConfig, logger);
  const settleMs = selectorsConfig.grid?.scrollSettleMs ?? 400;
  const resetWheelPx = selectorsConfig.grid?.resetWheelPx ?? 1200;
  let previousSignature = "";
  let stableCount = 0;

  for (let attempt = 0; attempt < (selectorsConfig.grid?.resetAttempts ?? 8); attempt += 1) {
    const visibleNames = await listVisibleStudentNames(page, selectorsConfig);
    const signature = visibleNames.join("|");
    if (signature && signature === previousSignature) {
      stableCount += 1;
    } else {
      stableCount = 0;
    }

    if (stableCount >= 1) {
      await logger.info("Attendance grid reset to the top boundary.", {
        visibleNames: visibleNames.slice(0, 5),
      });
      return;
    }

    previousSignature = signature;
    try {
      await scrollGridByWheel(page, gridMatch.locator, -resetWheelPx, settleMs);
    } catch (error) {
      await logger.warn("Skipping grid reset because the visible grid could not be measured.", {
        message: error.message,
      });
      return;
    }
  }

  await logger.warn("Stopped grid reset after max attempts.", {});
}

function buildRowCandidates(rowConfig, studentName) {
  return rowConfig.rowCandidates.map((candidate) => ({
    ...candidate,
    text: candidate.text ? candidate.text.replace("${name}", studentName) : undefined,
    selector: candidate.selector ? candidate.selector.replace("${name}", studentName) : undefined,
  }));
}

async function findVisibleStudentRow(page, rowConfig, studentName, logger) {
  try {
    return await findFirstMatchingLocator(page, buildRowCandidates(rowConfig, studentName), logger);
  } catch {
    return null;
  }
}

async function ensureStudentRowVisible(page, selectorsConfig, studentName, logger) {
  const rowConfig = selectorsConfig.attendanceRows;
  const gridConfig = selectorsConfig.grid ?? {};
  const settleMs = gridConfig.scrollSettleMs ?? 400;
  const stepY = gridConfig.verticalScrollStepPx ?? 240;

  if (gridConfig.resetBeforeProcessing) {
    await resetGridToTop(page, selectorsConfig, logger);
  }

  const initiallyVisibleNames = await listVisibleStudentNames(page, selectorsConfig);
  if (initiallyVisibleNames.includes(studentName)) {
    const directMatch = await findVisibleStudentRow(page, rowConfig, studentName, logger);
    if (directMatch) {
      return directMatch;
    }
  }

  const gridMatch = await findAttendanceGrid(page, selectorsConfig, logger);
  const seenSignatures = new Set();

  for (let attempt = 0; attempt < (gridConfig.maxScrollAttempts ?? 30); attempt += 1) {
    const visibleNames = await listVisibleStudentNames(page, selectorsConfig);
    const signature = visibleNames.join("|");
    await logger.info("Scanning visible student window.", {
      studentName,
      attempt,
      visibleNames: visibleNames.slice(0, 10),
    });

    if (visibleNames.includes(studentName)) {
      const matchedRow = await findVisibleStudentRow(page, rowConfig, studentName, logger);
      if (matchedRow) {
        return matchedRow;
      }
    }

    if (seenSignatures.has(signature)) {
      break;
    }
    seenSignatures.add(signature);
    await scrollGridByWheel(page, gridMatch.locator, stepY, settleMs);
  }

  throw new VerificationError("Could not make the target student visible in the attendance grid.", {
    studentName,
  });
}

async function applyFieldAction(page, matchedRow, fieldSelector, fieldValue, jobConfig, logger, studentName, fieldName, selectorsConfig) {
  const fieldTargetDate = resolveFieldTargetDate(fieldValue, jobConfig);
  const tokens = {
    name: studentName,
    value: fieldValue,
    targetDate: fieldTargetDate,
    ...buildDateTokens(fieldTargetDate),
  };

  const selectorTemplate = fieldSelector.selectorTemplate
    ? replaceTemplateTokens(fieldSelector.selectorTemplate, tokens)
    : null;
  const locator = selectorTemplate ? matchedRow.locator.locator(selectorTemplate).first() : matchedRow.locator;
  const clickOptions = fieldSelector.force ? { force: true } : {};

  if (fieldSelector.action === "fill") {
    await locator.fill(String(fieldValue));
  } else if (fieldSelector.action === "click") {
    await locator.click(clickOptions);
  } else if (fieldSelector.action === "select") {
    await locator.selectOption(String(fieldValue));
  } else if (fieldSelector.action === "clickCellByDay") {
    try {
      await locator.click(clickOptions);
    } catch (error) {
      if (!fieldSelector.fallbackCandidates?.length) {
        throw error;
      }

      await logger.warn("Primary day-cell click failed. Trying fallback candidates.", {
        student: studentName,
        fieldName,
        message: error.message,
      });
      await clickResolvedCandidates(page, fieldSelector.fallbackCandidates, tokens, logger, `${fieldName}:fallback`);
    }
    await applyAttendanceDialog(page, fieldValue, tokens, selectorsConfig, logger);
  } else if (fieldSelector.action === "doubleClickCellByDay") {
    await locator.dblclick(clickOptions);
    await applyAttendanceDialog(page, fieldValue, tokens, selectorsConfig, logger);
  } else {
    throw new AutomationError(`Unsupported attendance field action: ${fieldSelector.action}`);
  }

  const followUpCandidates = fieldSelector.valueCandidates?.[fieldValue];
  if (followUpCandidates?.length) {
    await clickCandidate(page, followUpCandidates, logger, `${fieldName}:${fieldValue}`);
  }

  await logger.info("Applied student attendance value.", {
    student: studentName,
    fieldName,
    fieldValue,
    action: fieldSelector.action,
    selectorTemplate,
  });
}

async function applyStudentAttendance(page, jobConfig, attendanceInput, selectorsConfig, logger) {
  const rowConfig = selectorsConfig.attendanceRows;
  if (!rowConfig) {
    throw new AutomationError("Missing attendance row configuration.");
  }

  for (const student of attendanceInput.students ?? []) {
    const matchedRow = await ensureStudentRowVisible(page, selectorsConfig, student.name, logger);

    for (const [fieldName, fieldValue] of Object.entries(student.values ?? {})) {
      const fieldSelector = rowConfig.fields[fieldName];
      if (!fieldSelector) {
        throw new AutomationError(`No selector configuration for attendance field: ${fieldName}`);
      }
      await applyFieldAction(
        page,
        matchedRow,
        fieldSelector,
        fieldValue,
        jobConfig,
        logger,
        student.name,
        fieldName,
        selectorsConfig,
      );
    }
  }
}

async function fillStaticFilters(page, jobConfig, selectorsConfig, logger) {
  const filters = selectorsConfig.filters ?? [];
  for (const filter of filters) {
    const value = jobConfig[filter.key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    await fillFieldWithCandidates(page, filter, value, logger);
  }
}

async function saveAndVerify(page, selectorsConfig, logger, projectRoot) {
  await clickCandidate(page, selectorsConfig.actions.save, logger, "save");
  const signal = await waitForSignals(page, selectorsConfig.successSignals, 15000);
  await logger.info("Detected success signal after save.", {
    signal,
  });
  await captureArtifact(page, projectRoot, "save-success", logger);
}

async function fillDialogReason(page, dialogConfig, reason, logger) {
  if (!reason || !dialogConfig.reasonField?.candidates?.length) {
    return;
  }

  const matched = await findFirstMatchingLocator(page, dialogConfig.reasonField.candidates, logger);
  await matched.locator.fill(String(reason), { timeout: 10000, force: true });
  await logger.info("Filled dialog reason field.", {
    reason,
  });
}

async function fillDialogDateField(locator, value) {
  await locator.click({ timeout: 10000, force: true });
  await locator.press("Control+A");
  await locator.press("Delete");
  await locator.type(String(value), { delay: 50 });
  await locator.press("Tab");
}

function normalizeDateInputValue(value) {
  return String(value ?? "").replace(/\D/g, "");
}

async function fillDialogPeriod(page, dialogConfig, startDate, endDate, logger) {
  if (!dialogConfig.periodFields) {
    return;
  }

  if (startDate && dialogConfig.periodFields.start?.candidates?.length) {
    const startMatched = await findFirstMatchingLocator(page, dialogConfig.periodFields.start.candidates, logger);
    await fillDialogDateField(startMatched.locator, startDate);
    const actualStartDate = await startMatched.locator.inputValue().catch(() => "");
    if (normalizeDateInputValue(actualStartDate) !== normalizeDateInputValue(startDate)) {
      throw new AutomationError("The dialog start date did not match the requested value.", {
        expected: startDate,
        actual: actualStartDate,
      });
    }
    await logger.info("Filled dialog start date.", {
      startDate,
      actualStartDate,
    });
  }

  if (endDate && dialogConfig.periodFields.end?.candidates?.length) {
    const endMatched = await findFirstMatchingLocator(page, dialogConfig.periodFields.end.candidates, logger);
    await fillDialogDateField(endMatched.locator, endDate);
    const actualEndDate = await endMatched.locator.inputValue().catch(() => "");
    if (normalizeDateInputValue(actualEndDate) !== normalizeDateInputValue(endDate)) {
      throw new AutomationError("The dialog end date did not match the requested value.", {
        expected: endDate,
        actual: actualEndDate,
      });
    }
    await logger.info("Filled dialog end date.", {
      endDate,
      actualEndDate,
    });
  }
}

async function waitForDialogPeriodFields(page, dialogConfig, logger, timeoutMs = 5000) {
  const startCandidates = dialogConfig.periodFields?.start?.candidates ?? [];
  const endCandidates = dialogConfig.periodFields?.end?.candidates ?? [];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (startCandidates.length) {
        await findFirstMatchingLocator(page, startCandidates, logger);
      }

      if (endCandidates.length) {
        await findFirstMatchingLocator(page, endCandidates, logger);
      }

      return true;
    } catch {
      await page.waitForTimeout(250);
    }
  }

  return false;
}

async function waitForDialogTypeOptions(page, logger, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
      const dialogs = Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']"));
      const visibleDialogs = dialogs.filter((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const attendanceDialog = visibleDialogs
        .filter((dialog) => normalize(dialog.textContent).includes("일일출결입력"))
        .at(-1);

      if (!attendanceDialog) {
        return false;
      }

      const absenceGroup = Array.from(
        attendanceDialog.querySelectorAll(".cl-radiobutton, [role='radiogroup']"),
      ).find((element) => normalize(element.getAttribute("aria-label")).startsWith("결석"));

      if (!absenceGroup) {
        return false;
      }

      const radioItems = absenceGroup.querySelectorAll(".cl-radiobutton-item");
      return radioItems.length >= 4;
    });

    if (ready) {
      await logger.info("Attendance dialog type options are ready.");
      return true;
    }

    await page.waitForTimeout(250);
  }

  return false;
}

export async function clickAttendanceTypeOption(page, type, logger) {
  const candidates = [
    { selector: `.cl-dialog [aria-label='결석${type}']` },
    { selector: `.cl-dialog [aria-label='결석 ${type}']` },
    { selector: `.cl-dialog [title='결석${type}']` },
    { selector: `.cl-dialog [title='결석 ${type}']` },
    { selector: `.cl-dialog .cl-control[aria-label*='결석'][aria-label*='${type}']` },
  ];

  const matched = await findFirstMatchingLocator(page, candidates, logger);
  const box = await matched.locator.boundingBox().catch(() => null);

  if (!box) {
    await matched.locator.click({ timeout: 10000, force: true });
    await page.waitForTimeout(200);
    await logger.info("Selected attendance type option from the absence section.", {
      type,
      strategy: "force-click",
      frame: matched.frame.url(),
      attempt: matched.attempt,
    });
    return;
  }

  const clickOffsets = [-18, -12, -8, 8, 14, 20];
  let clicked = false;

  for (const offsetX of clickOffsets) {
    try {
      await page.mouse.click(
        Math.max(1, box.x + offsetX),
        box.y + box.height / 2,
      );
      await page.waitForTimeout(200);
      clicked = true;
      await logger.info("Selected attendance type option from the absence section.", {
        type,
        strategy: "mouse-offset-click",
        offsetX,
        frame: matched.frame.url(),
        attempt: matched.attempt,
      });
      break;
    } catch (error) {
      await logger.warn("Offset click failed for attendance type option.", {
        type,
        offsetX,
        message: error.message,
      });
    }
  }

  if (!clicked) {
    await matched.locator.click({
      timeout: 10000,
      force: true,
      position: { x: Math.max(1, Math.min(8, box.width - 1)), y: Math.max(4, box.height / 2) },
    });
    await page.waitForTimeout(200);
    await logger.info("Selected attendance type option from the absence section.", {
      type,
      strategy: "locator-position-click",
      frame: matched.frame.url(),
      attempt: matched.attempt,
    });
  }
}

async function clickAttendanceTypeOptionPrecise(page, type, logger) {
  const candidates = [
    {
      selector:
        `.cl-dialog .cl-radiobutton[aria-label='결석'] .cl-radiobutton-icon[role='radio'][aria-label^='${type}']`,
      force: true,
    },
    {
      selector:
        `.cl-dialog .cl-radiobutton[aria-label='결석'] .cl-radiobutton-icon[role='radio'][aria-label*='${type}']`,
      force: true,
    },
    {
      selector:
        `.cl-dialog .cl-radiobutton[aria-label='결석'] .cl-radiobutton-item:has(.cl-text:has-text('${type}')) .cl-radiobutton-icon`,
      force: true,
    },
    {
      selector:
        `.cl-dialog .cl-radiobutton[aria-label='결석'] .cl-radiobutton-item:has-text('${type}') .cl-radiobutton-icon`,
      force: true,
    },
  ];

  const matched = await findFirstMatchingLocator(page, candidates, logger);
  await matched.locator.click({ timeout: 10000, force: true });
  await page.waitForTimeout(250);
  await logger.info("Selected attendance type option from the absence section.", {
    type,
    strategy: "precise-radio-click",
    frame: matched.frame.url(),
    attempt: matched.attempt,
  });
}

export async function clickAttendanceTypeOptionDom(page, type, logger) {
  const target = await page.evaluate((requestedType) => {
    const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
    const dialogs = Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']"));
    const attendanceDialog = dialogs.find((dialog) => normalize(dialog.textContent).includes("일일출결입력"));
    if (!attendanceDialog) {
      return { ok: false, reason: "attendance-dialog-not-found" };
    }

    const absenceGroup = Array.from(
      attendanceDialog.querySelectorAll(".cl-radiobutton, [role='radiogroup']"),
    ).find((element) => normalize(element.getAttribute("aria-label")).startsWith("결석"));

    if (!absenceGroup) {
      return { ok: false, reason: "absence-radiogroup-not-found" };
    }

    const iconCandidates = Array.from(
      absenceGroup.querySelectorAll(".cl-radiobutton-icon[role='radio'], .cl-radiobutton-icon"),
    );
    const iconByAria = iconCandidates.find((element) =>
      normalize(element.getAttribute("aria-label")).startsWith(requestedType),
    );

    const itemCandidates = Array.from(absenceGroup.querySelectorAll(".cl-radiobutton-item"));
    const itemByText = itemCandidates.find((element) => normalize(element.textContent).includes(requestedType));

    const targetElement =
      iconByAria ??
      itemByText?.querySelector(".cl-radiobutton-icon[role='radio'], .cl-radiobutton-icon") ??
      itemByText ??
      null;

    if (!targetElement) {
      return { ok: false, reason: "absence-type-target-not-found" };
    }

    const rect = targetElement.getBoundingClientRect();
    return {
      ok: true,
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      width: rect.width,
      height: rect.height,
      className: targetElement.className,
      role: targetElement.getAttribute("role") ?? "",
      ariaLabel: normalize(targetElement.getAttribute("aria-label")),
      text: normalize(targetElement.textContent),
    };
  }, type);

  if (!target?.ok) {
    throw new AutomationError("Could not select attendance type option.", {
      type,
      reason: target?.reason ?? "unknown",
    });
  }

  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(300);
  await logger.info("Selected attendance type option from the absence section.", {
    type,
    strategy: "dom-coordinate-click",
    target,
  });
}

async function applyAttendanceSelectionToStudentRow(page, studentName, columnName, logger) {
  const candidates = [
    {
      selector: `.cl-dialog [aria-label*='${columnName}'][aria-label*='편집창']`,
      force: true,
    },
    {
      selector: `.cl-dialog [title*='${columnName}'][title*='${studentName}']`,
      force: true,
    },
    {
      selector: `.cl-dialog [role='gridcell'][aria-label*='${columnName}']`,
      force: true,
    },
  ];

  await clickCandidate(page, candidates, logger, `attendance-apply:${columnName}`);
  await logger.info("Applied the selected attendance option to the student row.", {
    studentName,
    columnName,
  });
}

async function snapshotVisibleDialogTexts(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".cl-dialog[role='dialog'], [role='dialog']"))
      .map((dialog) => (dialog.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
}

export async function handlePostSaveConfirmation(page, logger, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const confirmState = await page.evaluate(() => {
      const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
      const dialogs = Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']"));
      const confirmationDialog = dialogs.find((dialog) => {
        const text = normalize(dialog.textContent);
        return text.includes("해당자료를 저장하시겠습니까?") || text.includes("확인") && text.includes("취소");
      });

      if (!confirmationDialog) {
        return { found: false };
      }

      const buttons = Array.from(
        confirmationDialog.querySelectorAll("button, [role='button'], .cl-button, div[aria-label]"),
      );
      const confirmButton = buttons.find((button) => normalize(button.textContent || button.getAttribute("aria-label")) === "확인");

      if (!confirmButton) {
        return { found: true, clicked: false };
      }

      confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
      return { found: true, clicked: true };
    });

    if (!confirmState.found) {
      await page.waitForTimeout(200);
      continue;
    }

    if (!confirmState.clicked) {
      throw new AutomationError("Save confirmation dialog appeared, but its confirm button was not clickable.");
    }

    await logger.info("Accepted the save confirmation dialog.");
    return true;
  }

  return false;
}

async function waitForAttendanceDialogResolution(page, logger, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const dialogTexts = await snapshotVisibleDialogTexts(page);
    const attendanceDialogOpen = dialogTexts.some((text) => text.includes("일일출결입력"));
    const savedNoticeOpen = dialogTexts.some((text) => text.includes("저장했습니다."));
    const alertText = dialogTexts.find((text) => text.includes("알림"));

    if (savedNoticeOpen && !attendanceDialogOpen) {
      await logger.info("Detected post-save informational alert after the attendance dialog closed.");
      return;
    }

    if (alertText) {
      throw new AutomationError("Attendance dialog save was blocked by a validation alert.", {
        alertText,
      });
    }

    if (!attendanceDialogOpen) {
      await logger.info("Attendance dialog closed after save.");
      return;
    }

    await page.waitForTimeout(250);
  }

  throw new AutomationError("Attendance dialog remained open after save.");
}

async function applyAttendanceDialog(page, fieldValue, tokens, selectorsConfig, logger) {
  const dialogConfig = selectorsConfig.dialog;
  if (!dialogConfig?.openSignals?.length) {
    return;
  }

  await waitForSignals(page, dialogConfig.openSignals, dialogConfig.timeoutMs ?? 10000);
  await logger.info("Attendance dialog opened.", {
    fieldValue,
  });

  const typeOptionsReady = await waitForDialogTypeOptions(
    page,
    logger,
    dialogConfig.timeoutMs ?? 10000,
  );
  if (!typeOptionsReady) {
    throw new AutomationError("Attendance dialog opened, but its type options were not ready.");
  }

  if (typeof fieldValue !== "object" || fieldValue === null) {
    if (dialogConfig.typeCandidates?.[fieldValue]?.length) {
      await clickResolvedCandidates(page, dialogConfig.typeCandidates[fieldValue], tokens, logger, `dialog-type:${fieldValue}`);
    }
    return;
  }

  const mode = fieldValue.mode ?? "daily";
  const type = fieldValue.type ?? fieldValue.status;
  const applyColumnName = fieldValue.applyColumn ?? "조회";

  if (mode === "continuous" && dialogConfig.modeCandidates?.continuous?.length) {
    const continuousModeCandidates = dialogConfig.modeCandidates.continuous.map((candidate) => ({
      ...candidate,
      force: true,
    }));
    await clickResolvedCandidates(page, continuousModeCandidates, tokens, logger, "dialog-mode:continuous");
    if (dialogConfig.modeSwitchSignals?.continuous?.length) {
      const switchedBySignal = await waitForSignals(page, dialogConfig.modeSwitchSignals.continuous, 5000)
        .then(() => true)
        .catch(() => false);
      if (!switchedBySignal) {
        const switchedByPeriodFields = await waitForDialogPeriodFields(page, dialogConfig, logger, 3000);
        if (!switchedByPeriodFields) {
          throw new AutomationError("Continuous attendance mode did not expose its period fields.");
        }
      }
    }
  } else if (mode === "daily") {
    await logger.info("Skipping daily attendance mode click because the popup defaults to daily mode.");
  }

  if (type) {
    try {
      await clickAttendanceTypeOptionDomRobust(page, type, logger);
    } catch (error) {
      await logger.warn("DOM attendance-type selection failed. Trying selector fallbacks.", {
        type,
        message: error.message,
      });

      try {
        await clickAttendanceTypeOptionPrecise(page, type, logger);
      } catch (fallbackError) {
        await logger.warn("Precise attendance-type selection failed. Trying broader fallbacks.", {
          type,
          message: fallbackError.message,
        });

        try {
          await clickAttendanceTypeOption(page, type, logger);
        } catch (selectorError) {
          if (!dialogConfig.typeCandidates?.[type]?.length) {
            throw selectorError;
          }

          await logger.warn("Specialized attendance-type selection failed. Falling back to selector candidates.", {
            type,
            message: selectorError.message,
          });
          await clickResolvedCandidates(page, dialogConfig.typeCandidates[type], tokens, logger, `dialog-type:${type}`);
        }
      }
    }
  }

  await fillDialogReason(page, dialogConfig, fieldValue.reason ?? "", logger);

  if (mode === "continuous" && fieldValue.endDate) {
    const periodFieldsReady = await waitForDialogPeriodFields(
      page,
      dialogConfig,
      logger,
      dialogConfig.timeoutMs ?? 10000,
    );
    if (!periodFieldsReady) {
      throw new AutomationError("Continuous attendance period fields were not ready for input.");
    }
    await fillDialogPeriod(page, dialogConfig, fieldValue.startDate ?? tokens.targetDate, fieldValue.endDate, logger);
    await logger.info("Continuous attendance mode activated.", {
      targetDate: tokens.targetDate,
      endDate: fieldValue.endDate,
    });
  }

  if (fieldValue.autoSave !== false && dialogConfig.actions?.save?.length) {
    await clickResolvedCandidates(page, dialogConfig.actions.save, tokens, logger, "dialog-save");
    await handlePostSaveConfirmationRobust(page, logger, 4000);
    await waitForAttendanceDialogResolution(page, logger, dialogConfig.timeoutMs ?? 10000);
    await acknowledgeInformationalAlertRobust(page, logger, "저장했습니다.", 4000);
  }
}

export async function navigateToAttendancePage(page, selectorsConfig, logger) {
  if (selectorsConfig.pageReadySignals?.length) {
    try {
      await waitForSignals(page, selectorsConfig.pageReadySignals, 1000);
      await logger.info("Attendance page is already open. Skipping navigation.");
      return;
    } catch {
      await logger.info("Attendance page is not open yet. Running navigation steps.");
    }
  }

  for (const step of selectorsConfig.navigationSteps ?? []) {
    await clickCandidate(page, step.candidates, logger, step.name);
    if (step.successSignals?.length) {
      await waitForSignals(page, step.successSignals, step.timeoutMs ?? 10000);
    }
  }
}

export async function fillAttendance(page, jobConfig, attendanceInput, selectorsConfig, logger) {
  const pageAlreadyReady = selectorsConfig.searchResultsSignals?.length
    ? await waitForSignals(page, selectorsConfig.searchResultsSignals, 1000)
        .then(() => true)
        .catch(() => false)
    : false;

  if (!pageAlreadyReady) {
    await fillStaticFilters(page, jobConfig, selectorsConfig, logger);

    if (selectorsConfig.actions?.search?.length) {
      await clickCandidate(page, selectorsConfig.actions.search, logger, "search");
    }

    if (selectorsConfig.searchResultsSignals?.length) {
      await waitForSignals(page, selectorsConfig.searchResultsSignals, 10000);
    }
  } else {
    await logger.info("Query results are already visible. Skipping filter entry and search.");
  }

  await verifyContext(page, jobConfig, attendanceInput, selectorsConfig, logger);
  await applyStudentAttendance(page, jobConfig, attendanceInput, selectorsConfig, logger);
}

export async function runAttendanceJob({
  attachConfig,
  jobConfig,
  attendanceInput,
  selectorsConfig,
  logger,
  projectRoot,
}) {
  const { browser, context } = await attachToLoggedInBrowser(attachConfig, logger);
  const page = await findNicePage(context, attachConfig, logger);

  try {
    await assertLoggedIn(page, selectorsConfig);
    await navigateToAttendancePage(page, selectorsConfig, logger);
    await fillAttendance(page, jobConfig, attendanceInput, selectorsConfig, logger);

    if (jobConfig.pageSave === true) {
      await saveAndVerify(page, selectorsConfig, logger, projectRoot);
    } else {
      await logger.info("Skipping page-level save. The next workflow step can continue with remark registration.");
    }
  } catch (error) {
    await captureArtifact(page, projectRoot, "failure", logger).catch(() => {});
    await fs.writeFile(
      path.join(projectRoot, "artifacts", "last-error.json"),
      JSON.stringify(
        {
          message: error.message,
          name: error.name,
          details: error.details ?? null,
        },
        null,
        2,
      ),
      "utf8",
    ).catch(() => {});
    throw error;
  } finally {
    if (browser.isConnected()) {
      await logger.info("Leaving the logged-in browser session open.");
    }
  }
}
