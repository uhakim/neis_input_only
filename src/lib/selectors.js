import { AutomationError } from "./errors.js";

function normalizeText(value) {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

export function buildSelectorAttempts(candidate) {
  const attempts = [];

  if (candidate.text) {
    attempts.push({
      type: "text",
      query: candidate.text,
    });
  }

  if (candidate.role) {
    attempts.push({
      type: "role",
      role: candidate.role,
      name: candidate.name ?? candidate.text,
    });
  }

  if (candidate.selector) {
    attempts.push({
      type: "selector",
      query: candidate.selector,
    });
  }

  if (candidate.title) {
    attempts.push({
      type: "selector",
      query: `[title="${candidate.title}"]`,
    });
  }

  if (candidate.hrefIncludes) {
    attempts.push({
      type: "selector",
      query: `a[href*="${candidate.hrefIncludes}"]`,
    });
  }

  return attempts;
}

async function locatorFromAttempt(frame, attempt) {
  switch (attempt.type) {
    case "text":
      return frame.getByText(attempt.query, { exact: false }).first();
    case "role":
      return frame.getByRole(attempt.role, {
        name: attempt.name,
        exact: false,
      }).first();
    case "selector":
      return frame.locator(attempt.query).first();
    default:
      throw new AutomationError(`Unsupported selector attempt type: ${attempt.type}`);
  }
}

export async function collectFrames(page) {
  const frames = page.frames();
  return frames;
}

export async function findFirstMatchingLocator(page, candidates, logger) {
  const frames = await collectFrames(page);

  for (const frame of frames) {
    for (const candidate of candidates) {
      const attempts = buildSelectorAttempts(candidate);
      for (const attempt of attempts) {
        try {
          const locator = await locatorFromAttempt(frame, attempt);
          if (await locator.count()) {
            logger.info("Selector candidate matched.", {
              frame: frame.url(),
              attempt,
            });
            return {
              frame,
              locator,
              attempt,
            };
          }
        } catch (error) {
          logger.warn("Selector candidate failed while probing.", {
            frame: frame.url(),
            attempt,
            message: error.message,
          });
        }
      }
    }
  }

  throw new AutomationError("No selector candidate matched in any frame.", {
    candidates,
  });
}

export async function waitForSignals(page, signals, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const signal of signals) {
      const frames = await collectFrames(page);
      for (const frame of frames) {
        if (signal.text) {
          const locator = frame.getByText(signal.text, { exact: false }).first();
          if (await locator.count()) {
            return { signal, frame };
          }
        }

        if (signal.selector) {
          const locator = frame.locator(signal.selector).first();
          if (await locator.count()) {
            return { signal, frame };
          }
        }
      }
    }

    await page.waitForTimeout(250);
  }

  throw new AutomationError("Timed out waiting for success signals.", { signals, timeoutMs });
}

export function findUnmatchedNames(expectedNames, actualNames) {
  const normalizedActual = new Set(actualNames.map(normalizeText));
  return expectedNames.filter((name) => !normalizedActual.has(normalizeText(name)));
}
