import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// D-8 (ported from Bookable's eslint-rules/no-axis-crossing.mjs, task 1.3): every one of these turns a calendar
// string into an instant through the process timezone. The engine compares fixed-width strings lexically and
// never needs a Date; the scripts beside it read and print the same strings.
const dateAxisBans = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length>0]",
      message: 'new Date(string) crosses the calendar/instant axis through the process timezone (D-8). Compare the string.',
    },
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
      message: 'Date.parse crosses the calendar/instant axis through the process timezone (D-8).',
    },
    {
      selector: "CallExpression[callee.property.name=/^(get|set)(UTC)?(Hours|Minutes|Seconds|Milliseconds|Date|Month|FullYear|Day)$/]",
      message: 'Date get/set accessors read or write through the process timezone (D-8).',
    },
    {
      selector: "CallExpression[callee.property.name='getTimezoneOffset']",
      message: 'getTimezoneOffset reads the process timezone directly (D-8).',
    },
    {
      selector: "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
      message: 'toISOString().slice(0,10) derives a calendar day from an instant through the process timezone (D-8).',
    },
  ],
};

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', 'src/generated/**', 'spikes/**', 'next-env.d.ts'] },
  // Spec §4: core never reaches into modules or app. This is what keeps the D-7
  // package extraction mechanical, so it is an error from the first commit.
  {
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/modules/*', '@/modules/**', '**/modules/**'], message: 'src/core must not import from src/modules (spec §4).' },
          { group: ['@/app/*', '@/app/**', '**/app/**'], message: 'src/core must not import from src/app (spec §4).' },
        ],
      }],
    },
  },
  // D-7: the engine imports nothing of the application. tally:lint greps for the rest (clock, randomness, network).
  {
    files: ['src/tally/**'],
    rules: {
      ...dateAxisBans,
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/core/*', '@/core/**', '**/core/**'], message: 'src/tally is pure: no @/core (D-7).' },
          { group: ['@/app/*', '@/app/**', '**/app/**'], message: 'src/tally is pure: no @/app (D-7).' },
          { group: ['@/modules/*', '@/modules/**', '**/modules/**'], message: 'src/tally is pure: no @/modules (D-7).' },
          { group: ['@prisma/*', '@prisma/**', 'prisma', 'prisma/**', '@/generated/**'], message: 'src/tally is pure: no database (D-7).' },
        ],
      }],
    },
  },
  { files: ['scripts/tally-*.ts', 'tests/tally/**'], rules: dateAxisBans },
];

export default config;
