/**
 * Timeline parser for the Smart Journal.
 *
 * Supported time formats:
 *   12h: 9:17am · 9:17 am · 3:26PM · 12:00am
 *   24h: 09:17 · 15:26  (no am/pm suffix)
 *
 * Two entry modes:
 *   1. Explicit range  — "9:17am to 4:12pm @AUII #Geniisys sprint"
 *                        "09:17 - 16:12 sprint planning"
 *      Duration = end − start (exact minutes)
 *
 *   2. Timeline mode   — leading timestamp only:
 *                        "9:17am @AUII #Geniisys sprint"
 *                        "4:12pm code review @UCPB"
 *      Duration of line N = timestamp[N+1] − timestamp[N]
 *      Last timestamped line uses defaultEndOfDay as its end.
 *
 *   A "time-only" line (just a timestamp, no description) is treated as
 *   a clock-out marker — it ends the previous line and carries no duration.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedTime {
  h: number; // 0–23
  m: number; // 0–59
}

export interface TimeMatch {
  time: ParsedTime;
  raw: string;    // matched substring as-typed
  index: number;  // start index in the original line
  length: number; // byte length of the match
}

export interface TimeRange {
  start: ParsedTime;
  end: ParsedTime;
  /** Character range of the entire "T1 to T2" span in the source line. */
  spanStart: number;
  spanEnd: number;
}

export interface SmartLineInput {
  id: string;
  text: string;
}

