import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./io.js";

function serialize(entry) {
  return `${JSON.stringify(entry)}\n`;
}

export function createLogger({ rootDir, silentConsole = false }) {
  const logDir = path.join(rootDir, "logs");
  const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logDir, `run-${sessionId}.log`);
  let initialized = false;

  async function write(level, message, context = {}) {
    if (!initialized) {
      await ensureDir(logDir);
      initialized = true;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    if (!silentConsole) {
      const line = `[${entry.timestamp}] ${level.toUpperCase()} ${message}`;
      if (level === "error") {
        console.error(line, Object.keys(context).length ? context : "");
      } else {
        console.log(line, Object.keys(context).length ? context : "");
      }
    }

    await fs.appendFile(logPath, serialize(entry), "utf8");
  }

  return {
    logPath,
    info(message, context) {
      return write("info", message, context);
    },
    warn(message, context) {
      return write("warn", message, context);
    },
    error(message, context) {
      return write("error", message, context);
    },
    async close() {
      if (!initialized) {
        return;
      }
      await fs.appendFile(logPath, "", "utf8");
    },
  };
}
