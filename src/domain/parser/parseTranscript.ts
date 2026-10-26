// 종정시 '년도/학기별 취득성적' 붙여넣기 파서 (§6). 순수 함수 — 원문을 저장하거나 외부로 보내지 않는다.
import { deriveInclusion, defaultGradingMode, normalizeGrade } from '../grades';
import { termKey, toUnits } from '../terms';
import type { Course, CreditArea, Grade, LetterGrade, Term } from '../types';

export const MAX_BYTES = 1024 * 1024; // 1 MiB
export const MAX_LINES = 2000;

/** 원문 이수구분 → 학점 반영 영역. 2전공과 이중전공은 합치지 않는다. */
export const AREA_LABELS: Record<string, CreditArea> = {
  '1전공': 'primary', 이중전공: 'double', '2전공': 'second', 부전공: 'minor', 실용외국어: 'practicalLanguage',
  교양: 'liberalArts', 교직: 'teaching', 자선: 'freeChoice', 기초: 'foundation',
};

export interface ParsedRow {
  rowKey: string;
  term: Term;
  officialCode?: string;
  /** 교과목코드 앞의 '개설학과' 칸 원문 (전필 이름 대조에 쓴다) */
  offeringDepartment?: string;
  name: string;
  rawAreaLabel: string;
  area: CreditArea;
  creditUnits: number;
  rawGrade?: string;
  grade: Grade;
  recordKind: Course['recordKind'];
  gradingMode: Course['gradingMode'];
  gpaInclusion: Course['gpaInclusion'];
  earnedInclusion: Course['earnedInclusion'];
  retakeMarked: boolean;
}

export interface ParseWarning { code: string; rowKey?: string; message: string }

export interface ParseResult {
  rows: ParsedRow[];
  reportedEarnedByArea: Partial<Record<CreditArea, number>>;
  reportedTotalEarnedUnits?: number;
  lookupTotalUnits?: number;
  computedEarnedByArea: Partial<Record<CreditArea, number>>;
  computedTotalUnits: number;
  completeness: { earnedTotals: boolean; courses: boolean; gpa: boolean };
  warnings: ParseWarning[];
}

export class ParseLimitError extends Error {}

const AREA_ALT = Object.keys(AREA_LABELS).join('|');
const CREDIT = String.raw`\d{1,2}(?:\.\d{1,2})?`;
const KNOWN_AREA_RE = new RegExp(String.raw`(?:^|\s)(${AREA_ALT})\s+(${CREDIT})(?=\s|$)`, 'g');
const ANY_AREA_RE = new RegExp(String.raw`(?:^|\s)([^\s\d][^\s]*)\s+(${CREDIT})(?=\s|$)`, 'g');
// 교과목 코드: 영문 대문자로 시작 + 숫자. 'O'와 '0'은 바꾸지 않는다.
const CODE_RE = /(?:^|\s)([A-Z]{1,4}\d{3,7}[A-Z0-9]*)(?=\s)/;
const TERM_RE = /^(\d{4})\s*(?:학년도|년도|년)?\s*[-–]?\s*(1|2|여름|하계|겨울|동계)\s*(?:학기|계절학기)?$/;
const GRADE_SHAPED = /^(?:[A-DF][+0°o]?|N?P|NA|S|U|I)$/;

const normalizeName = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

function lastMatch(re: RegExp, s: string): RegExpExecArray | null {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(s))) last = m;
  return last;
}

interface RawCourse { pre: string; areaLabel: string; credit: string; post: string; knownArea: boolean }

/** 한 줄(또는 이어 붙인 여러 줄)에서 '영역 + 학점' 앵커를 찾아 앞/뒤를 나눈다. */
function splitByAnchor(text: string): RawCourse | null {
  // 탭이 있으면 열(셀) 구조를 먼저 쓴다: '영역 셀' 바로 다음이 '학점 셀'인 마지막 위치
  if (text.includes('\t')) {
    const cells = text.split('\t').map((c) => c.trim());
    for (let i = cells.length - 2; i >= 0; i--) {
      if (AREA_LABELS[cells[i]] && new RegExp(`^${CREDIT}$`).test(cells[i + 1])) {
        return {
          pre: cells.slice(0, i).filter(Boolean).join(' '), areaLabel: cells[i], credit: cells[i + 1],
          post: cells.slice(i + 2).filter(Boolean).join(' '), knownArea: true,
        };
      }
    }
  }
  const flat = text.replace(/\t/g, ' ');
  let m = lastMatch(KNOWN_AREA_RE, flat);
  let knownArea = true;
  if (!m) {
    // 모르는 영역: 코드가 있는 행에서만 '단어 + 숫자'를 영역으로 본다.
    if (!CODE_RE.test(flat + ' ')) return null;
    m = lastMatch(ANY_AREA_RE, flat);
    knownArea = false;
    if (!m) return null;
  }
  const start = m.index + m[0].indexOf(m[1]);
  return { pre: flat.slice(0, start), areaLabel: m[1], credit: m[2], post: flat.slice(m.index + m[0].length), knownArea };
}

