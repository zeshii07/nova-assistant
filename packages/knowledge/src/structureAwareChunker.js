/**
 * v55.0 — Structure-Aware Chunker
 *
 * Replaces the naive sentence-only chunker (knowledgeNormalizer.chunkText)
 * with a chunker that respects document structure:
 *
 *   - Keeps a heading with its relevant body (heading + body = one chunk)
 *   - Keeps numbered and bulleted lists together as one chunk where practical
 *   - Preserves policy conditions and exceptions (e.g., the four cancellation
 *     tiers in a policy paragraph stay together)
 *   - Splits long paragraphs at sentence boundaries only when over the limit
 *   - Carries the parent heading context into every chunk
 *   - Tracks source location (line range) where available
 *   - Avoids tiny, meaningless chunks (merges into the previous chunk)
 *   - Avoids excessively large chunks that contain unrelated topics
 *
 * Spec reference: §7.2 Semantic chunking
 *
 * Configurable per knowledge type (defaults):
 *   FAQ            → 300-500 chars
 *   General docs   → 700-1000 chars
 *   Policies       → 1000-1500 chars
 *   Procedures     → group related steps
 *   Structured     → individual records (handled by normalizeJson, not here)
 */

const DEFAULT_MAX = {
  faq: 500,
  document: 1000,
  customer_policy: 1500,
  procedure: 1400,
  default: 900,
};

const MIN_CHUNK_CHARS = 40;       // chunks below this merge into the previous
const MAX_CHUNK_HARD_CAP = 3000;  // never emit a chunk larger than this

/**
 * Detect markdown heading level. Returns 0 for non-headings.
 */
function headingLevel(line) {
  const m = /^(#{1,6})\s+\S/.exec(String(line || ''));
  return m ? m[1].length : 0;
}

/**
 * Detect a numbered list item: "1. ", "1) ", "10. ", "(1) ".
 */
function isNumberedListItem(line) {
  return /^\s*(\d{1,3}[.)]|\(\d{1,3}\))\s+\S/.test(String(line || ''));
}

/**
 * Detect a bulleted list item: "- ", "* ", "+ ", "• ".
 */
function isBulletListItem(line) {
  return /^\s*[-*+•]\s+\S/.test(String(line || ''));
}

function isListItem(line) {
  return isNumberedListItem(line) || isBulletListItem(line);
}

/**
 * Is this line a markdown table row? (| ... | ... |)
 */
function isTableRow(line) {
  const s = String(line || '').trim();
  return s.startsWith('|') && s.endsWith('|') && s.includes('|', 1);
}

/**
 * Is this a markdown table separator? (| --- | --- |)
 */
function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(String(line || ''));
}

/**
 * Split a long paragraph at sentence boundaries, never mid-sentence.
 */
function splitAtSentences(text, maxChars) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur.length + s.length + 1) > maxChars) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) out.push(cur);
  // If a single sentence exceeds maxChars (rare), hard-split at the limit on a word boundary.
  const final = [];
  for (const chunk of out) {
    if (chunk.length <= MAX_CHUNK_HARD_CAP) { final.push(chunk); continue; }
    let rem = chunk;
    while (rem.length > MAX_CHUNK_HARD_CAP) {
      const slice = rem.slice(0, MAX_CHUNK_HARD_CAP);
      const lastSpace = slice.lastIndexOf(' ');
      const cut = lastSpace > MIN_CHUNK_CHARS ? lastSpace : MAX_CHUNK_HARD_CAP;
      final.push(rem.slice(0, cut).trim());
      rem = rem.slice(cut).trim();
    }
    if (rem) final.push(rem);
  }
  return final.filter(Boolean);
}

/**
 * Structure-aware chunker.
 *
 * @param {string} text         The document text (markdown or plain).
 * @param {object} options      { maxChars, kind, sourceName, startLine }
 *   - maxChars:  override the per-kind default
 *   - kind:      'faq' | 'document' | 'customer_policy' | 'procedure' | 'default'
 *   - sourceName: for chunk IDs
 *   - startLine: starting line number for sourceLocation (1-based)
 * @returns {Array<{chunkId, heading, text, sourceLocation}>}
 */
