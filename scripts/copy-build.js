#!/usr/bin/env node
/**
 * Cross-platform script to copy the React build output into the backend's
 * frontend_build folder. Works on Windows, macOS and Linux.
 *
 * Replaces the Unix-only: rm -rf backend/frontend_build && cp -R frontend/build/. backend/frontend_build/
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "frontend", "build");
const dest = path.join(root, "backend", "frontend_build");

if (!fs.existsSync(src)) {
  console.error("ERROR: frontend/build does not exist. Run 'npm run build:frontend' first.");
  process.exit(1);
}

// Remove the old build output (cross-platform)
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}

// Copy the new build output
copyDir(src, dest);
console.log(`Copied frontend build to ${dest}`);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
