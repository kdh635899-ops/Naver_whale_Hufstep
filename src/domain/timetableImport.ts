// 종정시 '개인별시간표 조회' 표를 붙여넣어 요일·교시·과목명·강의실을 읽고, 확정하면 시간표 과목으로 저장한다 (Model).
// 종정시에 접속하지 않는다. 학생이 직접 복사한 표만 읽는다.
// 교시 → 시각은 학교 교시표(1교시 09:00~09:50, 이후 매 교시 1시간 간격·50분 수업)를 따른다.
// 학점은 교시 수로 추정하지 않는다. 원본에 'n학점'이 적혀 있을 때만 미리 고른다.
import { autoProjectedRetake } from './retake';
import { newId, type AppState } from './state';
import { sameTerm } from './terms';
import { hhmm } from './timetableSelect';
import type { ClassTime, Course, CreditArea } from './types';
import { classTimeSchema, courseSchema, firstIssue } from './validation/schemas';

/** 시간표 화면이 보여 주는 범위 (시) */
export const TT_FROM_HOUR = 9;
export const TT_TO_HOUR = 21;

const DAY_NAMES = '월화수목금토일';

/** n교시 → 시작·끝(자정부터의 분). 1교시 09:00~09:50 */
export const periodMinutes = (n: number) => ({ start: (8 + n) * 60, end: (8 + n) * 60 + 50 });

export interface ImportSlot { day: number; start: number; end: number; room: string }
export interface ImportCourse {
  key: string;
  name: string;
  /** 원본에 적힌 학점 (없으면 null) */
  credit: number | null;
  slots: ImportSlot[];
}
export interface ImportResult {
  courses: ImportCourse[];
  /** 해석하지 못한 행 (원문 일부) */
  unparsed: string[];
  /** 시간표 표시 범위(월~금, 09~21시) 밖이라 넣지 않는 수업 */
  outOfRange: string[];
}

export const courseKey = (name: string) => name.normalize('NFC').replace(/\s+/g, '').toLowerCase();

/** '월' · '월요일' · 'Mon' 같은 머리 칸 → 0=월 … 6=일 */
function dayOf(cell: string): number | null {
  const t = cell.trim();
  const ko = /^([월화수목금토일])(요일)?$/.exec(t);
  if (ko) return DAY_NAMES.indexOf(ko[1]);
  const en = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(t.slice(0, 3).toLowerCase());
  return en >= 0 && /^[a-z]+$/i.test(t) ? en : null;
}

/** 칸 하나 → 과목명·강의실·학점. 예) '가상 과목\n(본관 101)', '가상 과목 [본관 101]', '가상 과목\n본관 101\n3학점' */
function parseCell(text: string): { name: string; room: string; credit: number | null } | null {
  let credit: number | null = null;
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.replace(/\s+/g, ' ').trim();
    const m = /[([]?\s*(\d(?:\.\d)?)\s*학점\s*[)\]]?/.exec(line);
    if (m) { credit = Number(m[1]); line = line.replace(m[0], '').trim(); }
    if (line) lines.push(line);
  }
  if (!lines.length) return null;
  let [name, ...rest] = lines;
  // 한 줄에 '과목명 (강의실)'처럼 적힌 경우: 괄호 안에 글자와 숫자가 함께 있으면 강의실로 본다
  // ('초급마.인어(2)'의 '(2)'는 과목명의 일부라 그대로 둔다)
  const inline = /^(.*\S)\s*[([]([^()[\]]*[^\d\s()[\]][^()[\]]*\d[^()[\]]*)[)\]]$/.exec(name);
  if (!rest.length && inline) { name = inline[1]; rest = [inline[2]]; }
  const room = rest.join(' ').replace(/^[([]\s*|\s*[)\]]$/g, '');
  return { name, room, credit };
}

/**
 * 표(행×칸 글자) → 과목 목록. 빈 칸도 자리를 차지하므로 요일 칸 번호로 요일을 정한다(다른 요일로 밀리지 않는다).
 * 같은 요일에 이어지는 같은 과목·강의실은 한 블록으로 합친다.
 */
