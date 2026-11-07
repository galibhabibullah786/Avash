#!/usr/bin/env node
/**
 * Agent-config sync gate (docs/standards/agent-compliance.md, Layer 1).
 *
 * AGENTS.md is canon. Every per-tool config is a pointer that carries canon's
 * content hash, and the eager tier has a hard size budget. Both drift silently
 * — a rule gets added to AGENTS.md and Cursor keeps teaching the old one, or
 * the "small" always-loaded file quietly grows back into the thing it replaced.
 * This is the deterministic check that stops both.
 *
 *   node scripts/agent-sync.mjs            # check; exit 1 on drift
 *   node scripts/agent-sync.mjs --fix      # re-stamp hashes + skills list
 *   node scripts/agent-sync.mjs --changed <paths...>
 *                                          # check only if a listed path is
 *                                          # agentic (used by the edit hook)
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const FIX = argv.includes("--fix");

/** Files that carry the AGENTS.md hash stamp. */
const POINTERS = [
  ".claude/settings.json",
  ".cursor/settings.json",
  ".codex/config.yaml",
  ".github/copilot-instructions.md",
  ".agents/task-contracts.json",
];

/**
 * Every agent-config path the compliance doc's Layer 1 table lists. A config
 * file outside this set fails the gate on purpose: an agent instruction file
 * nobody reviewed must not be able to appear silently.
 */
const KNOWN = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  ".agents/task-contracts.json",
  ".github/copilot-instructions.md",
  ...POINTERS,
]);

/** Eager tier: loaded every session, by every tool. Budget is the point. */
const AGENTS_LINE_BUDGET_MIN = 200;
const AGENTS_LINE_BUDGET_MAX = 250;
const EAGER_LINE_BUDGET = 320;
const ROUTING_ROW_BUDGET = 20;

const problems = [];
const fixes = [];
const fail = (m) => problems.push(m);

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const has = (p) => existsSync(join(ROOT, p));
const lines = (p) => read(p).split(/\r?\n/).length;

// ---------------------------------------------------------------- canon hash

const canon = readFileSync(join(ROOT, "AGENTS.md"));
const HASH = createHash("sha256").update(canon).digest("hex");

for (const p of POINTERS) {
  if (!has(p)) {
    fail(`${p} is listed as a pointer file but does not exist.`);
    continue;
  }
  const body = read(p);
  if (body.includes(HASH)) continue;

  if (FIX) {
    // Replace an existing 64-hex stamp, or the `PENDING` placeholder a newly
    // onboarded pointer file starts with. A file with neither was never wired
    // up at all and needs a human to decide where the stamp belongs.
    const stamped = body.replace(/\b(?:[0-9a-f]{64}|PENDING)\b/, HASH);
    if (stamped === body) {
      fail(
        `${p} carries no agentsMdSha256 stamp. Add the field with the placeholder ` +
          `value "PENDING" and re-run --fix (docs/standards/agent-compliance.md).`,
      );
    } else {
      writeFileSync(join(ROOT, p), stamped);
      fixes.push(`re-stamped ${p}`);
    }
  } else {
    fail(`${p} is stamped with a stale AGENTS.md hash. Run: pnpm agent:sync --fix`);
  }
}

// -------------------------------------------------------- skills <-> settings

const SKILLS_DIR = ".claude/skills";
const onDisk = has(SKILLS_DIR)
  ? readdirSync(join(ROOT, SKILLS_DIR)).filter((d) =>
      statSync(join(ROOT, SKILLS_DIR, d)).isDirectory(),
    )
  : [];

let settings;
try {
  settings = JSON.parse(read(".claude/settings.json"));
} catch (err) {
  fail(`.claude/settings.json is not valid JSON: ${err.message}`);
  settings = { skills: [] };
}

const declared = settings.skills ?? [];
const missingOnDisk = declared.filter((s) => !onDisk.includes(s));
const undeclared = onDisk.filter((s) => !declared.includes(s));

