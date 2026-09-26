#!/usr/bin/env node
// CI gate for the CONTRIBUTING.md § Terminology rule: nothing that ships
// with the repository may reference an internal planning artifact —
// numbered milestone/phase labels, task IDs, or an execution-schedule
// file. Those labels go stale the moment the plan is re-sequenced, and
// they force a reader to go find a document that is not in the repository
// (the planning files are gitignored) to understand a comment, doc, or
// commit that should be self-explanatory.
//
// This exists as a gate rather than as prose because the rule was written
// down in CONTRIBUTING.md and still got violated repeatedly across code
// comments, docs, workflow files, and test descriptions. A gate does not
// depend on anyone remembering.
//
// Describe work by what it does — the vertical-slice name from
// docs/PROJECT_PLAN.md §13, or a plain feature description.
//
//   node scripts/check-internal-refs.mjs
//
// Scans tracked files AND new files not yet staged, while honoring
// .gitignore — so gitignored planning scratch space (temp/,
// WORKFLOW.local.md) is out of scope by construction, but a brand-new
// doc is caught before it is ever committed rather than after.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Files permitted to contain the forbidden patterns because they are
 * where the rule itself is defined or enforced — each necessarily quotes
 * the pattern it bans.
 */
const RULE_DEFINING_FILES = new Set([
  'CONTRIBUTING.md',
  'AGENTS.md',
  'CLAUDE.md',
  'scripts/check-internal-refs.mjs',
]);

const FORBIDDEN = [
  {
    pattern: /\bM[1-9]\d?-T\d+/g,
    label: 'task ID (e.g. "M3-T11")',
  },
  {
    pattern: /\bmilestones?\s+\d+/gi,
    label: 'numbered milestone label (e.g. "Milestone 5")',
  },
  {
    // Bare shorthand: "M6", "M3/M4". Verified against the whole repo when
    // this gate was added — every occurrence was a genuine violation and
    // there were no false positives, so a strict match is correct here.
    // If a legitimate `M<n>` identifier ever appears, allowlist the file
    // rather than loosening this pattern.
    pattern: /\bM[1-9]\d?\b/g,
    label: 'bare milestone shorthand (e.g. "M6")',
  },
  {
    pattern: /\bM[1-9]\d?\s+exit[-\s]gate/gi,
    label: 'milestone exit-gate reference',
  },
  {
    pattern: /IMPLEMENTATION_INSTRUCTIONS?/g,
    label: 'internal execution-schedule filename',
  },
  {
    pattern: /§\s?0\.5[A-F]\b/g,
    label: 'section reference into the internal execution schedule',
  },
];

function filesToScan() {
  // --cached: tracked. --others: untracked new files (a doc added in this
  // change is exactly the case that must not slip through).
  // --exclude-standard: honor .gitignore, so planning scratch space stays
  // out of scope.
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }
  );
  return [...new Set(out.split('\n').map((line) => line.trim()).filter(Boolean))];
}

/** Skip binary and lockfile-shaped paths that can never carry prose. */
function isScannable(path) {
  if (/\.(png|jpe?g|gif|ico|webp|svg|woff2?|ttf|onnx|pdf)$/i.test(path)) return false;
  if (/(^|\/)pnpm-lock\.yaml$/.test(path)) return false;
  return true;
}

const violations = [];

for (const file of filesToScan()) {
  if (RULE_DEFINING_FILES.has(file) || !isScannable(file)) continue;

  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable or binary — nothing to scan
  }

  const lines = contents.split('\n');
  lines.forEach((line, index) => {
    for (const { pattern, label } of FORBIDDEN) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        violations.push({
          file,
          line: index + 1,
          match: match[0],
          label,
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error('FAIL: internal planning references found in shipped files.');
  console.error('See CONTRIBUTING.md § Terminology — describe work by what it does,');
  console.error('using the vertical-slice name (docs/PROJECT_PLAN.md §13) or a plain');
  console.error('feature description, never a milestone/task label.\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.label}: "${v.match}"`);
    console.error(`    ${v.text}`);
  }
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log('PASS: no internal planning references in shipped files.');