export interface ResolvedSmartLine extends SmartLineInput {
  timeRange?: TimeRange;
  leadingTime?: TimeMatch;
  /** True when the line contains only a timestamp (clock-out marker). */
  isTimeOnly: boolean;
  /** Computed duration in minutes; null when no time info present. */
  durationMinutes: number | null;
  /** HH:MM start for TimeBlock, undefined when no time info. */
  startTime?: string;
  /** HH:MM end for TimeBlock, undefined when no time info. */
  endTime?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_END_OF_DAY: ParsedTime = { h: 18, m: 0 };

// ── Math utils ────────────────────────────────────────────────────────────────

export function toMinutes(t: ParsedTime): number {
  return t.h * 60 + t.m;
}

/**
 * Like toMinutes but treats 12:00 AM (midnight = 0 min) as end-of-day
 * (1440 min = 24:00) when the corresponding start time is after midnight.
 * This lets "9:00 AM – 12:00 AM" be recognised as a valid 15-hour range
 * instead of being rejected as a reversed range.
 */
function endMinutes(endTime: ParsedTime, startTime: ParsedTime): number {
  const e = toMinutes(endTime);
  return e === 0 && toMinutes(startTime) > 0 ? 1440 : e;
}

export function minutesToStr(total: number): string {
  if (total <= 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function toHHMM(t: ParsedTime): string {
  return `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;
}

/** Format a "HH:MM" string to human display like "9:17 AM". */
export function hhmmToDisplay(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// ── Regex helpers ─────────────────────────────────────────────────────────────

// 12h: captures (hour, optional minute, period).
//   "9:17am", "9:01 am", "9:10 AM", "9am", "3:26 PM"
//
// The minute group is optional so bare-hour forms like "9am" are accepted
// and normalized downstream to ":00". The left lookbehind (?<!\d) plus
// `\d{1,2}` greediness rejects glued digits like "923am" — the engine
// can match "92" as hour but "3am" then fails the `\s*[aApP]` constraint,
// and backtracking to hour="9" leaves "23am" where "2" isn't `[aApP]`.
// The (?!\w) after the period prevents matching "3:26pmx".
const RE_12H_SRC =
  "(?<!\\d)(\\d{1,2})(?::(\\d{2}))?\\s*([aApP][mM]?)(?!\\w)";

// 24h: captures (hour, minute). Must NOT be followed by am/pm.
// (?<!\d) left-boundary stops matching inside "2026-02-03".
const RE_24H_SRC =
  "(?<!\\d)(\\d{1,2}):(\\d{2})(?!\\s*[aApP][mM])(?!\\d)";

function parse12h(h: number, m: number, period: string): ParsedTime | null {
  if (h < 1 || h > 12 || m > 59) return null;
  const p = period.toLowerCase();
  let hour: number;
  if (p.startsWith("a")) {
    hour = h === 12 ? 0 : h;
  } else {
    hour = h === 12 ? 12 : h + 12;
  }
  return { h: hour, m };
}

/**
 * Normalize a parsed time to the canonical "h:mm A" display format.
 *   {h: 9, m: 0}  → "9:00 AM"
 *   {h: 13, m: 30} → "1:30 PM"
 *
 * Use this to render any successfully parsed time token in a uniform way
 * regardless of which input form produced it ("9am", "9:00am", "09:00").
 */
export function normalizeTimeDisplay(t: ParsedTime): string {
  return hhmmToDisplay(toHHMM(t));
}

/** Extract every time token from `text`, left to right. */
function findAllTimes(text: string): TimeMatch[] {
  // Combined alternation — 12h group before 24h so am/pm wins over bare HH:MM
  const combined = new RegExp(
    `${RE_12H_SRC}|${RE_24H_SRC}`,
    "g",
  );

  const results: TimeMatch[] = [];
  let m: RegExpExecArray | null;

  while ((m = combined.exec(text)) !== null) {
    let time: ParsedTime | null = null;

    if (m[3] !== undefined) {
      // 12h branch (groups 1-3): m[2] (minute) is optional — bare "9am"
      // produces undefined here and is normalized to :00.
      const min = m[2] !== undefined ? parseInt(m[2]) : 0;
      time = parse12h(parseInt(m[1]), min, m[3]);
    } else if (m[4] !== undefined) {
      // 24h branch (groups 4-5)
      const h = parseInt(m[4]);
      const min = parseInt(m[5]);
      if (h <= 23 && min <= 59) time = { h, m: min };
    }

    if (time) {
      results.push({ time, raw: m[0], index: m.index, length: m[0].length });
    }
  }

  return results;
}

// Recognises the gap between two time tokens as a range separator.
// Accepts: " to ", " - ", " – ", " — ", just "-", "–", "—"
const RANGE_SEP_RE = /^\s*(?:to|[-–—])\s*$/i;

// ── Public parsing functions ──────────────────────────────────────────────────

/**
 * Detect an explicit time range anywhere in the line.
 * Returns the first pair of times separated by a recognised separator.
 *
 * Strict logical validation: endTime must be strictly AFTER startTime
 * within the same day. "9:00am - 6:00pm" is valid; "9:00am - 8:00am" is
 * not, because it would imply crossing into the next day and the daily
 * log format does not support that. An invalid range returns null and
 * the caller treats the line as having no time info, leaving it visible
 * to the user without contributing a (negative) duration.
 *
 * Note: overlapping ranges ACROSS different log lines/entries are not
 * rejected here — a user logging "9:00am - 6:00pm" on one task and
 * "11:00am - 12:00pm" on another is intentional and valid. Per-line
 * regex validation deliberately has no awareness of sibling lines.
 */
export function findTimeRange(text: string): TimeRange | null {
  const times = findAllTimes(text);
  if (times.length < 2) return null;

  const first = times[0];
  const second = times[1];
  const gap = text.substring(first.index + first.length, second.index);

  if (!RANGE_SEP_RE.test(gap)) return null;

  // Reject same-day reversed/equal ranges.
  // endMinutes treats 12:00 AM (midnight) as 1440 when start > 0,
  // so "9:00 AM – 12:00 AM" is accepted as a valid end-of-day range.
  if (endMinutes(second.time, first.time) <= toMinutes(first.time)) return null;

  return {
    start: first.time,
    end: second.time,
    spanStart: first.index,
    spanEnd: second.index + second.length,
  };
}

/**
 * Detect a time token at the very start of the line (ignoring leading
 * bullets or whitespace).  Used in timeline mode.
 */
export function findLeadingTime(text: string): TimeMatch | null {
  const stripped = text.replace(/^[\s\-\*•–—]+/, "");
  const offset = text.length - stripped.length;

  // 12h must come first so "9:17am" doesn't match the 24h branch.
  const m12 = stripped.match(new RegExp(`^${RE_12H_SRC}`));
  if (m12) {
    const min = m12[2] !== undefined ? parseInt(m12[2]) : 0;
    const time = parse12h(parseInt(m12[1]), min, m12[3]);
    if (time) {
      return { time, raw: m12[0], index: offset, length: m12[0].length };
    }
  }

  const m24 = stripped.match(new RegExp(`^${RE_24H_SRC}`));
  if (m24) {
    const h = parseInt(m24[1]);
    const min = parseInt(m24[2]);
    if (h <= 23 && min <= 59) {
      return { time: { h, m: min }, raw: m24[0], index: offset, length: m24[0].length };
    }
  }

  return null;
}

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Resolve all smart lines with computed durations.
 *
 * Pass `defaultEndOfDay` to control what the last timeline entry is
 * measured against when no clock-out marker follows it.
 */
export function resolveSmartLines(
  lines: SmartLineInput[],
  defaultEndOfDay: ParsedTime = DEFAULT_END_OF_DAY,
): ResolvedSmartLine[] {
  // ── Pass 1: extract raw time info from each line ───────────────────
  const annotated = lines.map((line) => {
    const range = findTimeRange(line.text);
    if (range) {
      return { ...line, timeRange: range, leadingTime: undefined };
    }
    const leading = findLeadingTime(line.text);
    return { ...line, timeRange: undefined, leadingTime: leading ?? undefined };
  });

  // ── Pass 2: resolve durations ──────────────────────────────────────
  return annotated.map((line, i): ResolvedSmartLine => {
    // ── Explicit range (highest priority) ─────────────────────────
    if (line.timeRange) {
      const dur =
        toMinutes(line.timeRange.end) - toMinutes(line.timeRange.start);
      return {
        ...line,
        isTimeOnly: false,
        durationMinutes: Math.max(0, dur),
        startTime: toHHMM(line.timeRange.start),
        endTime: toHHMM(line.timeRange.end),
      };
    }

    // ── Leading timestamp: timeline mode ──────────────────────────
    if (line.leadingTime) {
      const remaining = line.text
        .substring(line.leadingTime.index + line.leadingTime.length)
        .trim();
      const isTimeOnly = remaining === "";

      if (isTimeOnly) {
        // Clock-out marker: no duration of its own.
        return {
          ...line,
          isTimeOnly: true,
          durationMinutes: null,
          startTime: toHHMM(line.leadingTime.time),
        };
      }

      // Find the end time from the next timestamped line.
      let endT: ParsedTime = defaultEndOfDay;
      for (let j = i + 1; j < annotated.length; j++) {
        const next = annotated[j];
        if (next.leadingTime) {
          endT = next.leadingTime.time;
          break;
        }
        // A range line doesn't participate in timeline chaining.
        if (next.timeRange) break;
      }

      const dur = toMinutes(endT) - toMinutes(line.leadingTime.time);
      return {
        ...line,
        isTimeOnly: false,
        durationMinutes: Math.max(0, dur),
        startTime: toHHMM(line.leadingTime.time),
        endTime: toHHMM(endT),
      };
    }

    // ── No time info ───────────────────────────────────────────────
    return { ...line, isTimeOnly: false, durationMinutes: null };
  });
}

// ── Helpers for the UI ────────────────────────────────────────────────────────

/** Convert a legacy TimeBlock back into a smart line text. */
export function blockToLineText(
  startTime: string,
  description: string,
): string {
  if (!startTime) return description;
  const [h, m] = startTime.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const timeStr = `${h12}:${String(m).padStart(2, "0")}${period}`;
  if (!description) return timeStr;

  // Guard against "9:17am 9:17am …" on repeated save/load cycles.
  //
  // Why format-agnostic detection instead of string comparison:
  //   Comparing description.startsWith(timeStr) fails when the stored
  //   description used a different format variant — e.g. "9:17 am" (space
  //   before period) vs the "9:17am" we'd generate here.  findLeadingTime
  //   accepts all supported formats (12h with/without space, 24h) so any
  //   leading time token stops us from doubling regardless of how it
  //   was originally typed.
  const existingLeading = findLeadingTime(description);
  if (existingLeading && existingLeading.index === 0) {
    return description;
  }

  return `${timeStr} ${description}`;
}

/** Current local time as a 12h string like "3:26pm". */
export function currentTimeStr(): string {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const period = h < 12 ? "am" : "pm";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")}${period}`;
}

// ── Input masking ─────────────────────────────────────────────────────────────
//
// Real-time "smart typing": canonicalize shorthand time tokens to the
// standard `h:mm am/pm` form as the user types. The masker only fires
// once the am/pm suffix is fully typed so partial states like "9" or
// "9a" stay untouched — keystroke-by-keystroke noise would fight the
// user's caret.
//
// Idempotent on already-canonical text — running the mask repeatedly on
// "9:00 am" produces "9:00 am" unchanged, so masking can safely run on
// every onChange without trimming user-typed content.

// "9am", "912am", "1259pm" — digits glued to am/pm, NO colon.
const SHORTHAND_NO_COLON_RE =
  /(?<![A-Za-z0-9:])(\d{1,4})\s*([aApP])[mM]\b/g;
// "9:12am" — colon present but missing the space before am/pm.
const SHORTHAND_COLON_NO_SPACE_RE =
  /(?<![A-Za-z0-9])(\d{1,2}):(\d{2})([aApP])[mM]\b/g;

function expandShorthand(digits: string, period: string): string | null {
  let hour: number;
  let minute: number;
  if (digits.length <= 2) {
    hour = parseInt(digits, 10);
    minute = 0;
  } else if (digits.length === 3) {
    hour = parseInt(digits[0], 10);
    minute = parseInt(digits.slice(1), 10);
  } else if (digits.length === 4) {
    hour = parseInt(digits.slice(0, 2), 10);
    minute = parseInt(digits.slice(2), 10);
  } else {
    return null;
  }
  // Reject impossible values so the validator can still surface them
  // inline. "25am" stays "25am" — masking refuses to lie about it.
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return `${hour}:${String(minute).padStart(2, "0")} ${period.toLowerCase()}m`;
}

function applyShorthandPass(text: string): string {
  let out = text.replace(SHORTHAND_NO_COLON_RE, (full, digits, period) => {
    const expanded = expandShorthand(digits, period);
    return expanded ?? full;
  });
  out = out.replace(SHORTHAND_COLON_NO_SPACE_RE, (full, h, mm, period) => {
    const hour = parseInt(h, 10);
    const minute = parseInt(mm, 10);
    if (hour < 1 || hour > 12 || minute > 59) return full;
    return `${hour}:${mm} ${period.toLowerCase()}m`;
  });
  return out;
}

/**
 * Smart-format the shorthand time tokens in `text`, returning the
 * canonicalized text plus the adjusted caret position.
 *
 * Expansions (only when the am/pm suffix is fully typed):
 *   "9am"     → "9:00 am"
 *   "912am"   → "9:12 am"
 *   "1259pm"  → "12:59 pm"
 *   "9:12am"  → "9:12 am"   (inserts the missing space)
 *
 * The caret is anchored to its logical position by masking each side
 * independently — characters to the LEFT of the caret stay to its left
 * after expansion, characters to the RIGHT stay to its right. That way
 * a user mid-typing past the time block doesn't have their cursor jump.
 */
export function maskTimeShorthand(
  text: string,
  caretPos: number,
): { text: string; caretPos: number } {
  const before = applyShorthandPass(text.substring(0, caretPos));
  const after = applyShorthandPass(text.substring(caretPos));
  return { text: before + after, caretPos: before.length };
}

// ── Per-line validation ───────────────────────────────────────────────────────

export interface LineValidation {
  valid: boolean;
  /** Short reason string, suitable for inline display. null when valid. */
  reason: string | null;
}

// Permissive detectors for time-LIKE attempts — anything that looks
// like the user tried to enter a clock time, including malformed inputs
// the strict parser rejects. These exist purely to ask "did the user
// _try_ to type a time here?", so we can distinguish:
//
//   - "Working on stuff @AAA"      → no attempt, valid (description)
//   - "912am - 11:00am"            → 2 attempts, none parse strictly → invalid
//   - "9:00 am to 8:00 am"         → 2 attempts, strict but reversed → invalid
//
// The 24h detector requires 2+ minute digits to avoid flagging users
// mid-typing "9:0" before they finish "9:00".
const FUZZY_AMPM_RE =
  /(?<![A-Za-z0-9])(\d{1,4})(?::\d{1,3})?\s*[aApP][mM]?\b/g;
const FUZZY_24H_RE =
  /(?<![A-Za-z0-9])\d{1,2}:\d{2,3}(?!\d)(?!\s*[aApP])/g;

/**
 * Strict per-line validation for the Daily Journal editor.
 *
 * Returns `valid: false` when:
 *   - The line contains a time-like attempt (e.g. "25:00am", "9:99am",
 *     "912am") that doesn't parse to a real clock time.
 *   - The line expresses an explicit range whose end is not strictly
 *     AFTER its start ("9:00 am - 8:00 am").
 *
 * Lines with no time tokens are valid — they're continuation/notes
 * rows under a preceding time-bearing line.
 */
export function validateJournalLineTime(text: string): LineValidation {
  if (!text.trim()) return { valid: true, reason: null };

  type Hit = { index: number; length: number };
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;

  FUZZY_AMPM_RE.lastIndex = 0;
  while ((m = FUZZY_AMPM_RE.exec(text)) !== null) {
    hits.push({ index: m.index, length: m[0].length });
  }
  FUZZY_24H_RE.lastIndex = 0;
  while ((m = FUZZY_24H_RE.exec(text)) !== null) {
    const overlaps = hits.some(
      (h) => m!.index >= h.index && m!.index < h.index + h.length,
    );
    if (!overlaps) hits.push({ index: m.index, length: m[0].length });
  }

  if (hits.length === 0) return { valid: true, reason: null };
  hits.sort((a, b) => a.index - b.index);

  const range = findTimeRange(text);
  const leading = findLeadingTime(text);

  if (hits.length === 1) {
    if (range || leading) return { valid: true, reason: null };
    return { valid: false, reason: "Invalid time format" };
  }

  // Two-or-more time attempts.
  if (range) return { valid: true, reason: null };

  const gap = text.substring(hits[0].index + hits[0].length, hits[1].index);
  const hasSeparator = /^\s*(?:to|[-–—])\s*$/i.test(gap);

  if (hasSeparator) {
    // Both timestamps may parse strictly yet still be reversed (end ≤
    // start) — surface that as a distinct reason so the user knows the
    // problem is logical, not syntactic.
    const strict = findAllTimes(text);
    if (
      strict.length >= 2 &&
      endMinutes(strict[1].time, strict[0].time) <= toMinutes(strict[0].time)
    ) {
      return {
        valid: false,
        reason: "Invalid time range (end must be after start)",
      };
    }
    return { valid: false, reason: "Invalid time format" };
  }

  // No separator between attempts — first parses as leading time, rest
  // is description text (e.g. "9:00 am met with @AUII at 3pm").
  if (leading) return { valid: true, reason: null };
  return { valid: false, reason: "Invalid time format" };
}
