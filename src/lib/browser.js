import { chromium } from "playwright";
import { AutomationError } from "./errors.js";

export async function attachToLoggedInBrowser(attachConfig, logger) {
  const endpoint = `http://${attachConfig.host ?? "127.0.0.1"}:${attachConfig.port}`;
  logger.info("Connecting to logged-in browser.", {
    endpoint,
    browserName: attachConfig.browserName ?? "chromium",
  });

  const browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new AutomationError("Connected to browser but found no contexts.", { endpoint });
  }

  return { browser, context: contexts[0] };
}

function countMatches(value, hints) {
  if (!value || !hints?.length) {
    return 0;
  }

  return hints.reduce((count, hint) => (value.includes(hint) ? count + 1 : count), 0);
}

export function scoreNicePageCandidate(url, title, attachConfig) {
  const excluded = (attachConfig.excludeUrlIncludes ?? []).some((hint) => url.includes(hint));
  if (excluded) {
    return -1;
  }

  const preferredUrlScore = countMatches(url, attachConfig.preferredUrlIncludes) * 100;
  const urlScore = countMatches(url, attachConfig.urlIncludes) * 10;
  const titleScore = countMatches(title, attachConfig.titleIncludes) * 5;
  return preferredUrlScore + urlScore + titleScore;
}

export async function findNicePage(context, attachConfig, logger) {
  const candidates = [];
  const pages = context.pages();

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const url = page.url();
    const title = await page.title().catch(() => "");
    const score = scoreNicePageCandidate(url, title, attachConfig);
    candidates.push({ page, url, title, score, index });
  }

  candidates.sort((left, right) => right.score - left.score || right.index - left.index);

  if (candidates[0] && candidates[0].score > 0) {
    logger.info("Matched NICE page.", {
      url: candidates[0].url,
      title: candidates[0].title,
      score: candidates[0].score,
      candidateCount: candidates.length,
    });
    return candidates[0].page;
  }

  throw new AutomationError("Could not find an already logged-in NICE page.", {
    candidates: candidates.map((candidate) => ({
      url: candidate.url,
      title: candidate.title,
      score: candidate.score,
    })),
  });
}

export async function assertLoggedIn(page, selectorsConfig) {
  const loggedInSignals = selectorsConfig.loginSignals ?? [];
  for (const signal of loggedInSignals) {
    const foundByText = signal.text ? await page.getByText(signal.text, { exact: false }).count() : 0;
    const foundBySelector = signal.selector ? await page.locator(signal.selector).count() : 0;
    if (foundByText || foundBySelector) {
      return;
    }
  }

  throw new AutomationError("The attached NICE page does not appear to be logged in.", {
    loginSignals: loggedInSignals,
  });
}