export function parseTimetableGrid(rows: string[][]): ImportResult {
  const unparsed: string[] = [];
  const outOfRange: string[] = [];
  const head = rows.findIndex((r) => r.filter((c) => dayOf(c) !== null).length >= 3);
  if (head < 0) {
    return { courses: [], unparsed: rows.some((r) => r.some((c) => c.trim())) ? ['요일(월~금) 머리줄을 찾지 못했어요'] : [], outOfRange };
  }
  const dayCols = rows[head].map(dayOf);
  const cells: (ImportSlot & { name: string; credit: number | null })[] = [];
  for (const row of rows.slice(head + 1)) {
    const label = row.filter((_, i) => dayCols[i] == null).join(' ').trim();
    const filled = row.some((c, i) => dayCols[i] != null && c.trim());
    if (!label && !filled) continue;
    // 행 머리에 시각이 있으면 그것을, 없으면 교시 번호를 쓴다
    const time = /(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/.exec(label);
    const period = /(\d{1,2})\s*교시/.exec(label) ?? /^(\d{1,2})(?!\d|:)/.exec(label);
    const range = time
      ? { start: Number(time[1]) * 60 + Number(time[2]), end: Number(time[3]) * 60 + Number(time[4]) }
      : period ? periodMinutes(Number(period[1])) : null;
    if (!range || range.start >= range.end) {
      if (filled) unparsed.push(row.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 60));
      continue;
    }
    row.forEach((c, i) => {
      const day = dayCols[i];
      const cell = day == null ? null : parseCell(c);
      if (cell && day != null) cells.push({ day, ...range, ...cell });
    });
  }

  // 같은 요일 안에서 시간순으로 놓고, 바로 이어지는(쉬는 시간 10분 이내) 같은 과목·강의실을 합친다
  cells.sort((a, b) => a.day - b.day || a.start - b.start);
  const merged: typeof cells = [];
  for (const c of cells) {
    const prev = merged.at(-1);
    if (prev && prev.day === c.day && courseKey(prev.name) === courseKey(c.name) && prev.room === c.room
      && c.start <= prev.end + 10) prev.end = Math.max(prev.end, c.end);
    else merged.push({ ...c });
  }

  const byKey = new Map<string, ImportCourse>();
  for (const c of merged) {
    const key = courseKey(c.name);
    const course = byKey.get(key) ?? { key, name: c.name, credit: null, slots: [] };
    byKey.set(key, course);
    course.credit ??= c.credit;
    if (c.day > 4 || c.start < TT_FROM_HOUR * 60 || c.end > TT_TO_HOUR * 60) {
      outOfRange.push(`${c.name} · ${DAY_NAMES[c.day]} ${hhmm(c.start)}~${hhmm(c.end)}`);
      continue;
    }
    course.slots.push({ day: c.day, start: c.start, end: c.end, room: c.room });
  }
  // 범위 밖 수업만 있는 과목은 시간표에 놓을 칸이 없어 가져오지 않는다 (위 안내에 남는다)
  return { courses: [...byKey.values()].filter((c) => c.slots.length), unparsed, outOfRange };
}

/**
 * 탭으로 나뉜 글자(브라우저 일반 텍스트 복사) → 표.
 * 종정시 칸 안의 줄바꿈('과목명' ↵ '(강의실)')도 행 구분과 같은 '\n'으로 복사된다.
 * 그래서 요일 머리줄의 칸 수만큼 채워질 때까지는 칸 안 줄바꿈으로 보고 같은 행에 이어 붙인다.
 */
export function gridFromText(text: string): string[][] {
  let t = text.replace(/\r/g, '');
  // ponytail: 탭이 공백 4칸으로 바뀌어 온 글자(메신저 등을 거친 복사)만 되돌린다. 과목명 안의 공백 4칸은 구분하지 못한다.
  if (!t.includes('\t')) t = t.replace(/ {4}/g, '\t');
  const lines = t.split('\n');
  const head = lines.findIndex((l) => l.split('\t').filter((c) => dayOf(c) !== null).length >= 3);
  if (head < 0) return lines.map((l) => l.split('\t'));
  const width = lines[head].split('\t').length;
  const rows: string[][] = [lines[head].split('\t')];
  let row: string[] | null = null;
  for (const line of lines.slice(head + 1)) {
    const parts = line.split('\t');
    if (row) { row[row.length - 1] += `\n${parts[0]}`; row.push(...parts.slice(1)); }
    else if (parts.length === 1 && rows.length > 1 && line.trim() && !/^\s*\d{1,2}(\s*교시)?\s*$/.test(line)) {
      // 마지막 요일 칸 안의 줄바꿈: 앞 행의 마지막 칸에 붙인다
      const prev = rows[rows.length - 1];
      prev[prev.length - 1] += `\n${line}`;
      continue;
    } else row = parts;
    if (row.length >= width) { rows.push(row); row = null; }
  }
  if (row) rows.push(row);
  return rows;
}

