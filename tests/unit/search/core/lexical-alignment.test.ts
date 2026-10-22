import { describe, it, expect } from 'vitest';
import { lexicalAlignment, hasContentTokens } from '../../../../src/search/core/lexical-alignment.js';

describe('lexicalAlignment', () => {
  it('returns 0 when title and snippet share no query tokens', () => {
    const a = lexicalAlignment('next.js server actions caching', "Women's Clothing", 'Shop dresses');
    expect(a).toBe(0);
  });

  it('returns 1 when title fully covers the query tokens', () => {
    const a = lexicalAlignment(
      'pgvector hnsw ef_search',
      'pgvector hnsw ef_search tuning guide',
      '',
    );
    expect(a).toBe(1);
  });

  it('returns a partial fraction when only some tokens match', () => {
    const a = lexicalAlignment(
      'next.js 15 app router server actions',
      'Next.js 15 App Router release notes',
      '',
    );
    expect(a).toBeGreaterThan(0.5);
    expect(a).toBeLessThan(1);
  });

  it('ignores stopwords in the query', () => {
    // Query stopwords-only after filtering => alignment 0 (empty query set).
    const a = lexicalAlignment('what is the best', 'doc title', 'snippet');
    expect(a).toBe(0);
  });

  it('handles empty title and snippet', () => {
    const a = lexicalAlignment('pgvector', '', '');
    expect(a).toBe(0);
  });

  it('handles empty query', () => {
    const a = lexicalAlignment('', 'pgvector docs', 'lorem ipsum');
    expect(a).toBe(0);
  });

  it('combines title + snippet for token coverage', () => {
    const a = lexicalAlignment(
      'pgvector hnsw',
      'database tuning',
      'pgvector hnsw index configuration',
    );
    expect(a).toBe(1);
  });

  it('treats tokens case-insensitively and strips punctuation', () => {
    const a = lexicalAlignment('Next.js', 'NEXT-JS Docs', '');
    expect(a).toBe(1);
  });

  // The gate used to be ASCII-only, so an Arabic query produced an empty
  // token set and every alignment-based quality gate stayed inert for
  // non-English queries. These cases pin the script-agnostic behaviour.
  it('aligns Arabic queries against Arabic results', () => {
    const a = lexicalAlignment(
      'سيدة الشاشة العربية',
      'فاتن حمامة - ويكيبيديا',
      'سيدة الشاشة العربية سعاد حسني',
    );
    expect(a).toBeGreaterThan(0);
  });

  it('scores an off-topic English page as 0 for an Arabic query', () => {
    const a = lexicalAlignment(
      'سيدة الشاشة العربية',
      'Google Chrome - The Fast & Secure Web Browser',
      'Download now and make it yours.',
    );
    expect(a).toBe(0);
  });

  it('ignores Arabic diacritics and letter variants', () => {
    expect(lexicalAlignment('سيدة الشاشة', 'سيّدة الشاشة', '')).toBeGreaterThan(0);
    expect(lexicalAlignment('منتخب مصر', 'منتخب مصري', '')).toBeGreaterThan(0);
  });
});

describe('hasContentTokens', () => {
  it('is true for a query with real content words', () => {
    expect(hasContentTokens('سيدة الشاشة العربية')).toBe(true);
    expect(hasContentTokens('pgvector hnsw')).toBe(true);
  });

  it('is false for a stopword-only query (English and Arabic)', () => {
    expect(hasContentTokens('what is the')).toBe(false);
    expect(hasContentTokens('من في على')).toBe(false);
  });
});
