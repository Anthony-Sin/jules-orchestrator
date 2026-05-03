/**
 * test-loader.mjs
 *
 * Node.js ESM custom loader that transparently redirects source-module
 * imports made from inside tests/ to their counterparts in src/.
 *
 * WHY THIS EXISTS
 * ---------------
 * Test files live at:   tests/<subpath>/foo.test.js
 * Source files live at: src/<subpath>/foo.js
 *
 * Tests write natural same-directory imports:
 *   import { bar } from './foo.js'
 *
 * Without this loader those imports fail with ERR_MODULE_NOT_FOUND because
 * tests/<subpath>/foo.js does not exist — only src/<subpath>/foo.js does.
 * The loader intercepts the resolution and rewrites any resolved path that
 * falls inside tests/ to the matching path under src/.
 *
 * USAGE (in package.json scripts)
 * --------------------------------
 * Node >= 21:  node --import ./tests/test-loader.mjs --test "tests/**\/*.test.js"
 * Node < 21:   node --loader ./tests/test-loader.mjs --test "tests/**\/*.test.js"
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// ---------------------------------------------------------------------------
// Locate project root = nearest ancestor directory containing package.json
// ---------------------------------------------------------------------------
function findProjectRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir; // reached filesystem root
    dir = parent;
  }
}

const LOADER_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = findProjectRoot(LOADER_DIR);
const TESTS_DIR  = path.join(ROOT, 'tests') + path.sep;
const SRC_DIR    = path.join(ROOT, 'src');

// ---------------------------------------------------------------------------
// If absPath lives inside tests/, return its src/ mirror path — but only
// when that mirrored file actually exists on disk.  Returns null otherwise.
// ---------------------------------------------------------------------------
function mirrorInSrc(absPath) {
  if (!absPath.startsWith(TESTS_DIR)) return null;
  const rel     = path.relative(path.join(ROOT, 'tests'), absPath);
  const srcPath = path.join(SRC_DIR, rel);
  return fs.existsSync(srcPath) ? srcPath : null;
}

// ---------------------------------------------------------------------------
// When default resolution fails, try resolving the specifier relative to
// the src/ mirror of the parent directory.
// ---------------------------------------------------------------------------
function tryResolveBySrcMirror(specifier, parentURL) {
  if (!parentURL) return null;

  let parentPath;
  try { parentPath = fileURLToPath(parentURL); } catch { return null; }

  // Compute the src/ equivalent of the parent directory
  const parentDir = path.dirname(parentPath);
  let mirrorDir   = parentDir;
  if (parentDir.startsWith(path.join(ROOT, 'tests'))) {
    const rel = path.relative(path.join(ROOT, 'tests'), parentDir);
    mirrorDir = path.join(SRC_DIR, rel);
  }

  const base = path.resolve(mirrorDir, specifier);

  // Try with common extensions / index file
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// ESM Loader hook
// ---------------------------------------------------------------------------
export async function resolve(specifier, context, nextResolve) {
  // Step 1: let Node attempt its normal resolution.
  let result;
  try {
    result = await nextResolve(specifier, context);
  } catch (err) {
    // Step 2: if it couldn't find the module and it's a relative import,
    //         fall back to resolving against the src/ mirror.
    if (
      err.code === 'ERR_MODULE_NOT_FOUND' &&
      (specifier.startsWith('./') || specifier.startsWith('../'))
    ) {
      const srcPath = tryResolveBySrcMirror(specifier, context.parentURL);
      if (srcPath) {
        return { url: pathToFileURL(srcPath).href, shortCircuit: true };
      }
    }
    throw err;
  }

  // Step 3: resolution succeeded but the path landed inside tests/ —
  //         redirect to the src/ mirror so we run the real source code.
  if (result.url?.startsWith('file://')) {
    const resolved = fileURLToPath(result.url);
    const srcPath  = mirrorInSrc(resolved);
    if (srcPath) {
      return { ...result, url: pathToFileURL(srcPath).href, shortCircuit: true };
    }
  }

  return result;
}