/** HTML 표 → 표. rowspan·colspan 칸은 차지하는 모든 자리에 같은 글자를 채운다 */
export function gridFromTable(table: HTMLTableElement): string[][] {
  const grid: string[][] = [];
  const rows = [...table.rows];
  rows.forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const td of [...tr.cells]) {
      while (grid[r][c] !== undefined) c++;
      const copy = td.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
      copy.querySelectorAll('div, p, li').forEach((b) => b.append('\n'));
      const text = (copy.textContent ?? '').replace(/[ \t ]+/g, ' ').trim();
      const down = Math.min(Math.max(1, td.rowSpan), rows.length - r);
      for (let dr = 0; dr < down; dr++) for (let dc = 0; dc < Math.max(1, td.colSpan); dc++) (grid[r + dr] ??= [])[c + dc] = text;
      c += Math.max(1, td.colSpan);
    }
  });
  return grid.map((row) => Array.from(row, (v) => v ?? ''));
}

/** 클립보드(HTML 우선, 없으면 탭 글자) → 결과. HTML에 표가 여러 개면 요일 머리줄이 있는 표를 쓴다 */
export function parseTimetablePaste(html: string, text: string, toDoc: (html: string) => Document): ImportResult {
  if (/<table/i.test(html)) {
    for (const table of toDoc(html).querySelectorAll('table')) {
      const r = parseTimetableGrid(gridFromTable(table));
      if (r.courses.length || r.outOfRange.length) return r;
    }
  }
  return parseTimetableGrid(gridFromText(text));
}

export interface ImportPick { name: string; creditUnits: number; area: CreditArea; slots: ImportSlot[] }

/** 이번 학기 시간표에 이미 있는 같은 이름의 과목 (메모·시험 정보가 이 ID에 붙어 있다) */
export function matchTimetableCourse(state: AppState, name: string): Course | undefined {
  const term = state.profile?.currentTerm;
  return state.courses.find((c) => (c.origin === 'timetable' || c.origin === 'demo') && !!term && sameTerm(c.term, term)
    && courseKey(c.name) === courseKey(name));
}

/**
 * 확정: 과목은 이름으로 기존 시간표 과목과 맞춰 ID(메모·시험 정보)를 유지하고, 그 과목의 수업 시간은 붙여넣은 표로 바꾼다.
 * 같은 표를 다시 붙여넣어도 과목·시간이 늘어나지 않는다. 학점·영역은 학생이 고른 값으로 저장한다.
 */
export function applyTimetableImport(s: AppState, picks: ImportPick[], stamp: string): { state: AppState; error?: undefined } | { state?: undefined; error: string } {
  let courses = s.courses;
  let classTimes = s.classTimes;
  for (const p of picks) {
    const found = matchTimetableCourse({ ...s, courses }, p.name);
    // 새 과목: 이전 학기에 같은 과목 기록이 정확히 하나 있으면 시간표 직접 등록과 같이 재수강으로 연결한다
    const previous = found ? undefined : autoProjectedRetake(courses, { name: p.name, term: s.profile!.currentTerm });
    const draft: Course = found
      ? { ...found, creditUnits: p.creditUnits, area: p.area, updatedAt: stamp }
      : { id: newId('course'), name: p.name, term: s.profile!.currentTerm, creditUnits: p.creditUnits, area: p.area,
        origin: 'timetable', recordKind: 'course', status: 'inProgress', grade: null, gradingMode: 'graded',
        gpaInclusion: 'excluded', earnedInclusion: 'excluded', requiredClaim: 'none', overriddenFields: [], updatedAt: stamp,
        ...(previous ? { isRetake: true, replacesCourseId: previous.id } : {}) };
    const c = courseSchema.safeParse(draft);
    if (!c.success) return { error: `${p.name}: ${firstIssue(c.error)}` };
    const times: ClassTime[] = [];
    for (const slot of p.slots) {
      const t = classTimeSchema.safeParse({ courseId: draft.id, day: slot.day, start: hhmm(slot.start), end: hhmm(slot.end) });
      if (!t.success) return { error: `${p.name}: ${firstIssue(t.error)}` };
      times.push(t.data);
    }
    courses = found ? courses.map((x) => (x.id === draft.id ? c.data : x)) : [...courses, c.data];
    classTimes = [...classTimes.filter((t) => t.courseId !== draft.id), ...times];
  }
  return { state: { ...s, courses, classTimes } };
}
