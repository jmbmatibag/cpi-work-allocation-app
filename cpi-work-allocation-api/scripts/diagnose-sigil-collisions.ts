/**
 * scripts/diagnose-sigil-collisions.ts
 *
 * READ-ONLY. Scores candidate sigils for the enhancement token by how often
 * each already appears in REAL text, in the exact position the parser would
 * treat as a trigger: start-of-line or after whitespace, immediately followed
 * by a letter or digit.
 *
 * Anything with a non-zero count is a character users already type that way,
 * so adopting it would silently turn existing prose into tokens.
 *
 * Sources: AllocationActivity.description + JournalEntry.content.
 * Writes nothing.
 *
 *   npx tsx scripts/diagnose-sigil-collisions.ts
 *   npx tsx scripts/diagnose-sigil-collisions.ts --samples
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

const SHOW_SAMPLES = process.argv.includes('--samples');

/** Candidates that survived the structural review (see notes per row). */
const CANDIDATES: ReadonlyArray<{ char: string; note: string }> = [
  { char: '!', note: 'reads as negation / shouting' },
  { char: '+', note: 'reads as "additional"' },
  { char: '^', note: 'reads as "up/parent"; thin glyph' },
  { char: '~', note: 'reads as "approximately"' },
  { char: '=', note: 'reads as assignment' },
  { char: '>', note: 'reads as hierarchy step / blockquote' },
  { char: '$', note: 'CHOSEN — "$NAME is a named token" convention' },
  { char: '?', note: 'question' },
  // Structurally excluded, measured anyway to show WHY.
  { char: '#', note: 'TAKEN — category' },
  { char: '@', note: 'TAKEN — client' },
  { char: '*', note: 'EXCLUDED — bullet marker' },
  { char: '%', note: 'EXCLUDED — percentage syntax' },
];

function triggerRegex(ch: string): RegExp {
  const esc = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Same rule the autocomplete uses: start of input or after whitespace.
  return new RegExp(`(?:^|\\s)${esc}[A-Za-z0-9]`, 'g');
}

async function main(): Promise<void> {
  const [activities, journals] = await Promise.all([
    prisma.allocationActivity.findMany({ select: { description: true } }),
    prisma.journalEntry.findMany({ select: { content: true } }),
  ]);

  const corpus = [
    ...activities.map((a) => a.description ?? ''),
    ...journals.map((j) => j.content ?? ''),
  ].filter((t) => t.trim().length > 0);

  const totalChars = corpus.reduce((n, t) => n + t.length, 0);

  console.log('');
  console.log(`Sigil collision scan — ${corpus.length} texts, ${totalChars} chars`);
  console.log('  (AllocationActivity.description + JournalEntry.content)');
  console.log('─'.repeat(72));
  console.log('  SIGIL   HITS   TEXTS  NOTE');

  const results: Array<{ char: string; hits: number; texts: number; note: string }> = [];

  for (const { char, note } of CANDIDATES) {
    const re = triggerRegex(char);
    let hits = 0;
    let texts = 0;
    const samples: string[] = [];

    for (const text of corpus) {
      re.lastIndex = 0;
      const found = text.match(re);
      if (!found) continue;
      hits += found.length;
      texts += 1;
      if (samples.length < 3) {
        const idx = text.search(re);
        samples.push(text.slice(Math.max(0, idx - 25), idx + 35).replace(/\s+/g, ' '));
      }
    }

    results.push({ char, hits, texts, note });
    const flag = hits === 0 ? '  ' : '!!';
    console.log(
      `${flag}  ${char.padEnd(5)} ${String(hits).padStart(6)} ${String(texts).padStart(7)}  ${note}`,
    );
    if (SHOW_SAMPLES && samples.length > 0) {
      for (const sm of samples) console.log(`            … ${sm}`);
    }
  }

  const clean = results.filter(
    (r) => r.hits === 0 && !r.note.startsWith('TAKEN') && !r.note.startsWith('EXCLUDED'),
  );

  console.log('');
  console.log(
    clean.length > 0
      ? `  Zero collisions: ${clean.map((r) => r.char).join('  ')}`
      : '  Every candidate collides — pick the lowest count and accept the risk.',
  );
  console.log('');
  console.log('  Read-only. LOCAL data only — LIVE is ahead, so re-run there');
  console.log('  before treating a zero as final.');
  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
