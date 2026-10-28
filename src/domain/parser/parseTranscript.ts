// 종정시 '년도/학기별 취득성적' 붙여넣기 파서 (§6). 순수 함수 — 원문을 저장하거나 외부로 보내지 않는다.
import { deriveInclusion, defaultGradingMode, normalizeGrade } from '../grades';
import { termKey, toUnits } from '../terms';
import type { Course, CreditArea, Grade, LetterGrade, Term } from '../types';
import { MAX_RECORD_UNITS } from '../validation/schemas';

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

export interface ParseWarning { code: string; rowKey?: string; lineNumber?: number; message: string }

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
const CREDIT = String.raw`\d{1,3}(?:\.\d{1,2})?`;
const KNOWN_AREA_RE = new RegExp(String.raw`(?:^|\s)(${AREA_ALT})\s+(${CREDIT})(?=\s|$)`, 'g');
const ANY_AREA_RE = new RegExp(String.raw`(?:^|\s)([^\s\d][^\s]*)\s+(${CREDIT})(?=\s|$)`, 'g');
// 교과목 코드: 영문 대문자로 시작 + 숫자. 'O'와 '0'은 바꾸지 않는다.
const CODE_RE = /(?:^|\s)([A-Z]{1,4}\d{3,7}[A-Z0-9]*)(?=\s)/;
const TERM_RE = /^(\d{4})\s*(?:학년도|년도|년)?\s*[-–]?\s*(1|2|여름|하계|겨울|동계)\s*(?:학기|계절학기)?$/;
const SUMMARY_TITLE = /(?:이\s*수\s*구\s*분\s*별\s*취\s*득\s*학\s*점(?:\s*계)?|영\s*역\s*별\s*취\s*득\s*학\s*점)/g;
const SUMMARY_NOTE = /^※?이수구분별합계정보는화면하단에서확인가능합니다[.!]?$/;
// 전체 영역을 복사하면 함께 들어오는, 확인된 화면 조작 문구만 제외한다.
const PAGE_CONTROL = /^(?:검색조건|년도\/학기선택|이수영역선택|\+?전체보기\(Viewall\))$/;

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
      if (Object.hasOwn(AREA_LABELS, cells[i]) && new RegExp(`^${CREDIT}$`).test(cells[i + 1])) {
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
  const rawLines = input.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
  if (rawLines.length > MAX_LINES) {
    throw new ParseLimitError(`붙여넣은 내용이 ${MAX_LINES}줄을 넘어요. 성적 목록 부분만 나눠서 붙여넣어 주세요.`);
  }
  // 확인된 안내 문구만 제외한다. 그 밖의 미해석 행은 계속 저장을 차단한다.
  const lines = rawLines.map((line) => {
    const compact = line.replace(/\s/g, '');
    return SUMMARY_NOTE.test(compact) || PAGE_CONTROL.test(compact) ? '' : line;
  });

  const rows: ParsedRow[] = [];
  const warnings: ParseWarning[] = [];
  const occurrences = new Map<string, number>();
  let term: Term | null = null;
  let pending: { text: string; lineNumber: number }[] = [];
  const reported: Partial<Record<CreditArea, number>> = {};
  let reportedTotal: number | undefined;
  let lookupTotal: number | undefined;
  let earnedTotalsFound = false;
  let unparsed = 0;

  // 하단 표를 먼저 분리해야 줄바꿈된 합계가 과목으로 중복 집계되지 않는다.
  // 과목 위에도 '영역별 취득학점' 제목이 있으므로 마지막 학기 뒤에서 합계 표를 찾는다.
  const lastTermIndex = lines.reduce((last, line, i) => TERM_RE.test(line.trim()) ? i : last, -1);
  const summaryStart = lines.findIndex((line, i) => i > lastTermIndex && (/^이수구분(?:\s|$)/.test(line.trim())
    || /^(?:이수구분별취득학점|영역별취득학점)/.test(lines.slice(i, i + 8).join('').replace(/\s/g, ''))));
  if (summaryStart >= 0) {
    const tokens = lines.slice(summaryStart).join('\n').replace(SUMMARY_TITLE, ' ')
      .replace(/총\s*(?:취득\s*)?학점|총\s+계/g, '총계')
      .replace(/(?:이\s*수\s*구\s*분|구\s*분|취\s*득\s*학\s*점)(?=\s|$)/g, ' ')
      .trim().split(/\s+/).filter(Boolean).map((t) => t === '합계' || t === '계' ? '총계' : t);
    const firstValue = tokens.findIndex((t) => /^[-+]?\d+(?:\.\d+)?$/.test(t));
    const isLabel = (t: string) => t === '총계' || Object.hasOwn(AREA_LABELS, t);
    const paired = tokens.length >= 4 && tokens.length % 2 === 0
      && tokens.every((t, i) => i % 2 === 0 ? isLabel(t) : /^[-+]?\d+(?:\.\d+)?$/.test(t));
    const labels = paired ? tokens.filter((_, i) => i % 2 === 0) : tokens.slice(0, firstValue < 0 ? tokens.length : firstValue);
    const values = paired ? tokens.filter((_, i) => i % 2 === 1) : firstValue < 0 ? [] : tokens.slice(firstValue);
    const validLabels = labels.length > 1 && labels.includes('총계') && new Set(labels).size === labels.length
      && labels.every(isLabel);
    const validValues = values.length === labels.length
      && values.every((v) => /^\d+(?:\.\d{1,2})?$/.test(v) && Number(v) <= 10_000);
    if (validLabels && validValues) {
      labels.forEach((label, i) => {
        const units = toUnits(Number(values[i]));
        if (label === '총계') reportedTotal = units;
        else reported[AREA_LABELS[label]] = units;
      });
      earnedTotalsFound = Object.values(reported).reduce((sum, u) => sum + u, 0) === reportedTotal;
      if (!earnedTotalsFound) warnings.push({ code: 'summaryMismatch', message: '하단 영역별 학점의 합과 총계가 달라요. 하단 표를 끝까지 다시 복사해 주세요.' });
    } else {
      warnings.push({ code: 'summaryUnreadable', message: '하단 ‘이수구분별 취득학점 계’의 열·숫자 개수 또는 범위를 확인하지 못했어요.' });
      if (labels.some((l) => l !== '총계' && !Object.hasOwn(AREA_LABELS, l))) {
        warnings.push({ code: 'unknownSummaryArea', message: '하단 합계에 알 수 없는 이수구분이 있어요.' });
      }
    }
  }

  const flushPending = () => {
    for (const p of pending) {
      unparsed++;
      warnings.push({ code: 'unparsedLine', lineNumber: p.lineNumber, message: `해석하지 못한 줄이 있어요: “${p.text.slice(0, 40)}${p.text.length > 40 ? '…' : ''}”` });
    }
    pending = [];
  };

  for (const [index, rawLine] of (summaryStart < 0 ? lines : lines.slice(0, summaryStart)).entries()) {
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
    if (flat.replace(/\s/g, '') === '영역별취득학점') continue;
    if (flat.includes('교과목명') && flat.includes('이수구분')) continue;
    if (flat.startsWith('조회합계')) {
      const n = /(\d+(?:\.\d+)?)/.exec(flat);
      if (n) lookupTotal = toUnits(Number(n[1]));
      continue;
    }

    // 3) 과목 행: 앵커(영역+학점)로 분석. 줄바꿈된 과목명은 앞 줄과 합쳐 본다.
    let anchor = splitByAnchor(line);
    if (!anchor) { pending.push({ text: flat, lineNumber: index + 1 }); continue; }
    if (pending.length && !CODE_RE.test(anchor.pre + ' ')) {
      const joined = splitByAnchor([...pending.map((p) => p.text), line].join('\n'));
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
    const recognized = !officialCode && !postTokens.length && /인정.*학점|학점.*인정/.test(name);
    let gradeUnknown = !recognized;
    if (postTokens.length) {
      rawGrade = postTokens.shift();
      const g = normalizeGrade(rawGrade!, gradeAliases);
      if (g) { grade = g; gradeUnknown = false; }
    }
    const retakeMarked = postTokens.some((t) => t.includes('재수강') || t === 'R');
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
    if (!term || term.academicYear < 2000 || term.academicYear > 2100) warnings.push({ code: 'noTerm', rowKey, message: `“${label}”의 올바른 학기를 찾지 못했어요.` });
    if (!name || name.length > 120) warnings.push({ code: 'invalidName', rowKey, message: '과목명이 없거나 너무 길어요. 과목 행을 다시 복사해 주세요.' });
    if (Number(anchor.credit) <= 0 || toUnits(Number(anchor.credit)) > MAX_RECORD_UNITS) warnings.push({ code: 'invalidCredit', rowKey, message: `“${label}”의 학점 범위를 확인해 주세요.` });
    if (!anchor.knownArea) warnings.push({ code: 'unknownArea', rowKey, message: `“${label}”의 이수구분 “${anchor.areaLabel}”을 알 수 없어요. 학점 반영 영역을 골라 주세요.` });
    if (gradeUnknown) warnings.push({ code: 'unknownGrade', rowKey, message: `“${label}”의 등급 “${rawGrade ?? '누락'}”을 해석하지 못했어요. F로 처리하지 않고 보류했어요.` });
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
  } else if (rows.length && !earnedTotalsFound && summaryStart < 0) {
    warnings.push({ code: 'noSummary', message: '하단 ‘이수구분별 취득학점 계’가 없어 과목 합계와 대조하지 못했어요.' });
  }

  const coursesComplete = rows.length > 0 && earnedTotalsFound && unparsed === 0 && totalsMatch
    && !warnings.some((w) => ['noTerm', 'invalidName', 'invalidCredit', 'unknownArea', 'unknownGrade', 'duplicate'].includes(w.code));
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
      gpa: coursesComplete && rows.every((r) => r.gpaInclusion !== 'unresolved' && !r.retakeMarked),
    },
    warnings,
  };
}

