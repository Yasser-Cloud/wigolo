import { describe, it, expect } from 'vitest';
import {
  isForeignScriptBatch,
  isOffTopicBatch,
  hasOnTopicResult,
  demoteUnalignedResults,
} from '../../../../src/search/core/offtopic.js';

// WHY these tests exist:
// A single misbehaving engine can poison an otherwise healthy search. The
// classic shape: a non-English query answered by ONE engine that returned
// pages in a completely different language (e.g. Google Chrome download
// pages for "سيدة الشاشة العربية"). The rows are well-formed, so every
// count-based health check passes — the junk then gets cached and replayed.
//
// The gate is script-aware: a payload answered entirely outside the query's
// script is noise. Latin-script queries are deliberately untouched (their
// junk is handled by the existing English-calibrated score gates).

const chromePage = {
  title: 'Google Chrome - The Fast & Secure Web Browser Built to be Yours',
  snippet: 'Chrome is the official web browser from Google. Download now.',
  url: 'https://www.google.com/chrome/',
};

const hamamaPage = {
  title: 'فاتن حمامة - ويكيبيديا',
  snippet: 'سيدة الشاشة العربية سعاد حسني',
  url: 'https://ar.wikipedia.org/wiki/فاتن_حمامة',
};

describe('isForeignScriptBatch', () => {
  it('flags a payload answered entirely in another script', () => {
    expect(isForeignScriptBatch('سيدة الشاشة العربية', [chromePage])).toBe(true);
  });

  it('keeps a payload that contains the query script', () => {
    expect(isForeignScriptBatch('سيدة الشاشة العربية', [hamamaPage])).toBe(false);
  });

  it('keeps a MIXED payload (one in-script row is enough)', () => {
    expect(isForeignScriptBatch('سيدة الشاشة العربية', [chromePage, hamamaPage])).toBe(false);
  });

  it('never fires for a Latin-script query (existing gates own that)', () => {
    expect(isForeignScriptBatch('pgvector hnsw tuning', [chromePage])).toBe(false);
  });

  it('never fires for a stopword-only query or an empty payload', () => {
    expect(isForeignScriptBatch('من في على', [chromePage])).toBe(false);
    expect(isForeignScriptBatch('سيدة الشاشة العربية', [])).toBe(false);
  });

  it('covers other non-Latin scripts the same way', () => {
    // The payload is Latin-only, so it is foreign for a Cyrillic query and
    // for a Devanagari query alike.
    expect(isForeignScriptBatch('как открыть', [chromePage])).toBe(true);
    expect(isForeignScriptBatch('कैसे खोलें', [chromePage])).toBe(true);
    // A payload in the query's own script is fine.
    expect(
      isForeignScriptBatch('как открыть', [{ title: 'Как открыть', snippet: '', url: 'u' }]),
    ).toBe(false);
  });
});

describe('isOffTopicBatch', () => {
  it('flags a batch that shares no content token with the query', () => {
    expect(isOffTopicBatch('سيدة الشاشة العربية', [chromePage])).toBe(true);
  });

  it('keeps a batch that shares a content token with the query', () => {
    expect(isOffTopicBatch('سيدة الشاشة العربية', [hamamaPage])).toBe(false);
  });

  it('treats an empty batch as off-topic-free (nothing to judge)', () => {
    expect(isOffTopicBatch('سيدة الشاشة العربية', [])).toBe(false);
  });

  it('never fires for a query with no content tokens (stopwords only)', () => {
    expect(isOffTopicBatch('من في على', [chromePage])).toBe(false);
    expect(isOffTopicBatch('what is the', [chromePage])).toBe(false);
  });

  it('works the same way for English queries', () => {
    const junk = [
      { title: "Women's Clothing", snippet: 'Shop dresses', url: 'https://shop.example/' },
    ];
    expect(isOffTopicBatch('pgvector hnsw tuning', junk)).toBe(true);
    const good = [
      { title: 'pgvector hnsw tuning guide', snippet: '', url: 'https://docs.example/pg' },
    ];
    expect(isOffTopicBatch('pgvector hnsw tuning', good)).toBe(false);
  });
});

describe('demoteUnalignedResults', () => {
  it('sinks rows that share no token with a non-Latin query', () => {
    const rows = [
      { title: 'فاتن حمامة - ويكيبيديا', snippet: 'سيدة الشاشة العربية', url: 'u1', relevance_score: 1 },
      { title: 'Mayo Clinic', snippet: 'Diseases and Conditions', url: 'u2', relevance_score: 0.6 },
    ];
    const out = demoteUnalignedResults('سيدة الشاشة العربية', rows);
    expect(out[0].relevance_score).toBe(1);
    expect(out[1].relevance_score).toBeLessThan(0.6);
  });

  it('never touches a Latin-script query (existing gates own that)', () => {
    const rows = [
      { title: 'Women\'s Clothing', snippet: 'Shop dresses', url: 'u1', relevance_score: 0.6 },
    ];
    const out = demoteUnalignedResults('pgvector hnsw tuning', rows);
    expect(out[0].relevance_score).toBe(0.6);
  });

  it('never touches a stopword-only query (nothing to align against)', () => {
    const rows = [{ title: 'Mayo Clinic', snippet: 'x', url: 'u1', relevance_score: 0.6 }];
    expect(demoteUnalignedResults('من في على', rows)[0].relevance_score).toBe(0.6);
  });
});

describe('hasOnTopicResult', () => {  it('is false when no row shares a content token with the query', () => {
    expect(hasOnTopicResult('سيدة الشاشة العربية', [chromePage])).toBe(false);
  });

  it('is true when at least one row is on-topic', () => {
    expect(hasOnTopicResult('سيدة الشاشة العربية', [chromePage, hamamaPage])).toBe(true);
  });

  it('is true for a stopword-only query (nothing to align against)', () => {
    expect(hasOnTopicResult('من في على', [])).toBe(false);
    expect(hasOnTopicResult('من في على', [chromePage])).toBe(true);
  });
});