export function parseTranscript(input: string, gradeAliases: Record<string, LetterGrade> = {}): ParseResult {
  if (new TextEncoder().encode(input).length > MAX_BYTES) {
    throw new ParseLimitError('붙여넣은 내용이 1MB를 넘어요. 성적 목록 부분만 나눠서 붙여넣어 주세요.');
  }
  const lines = input.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
  if (lines.length > MAX_LINES) {
    throw new ParseLimitError(`붙여넣은 내용이 ${MAX_LINES}줄을 넘어요. 성적 목록 부분만 나눠서 붙여넣어 주세요.`);
  }

  const rows: ParsedRow[] = [];
  const warnings: ParseWarning[] = [];
  const occurrences = new Map<string, number>();
  let term: Term | null = null;
  let pending: string[] = [];
  let summaryLabels: string[] | null = null;
  const reported: Partial<Record<CreditArea, number>> = {};
  let reportedTotal: number | undefined;
  let lookupTotal: number | undefined;
  let earnedTotalsFound = false;
  let unparsed = 0;

  const flushPending = () => {
    for (const p of pending) {
      unparsed++;
      warnings.push({ code: 'unparsedLine', message: `해석하지 못한 줄이 있어요: “${p.slice(0, 40)}${p.length > 40 ? '…' : ''}”` });
    }
    pending = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/ +$/g, '');
    const flat = line.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (!flat) continue;

    // 1) 학기 제목 — 계절학기를 1/2학기로 바꾸지 않는다
    const tm = TERM_RE.exec(flat);
    if (tm) {
      flushPending();
      const sem = tm[2];
      term = {
        academicYear: Number(tm[1]),
        semester: sem === '1' || sem === '2' ? sem : sem === '여름' || sem === '하계' ? 'summer' : 'winter',
      };
      continue;
    }

    // 2) 머리글·합계 줄 (과목이 아님 — 중복 가산 금지)
    if (flat.startsWith('년도/학기별') || flat.includes('재수강누적')) continue;
    if (flat.includes('교과목명') && flat.includes('이수구분')) continue;
    if (flat.startsWith('조회합계')) {
      const n = /(\d+(?:\.\d+)?)/.exec(flat);
      if (n) lookupTotal = toUnits(Number(n[1]));
      continue;
    }
    if (flat === '이수구분별 취득학점 계') { flushPending(); continue; }
    if (flat.startsWith('이수구분별 취득학점 계')) {
      const nums = flat.slice('이수구분별 취득학점 계'.length).trim().split(/\s+/).filter(Boolean);
      if (summaryLabels && nums.length === summaryLabels.length && nums.every((n) => /^\d+(\.\d+)?$/.test(n))) {
        summaryLabels.forEach((label, i) => {
          const units = toUnits(Number(nums[i]));
          if (label === '총계') reportedTotal = units;
          else if (AREA_LABELS[label]) reported[AREA_LABELS[label]] = units;
          else warnings.push({ code: 'unknownSummaryArea', message: `합계의 알 수 없는 이수구분 “${label}”은 영역 합계에 넣지 않았어요.` });
        });
        earnedTotalsFound = true;
      } else {
        warnings.push({ code: 'summaryUnreadable', message: '하단 ‘이수구분별 취득학점 계’의 열과 숫자를 맞추지 못했어요.' });
      }
      continue;
    }
    if (flat.startsWith('이수구분 ')) {
      summaryLabels = flat.slice('이수구분 '.length).replace(/총\s+계/, '총계').split(/\s+/).filter(Boolean);
      continue;
    }

    // 3) 과목 행: 앵커(영역+학점)로 분석. 줄바꿈된 과목명은 앞 줄과 합쳐 본다.
    let anchor = splitByAnchor(line);
    if (!anchor) { pending.push(flat); continue; }
    if (pending.length && !CODE_RE.test(anchor.pre + ' ')) {
      const joined = splitByAnchor([...pending, line].join('\n'));
      if (joined && CODE_RE.test(joined.pre.replace(/\n/g, ' ') + ' ')) { anchor = joined; pending = []; }
    }
    flushPending();

    const pre = anchor.pre;
    const codeMatch = CODE_RE.exec(pre + ' ');
    const officialCode = codeMatch?.[1];
    // 코드 앞에 남은 칸이 '개설학과'. 코드가 없는 인정학점 행에는 개설학과 칸도 없다.
    const offeringDepartment = codeMatch ? pre.slice(0, codeMatch.index).replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    const name = (codeMatch ? pre.slice(codeMatch.index + codeMatch[0].length) : pre)
      .replace(/^[ \t]+|[ \t]+$/g, '')
      .replace(/[ \t]*\n[ \t]*/g, '\n');
    const postTokens = anchor.post.trim().split(/\s+/).filter(Boolean);
    let rawGrade: string | undefined;
    let grade: Grade = null;
    let gradeUnknown = false;
    if (postTokens.length) {
      const g = normalizeGrade(postTokens[0], gradeAliases);
      if (g) { grade = g; rawGrade = postTokens.shift(); }
      else if (GRADE_SHAPED.test(postTokens[0])) { rawGrade = postTokens.shift(); gradeUnknown = true; }
    }
    const retakeMarked = postTokens.some((t) => t.includes('재수강') || t === 'R');
    const recognized = !officialCode && !rawGrade;
    const recordKind: Course['recordKind'] = recognized ? 'recognizedCredit' : 'course';
    const gradingMode: Course['gradingMode'] = recognized ? 'ungradedCredit' : defaultGradingMode(grade);
    const area = anchor.knownArea ? AREA_LABELS[anchor.areaLabel] : 'unknown';
    const t: Term = term ?? { academicYear: 0, semester: 'unknown' };
    const baseKey = officialCode
      ? `${termKey(t)}|${officialCode}`
      : `${termKey(t)}|${normalizeName(name)}|${area}|${recordKind}`;
    const occ = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occ + 1);
    const rowKey = `${baseKey}|${occ}`;
    const inclusion = deriveInclusion({ status: 'completed', grade, gradingMode, recordKind });

    rows.push({
      rowKey, term: t, officialCode, ...(offeringDepartment && { offeringDepartment }), name: name || '(이름 없음)', rawAreaLabel: anchor.areaLabel, area,
      creditUnits: toUnits(Number(anchor.credit)), rawGrade, grade, recordKind, gradingMode, retakeMarked, ...inclusion,
    });

    const label = name.split('\n')[0];
    if (!term) warnings.push({ code: 'noTerm', rowKey, message: `“${label}”의 학기를 찾지 못했어요.` });
    if (!anchor.knownArea) warnings.push({ code: 'unknownArea', rowKey, message: `“${label}”의 이수구분 “${anchor.areaLabel}”을 알 수 없어요. 학점 반영 영역을 골라 주세요.` });
    if (gradeUnknown) warnings.push({ code: 'unknownGrade', rowKey, message: `“${label}”의 등급 “${rawGrade}”을 해석하지 못했어요. F로 처리하지 않고 보류했어요.` });
    if (occ > 0) warnings.push({ code: 'duplicate', rowKey, message: `“${label}”이(가) 같은 학기에 두 번 이상 있어요. 중복 복사인지 확인해 주세요.` });
    if (retakeMarked) warnings.push({ code: 'retakeUnresolved', rowKey, message: `“${label}”은 재수강 표시가 있어요. 대체된 이전 기록을 확인해 주세요.` });
    if (!officialCode && rawGrade) warnings.push({ code: 'noCode', rowKey, message: `“${label}”의 교과목 코드가 없어요. 필수과목 자동 매칭에서 빠져요.` });
  }
  flushPending();

  // 4) 과목에서 계산한 합 vs 보고된 합 비교 (차이를 '기타'로 채우지 않는다)
  const computed: Partial<Record<CreditArea, number>> = {};
  let computedTotal = 0;
  for (const r of rows) {
    if (r.earnedInclusion !== 'included') continue;
    computed[r.area] = (computed[r.area] ?? 0) + r.creditUnits;
    computedTotal += r.creditUnits;
  }
  let totalsMatch = true;
  if (earnedTotalsFound && rows.length) {
    const areas = new Set([...Object.keys(reported), ...Object.keys(computed)] as CreditArea[]);
    for (const a of areas) {
      if ((reported[a] ?? 0) !== (computed[a] ?? 0)) {
        totalsMatch = false;
        const label = Object.keys(AREA_LABELS).find((k) => AREA_LABELS[k] === a) ?? '미분류';
        warnings.push({ code: 'areaMismatch', message: `${label} 영역: 과목 합 ${(computed[a] ?? 0) / 100}학점, 하단 합계 ${(reported[a] ?? 0) / 100}학점으로 달라요. 누락되거나 제외된 행을 확인해 주세요.` });
      }
    }
    if (reportedTotal !== undefined && reportedTotal !== computedTotal) {
      totalsMatch = false;
      warnings.push({ code: 'totalMismatch', message: `과목에서 계산한 총 ${computedTotal / 100}학점과 하단 총계 ${reportedTotal / 100}학점이 달라요.` });
    }
  }
  if (!rows.length && earnedTotalsFound) {
    warnings.push({ code: 'summaryOnly', message: '하단 합계만 있어요. 영역별 현황은 볼 수 있지만 필수과목 자동 매칭과 과목별 평점 계산은 제한돼요.' });
  } else if (rows.length && !earnedTotalsFound) {
    warnings.push({ code: 'noSummary', message: '하단 ‘이수구분별 취득학점 계’가 없어 과목 합계와 대조하지 못했어요.' });
  }

  const coursesComplete = rows.length > 0 && unparsed === 0 && totalsMatch && rows.every((r) => r.area !== 'unknown');
  return {
    rows,
    reportedEarnedByArea: reported,
    reportedTotalEarnedUnits: reportedTotal,
    lookupTotalUnits: lookupTotal,
    computedEarnedByArea: computed,
    computedTotalUnits: computedTotal,
    completeness: {
      earnedTotals: earnedTotalsFound,
      courses: coursesComplete,
      gpa: coursesComplete && rows.every((r) => r.gpaInclusion !== 'unresolved'),
    },
    warnings,
  };
}
