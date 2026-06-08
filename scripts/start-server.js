#!/usr/bin/env node
/**
 * Cross-platform server start script.
 * Tries "python3" first, then "python", picks up $PORT from the environment.
 *
 * Replaces the Unix-only: cd backend && python3 -m uvicorn server:app ...
 */
const { spawn } = require("child_process");
const path = require("path");

const backendDir = path.join(__dirname, "..", "backend");
const port = process.env.PORT || "8001";

// Allow passing --reload and --port via CLI for dev mode
const args = process.argv.slice(2);
const reload = args.includes("--reload");
const portArg = args.find((a, i) => a === "--port" && args[i + 1]);
const effectivePort = portArg ? args[args.indexOf("--port") + 1] : port;

const uvicornArgs = [
  "-m", "uvicorn", "server:app",
  "--host", "0.0.0.0",
  "--port", effectivePort,
];
if (reload) uvicornArgs.push("--reload");

function tryStart(pythonCmd) {
  const child = spawn(pythonCmd, uvicornArgs, {
    cwd: backendDir,
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      return; // executable not found — caller will try next
    }
    console.error(`Server error: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  return child;
}

// Try python3 first, then python
let started = false;
for (const cmd of ["python3", "python"]) {
  try {
    const { execSync } = require("child_process");
    execSync(`${cmd} --version`, { stdio: "ignore" });
    tryStart(cmd);
    started = true;
    break;
  } catch {
    // not found, try next
  }
}

if (!started) {
  console.error("ERROR: Could not find a Python interpreter. Install Python 3.11+.");
  process.exit(1);
}
