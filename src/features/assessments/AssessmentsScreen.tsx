// 시간표: 월~금 격자에서 칸을 누르거나 끌어 수업을 넣고, 수업 블록의 '시험정보 추가'·연필로 메모와 중간·기말 정보를 적는다.
// 칸 고르기 → (손을 떼고 0.3초 뒤) '추가하시겠습니까?' 확인 → 수업 정보 시트(과목명·시간) → 블록 생성.
// 수업 블록을 누르면 시험 정보·메모 시트가 열리고(메모는 수시로 쓰므로), 블록 맨 아래 연필 모양을 눌러야만 '삭제하시겠습니까?' 확인이 뜬다.
// 수업·시험 정보 저장은 모두 store.save()를 거친다. 자유 메모는 알림을 만들지 않는다.
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useStore } from '../../app/store';
import { deriveEvaluationEvents, eventsOn, KIND_LABEL, PHASE_LABEL } from '../../domain/assessment-events/events';
import { dropCourseRefs } from '../../domain/merge/mergeImport';
import { newId } from '../../domain/state';
import { localDateTime, sameTerm } from '../../domain/terms';
import { classTimeText, DAY_LABEL, layoutWeek, toMinutes } from '../../domain/timetable';
import { dragRange, hhmm, hmToMinutes, overlapsAny } from '../../domain/timetableSelect';
import type { Assessment, AssessmentMode, ClassTime, Course, CourseMemo } from '../../domain/types';
import { assessmentSchema, classTimeSchema, courseMemoSchema, courseSchema, firstIssue, MEMO_MAX } from '../../domain/validation/schemas';
import { ConsentGate, Sheet } from '../common';

/** 시간표 한 시간의 높이(px) — Figma 70px, CSS(.tt-cell)와 같아야 한다 */
const HOUR_PX = 70;
/** 손을 뗀 뒤 확인 창이 뜨기까지 (너무 빠르면 끌다 놓친 것처럼 느껴지고, 너무 느리면 답답하다) */
const HOLD_MS = 300;
/** 과목 블록 배경 (Figma 시간표 파스텔) */
const TINTS = ['#dff1ed', '#e3edf9', '#eee8f8', '#f9e9de', '#f5efcf'];

type Phase = Assessment['phase'];
const PHASES: Phase[] = ['midterm', 'final'];
const REPL: Record<NonNullable<Assessment['replacementType']>, string> = { presentation: '발표', report: '보고서', project: '프로젝트', other: '대체' };

/** 시간표 블록용 짧은 표시(Figma): 시험O / 시험X / — / 발표·대체 */
function evText(a?: Assessment): string {
  if (!a || a.mode === null) return '—';
  if (a.mode === 'exam') return '시험O';
  if (a.mode === 'none') return '시험X';
  return REPL[a.replacementType ?? 'other'];
}

const WEEK = '일월화수목금토';
export function prettyDate(d?: string): string {
  if (!d) return '날짜 미입력';
  const x = localDateTime(d);
  return `${x.getMonth() + 1}월 ${x.getDate()}일 (${WEEK[x.getDay()]})`;
}

export function AssessmentsScreen() {
  const { state, todayRoute, consumeTodayRoute } = useStore();
  const current = state.profile!.currentTerm;
  const [examFor, setExamFor] = useState<string | null>(null);
  const [todayDate, setTodayDate] = useState<string | null>(null);

  // 알림을 눌러 들어오면 그 날짜의 평가 목록을 연다 (화면에는 '오늘 평가' 줄이 없지만 알림 연결은 그대로)
  useEffect(() => {
    if (todayRoute) { setTodayDate(todayRoute); consumeTodayRoute(); }
  }, [todayRoute, consumeTodayRoute]);

  // 이번 학기 '수강 중' 과목
  const courses = state.courses.filter((c) => sameTerm(c.term, current) && c.status === 'inProgress');
  const find = (courseId: string, phase: Phase) => state.assessments.find((a) => a.courseId === courseId && a.phase === phase);
  const hasTimes = state.classTimes.some((t) => courses.some((c) => c.id === t.courseId));

  return (
    <div className="page">
      <h1 className="page-title">시간표</h1>
      <p className="page-lead">아래 표를 드래그하여 수업 시간표를 {hasTimes ? '추가/삭제하고,' : '추가하고,'}<br />시험 정보나 기억할 내용을 메모로 남길 수 있어요.</p>

      <Timetable courses={courses} times={state.classTimes} find={find} onExam={setExamFor} />

      {examFor && <ExamSheet courseId={examFor} onClose={() => setExamFor(null)} />}
      {todayDate && (
        <TodaySheet date={todayDate} setDate={setTodayDate} onClose={() => setTodayDate(null)}
          onOpenCourse={(id) => { setTodayDate(null); setExamFor(id); }} />
      )}
    </div>
  );
}

