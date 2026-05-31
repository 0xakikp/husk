const fs = require("fs");
const path = require("path");

const src = path.join("node_modules", "material-icon-theme", "icons");
const dst = path.join("public", "icons");

if (!fs.existsSync(src)) {
  console.log("material-icon-theme/icons not found, skipping");
  process.exit(0);
}

if (!fs.existsSync(dst)) {
  fs.mkdirSync(dst, { recursive: true });
}

fs.readdirSync(src)
  .filter((f) => f.endsWith(".svg"))
  .forEach((f) => {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  });

console.log("Icons copied successfully");
