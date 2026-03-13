import fs from "node:fs/promises";
import path from "node:path";
import { attachToLoggedInBrowser, assertLoggedIn, findNicePage } from "./browser.js";
import { ensureDir } from "./io.js";
import { collectFrames } from "./selectors.js";

function dedupeKeywords(keywordHints, selectorsConfig) {
  const keywords = new Set(keywordHints.filter(Boolean));

  for (const step of selectorsConfig.navigationSteps ?? []) {
    keywords.add(step.name);
    for (const candidate of step.candidates ?? []) {
      if (candidate.text) {
        keywords.add(candidate.text);
      }
      if (candidate.name) {
        keywords.add(candidate.name);
      }
    }
  }

  for (const actionList of Object.values(selectorsConfig.actions ?? {})) {
    for (const candidate of actionList ?? []) {
      if (candidate.text) {
        keywords.add(candidate.text);
      }
      if (candidate.name) {
        keywords.add(candidate.name);
      }
    }
  }

  return [...keywords].filter(Boolean);
}

async function captureInspectionScreenshot(page, outputDir) {
  const filePath = path.join(outputDir, "page-overview.png");
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function collectFrameDiagnostics(frame, keywords) {
  return frame.evaluate(({ keywordList }) => {
    function normalize(value) {
      return `${value ?? ""}`.replace(/\s+/g, " ").trim();
    }

    function cssEscape(value) {
      if (!value) {
        return "";
      }
      if (globalThis.CSS?.escape) {
        return globalThis.CSS.escape(value);
      }
      return `${value}`.replace(/([^\w-])/g, "\\$1");
    }

    function buildSelector(element) {
      if (!(element instanceof HTMLElement)) {
        return null;
      }

      if (element.id) {
        return `#${cssEscape(element.id)}`;
      }

      const preferredAttrs = ["name", "title", "aria-label", "placeholder", "role"];
      for (const attr of preferredAttrs) {
        const value = element.getAttribute(attr);
        if (value) {
          return `${element.tagName.toLowerCase()}[${attr}="${value}"]`;
        }
      }

      const classNames = [...element.classList].filter((name) => !/^cl-/.test(name)).slice(0, 2);
      if (classNames.length) {
        return `${element.tagName.toLowerCase()}.${classNames.join(".")}`;
      }

      return element.tagName.toLowerCase();
    }

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const interactiveSelector = [
      "a",
      "button",
      "[role='button']",
      "[role='link']",
      "[role='grid']",
      "[role='row']",
      "[role='gridcell']",
      ".cl-grid",
      ".cl-grid-row",
      ".cl-grid-cell",
      "input",
      "select",
      "textarea",
      "[onclick]",
      "[title]",
    ].join(", ");

    const interactiveElements = [...document.querySelectorAll(interactiveSelector)]
      .filter((element) => element instanceof HTMLElement && isVisible(element))
      .map((element) => {
        const text = normalize(element.innerText || element.textContent);
        const title = normalize(element.getAttribute("title"));
        const ariaLabel = normalize(element.getAttribute("aria-label"));
        const selector = buildSelector(element);
        const matchKeyword = keywordList.some(
          (keyword) =>
            keyword &&
            [text, title, ariaLabel].some((value) => value && value.includes(keyword)),
        );

        return {
          tag: element.tagName.toLowerCase(),
          role: normalize(element.getAttribute("role")),
          text,
          title,
          ariaLabel,
          id: element.id || "",
          name: element.getAttribute("name") || "",
          selector,
          href: element.getAttribute("href") || "",
          onclick: normalize(element.getAttribute("onclick")),
          matchKeyword,
        };
      });

    const headings = [...document.querySelectorAll("h1, h2, h3, legend, label, th, .cl-text, .cl-output")]
      .filter((element) => element instanceof HTMLElement && isVisible(element))
      .map((element) => normalize(element.textContent))
      .filter(Boolean)
      .slice(0, 50);

    const gridSummaries = [...document.querySelectorAll(".cl-grid[role='grid'], .cl-grid")]
      .filter((element) => element instanceof HTMLElement && isVisible(element))
      .map((grid) => ({
        text: normalize(grid.innerText || grid.textContent).slice(0, 1500),
      }))
      .slice(0, 5);

    return {
      url: window.location.href,
      title: document.title,
      headings,
      gridSummaries,
      interactiveElements: interactiveElements.slice(0, 200),
      matchedInteractiveElements: interactiveElements.filter((entry) => entry.matchKeyword).slice(0, 100),
    };
  }, { keywordList: keywords });
}

export async function runInspection({
  attachConfig,
  selectorsConfig,
  logger,
  projectRoot,
  keywordHints = [],
}) {
  const keywords = dedupeKeywords(keywordHints, selectorsConfig);
  const { browser, context } = await attachToLoggedInBrowser(attachConfig, logger);
  const page = await findNicePage(context, attachConfig, logger);
  const outputDir = path.join(projectRoot, "artifacts", "inspection");

  try {
    await ensureDir(outputDir);
    await assertLoggedIn(page, selectorsConfig);

    const frames = await collectFrames(page);
    const frameDiagnostics = [];

    for (const frame of frames) {
      const diagnostic = await collectFrameDiagnostics(frame, keywords);
      frameDiagnostics.push(diagnostic);
    }

    const screenshotPath = await captureInspectionScreenshot(page, outputDir);
    const inspectionPath = path.join(outputDir, "frame-diagnostics.json");
    await fs.writeFile(
      inspectionPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          pageUrl: page.url(),
          keywordHints: keywords,
          screenshotPath,
          frameDiagnostics,
        },
        null,
        2,
      ),
      "utf8",
    );

    await logger.info("Inspection artifacts saved.", {
      inspectionPath,
      screenshotPath,
      frameCount: frameDiagnostics.length,
    });
  } finally {
    if (browser.isConnected()) {
      await logger.info("Leaving the logged-in browser session open after inspection.");
    }
  }
}
