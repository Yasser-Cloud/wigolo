// Foreign-script / off-topic detection for whole result batches.
//
// WHY THIS EXISTS
// A single misbehaving engine can poison an otherwise healthy search. The
// classic shape: a non-English query comes back with ONE engine answering,
// and that engine returns pages in a completely different language/topic
// (e.g. "سيدة الشاشة العربية" answered with Google Chrome download pages).
// The results LOOK valid — a non-empty title, a URL, a snippet — so every
// count-based health check ("did the engine return anything?") passes, and
// the junk is then written to the persistent search cache and replayed for
// the whole TTL.
//
// WHY SCRIPT-AWARE AND NOT PURELY LEXICAL
// Wigolo already has lexical quality gates (tier-0 demotion, score floor)
// and those gates are calibrated for English: for a Latin-script query an
// English result that shares no token with the query is junk, and the
// existing machinery already demotes it. For a NON-Latin query the failure
// mode is different and much louder — the engine answers in another
// language entirely, so NOTHING in the payload shares the query's script.
//
// So the gate here is: "the query is written in a non-Latin script and NOT
// ONE result is written in that script" -> the engine answered in the wrong
// language, and the whole payload is noise.
//
// Latin-script queries are deliberately left untouched: their junk is
// already handled by the existing (English-calibrated) gates, and changing
// that behaviour would break the established contract for every caller.
//
// The gate is script-generic: Arabic, Hebrew, Cyrillic, Greek, Devanagari,
// Thai, Kana, Han and Hangul are all covered by the same rule.

import { lexicalAlignment, hasContentTokens } from './lexical-alignment.js';

export interface AlignableResult {
  title?: string;
  snippet?: string;
  url?: string;
}

// Non-Latin script ranges. The FIRST range present in the query defines the
// query's script; a result counts as "in-script" when it contains ANY
// character from that range.
const NON_LATIN_SCRIPTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/, 'arabic'],
  [/[\u0590-\u05FF]/, 'hebrew'],
  [/[\u0400-\u04FF]/, 'cyrillic'],
  [/[\u0370-\u03FF]/, 'greek'],
  [/[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F]/, 'indic'],
  [/[\u0E00-\u0E7F]/, 'thai'],
  [/[\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]/, 'kana'],
  [/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/, 'han'],
  [/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/, 'hangul'],
];

function detectNonLatinScript(text: string): string | null {
  for (const [re, name] of NON_LATIN_SCRIPTS) {
    if (re.test(text)) return name;
  }
  return null;
}

function containsScript(text: string, script: string): boolean {
  for (const [re, name] of NON_LATIN_SCRIPTS) {
    if (name === script) return re.test(text);
  }
  return false;
}

/**
 * True when the query is written in a non-Latin script and NOT ONE result in
 * the batch is written in that script — i.e. the engine answered in a
 * different language. Returns false for Latin-script queries, for
 * stopword-only queries, and for an empty batch.
 */
export function isForeignScriptBatch(query: string, results: AlignableResult[]): boolean {
  if (!results || results.length === 0) return false;
  if (!hasContentTokens(query)) return false;
  const script = detectNonLatinScript(query);
  if (!script) return false; // Latin query — existing (English-calibrated) gates own this.
  return results.every(
    (r) => !containsScript(`${r.title ?? ''} ${r.snippet ?? ''}`, script),
  );
}

/**
 * True when the result carries no character from the query's script AND
 * shares no content token with the query — i.e. it is a page in another
 * language about something else. Always false for Latin-script queries
 * (their junk is handled by the existing English-calibrated gates).
 */
export function isForeignScriptResult(query: string, result: AlignableResult): boolean {
  if (!hasContentTokens(query)) return false;
  const script = detectNonLatinScript(query);
  if (!script) return false;
  const text = `${result.title ?? ''} ${result.snippet ?? ''}`;
  if (containsScript(text, script)) return false;
  return lexicalAlignment(query, result.title ?? '', result.snippet ?? '') === 0;
}

/**
 * Sink the rows that cannot be about the query instead of dropping them: for
 * a non-Latin-script query, a row that shares NO content token with the
 * query is almost certainly noise (another language, another topic). It is
 * demoted (score x factor) rather than removed — a degraded pool may have
 * produced nothing else — so the score floor can trim it and the on-topic
 * rows keep the top slots. Latin-script queries are untouched (their junk
 * is handled by the existing English-calibrated gates).
 */
export function demoteUnalignedResults<T extends AlignableResult & { relevance_score: number }>(
  query: string,
  results: T[],
  factor = 0.05,
): T[] {
  if (!results || results.length === 0) return results;
  if (!hasContentTokens(query)) return results;
  if (!detectNonLatinScript(query)) return results;
  return results.map((r) =>
    lexicalAlignment(query, r.title ?? '', r.snippet ?? '') === 0
      ? { ...r, relevance_score: r.relevance_score * factor }
      : r,
  );
}

/**
 * True when EVERY result in the batch shares no content token with the
 * query. Used as the strict lexical signal (independent of script).
 */
export function isOffTopicBatch(query: string, results: AlignableResult[]): boolean {
  if (!results || results.length === 0) return false;
  if (!hasContentTokens(query)) return false;
  return results.every(
    (r) => lexicalAlignment(query, r.title ?? '', r.snippet ?? '') === 0,
  );
}

/**
 * True when at least one result in the batch shares a content token with the
 * query. A payload with no on-topic row is never worth caching.
 */
export function hasOnTopicResult(query: string, results: AlignableResult[]): boolean {
  if (!results || results.length === 0) return false;
  if (!hasContentTokens(query)) return true;
  return results.some(
    (r) => lexicalAlignment(query, r.title ?? '', r.snippet ?? '') > 0,
  );
}
