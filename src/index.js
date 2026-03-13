import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runAttendanceJob } from "./lib/attendance.js";
import { runConfirmTest } from "./lib/confirm-test.js";
import { runInspection } from "./lib/inspect.js";
import { runRadioTest } from "./lib/radio-test.js";
import { loadJsonFile } from "./lib/io.js";
import { createLogger } from "./lib/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    args[key] = value;

    if (value !== "true") {
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode ?? "run";

  const selectorsPath = path.resolve(
    projectRoot,
    args.selectors ?? "config/nice-selectors.json",
  );
  const attachConfigPath = path.resolve(
    projectRoot,
    args.attach ?? "config/attach-config.json",
  );
  const jobConfigPath = path.resolve(
    projectRoot,
    args.job ?? "config/job-config.json",
  );
  const attendanceInputPath = path.resolve(
    projectRoot,
    args.input ?? "config/attendance-input.json",
  );

  const logger = createLogger({
    rootDir: projectRoot,
    silentConsole: args.quiet === "true",
  });

  logger.info("Starting NICE attendance automation job.");

  try {
    const [attachConfig, jobConfig, attendanceInput, selectorsConfig] = await Promise.all([
      loadJsonFile(attachConfigPath),
      loadJsonFile(jobConfigPath),
      loadJsonFile(attendanceInputPath),
      loadJsonFile(selectorsPath),
    ]);

    if (mode === "inspect") {
      await runInspection({
        attachConfig,
        selectorsConfig,
        logger,
        projectRoot,
        keywordHints: args.keywords ? args.keywords.split(",").map((value) => value.trim()) : [],
      });
    } else if (mode === "confirm-test") {
      await runConfirmTest({
        attachConfig,
        selectorsConfig,
        logger,
        projectRoot,
      });
    } else if (mode === "radio-test") {
      await runRadioTest({
        attachConfig,
        selectorsConfig,
        logger,
        projectRoot,
        requestedType: args.type ?? "질병",
      });
    } else {
      await runAttendanceJob({
        attachConfig,
        jobConfig,
        attendanceInput,
        selectorsConfig,
        logger,
        projectRoot,
      });
    }

    logger.info(`NICE automation mode completed successfully.`, { mode });
  } catch (error) {
    logger.error("NICE automation mode failed.", {
      message: error.message,
      stack: error.stack,
      mode,
    });
    process.exitCode = 1;
  } finally {
    await logger.close();
  }

  process.exit(process.exitCode ?? 0);
}

main();
