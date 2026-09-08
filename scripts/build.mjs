// Cache-busting build step, run by Netlify on every deploy (see netlify.toml
// [build] command). No bundler — this site intentionally ships plain
// <script>/<link> tags — so "versioning" means: hash each asset file's
// content, then rewrite every HTML page's references to that file as
// "file.ext?v=<hash>". A browser treats a different query string as a
// different cache key, so once this runs, /assets/* and /admin/admin.* can
// safely go back to a long `immutable` Cache-Control (see netlify.toml) —
// a new deploy changes the URL, not just the file behind an old one, so
// there's no window where a visitor's cached JS/CSS is stale AND indistinguishable
// from current. This is what task #17 ("normal navigation or a refresh loads
// the correct version, even for visitors who already have old files cached")
// actually requires — a short max-age was only ever a stopgap.
//
// Also writes public/build-info.json (commit + build time) purely so this
// script's own output is inspectable in CI logs / by hand; the /admin
// version badge itself reads Netlify's own COMMIT_REF/DEPLOY_ID env vars at
// request time (see admin-pricing.mjs), not this file — those two sources
// SHOULD normally agree, and disagreeing would itself be a useful diagnostic.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

// Every file that gets a content hash. Adding a new shared asset later just
// means adding its repo-root-relative path here.
const VERSIONED_ASSETS = [
  "assets/app.js",
  "assets/booking.js",
  "assets/style.css",
  "admin/admin.js",
  "admin/admin.css",
];

function hashOf(path) {
  const buf = readFileSync(join(ROOT, path));
  return createHash("sha256").update(buf).digest("hex").slice(0, 10);
}

function listHtmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "netlify") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listHtmlFiles(full));
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

function run() {
  const versions = {};
  for (const asset of VERSIONED_ASSETS) versions[asset] = hashOf(asset);

  const htmlFiles = listHtmlFiles(ROOT);
  let filesChanged = 0;
  for (const file of htmlFiles) {
    let html = readFileSync(file, "utf8");
    let changed = false;
    for (const asset of VERSIONED_ASSETS) {
      const basename = asset.split("/").pop();
      // Matches src="...booking.js" or href="...style.css" with ANY relative
      // path prefix (or none), so this doesn't need to know each HTML file's
      // depth (root / fr / embed / embed/fr / admin / ...) — it just matches
      // on the filename at the end of the attribute value. Re-running this
      // script (e.g. `netlify dev` rebuilding) is idempotent: the optional
      // `(?:\?v=[0-9a-f]+)?` swallows a version query this file may already
      // have from a previous build, so it's replaced rather than stacked.
      const re = new RegExp(`((?:src|href)=")([^"]*${basename.replace(".", "\\.")})(?:\\?v=[0-9a-f]+)?(")`, "g");
      const next = html.replace(re, (m, pre, path, post) => `${pre}${path}?v=${versions[asset]}${post}`);
      if (next !== html) changed = true;
      html = next;
    }
    if (changed) {
      writeFileSync(file, html);
      filesChanged++;
    }
  }

  writeFileSync(
    join(ROOT, "build-info.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), commit: process.env.COMMIT_REF || null, versions }, null, 2)
  );

  console.log(`build: versioned ${VERSIONED_ASSETS.length} asset(s), rewrote references in ${filesChanged}/${htmlFiles.length} HTML file(s).`);
  for (const [asset, hash] of Object.entries(versions)) console.log(`  ${asset} -> ?v=${hash}`);
}

run();
