// Lexical alignment between a query and a result's (title + snippet).
//
// Returns the fraction of non-stopword query tokens that appear in the
// result's title or snippet token set. 0..1. Used by the core ranker to
// damp results whose surface text has near-zero overlap with the query
// (typical brand-collision pattern: query about a technology, result is
// a retail homepage with no technical tokens).
//
// SCRIPT-AGNOSTIC (was English-only):
//   The tokenizer is Unicode-aware, so the alignment gate works for Arabic
//   (and any other non-Latin script) instead of silently collapsing to 0 for
//   every non-ASCII query. Before this change an Arabic query produced an
//   EMPTY token set, which made `lexicalAlignment` always 0 — so the
//   off-topic gates (tier-0 demotion, score floor, cache read/write guards)
//   were completely inert for non-English queries.
//
//   Arabic text is normalized before tokenizing: diacritics (harakat) are
//   stripped and alef/ya/ta-marbuta/hamza variants are folded to a single
//   base letter, so "الشاشة" matches "الشاشه" and the same word written
//   with or without harakat does not fragment the token set.

// Arabic diacritics (harakat) + tatweel. Stripped so a token written with
// and without harakat is the same token.
const ARABIC_DIACRITICS_RE = /[\u064B-\u0652\u0670\u0640]/g;

/**
 * Fold a string into the canonical form used for token comparisons.
 * Applies to EVERY script, so the stopword tables below can be written in
 * their natural spelling and still match the normalized tokens.
 */
function normalizeForTokens(text: string): string {
  return text
    .toLowerCase()
    .replace(ARABIC_DIACRITICS_RE, '')
    // Fold Arabic letter variants onto their base form:
    // آ/أ/إ/ٱ -> ا, ى -> ي, ة -> ه, ؤ -> و, ئ -> ي
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A');
}

const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an',
  'what', 'is', 'are', 'was', 'were', 'how', 'why', 'when', 'where', 'who',
  'do', 'does', 'did',
  'for', 'of', 'to', 'in', 'on', 'with', 'and', 'or', 'but', 'as', 'at',
  'by', 'from', 'into', 'about', 'than',
  'this', 'that', 'these', 'those', 'it', 'its',
  'be', 'been', 'has', 'have', 'had',
  'can', 'could', 'should', 'would', 'may', 'might', 'must',
  'will', 'shall',
  'i', 'you', 'we', 'they', 'he', 'she', 'them',
  'my', 'your', 'our', 'their',
  'latest', 'current', 'newest', 'recent', 'best', 'top', 'most',
]);

// Arabic function words. They carry no entity signal, so a query made only
// of these must not count as "has content tokens" (that would re-open the
// door to the very junk this gate exists to remove). The list is normalized
// at build time so "على" (alef maksura) matches the folded "علي" token.
const ARABIC_STOPWORDS: ReadonlySet<string> = new Set(
  [
    'من', 'في', 'عن', 'على', 'مع', 'إلى', 'الى', 'هذا', 'هذه', 'ذلك',
    'التي', 'الذي', 'الذين', 'اللذان', 'اللاتي', 'ما', 'ماذا',
    'كيف', 'متى', 'اين', 'أين', 'لماذا', 'هل', 'او', 'و', 'ثم', 'قد', 'كان',
    'كانت', 'يكون', 'تكون', 'كل', 'بعض', 'بين', 'بعد', 'قبل', 'حتى', 'عند',
    'لدى', 'نحو', 'حيث', 'ايضا', 'أيضا', 'هو', 'هي', 'هم', 'نحن', 'انا',
    'كم', 'متي',
  ].map((w) => normalizeForTokens(w)),
);

function tokenize(s: string): string[] {
  // \p{M} (combining marks) is included so scripts that write vowel signs
  // INSIDE the letter (Devanagari, Thai, ...) do not shatter into
  // single-character tokens that the length filter would then drop.
  const matches = normalizeForTokens(s).match(/[\p{L}\p{M}\p{N}]+/gu);
  if (!matches) return [];
  return matches.filter(
    (t) => t.length >= 2 && !STOPWORDS.has(t) && !ARABIC_STOPWORDS.has(t),
  );
}

/**
 * Fraction of unique non-stopword query tokens that appear in (title + snippet).
 * Range: [0, 1].
 */
export function lexicalAlignment(query: string, title: string, snippet: string): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;

  const docTokens = new Set<string>();
  for (const t of tokenize(title)) docTokens.add(t);
  for (const t of tokenize(snippet)) docTokens.add(t);
  if (docTokens.size === 0) return 0;

  let overlap = 0;
  for (const t of qTokens) {
    if (docTokens.has(t)) overlap++;
  }
  return overlap / qTokens.size;
}

/**
 * True when the query carries at least one content token (i.e. a token that
 * could legitimately be matched by a result). A query made only of stopwords
 * has nothing to align against, so every alignment gate must stay open.
 */
export function hasContentTokens(query: string): boolean {
  return tokenize(query).length > 0;
}
