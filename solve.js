// A faster drop-in for csv-reader 1.0.0 (make.fun's reference CSV reader).
//
// run(input) returns exactly csv-reader 1.0.0's reading of {text, header}: the JSON value
// {columns, rows, errors} under its broken-row policy:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled ("" inside it is
//     one quote; each CRLF or lone CR inside it is read as LF); what follows its closing quote, up
//     to the next comma or line break, is appended as it stands (quote_junk, when the field ends);
//   - a quote that never closes is a literal character and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - columns is the first record when header is true, else null; rows holds the records after it
//     (every record when header is false), each padded with "" (short_row) or cut (long_row) to
//     the first record's width;
//   - each error is {code, line, row} in the order met: line the 1-based line its record starts
//     on (counting every LF, CRLF and lone CR inside quotes), row its record's index in rows
//     (null for the header).
//
// Where the reference walks a character at a time and grows each field a character at a time,
// this reader scans each field to its next delimiter and slices it out whole; the next LF
// and CR are cached searches, so a quoted field's content is not rescanned per field; the piecewise
// paths (a stray CR inside a field, a doubled quote, a CR inside quotes, junk after a closing
// quote, the re-read of an unterminated quote) run only on the fields that need them.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

// How a field ended: 0 at a comma (the record goes on), 1 at a line break, 2 at the end of text.
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  // Cached next LF / CR: each is the first occurrence at or after the position it was
  // computed from (or -1 for none). pos moves only forward (the unterminated-quote
  // re-read is the one step back, and it resets both), so a cached index that is still
  // >= the query start is still the first occurrence at or after it; a stale one is
  // recomputed on demand. Together the two searches cross each character once.
  let nLF = -2;
  let nCR = -2;
  if (n !== 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read, shared between the readers below to keep the hot loop allocation-free.
  let fValue = '';
  let fEnded = 2;

  // Scans unquoted content from pos onto `parts` (an array of string pieces), dropping each lone
  // CR with a stray_cr error. Sets fEnded and leaves pos past the delimiter that ended the
  // field. Returns the number of characters kept.
  function scanUnquoted(parts) {
    let added = 0;
    for (;;) {
      const segStart = pos;
      let i = pos;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44) break;
        if (c <= 13 && (c === 10 || c === 13)) break;
        i++;
      }
      if (i > segStart) {
        parts.push(text.slice(segStart, i));
        added += i - segStart;
      }
      if (i >= n) {
        fEnded = 2;
        pos = i;
        return added;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        fEnded = 0;
        pos = i + 1;
        return added;
      }
      if (c === 10) {
        fEnded = 1;
        pos = i + 1;
        line++;
        return added;
      }
      // c === 13: CRLF ends the field; a lone CR is dropped with an error and the field goes on.
      if (text.charCodeAt(i + 1) === 10) {
        fEnded = 1;
        pos = i + 2;
        line++;
        return added;
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = i + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos into fValue; sets fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // The closing quote is the next '"' that is not doubled.
    let q = text.indexOf('"', open + 1);
    let hasDouble = false;
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      hasDouble = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again
      // as unquoted.
      pos = open + 1;
      line = openLine;
      nLF = -2;
      nCR = -2;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      const parts = ['"'];
      scanUnquoted(parts);
      fValue = parts.join('');
      return;
    }
    const cs = open + 1; // the content is text[cs .. q)
    let value;
    if (nCR < cs) nCR = text.indexOf('\r', cs);
    if (!hasDouble && (nCR === -1 || nCR >= q)) {
      // Clean content: no doubled quote, no CR. Slice it whole and count its LFs by
      // stepping the cached LF search from one LF to the next.
      value = text.slice(cs, q);
      if (nLF < cs) nLF = text.indexOf('\n', cs);
      while (nLF !== -1 && nLF < q) {
        line++;
        nLF = text.indexOf('\n', nLF + 1);
      }
    } else {
      // The content holds a doubled quote or a CR (or both): build it from pieces. Every '"'
      // in the span is half of a doubled pair; each CR or CRLF becomes one LF.
      const parts = [];
      let segStart = cs;
      let i = cs;
      while (i < q) {
        const c = text.charCodeAt(i);
        if (c === 34) {
          if (i > segStart) parts.push(text.slice(segStart, i));
          parts.push('"');
          i += 2;
          segStart = i;
        } else if (c === 13) {
          if (i > segStart) parts.push(text.slice(segStart, i));
          parts.push('\n');
          line++;
          i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
          segStart = i;
        } else {
          if (c === 10) line++;
          i++;
        }
      }
      if (q > segStart) parts.push(text.slice(segStart, q));
      value = parts.join('');
    }
    pos = q + 1;
    if (pos >= n) {
      fValue = value;
      fEnded = 2;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos++;
      fValue = value;
      fEnded = 0;
      return;
    }
    if (c === 10) {
      pos++;
      line++;
      fValue = value;
      fEnded = 1;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line++;
      fValue = value;
      fEnded = 1;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or break.
    const parts = [value];
    const added = scanUnquoted(parts);
    if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    fValue = parts.join('');
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        // Unquoted field: scan to the next comma or line break and slice the field whole.
        const segStart = pos;
        let i = pos;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 44) break;
          if (c <= 13 && (c === 10 || c === 13)) break;
          i++;
        }
        if (i >= n) {
          fValue = text.slice(segStart, i);
          fEnded = 2;
          pos = i;
        } else {
          const c = text.charCodeAt(i);
          if (c === 44) {
            fValue = text.slice(segStart, i);
            fEnded = 0;
            pos = i + 1;
          } else if (c === 10) {
            fValue = text.slice(segStart, i);
            fEnded = 1;
            pos = i + 1;
            line++;
          } else if (text.charCodeAt(i + 1) === 10) {
            // c === 13 and CRLF ends the field.
            fValue = text.slice(segStart, i);
            fEnded = 1;
            pos = i + 2;
            line++;
          } else {
            // A lone CR inside the field: dropped with an error; the field is built in pieces.
            const parts = [];
            if (i > segStart) parts.push(text.slice(segStart, i));
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            pos = i + 1;
            scanUnquoted(parts);
            fValue = parts.join('');
          }
        }
      }
      fields.push(fValue);
      if (fEnded !== 0) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
