import { AutomationError } from "./errors.js";

export async function clickAttendanceTypeOptionDomRobust(page, type, logger) {
  const isSelected = async () => page.evaluate((requestedType) => {
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

    return Array.from(absenceGroup.querySelectorAll(".cl-radiobutton-item")).some((element) => (
      element.classList.contains("cl-selected") &&
      normalize(element.textContent).includes(requestedType)
    ));
  }, type);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const target = await page.evaluate((requestedType) => {
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
    await page.waitForTimeout(250 + (attempt * 100));

    if (await isSelected()) {
      await logger.info("Selected attendance type option from the absence section.", {
        type,
        strategy: "robust-dom-coordinate-click",
        attempt,
        target,
      });
      return;
    }
  }

  throw new AutomationError("Attendance type option click did not change selection state.", {
    type,
  });
}

export async function handlePostSaveConfirmationRobust(page, logger, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const confirmState = await page.evaluate(() => {
      const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
      const dialogs = Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']"));
      const visibleDialogs = dialogs.filter((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const confirmationDialog = visibleDialogs
        .filter((dialog) => {
          const text = normalize(dialog.textContent);
          return text.includes("해당자료를 저장하시겠습니까?") || (text.includes("확인") && text.includes("취소"));
        })
        .at(-1);

      if (!confirmationDialog) {
        return { found: false };
      }

      const buttons = Array.from(
        confirmationDialog.querySelectorAll("button, [role='button'], .cl-button, div[aria-label]"),
      );
      const confirmButton = buttons.find((button) => normalize(button.textContent || button.getAttribute("aria-label")) === "확인");

      if (!confirmButton) {
        return {
          found: true,
          clicked: false,
          dialogText: normalize(confirmationDialog.textContent),
        };
      }

      const rect = confirmButton.getBoundingClientRect();
      return {
        found: true,
        clicked: true,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        dialogText: normalize(confirmationDialog.textContent),
      };
    });

    if (!confirmState.found) {
      await page.waitForTimeout(200);
      continue;
    }

    if (!confirmState.clicked) {
      throw new AutomationError("Save confirmation dialog appeared, but its confirm button was not clickable.", {
        dialogText: confirmState.dialogText,
      });
    }

    await page.mouse.click(confirmState.x, confirmState.y);
    await page.waitForTimeout(300);

    const confirmationStillOpen = await page.evaluate(() => {
      const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
      return Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']")).some((dialog) => {
        const rect = dialog.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return false;
        }
        const text = normalize(dialog.textContent);
        return text.includes("해당자료를 저장하시겠습니까?") || (text.includes("확인") && text.includes("취소"));
      });
    });

    if (!confirmationStillOpen) {
      await logger.info("Accepted the save confirmation dialog.", {
        strategy: "robust-coordinate-click",
      });
      return true;
    }
  }

  return false;
}

export async function acknowledgeInformationalAlertRobust(
  page,
  logger,
  expectedText = "저장했습니다.",
  timeoutMs = 3000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const alertState = await page.evaluate((requestedText) => {
      const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
      const dialogs = Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']"));
      const visibleDialogs = dialogs.filter((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const alertDialog = visibleDialogs
        .filter((dialog) => {
          const text = normalize(dialog.textContent);
          return text.includes("알림") && text.includes(requestedText) && text.includes("확인");
        })
        .at(-1);

      if (!alertDialog) {
        return { found: false };
      }

      const buttons = Array.from(
        alertDialog.querySelectorAll("button, [role='button'], .cl-button, div[aria-label]"),
      );
      const confirmButton = buttons.find((button) => normalize(button.textContent || button.getAttribute("aria-label")) === "확인");

      if (!confirmButton) {
        return {
          found: true,
          clicked: false,
          dialogText: normalize(alertDialog.textContent),
        };
      }

      const rect = confirmButton.getBoundingClientRect();
      return {
        found: true,
        clicked: true,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        dialogText: normalize(alertDialog.textContent),
      };
    }, expectedText);

    if (!alertState.found) {
      await page.waitForTimeout(200);
      continue;
    }

    if (!alertState.clicked) {
      throw new AutomationError("Informational alert appeared, but its confirm button was not clickable.", {
        dialogText: alertState.dialogText,
      });
    }

    await page.mouse.click(alertState.x, alertState.y);
    await page.waitForTimeout(300);

    const alertStillOpen = await page.evaluate((requestedText) => {
      const normalize = (value) => `${value ?? ""}`.replace(/\s+/g, " ").trim();
      return Array.from(document.querySelectorAll(".cl-dialog, [role='dialog']")).some((dialog) => {
        const rect = dialog.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return false;
        }
        const text = normalize(dialog.textContent);
        return text.includes("알림") && text.includes(requestedText) && text.includes("확인");
      });
    }, expectedText);

    if (!alertStillOpen) {
      await logger.info("Accepted the informational alert dialog.", {
        expectedText,
        strategy: "robust-coordinate-click",
      });
      return true;
    }
  }

  return false;
}
