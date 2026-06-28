const fs = require("node:fs");
const path = require("node:path");

const rootDirs = [
  "c:\\Users\\prajbr\\Desktop\\Suraksha OS",
  "c:\\Users\\prajbr\\Desktop\\Suraksha OS\\suraksha-compliance-os"
];

function searchDir(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (file === "node_modules" || file === ".git" || file === ".next") continue;
        searchDir(fullPath);
      } else if (stat.isFile()) {
        const ext = path.extname(file);
        if ([".txt", ".env", ".local", ".json", ".js", ".cjs", ".md"].includes(ext) || file.startsWith(".env")) {
          try {
            const content = fs.readFileSync(fullPath, "utf8");
            if (content.includes("SUPABASE_DB_PASSWORD") || content.includes("password") || content.includes("PASSWORD")) {
              console.log(`Found pattern in: ${fullPath}`);
              // Print lines containing the match
              const lines = content.split(/\r?\n/);
              lines.forEach((line, idx) => {
                if (line.includes("SUPABASE_DB_PASSWORD") || line.includes("password") || line.includes("PASSWORD")) {
                  console.log(`  L${idx + 1}: ${line.trim()}`);
                }
              });
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.error("Error reading dir:", dir, err.message);
  }
}

for (const dir of rootDirs) {
  console.log(`Searching in ${dir}...`);
  searchDir(dir);
}