if (missingOnDisk.length || undeclared.length) {
  if (FIX && !missingOnDisk.length) {
    settings.skills = [...declared, ...undeclared];
    writeFileSync(join(ROOT, ".claude/settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
    fixes.push(`added ${undeclared.join(", ")} to .claude/settings.json skills`);
  } else {
    if (missingOnDisk.length)
      fail(`.claude/settings.json declares skills with no directory on disk: ${missingOnDisk.join(", ")}`);
    if (undeclared.length)
      fail(`skill directories not declared in .claude/settings.json: ${undeclared.join(", ")}`);
  }
}

// --------------------------------------------------------- skill frontmatter

/**
 * Only a skill's `description` is eager — it is the trigger that decides
 * whether the body ever loads. A topic-shaped description ("about testing")
 * never fires and still costs context every session, so require an
 * action-shaped one.
 */
const TRIGGER = /\b(use (when|for|before)|invoke (when|for|before)|read (this )?before)\b/i;

for (const skill of onDisk) {
  const p = `${SKILLS_DIR}/${skill}/SKILL.md`;
  if (!has(p)) {
    fail(`${SKILLS_DIR}/${skill}/ has no SKILL.md.`);
    continue;
  }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(p));
  if (!fm) {
    fail(`${p} has no YAML frontmatter.`);
    continue;
  }
  const name = /^name:\s*(.+)$/m.exec(fm[1])?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(fm[1])?.[1]?.trim();

  if (!name) fail(`${p} frontmatter is missing \`name\`.`);
  else if (name !== skill) fail(`${p} declares name "${name}" but lives in ${skill}/.`);

  if (!description) fail(`${p} frontmatter is missing \`description\`.`);
  else if (!TRIGGER.test(description))
    fail(
      `${p} description does not name a triggering action — start it with "Use when…" / ` +
        `"Invoke before…". A topic-shaped description never fires and still costs context.`,
    );
}

// ------------------------------------------------------- routing table + budget

const agents = read("AGENTS.md");
const routing = [...agents.matchAll(/^\|\s*[^|]+\|\s*`([^`]+)`\s*\|$/gm)].map((m) => m[1]);

if (!routing.length) fail("AGENTS.md has no read-before-you-act routing table.");
if (routing.length > ROUTING_ROW_BUDGET)
  fail(`AGENTS.md routing table has ${routing.length} rows (budget ${ROUTING_ROW_BUDGET}).`);

for (const target of new Set(routing)) {
  if (!has(target)) fail(`AGENTS.md routing table points at a missing file: ${target}`);
}

// Every standards doc must be reachable from the table — a lazy-loaded doc
// nothing routes to is a doc nobody opens.
if (has("docs/standards")) {
  for (const f of readdirSync(join(ROOT, "docs/standards")).filter((f) => f.endsWith(".md"))) {
    const p = `docs/standards/${f}`;
    if (!routing.includes(p))
      fail(`${p} has no row in AGENTS.md's routing table — it will never be loaded on demand.`);
  }
}

const agentsLines = lines("AGENTS.md");
if (agentsLines < AGENTS_LINE_BUDGET_MIN || agentsLines > AGENTS_LINE_BUDGET_MAX) {
  fail(
    `AGENTS.md is ${agentsLines} lines (budget ${AGENTS_LINE_BUDGET_MIN}–${AGENTS_LINE_BUDGET_MAX}). ` +
      `Keep it tightly compressed and within budget (Section 14 Document Length Guard).`,
  );
}

const eager = agentsLines + lines("CLAUDE.md");
if (eager > EAGER_LINE_BUDGET)
  fail(
    `Eager tier is ${eager} lines (budget ${EAGER_LINE_BUDGET}). AGENTS.md + CLAUDE.md are loaded ` +
      `every session by every tool — move something to a routing row or a skill.`,
  );

// ------------------------------------------------- routing table mirrored per tool
//
// AGENTS.md's routing table is the source. `.codex/config.yaml`,
// `.cursor/settings.json`, and `.github/copilot-instructions.md` each carry
// their own rendering of it (per-tool syntax, "about to…" wording may
// differ) — but the *set of target doc paths* must match exactly, or a row
// added for one tool silently never reaches the others. `.claude/settings.json`
// is exempt: Claude Code gets these as skills instead (AGENTS.md: "Claude
// Code additionally auto-surfaces these as skills; other tools use this
// table").

const routingSet = new Set(routing);