interface Sel { day: number; start: number; end: number } // 분 단위
interface Target { courseId: string; day: number; start: string; end: string }
type Ask = 'add' | 'del' | 'class';
const keyOf = (t: Target) => `${t.courseId}|${t.day}|${t.start}|${t.end}`;

/**
 * 월~금 시간표(Figma 격자). 과목 블록 = 과목명 + 시험 정보(없으면 '시험정보 추가').
 * 빈 칸을 누르거나 끌면 칸이 잡히고, 이미 있는 수업을 누르면 그 수업 전체가 잡힌다.
 */
function Timetable({ courses, times, find, onExam }: {
  courses: Course[]; times: ClassTime[]; find: (courseId: string, phase: Phase) => Assessment | undefined;
  onExam: (courseId: string) => void;
}) {
  const { state, save } = useStore();
  const byId = new Map(courses.map((c, i) => [c.id, { c, tint: TINTS[i % TINTS.length] }]));
  const visible = times.filter((t) => byId.has(t.courseId));
  const { blocks, fromHour } = layoutWeek(visible);
  const toHour = Math.max(17, ...blocks.map((b) => Math.ceil(toMinutes(b.end) / 60)));
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);
  const memoed = new Set(state.courseMemos.filter((m) => m.text.trim()).map((m) => m.courseId));
  const hasInfo = (id: string) => memoed.has(id) || PHASES.some((p) => find(id, p)?.mode);

  const [sel, setSel] = useState<Sel | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ day: number; anchor: number } | null>(null);
  const timer = useRef(0);
  const clearTimer = () => window.clearTimeout(timer.current);
  useEffect(() => clearTimer, []);

  const busy = (day: number, hour: number) => overlapsAny(visible, day, hour * 60, hour * 60 + 60);
  const cancel = () => { clearTimer(); gesture.current = null; setSel(null); setAsk(null); setTarget(null); };

  // 마우스 위치 → 요일 칸·시 칸
  const locate = (x: number, y: number) => {
    const r = bodyRef.current!.getBoundingClientRect();
    const colW = (r.width - 30) / 5;
    const col = Math.floor((x - r.left - 30) / colW);
    const rowF = (y - r.top) / HOUR_PX;
    return { col, row: Math.floor(rowF), inside: col >= 0 && col < 5 && rowF >= 0 && rowF < hours.length };
  };

  // 수업 블록 전체를 잡는다 (누르기·끌기·키보드 모두 같다). 확인 창에서 '삭제'를 눌러야만 지워진다.
  const grab = (t: Target) => { setTarget(t); setSel({ day: t.day, start: toMinutes(t.start), end: toMinutes(t.end) }); };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (ask === 'class' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.target as HTMLElement;
    if (el.closest('[data-ttaction]')) return; // 시험정보 버튼은 따로 동작
    clearTimer();
    setAsk(null);
    if (el.closest('[data-blk]')) { setSel(null); setTarget(null); return; } // 수업 블록은 아래 onClick에서 시트를 연다 (끌어도 지워지지 않는다)
    const p = locate(e.clientX, e.clientY);
    const hour = fromHour + p.row;
    if (!p.inside || busy(p.col, hour)) { setSel(null); setTarget(null); return; }
    gesture.current = { day: p.col, anchor: hour };
    setTarget(null);
    setSel({ day: p.col, start: hour * 60, end: hour * 60 + 60 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const cursor = fromHour + Math.max(0, Math.min(hours.length - 1, locate(e.clientX, e.clientY).row));
    const r = dragRange(g.anchor, cursor, (h) => busy(g.day, h)); // 이미 있는 수업 앞에서 멈춘다
    const start = r.from * 60, end = (r.to + 1) * 60;
    setSel((prev) => (prev && prev.start === start && prev.end === end ? prev : { day: g.day, start, end }));
  };
  const onPointerUp = () => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    clearTimer();
    timer.current = window.setTimeout(() => setAsk('add'), HOLD_MS);
  };
  const onBlockKey = (e: KeyboardEvent<HTMLDivElement>, b: Target) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== 'Delete')) return;
    e.preventDefault();
    if (e.key === 'Enter') return onExam(b.courseId);
    clearTimer();
    grab(b);
    setAsk('del');
  };

  // 확인 창·시트가 떠 있는 동안 Esc는 취소 (시트는 자체 Esc 처리)
  useEffect(() => {
    if (ask !== 'add' && ask !== 'del') return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ask]);

  // 시트가 올라오면 고른 칸이 시트에 가려지지 않게 화면을 조금 내린다 (고른 칸이 계속 보여야 시간을 맞춰 볼 수 있다)
  useEffect(() => {
    if (ask !== 'class') return;
    const id = window.setTimeout(() => {
      const s = document.querySelector('.tt-sel')?.getBoundingClientRect();
      const sheet = document.querySelector('.sheet-layer.fg .sheet')?.getBoundingClientRect();
      if (!s || !sheet) return;
      const tabsBottom = document.querySelector('.tabs')?.getBoundingClientRect().bottom ?? 0;
      const need = s.bottom + 12 - sheet.top;
      if (need > 0) window.scrollBy({ top: Math.min(need, Math.max(0, s.top - tabsBottom - 8)) });
    }, 220);
    return () => window.clearTimeout(id);
  }, [ask]);

  async function removeTarget() {
    const t = target;
    if (!t) return;
    await save((s) => {
      const nextTimes = s.classTimes.filter((x) => !(x.courseId === t.courseId && x.day === t.day && x.start === t.start && x.end === t.end));
      const course = s.courses.find((c) => c.id === t.courseId);
      const memo = s.courseMemos.find((m) => m.courseId === t.courseId)?.text.trim();
      const info = !!memo || s.assessments.some((a) => a.courseId === t.courseId && a.mode);
      // 시간표에서 이름과 시간만 넣어 만든 과목(학점 0)이 마지막 시간까지 지워지고 적어 둔 정보도 없으면 과목째 정리한다.
      // 종정시에서 가져온 과목이나, 메모·시험 정보가 있는 과목은 남겨 둔다 (같은 이름으로 다시 넣으면 이어진다).
      if (course && course.origin === 'manual' && course.creditUnits === 0 && !info && !nextTimes.some((x) => x.courseId === t.courseId)) {
        return { ...s, ...dropCourseRefs(s, new Set([t.courseId])), courses: s.courses.filter((c) => c.id !== t.courseId) };
      }
      return { ...s, classTimes: nextTimes };
    });
    cancel();
  }

  const targetName = target ? byId.get(target.courseId)?.c.name ?? '' : '';
  const day = (d: number) => `${DAY_LABEL[d]}요일`;

  return (
    <>
      <div className="tt" role="group" aria-label="수업 시간표"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { if (gesture.current) cancel(); }}>
        <div className="tt-grid" aria-hidden="true">
          <div className="tt-dayh" />
          {DAY_LABEL.map((d) => <div key={d} className="tt-dayh">{d}</div>)}
          {hours.map((h) => (
            <Fragment key={h}>
              <div className="tt-cell hour">{h}</div>
              {DAY_LABEL.map((d) => <div key={d} className="tt-cell" />)}
            </Fragment>
          ))}
        </div>
        <div className="tt-over" ref={bodyRef}>
          <div />
          {DAY_LABEL.map((dayName, d) => (
            <div key={dayName} className="tt-lane" role="list" aria-label={day(d)}>
              {blocks.filter((b) => b.day === d).map((b) => {
                const { c, tint } = byId.get(b.courseId)!;
                const mid = find(c.id, 'midterm');
                const fin = find(c.id, 'final');
                const top = ((toMinutes(b.start) - fromHour * 60) / 60) * HOUR_PX;
                const height = ((toMinutes(b.end) - toMinutes(b.start)) / 60) * HOUR_PX;
                const tall = height >= HOUR_PX * 2;
                const t: Target = { courseId: c.id, day: b.day, start: b.start, end: b.end };
                return (
                  <div key={keyOf(t)} role="listitem" tabIndex={0} data-blk={keyOf(t)} data-course={c.id}
                    className={`tt-blk${tall ? ' tall' : ' short'}`}
                    style={{ top, height, left: `${(b.lane / b.lanes) * 100}%`, width: `${100 / b.lanes}%`, right: 'auto', background: tint }}
                    aria-label={`${c.name}, ${classTimeText(b)}, 중간 ${evText(mid)}, 기말 ${evText(fin)}. 수정하려면 Enter, 삭제하려면 Delete`}
                    onClick={() => onExam(c.id)} onKeyDown={(e) => onBlockKey(e, t)}>
                    <span className="nm">{c.name}</span>
                    {hasInfo(c.id) ? (
                      <span className="ex" style={tall ? { top: HOUR_PX + 15 } : undefined}>
                        <span className="ev">중간 {evText(mid)}</span>
                        <span className="ev">기말 {evText(fin)}</span>
                      </span>
                    ) : (
                      <button type="button" data-ttaction className="tt-add" style={tall ? { top: Math.min(HOUR_PX + 35, height - 44) } : undefined}
                        aria-label={`${c.name} 시험 정보 추가`} onClick={(e) => { e.stopPropagation(); onExam(c.id); }}>
                        <i className="icon ic-plus" aria-hidden="true" />시험정보 추가
                      </button>
                    )}
                    {/* 연필 모양: 항상 막대 맨 아래. 누르면 이 수업의 삭제 확인이 뜬다 */}
                    <button type="button" data-ttaction className="tt-pen" aria-label={`${c.name} ${classTimeText(b)} 삭제`}
                      onClick={(e) => { e.stopPropagation(); clearTimer(); grab(t); setAsk('del'); }}>
                      <i className="icon ic-pencil" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {sel && sel.day === d && (
                <div className="tt-sel" aria-hidden="true"
                  style={{ top: ((sel.start - fromHour * 60) / 60) * HOUR_PX, height: ((sel.end - sel.start) / 60) * HOUR_PX }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 시트가 격자 아래쪽을 가리지 않게, 시트가 떠 있는 동안만 화면을 더 내릴 수 있는 여백을 둔다 */}
      {ask === 'class' && <div className="tt-spacer" aria-hidden="true" />}
      {ask === 'add' && (
        <Confirm text="해당 영역에 강의 정보를 추가하시겠습니까?" yes="네" no="아니오" onYes={() => setAsk('class')} onNo={cancel} />
      )}
      {ask === 'del' && target && (
        <Confirm text={<>‘{targetName}’ 강의 시간표를 <span className="red">삭제</span>하시겠습니까?</>} yes="삭제" no="취소" onYes={removeTarget} onNo={cancel} />
      )}
      {ask === 'class' && sel && (
        <ClassSheet sel={sel} setSel={setSel} fromHour={fromHour} toHour={toHour} courses={courses} visible={visible}
          onClose={cancel} />
      )}
    </>
  );
}

/** Figma 확인 창 (화면 가운데): 네/아니오 · 삭제/취소 */
function Confirm({ text, yes, no, onYes, onNo }: { text: ReactNode; yes: string; no: string; onYes: () => void; onNo: () => void }) {
  const id = useId();
  return (
    <div className="tt-confirm" role="alertdialog" aria-labelledby={id}>
      <p id={id}>{text}</p>
      <div className="acts">
        <button type="button" className="yes" autoFocus onClick={onYes}>{yes}</button>
        <button type="button" className="no" onClick={onNo}>{no}</button>
      </div>
    </div>
  );
}

/** 'HH:mm' 시·분 칸 하나: 숫자 두 자리만 */
function Digits({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input className="dg" inputMode="numeric" maxLength={2} value={value} aria-label={label} placeholder="00"
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
      onBlur={() => value.length === 1 && onChange(`0${value}`)} />
  );
}

/** 수업 정보 시트: 과목명 + 수업 시간. 시간을 바꾸면 격자의 시간 막대도 바로 따라 바뀐다. */
function ClassSheet({ sel, setSel, fromHour, toHour, courses, visible, onClose }: {
  sel: Sel; setSel: (s: Sel) => void; fromHour: number; toHour: number; courses: Course[]; visible: ClassTime[]; onClose: () => void;
}) {
  const { state, save, now } = useStore();
  const listId = useId();
  const day = useRef(sel.day).current;
  const [name, setName] = useState('');
  const [s1, setS1] = useState(String(Math.floor(sel.start / 60)).padStart(2, '0'));
  const [s2, setS2] = useState(String(sel.start % 60).padStart(2, '0'));
  const [e1, setE1] = useState(String(Math.floor(sel.end / 60)).padStart(2, '0'));
  const [e2, setE2] = useState(String(sel.end % 60).padStart(2, '0'));
  const [error, setError] = useState('');
  const start = hmToMinutes(s1, s2), end = hmToMinutes(e1, e2);
  const okRange = start !== null && end !== null && start < end && start >= fromHour * 60 && end <= toHour * 60;

  // 입력한 시간이 올바르면 격자의 막대를 그 시간으로 맞춘다 (끌어서 고른 것과 똑같이 보인다)
  useEffect(() => {
    if (okRange) setSel({ day, start: start!, end: end! });
  }, [okRange, start, end, day, setSel]);

  const pending = courses.filter((c) => !visible.some((t) => t.courseId === c.id)); // 시간이 아직 없는 과목 (종정시에서 가져온 수강 중 과목)
  const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError('과목명을 입력해 주세요');
    if (start === null || end === null) return setError('시간을 시와 분으로 입력해 주세요 (예: 09 : 00)');
    if (end <= start) return setError('수업 종료 시각은 시작보다 늦어야 해요');
    if (start < fromHour * 60 || end > toHour * 60) return setError(`시간표는 ${fromHour}시~${toHour}시 안에서 입력해 주세요`);
    if (overlapsAny(visible, day, start, end)) return setError('이미 다른 수업이 있는 시간이에요');
    // 같은 이름의 이번 학기 수강 과목이 있으면 그 과목에 시간을 더한다 (종정시에서 가져온 과목, 또는 같은 수업의 다른 요일)
    const found = courses.find((c) => norm(c.name) === norm(trimmed));
    const course: Course = found ?? {
      id: newId('course'), name: trimmed, term: state.profile!.currentTerm,
      creditUnits: 0, area: 'unknown', origin: 'manual', recordKind: 'course', status: 'inProgress', grade: null, gradingMode: 'graded',
      gpaInclusion: 'excluded', earnedInclusion: 'excluded', requiredClaim: 'none', overriddenFields: [], updatedAt: now.toISOString(),
    };
    if (!found) {
      const c = courseSchema.safeParse(course);
      if (!c.success) return setError(firstIssue(c.error));
    }
    const t = classTimeSchema.safeParse({ courseId: course.id, day, start: hhmm(start), end: hhmm(end) });
    if (!t.success) return setError(firstIssue(t.error));
    const ok = await save((s) => ({ ...s, courses: found ? s.courses : [...s.courses, course], classTimes: [...s.classTimes, t.data] }));
    if (ok) onClose();
  }

  return (
    <Sheet variant="fg" title="수업 정보" onClose={onClose}
      footer={<button type="button" className="btn-fg" onClick={submit}>수업 시간표 추가</button>}>
      <ConsentGate>
        <form className="fg-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          <label className="fg-field">과목명
            <input autoFocus list={listId} value={name} maxLength={120} autoComplete="off" onChange={(e) => { setName(e.target.value); setError(''); }} />
            <datalist id={listId}>{pending.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </label>
          <div className="fg-field" role="group" aria-label="수업 시간">
            <span>수업 시간</span>
            <div className="tt-time">
              <span className="t"><Digits value={s1} onChange={(v) => { setS1(v); setError(''); }} label="시작 시" />:<Digits value={s2} onChange={(v) => { setS2(v); setError(''); }} label="시작 분" /></span>
              <span className="tilde" aria-hidden="true">~</span>
              <span className="t"><Digits value={e1} onChange={(v) => { setE1(v); setError(''); }} label="종료 시" />:<Digits value={e2} onChange={(v) => { setE2(v); setError(''); }} label="종료 분" /></span>
              <i className="icon ic-clock" aria-hidden="true" />
            </div>
          </div>
          {error && <p className="fg-error" role="alert">{error}</p>}
          <button type="submit" hidden />
        </form>
      </ConsentGate>
    </Sheet>
  );
}

const MODE_BTN: [AssessmentMode, string][] = [['exam', 'O'], ['replacement', '대체 과제'], ['none', 'X']];

/**
 * 시험 정보 시트: 내 메모 + 중간·기말고사 O/대체 과제/X.
 * 처음엔 '시험 정보 추가', 이미 적어 둔 수업을 다시 열면 '저장'. 같은 버튼으로 메모와 시험 정보를 함께 저장하고,
 * '메모 저장'은 메모만 따로 저장한다. 메모 속 날짜로 알림을 만들지 않는다.
 */
function ExamSheet({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const { state, save, now } = useStore();
  const memoId = useId();
  const existing = (p: Phase) => state.assessments.find((a) => a.courseId === courseId && a.phase === p);
  const saved = state.courseMemos.find((m) => m.courseId === courseId)?.text ?? '';
  const [editing] = useState(() => !!saved.trim() || PHASES.some((p) => existing(p)?.mode)); // 처음 열 때 이미 적어 둔 정보가 있는가
  const [modes, setModes] = useState<Record<Phase, AssessmentMode>>(() => ({ midterm: existing('midterm')?.mode ?? null, final: existing('final')?.mode ?? null }));
  const [text, setText] = useState(saved);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const dirty = text !== saved;
  const course = state.courses.find((c) => c.id === courseId);
  if (!course) return null;
  const anything = !!text.trim() || modes.midterm !== null || modes.final !== null;

  // 빈 메모는 기록을 지운다
  const memoRows = (s: typeof state, memoText: string, stamp: string): { rows: CourseMemo[]; error?: undefined } | { rows?: undefined; error: string } => {
    const r = courseMemoSchema.safeParse({ courseId, text: memoText, updatedAt: stamp });
    return r.success ? { rows: [...s.courseMemos.filter((m) => m.courseId !== courseId), ...(memoText.trim() ? [r.data] : [])] } : { error: firstIssue(r.error) };
  };

  async function saveMemo() {
    const probe = memoRows(state, text, now.toISOString());
    if (probe.error !== undefined) return setError(probe.error);
    setError('');
    const ok = await save((s) => ({ ...s, courseMemos: memoRows(s, text, now.toISOString()).rows ?? s.courseMemos }));
    setMsg(ok ? '저장했어요' : '');
  }

  async function submit() {
    const next: Assessment[] = [];
    for (const p of PHASES) {
      const mode = modes[p];
      const old = existing(p);
      if (!old && mode === null) continue;
      // 고른 방식이 그대로면 이전에 적어 둔 날짜·방식 메모를 유지하고, 바뀌면 그 방식에 맞는 칸만 남긴다
      const keep = old && old.mode === mode ? old : undefined;
      const base = { id: old?.id ?? newId('as'), courseId, phase: p, mode, notes: mode === 'none' ? '' : old?.notes ?? '', origin: 'student' as const, updatedAt: now.toISOString() };
      const a: Assessment = mode === 'exam'
        ? { ...base, examDate: keep?.examDate, examStartTime: keep?.examStartTime, examEndTime: keep?.examEndTime }
        : mode === 'replacement'
          ? { ...base, replacementType: keep?.replacementType ?? 'other', submissionDate: keep?.submissionDate, submissionTime: keep?.submissionTime, presentationDate: keep?.presentationDate, presentationTime: keep?.presentationTime }
          : base;
      const r = assessmentSchema.safeParse(a);
      if (!r.success) return setError(`${PHASE_LABEL[p]}고사: ${firstIssue(r.error)}`);
      next.push(r.data);
    }
    const probe = memoRows(state, text, now.toISOString());
    if (probe.error !== undefined) return setError(probe.error);
    const ids = new Set(next.map((a) => a.id));
    const ok = await save((s) => {
      // 날짜가 바뀐 이벤트의 '완료' 표시는 다시 확인하도록 정리
      const changed = new Set<string>();
      for (const a of next) {
        const o = s.assessments.find((x) => x.id === a.id);
        if (!o) continue;
        if (o.mode !== a.mode || o.examDate !== a.examDate) changed.add(`${a.id}:exam`);
        if (o.mode !== a.mode || o.submissionDate !== a.submissionDate) changed.add(`${a.id}:submission`);
        if (o.mode !== a.mode || o.presentationDate !== a.presentationDate) changed.add(`${a.id}:presentation`);
      }
      return {
        ...s,
        assessments: [...s.assessments.filter((a) => !ids.has(a.id)), ...next],
        completions: s.completions.filter((c) => !changed.has(c.eventId)),
        courseMemos: memoRows(s, text, now.toISOString()).rows ?? s.courseMemos,
      };
    });
    if (ok) onClose();
  }

  return (
    <Sheet variant="fg" title="시험 정보" onClose={onClose}
      footer={<button type="button" className="btn-fg" disabled={!editing && !anything} onClick={submit}>{editing ? '저장' : '시험 정보 추가'}</button>}>
      <ConsentGate>
        <div className="fg-memo">
          <label htmlFor={memoId}>내 메모</label>
          <textarea id={memoId} rows={3} maxLength={MEMO_MAX} value={text} onChange={(e) => { setText(e.target.value); setMsg(''); }} />
          <div className="foot">
            <span className="cnt" aria-live="polite">{text.length}/{MEMO_MAX.toLocaleString()}{msg && ` · ${msg}`}</span>
            <button type="button" className="save" disabled={!dirty} onClick={saveMemo}>메모 저장</button>
          </div>
        </div>
        {PHASES.map((p) => (
          <div key={p} className="fg-phase" role="group" aria-label={`${PHASE_LABEL[p]}고사`}>
            <h3>{PHASE_LABEL[p]}고사</h3>
            <div className="opts">
              {MODE_BTN.map(([v, l]) => (
                <button key={l} type="button" aria-pressed={modes[p] === v} className={`o${v === 'replacement' ? ' wide' : ''}`}
                  onClick={() => { setModes((m) => ({ ...m, [p]: m[p] === v ? null : v })); setError(''); }}>{l}</button>
              ))}
            </div>
          </div>
        ))}
        {error && <p className="fg-error" role="alert">{error}</p>}
      </ConsentGate>
    </Sheet>
  );
}

function TodaySheet({ date, setDate, onClose, onOpenCourse }: {
  date: string; setDate: (d: string) => void; onClose: () => void; onOpenCourse: (courseId: string) => void;
}) {
  const { state, save, now, today } = useStore();
  const events = deriveEvaluationEvents(state.assessments, state.courses, state.completions, state.profile!.currentTerm);
  const list = eventsOn(events, date);
  const byId = new Map<string, Course>(state.courses.map((c) => [c.id, c]));
  const notes = new Map(state.assessments.map((a) => [a.id, a.notes]));
  const toggleDone = (eventId: string, done: boolean) => save((s) => ({
    ...s,
    completions: done ? [...s.completions, { eventId, completedAt: now.toISOString() }] : s.completions.filter((c) => c.eventId !== eventId),
  }));
  return (
    <Sheet title={date === today ? '오늘의 평가' : `${prettyDate(date)} 평가`} onClose={onClose}>
      <label className="inline">날짜 <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      {list.length === 0 ? <p className="empty">{date === today ? '오늘 등록된 평가가 없어요' : '이 날짜에 등록된 평가가 없어요'}</p> : (
        <ul className="event-list">
          {list.map((e) => (
            <li key={e.id}>
              <button type="button" className="event" onClick={() => onOpenCourse(e.courseId)}>
                <span className="name">{byId.get(e.courseId)?.name}</span>
                <span className="small">{PHASE_LABEL[e.phase]} · {KIND_LABEL[e.kind]} · {e.time ?? '시간 미입력'}</span>
                {notes.get(e.assessmentId) && <span className="small muted">{notes.get(e.assessmentId)}</span>}
              </button>
              {e.kind === 'submission' && (
                <label className="check small"><input type="checkbox" checked={e.completed} onChange={(x) => toggleDone(e.id, x.target.checked)} /> 제출 완료 (성적 이수와는 별개)</label>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
