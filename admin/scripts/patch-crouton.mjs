import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// Narrow corrections to the pinned Crouton 0.0.1-alpha.88 distribution.
// Bundle filenames are content-hashed, so each patch locates its file by the code it rewrites.
// Every patch is idempotent and warns (instead of failing install) when its target has changed upstream.
const dist = (pkg) => join('node_modules/@ghentcdh', pkg, 'dist');
const jsFiles = (pkg) => readdirSync(dist(pkg)).filter((f) => /\.c?js$/.test(f)).map((f) => join(dist(pkg), f));
function patch(name, pkg, from, to, applied = to) {
  const files = jsFiles(pkg).map((file) => [file, readFileSync(file, 'utf8')]);
  if (files.some(([, source]) => source.includes(applied))) return console.log(`crouton patch: ${name} (already applied)`);
  const targets = files.filter(([, source]) => source.includes(from));
  if (!targets.length) return console.warn(`crouton patch: ${name} — target not found; check whether upstream fixed it`);
  for (const [file, source] of targets) writeFileSync(file, source.replace(from, to));
  console.log(`crouton patch: ${name} (${targets.length} file${targets.length > 1 ? 's' : ''})`);
}
// Preserve empty TEXT values if the generated schema accepts them. Null remains null.
patch('empty TEXT', 'crouton-api', 'if (out[key] === "") {', 'if (out[key] === "" && !this.schema.shape[key]?.safeParse("").success) {');
// Crouton's calculated-column helper emits PostgreSQL placeholders; this app uses SQLite.
patch('SQLite placeholders', 'crouton-api', 'ids.map((_, i) => `$${i + 1}`).join(", ")', 'ids.map(() => "?").join(", ")');
// The detail view renders any value that `new Date()` accepts as a date, so "6641" or "1990" became "1 Jan 6641".
// Only ISO-like YYYY-MM-DD strings are dates here.
patch('date detection', 'crouton-vue', 't.resource ? Jc : hs(e) ? jc', 't.resource ? Jc : typeof e == "string" && /^\\d{4}-\\d{2}-\\d{2}/.test(e) && hs(e) ? jc');
