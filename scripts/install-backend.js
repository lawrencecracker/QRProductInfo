#!/usr/bin/env node
/**
 * Cross-platform backend dependency installer.
 * Tries "python3" first, falls back to "python" so it works on Windows,
 * macOS, Linux and cloud build environments alike.
 */
const { execSync } = require("child_process");
const path = require("path");

const reqFile = path.join(__dirname, "..", "backend", "requirements.txt");

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function tryPip(pythonCmd) {
  try {
    run(`${pythonCmd} -m pip install --upgrade pip`);
    run(`${pythonCmd} -m pip install --no-cache-dir -r "${reqFile}"`);
    return true;
  } catch {
    return false;
  }
}

if (!tryPip("python3") && !tryPip("python")) {
  console.error("ERROR: Could not find a Python 3 interpreter (tried 'python3' and 'python').");
  console.error("Please install Python 3.11+ and re-run the build.");
  process.exit(1);
}