// Every extractor below normalizes CRLF first. `core.autocrlf` is true on
// this repo's Windows checkouts and there is no `.gitattributes`, so these
// files arrive with `\r\n` there and `\n` elsewhere. The YAML block matcher
// in particular could not span CRLF lines — `.*` stops at the `\r`, the
// optional `\n` then fails to match it, and the repetition ends after the
// first row — so on Windows it reported *every* routing row as missing,
// which reads as "the mirrors are all out of sync" rather than as a parser
// bug. Normalizing once here is simpler than making three regexes
// individually `\r`-tolerant.
function normalizeNewlines(body) {
  return String(body ?? "").replace(/\r\n/g, "\n");
}

function extractYamlRouting(body) {
  const block = /readBeforeYouAct:\s*\n((?:[ \t]+\S.*\n?)+)/.exec(normalizeNewlines(body))?.[1] ?? "";
  return new Set([...block.matchAll(/^[ \t]+[\w./-]+:\s*(\S+)\s*$/gm)].map((m) => m[1]));
}

function extractCursorRouting(body) {
  const rule = JSON.parse(body).rules?.find((r) => r.startsWith("READ BEFORE YOU ACT"));
  if (!rule) return new Set();
  return new Set([...rule.matchAll(/->\s*([^\s|]+)/g)].map((m) => m[1]));
}

function extractMarkdownTableRouting(body) {
  return new Set(
    [...normalizeNewlines(body).matchAll(/^\|\s*[^|]+\|\s*`([^`]+)`\s*\|$/gm)].map((m) => m[1])
  );
}

const MIRRORS = [
  [".codex/config.yaml", extractYamlRouting],
  [".cursor/settings.json", extractCursorRouting],
  [".github/copilot-instructions.md", extractMarkdownTableRouting],
];

for (const [path, extract] of MIRRORS) {
  if (!has(path)) continue; // reported by the pointer-file check above
  let mirrored;
  try {
    mirrored = extract(read(path));
  } catch (err) {
    fail(`${path}'s routing table could not be parsed: ${err.message}`);
    continue;
  }
  const missing = [...routingSet].filter((p) => !mirrored.has(p));
  const extra = [...mirrored].filter((p) => !routingSet.has(p));
  if (missing.length)
    fail(`${path} is missing routing row(s) present in AGENTS.md: ${missing.join(", ")}`);
  if (extra.length)
    fail(`${path} routes to path(s) AGENTS.md's table does not: ${extra.join(", ")}`);
}

// ------------------------------------------------------- unknown config files

const CANDIDATE_DIRS = [".claude", ".cursor", ".codex", ".agents"];

/**
 * Runtime artifacts a tool writes locally into a candidate dir (e.g.
 * `.claude/scheduled_tasks.lock`, written by Claude Code while a scheduled
 * or looped task is active) are not agent config and must not need a
 * Layer 1 table entry. `check-internal-refs.mjs` already gets this right
 * by scanning only `git ls-files --cached --others --exclude-standard`;
 * this mirrors that so a file gitignored (or locally excluded via
 * `.git/info/exclude`, which `--exclude-standard` also honors) can exist
 * on disk without failing the gate on every machine that has ever run it.
 * Falls back to "nothing is ignored" if git is unavailable, which just
 * means the gate is exactly as strict as before this fix — never looser.
 */
function ignoredPathsUnder(dirs) {
  try {
    const out = execFileSync(
      "git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--", ...dirs],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 }
    );
    return new Set(out.split("\n").map((line) => line.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

const ignoredPaths = ignoredPathsUnder(CANDIDATE_DIRS);

const walk = (dir) => {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (ignoredPaths.has(p)) continue;
    if (entry.isDirectory()) walk(p);
    // Skills and commands are lazy content, not eager config — exempt.
    else if (!p.startsWith(".claude/skills/") && !p.startsWith(".claude/commands/") && !KNOWN.has(p))
      fail(`${p} is an agent config the Layer 1 table does not list (docs/standards/agent-compliance.md).`);
  }
};
for (const d of CANDIDATE_DIRS) if (has(d)) walk(d);

// ------------------------------------------------------------------- report

if (fixes.length) for (const f of fixes) console.log(`fixed: ${f}`);

if (problems.length) {
  console.error("\nFAIL: agent config out of sync.\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    `\n${problems.length} problem(s). Canon is AGENTS.md (sha256 ${HASH.slice(0, 12)}…).\n` +
      `Fix what is mechanical with: node scripts/agent-sync.mjs --fix\n`,
  );
  process.exit(1);
}