/** 화면의 부분 표시와 저장 허용 여부는 제목 대신 같은 분석 결과로 판단한다. */
export function validateTranscript(result: ParseResult) {
  const parts = { grades: result.rows.length > 0, summary: result.completeness.earnedTotals };
  const problems = result.warnings.filter((w) => w.code !== 'noCode').map((w) => w.message);
  if (!parts.grades) problems.unshift('년도/학기별 취득성적의 과목 목록을 찾지 못했어요. 학기와 과목 행을 함께 복사해 주세요.');
  if (!parts.summary && !problems.some((m) => m.includes('이수구분별 취득학점 계'))) problems.push('이수구분별 취득학점 계의 열과 숫자를 끝까지 복사해 주세요.');
  const canSave = result.completeness.earnedTotals && result.completeness.courses && result.completeness.gpa;
  if (!canSave && !problems.length) problems.push('성적 자료가 불완전해요. 전체 내용을 다시 복사해 주세요.');
  return { parts, problems, canSave };
}

/** 전체 원문이나 저장된 개인정보 대신, 분석 수치와 오류 메시지만 모은다. */
export function formatTranscriptDiagnostic(input: string, result: ParseResult | null, problems: string[]): string {
  const lines = [
    'HUFStep 성적 입력 진단 v1 (2026-10-29)',
    '아래 진단 내용으로 성적 입력 오류의 원인과 수정할 코드를 확인해 주세요.',
    `입력: ${input.length}자 / ${new TextEncoder().encode(input).length}바이트 / ${input.split(/\r\n?|\n/).length}줄`,
  ];
  if (result) {
    lines.push(
      `분석: ${result.rows.length}행 (인정학점 ${result.rows.filter((r) => r.recordKind === 'recognizedCredit').length}행)`,
      `검증: ${validateTranscript(result).canSave ? '통과' : '저장 차단'} / 과목 ${result.completeness.courses} / 합계 ${result.completeness.earnedTotals} / 평점 ${result.completeness.gpa}`,
      `총 취득학점: 과목 합 ${result.computedTotalUnits / 100} / 하단 총계 ${result.reportedTotalEarnedUnits === undefined ? '미확인' : result.reportedTotalEarnedUnits / 100}`,
      ...Object.entries(AREA_LABELS).map(([label, area]) => `${label}: 과목 합 ${(result.computedEarnedByArea[area] ?? 0) / 100} / 하단 ${result.reportedEarnedByArea[area] === undefined ? '미확인' : result.reportedEarnedByArea[area]! / 100}`),
      '분석 경고:',
      ...result.warnings.map((w) => `[${w.code}]${w.lineNumber ? ` ${w.lineNumber}번째 줄` : ''} ${w.message}`),
    );
  } else {
    lines.push('분석: 결과 없음 (분석 실행 오류 또는 미완료)');
  }
  lines.push('화면 오류:', ...problems.map((p) => `- ${p}`));
  return lines.join('\n');
}