function structureAwareChunk(text, options = {}) {
  const {
    maxChars,
    kind = 'default',
    sourceName = 'doc',
    startLine = 1,
  } = options;

  const limit = maxChars || DEFAULT_MAX[kind] || DEFAULT_MAX.default;

  const lines = String(text || '').split(/\r?\n/);
  const chunks = [];
  let currentHeading = '';
  let currentHeadingLine = 0;
  let bodyBuffer = [];
  let bodyStartLine = startLine;

  const flush = (endLine) => {
    const content = bodyBuffer.join('\n').trim();
    if (!content) { bodyBuffer = []; return; }
    const prefix = currentHeading ? `${currentHeading}\n` : '';
    const combined = `${prefix}${content}`.trim();

    // If the combined chunk fits, emit one chunk.
    if (combined.length <= limit) {
      chunks.push({
        chunkId: `${sourceName}:chunk:${chunks.length}`,
        heading: currentHeading.replace(/^#{1,6}\s+/, ''),
        text: combined,
        sourceLocation: { lineStart: bodyStartLine, lineEnd: endLine },
      });
    } else {
      // Split long content at sentence boundaries; carry heading on each piece.
      const parts = splitAtSentences(content, Math.max(500, limit - prefix.length));
      for (const part of parts) {
        const piece = `${prefix}${part}`.trim();
        chunks.push({
          chunkId: `${sourceName}:chunk:${chunks.length}`,
          heading: currentHeading.replace(/^#{1,6}\s+/, ''),
          text: piece,
          sourceLocation: { lineStart: bodyStartLine, lineEnd: endLine },
        });
      }
    }
    bodyBuffer = [];
  };

  let listBuffer = [];
  let listStartLine = startLine;
  let inTable = false;
  let tableBuffer = [];
  let tableStartLine = startLine;

  const flushList = (endLine) => {
    if (!listBuffer.length) return;
    const listText = listBuffer.join('\n').trim();
    const prefix = currentHeading ? `${currentHeading}\n` : '';
    const combined = `${prefix}${listText}`.trim();
    // Lists stay together unless they exceed maxChars (or the hard cap).
    // When they exceed maxChars, split at item boundaries, keeping items intact.
    if (combined.length <= limit) {
      chunks.push({
        chunkId: `${sourceName}:chunk:${chunks.length}`,
        heading: currentHeading.replace(/^#{1,6}\s+/, ''),
        text: combined,
        sourceLocation: { lineStart: listStartLine, lineEnd: endLine },
      });
    } else {
      // A list that is too long: split it, keeping items intact.
      const items = listBuffer.slice();
      let cur = `${prefix}`.trim();
      let curStart = listStartLine;
      for (let i = 0; i < items.length; i++) {
        const candidate = cur ? `${cur}\n${items[i]}` : items[i];
        if (candidate.length > limit && cur) {
          chunks.push({
            chunkId: `${sourceName}:chunk:${chunks.length}`,
            heading: currentHeading.replace(/^#{1,6}\s+/, ''),
            text: cur,
            sourceLocation: { lineStart: curStart, lineEnd: listStartLine + i - 1 },
          });
          cur = `${prefix}${items[i]}`.trim();
          curStart = listStartLine + i;
        } else {
          cur = candidate;
        }
      }
      if (cur) {
        chunks.push({
          chunkId: `${sourceName}:chunk:${chunks.length}`,
          heading: currentHeading.replace(/^#{1,6}\s+/, ''),
          text: cur,
          sourceLocation: { lineStart: curStart, lineEnd: endLine },
        });
      }
    }
    listBuffer = [];
  };

  const flushTable = (endLine) => {
    if (!tableBuffer.length) { inTable = false; return; }
    const tableText = tableBuffer.join('\n').trim();
    const prefix = currentHeading ? `${currentHeading}\n` : '';
    const combined = `${prefix}${tableText}`.trim();
    chunks.push({
      chunkId: `${sourceName}:chunk:${chunks.length}`,
      heading: currentHeading.replace(/^#{1,6}\s+/, ''),
      text: combined,
      sourceLocation: { lineStart: tableStartLine, lineEnd: endLine },
    });
    tableBuffer = [];
    inTable = false;
  };

  lines.forEach((raw, idx) => {
    const lineNo = startLine + idx;
    const line = raw.trimEnd();

    // Heading: flush everything, start a new section.
    const hlevel = headingLevel(line);
    if (hlevel > 0) {
      flushList(lineNo - 1);
      flushTable(lineNo - 1);
      flush(lineNo - 1);
      currentHeading = line.trim();
      currentHeadingLine = lineNo;
      bodyStartLine = lineNo + 1;
      return;
    }

    // Table handling: keep header + separator + all rows together.
    if (isTableRow(line) || isTableSeparator(line)) {
      if (!inTable) {
        flushList(lineNo - 1);
        flush(lineNo - 1);
        inTable = true;
        tableStartLine = lineNo;
      }
      tableBuffer.push(raw);
      return;
    } else if (inTable) {
      // End of table on a blank line or non-table content.
      flushTable(lineNo - 1);
    }

    // List handling: collect consecutive list items into one buffer.
    if (isListItem(line)) {
      if (!listBuffer.length) {
        flush(lineNo - 1);
        listStartLine = lineNo;
      }
      listBuffer.push(raw);
      return;
    } else if (listBuffer.length) {
      // End of list on a non-list, non-blank line.
      flushList(lineNo - 1);
    }

    // Blank line: paragraph boundary. Don't flush yet — keep accumulating into
    // bodyBuffer until we hit a heading/list/table or the buffer is full.
    if (line.trim() === '') {
      bodyBuffer.push('');
      return;
    }

    bodyBuffer.push(raw);

    // If body grows beyond the limit, flush early to avoid one giant chunk.
    const currentLen = bodyBuffer.join('\n').length;
    if (currentLen > MAX_CHUNK_HARD_CAP) {
      flush(lineNo);
      bodyStartLine = lineNo + 1;
    }
  });

  // Final flush.
  const lastLine = startLine + lines.length - 1;
  flushList(lastLine);
  flushTable(lastLine);
  flush(lastLine);

  // Merge tiny chunks into the previous one.
  const merged = [];
  for (const chunk of chunks) {
    if (merged.length && chunk.text.length < MIN_CHUNK_CHARS) {
      const prev = merged[merged.length - 1];
      prev.text = `${prev.text}\n${chunk.text}`.trim();
      prev.sourceLocation.lineEnd = chunk.sourceLocation.lineEnd;
    } else {
      merged.push(chunk);
    }
  }

  return merged;
}

module.exports = { structureAwareChunk, DEFAULT_MAX, splitAtSentences, isListItem, isTableRow, headingLevel };
