#!/usr/bin/env node
/**
 * check-css-vars.mjs
 *
 * Validates that every var(--xxx) reference in CSS source files points to a
 * custom property defined somewhere in the CSS codebase. Exits non-zero on any
 * undefined reference so CI catches the bug class that caused PR #20 (DebugMenu
 * transparent background due to referencing --color-bg, --color-border etc.
 * which were never defined anywhere).
 *
 * Cross-file validation: stylelint's no-unknown-custom-properties only checks
 * within a single file. This script is the cross-file check.
 *
 * Definition sources (in priority order):
 *   1. src/app/globals.css — global design tokens (canonical source of truth)
 *   2. Any other .css file — component-scoped custom properties set on elements
 *      and inherited by descendants via CSS cascade (valid during CSS Modules
 *      → vanilla-extract migration period; see ADR-009).
 *
 * Run:  node scripts/check-css-vars.mjs
 * CI:   npm run lint:css-vars
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcDir = join(__dirname, '../src');
const globalsPath = join(srcDir, 'app/globals.css');

// Recursively collect all .css files (not .css.ts — those are vanilla-extract)
function walkCss(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkCss(full));
    } else if (entry.name.endsWith('.css') && !entry.name.endsWith('.css.ts')) {
      files.push(full);
    }
  }
  return files;
}

const allCssFiles = walkCss(srcDir);

// Collect all --var-name: definitions across every CSS file in the project.
// This covers:
//   - Global tokens in globals.css (the canonical source)
//   - Component-scoped custom properties set on ancestor elements and inherited
//     by child components via CSS cascade (valid migration-period pattern)
const defined = new Set();
for (const file of allCssFiles) {
  const content = readFileSync(file, 'utf8');
  for (const m of content.matchAll(/--[\w-]+(?=\s*:)/g)) {
    defined.add(m[0]);
  }
}

// Count globals.css tokens separately for the success message
const globalsContent = readFileSync(globalsPath, 'utf8');
const globalTokenCount = new Set(
  [...globalsContent.matchAll(/--[\w-]+(?=\s*:)/g)].map(m => m[0])
).size;

// Scan every CSS file for var(--xxx) references; flag any that are defined nowhere
const errors = [];
for (const file of allCssFiles) {
  const content = readFileSync(file, 'utf8');
  const rel = relative(srcDir, file);
  for (const [, varName] of content.matchAll(/var\((--[\w-]+)/g)) {
    if (!defined.has(varName)) {
      errors.push(`  ${rel}: ${varName}`);
    }
  }
}

if (errors.length > 0) {
  // Deduplicate and sort for readable output
  const unique = [...new Set(errors)].sort();
  console.error(`\nUndefined CSS variables (${unique.length} found):`);
  for (const e of unique) console.error(e);
  console.error(
    `\nAll var(--xxx) references must be defined somewhere in the CSS codebase.\n` +
    `Global design tokens belong in src/app/globals.css.\n` +
    `See docs/adr/009-vanilla-extract-type-safe-css.md`
  );
  process.exit(1);
}

console.log(`CSS variables OK — ${globalTokenCount} global tokens in globals.css, ${defined.size} total defined across all CSS files, no undefined references.`);
