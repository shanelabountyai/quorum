// tally:lint (task 1.12; CLAUDE.md non-negotiables 1, 4, 7). Exit 1 on the first failure, naming file and rule.
//   1. Nothing under src/tally/ names Prisma, @/core, @/app, @/modules, Date.now, new Date(, Math.random,
//      process.env, fetch, setTimeout or anthropic — the engine is pure (D-7).
//   2. No float path under src/tally/: parseFloat, toFixed, Math.round, a decimal literal, or `/ 100` on cents or bps
//      (shares are basis points and money is cents; every threshold is an integer inequality, D-16).
//   3. No machine tiebreak: src/tally/seats.ts contains no .sort(, .reverse( or localeCompare at all; its display
//      ordering of already-decided lists goes through canonical.ts's sortedStrings (D-17, T-9).
//   4. fixtures/meeting.json parses against the closed rules schema (task 1.4) — added when src/tally/rules.ts exists.
// Shape after Gavel scripts/rules-lint.ts (itself after Bracketry's engine eslint block), task 1.3.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ENGINE_DIR = 'src/tally';

const BANNED: [RegExp, string][] = [
  [/prisma/i, 'prisma (database)'],
  [/@\/core/, '@/core'],
  [/@\/app/, '@/app'],
  [/@\/modules/, '@/modules'],
  [/\bDate\.now\b/, 'Date.now (clock)'],
  [/\bnew\s+Date\s*\(/, 'new Date( (clock or axis crossing)'],
  [/\bDate\.parse\b/, 'Date.parse (axis crossing)'],
  [/\bMath\.random\b/, 'Math.random (randomness)'],
  [/\bcrypto\.randomBytes\b|\brandomUUID\b|\brandomBytes\b/, 'random bytes (randomness)'],
  [/\bprocess\.env\b/, 'process.env'],
  [/\bfetch\s*\(/, 'fetch (network)'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'timers'],
  [/anthropic/i, 'anthropic (model client)'],
  [/\bparseFloat\b/, 'parseFloat (float)'],
  [/\.toFixed\b/, 'toFixed (float)'],
  [/\bMath\.round\b|\bMath\.floor\b|\bMath\.ceil\b/, 'Math.round/floor/ceil (float rounding)'],
  [/\b\d+\.\d+\b/, 'a decimal literal (float)'],
  [/\/\s*100\b|\/\s*10000\b/, '/ 100 or / 10000 (float on cents or bps)'],
];

/** seats.ts may not order anything itself: ranking is by vote count, display ordering is imported. */
const TIEBREAK: [RegExp, string][] = [
  [/\.sort\s*\(/, '.sort( in seats.ts (a tiebreak hides here, D-17)'],
  [/\.reverse\s*\(/, '.reverse( in seats.ts'],
  [/localeCompare/, 'localeCompare in seats.ts (a tiebreak hides here, D-17)'],
  [/\.toSorted\s*\(/, '.toSorted( in seats.ts'],
];

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Problems in one engine source file, as "path: what" lines; empty means clean. */
export function lintEngineSource(path: string, source: string): string[] {
  const code = stripComments(source);
  const problems = BANNED.filter(([re]) => re.test(code)).map(([, what]) => `${path}: ${what}`);
  if (/\/seats\.ts$/.test(path)) problems.push(...TIEBREAK.filter(([re]) => re.test(code)).map(([, what]) => `${path}: ${what}`));
  return problems;
}

export function lintEngineDir(dir = ENGINE_DIR): string[] {
  if (!existsSync(dir)) return [`${dir}: missing`];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name))
    .map((d) => `${d.parentPath}/${d.name}`)
    .sort()
    .flatMap((p) => lintEngineSource(p, readFileSync(p, 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = lintEngineDir();
  for (const p of problems) console.error(`tally:lint: ${p}`);
  if (problems.length) process.exit(1);
  let rulesNote = 'rules schema check pending task 1.4';
  if (existsSync(`${ENGINE_DIR}/rules.ts`)) {
    const { parseMeeting } = await import('../src/tally/rules');
    const meeting = parseMeeting(JSON.parse(readFileSync('fixtures/meeting.json', 'utf8')));
    rulesNote = `fixtures/meeting.json valid (${meeting.contests.length} contests, quorum ${meeting.rules.quorum.threshold_bps} bps on ${meeting.rules.quorum.basis})`;
  }
  const files = readdirSync(ENGINE_DIR, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && /\.tsx?$/.test(d.name)).length;
  console.log(`tally:lint: OK (${files} files under ${ENGINE_DIR} clean; ${rulesNote})`);
}
