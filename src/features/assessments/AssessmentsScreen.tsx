// 평가일정: 월~금 격자와 맨 아래 '시간 미정' 줄을 하나의 시간표로 표시한다.
// 시간표(학생이 입력한 수업 시간) → 과목 누르면 하단 상세 패널(자유 메모 + 중간·기말 정보) → 메모 저장과 시험 정보 수정은 따로.
// 시험 정보 저장은 store.save()를 거쳐 오늘 집계·알림 예약을 갱신한다. 자유 메모는 알림을 만들지 않는다.
import { useEffect, useId, useMemo, useState } from 'react';
import { useStore } from '../../app/store';
import { calendarFor } from '../../data';
import { countEventsForDate, countText, deriveEvaluationEvents, eventsOn, KIND_LABEL, PHASE_LABEL } from '../../domain/assessment-events/events';
import { newId } from '../../domain/state';
import { compareTerms, formatUnits, localDateTime, sameTerm, termKey, termLabel } from '../../domain/terms';
import { classTimeText, DAY_LABEL, layoutWeek, toMinutes } from '../../domain/timetable';
import type { Assessment, ClassTime, Course, Term } from '../../domain/types';
import { assessmentSchema, classTimeSchema, courseMemoSchema, firstIssue, MEMO_MAX } from '../../domain/validation/schemas';
import { AREA_LABEL, ConsentGate, Sheet, STATUS_LABEL } from '../common';

/** 시간표 한 시간의 높이(px) */
const HOUR_PX = 72;
/** 과목 블록 배경 (기존 팔레트의 옅은 청록·파랑 계열) */
const TINTS = ['#e8f6f6', '#e8f0fb', '#eef1f8', '#e6f2ee', '#f1eefa'];
/** 저장 전 메모 초안: 패널을 닫았다 열어도 남는다. ponytail: 메모리에만 — 사이드바를 다시 열면 사라짐 */
const memoDrafts = new Map<string, string>();

type Phase = Assessment['phase'];
const PHASES: Phase[] = ['midterm', 'final'];
const REPL: Record<NonNullable<Assessment['replacementType']>, string> = { presentation: '발표', report: '보고서', project: '프로젝트', other: '기타' };

/** 평가 상태 표시: 미선택 —, 시험 O, 없음 X, ○○ 대체 (색만으로 구분하지 않음) */
export function phaseLabel(a?: Assessment): string {
  if (!a || a.mode === null) return '—';
  if (a.mode === 'exam') return '시험 O';
  if (a.mode === 'none') return '없음 X';
  return `${REPL[a.replacementType ?? 'other']} 대체`;
}

/** 좁은 시간표 칸용 짧은 표시: O / X / — / 발표·보고서… (전체 문구는 aria-label과 상세 패널에) */
function shortLabel(a?: Assessment): string {
  if (!a || a.mode === null) return '—';
  if (a.mode === 'exam') return 'O';
  if (a.mode === 'none') return 'X';
  return REPL[a.replacementType ?? 'other'];
}

const WEEK = '일월화수목금토';
export function prettyDate(d?: string): string {
  if (!d) return '날짜 미입력';
  const x = localDateTime(d);
  return `${x.getMonth() + 1}월 ${x.getDate()}일 (${WEEK[x.getDay()]})`;
}

export function AssessmentsScreen() {
  const { state, today, openEditor, todayRoute, consumeTodayRoute } = useStore();
  const current = state.profile!.currentTerm;
  const [termSel, setTermSel] = useState(termKey(current));
  const [detail, setDetail] = useState<string | null>(null);
  const [todayDate, setTodayDate] = useState<string | null>(null);

  // 알림 클릭으로 들어오면 그 날짜 목록을 연다
  useEffect(() => {
    if (todayRoute) { setTermSel(termKey(current)); setTodayDate(todayRoute); consumeTodayRoute(); }
  }, [todayRoute, consumeTodayRoute, current]);

  const terms = useMemo(() => {
    const m = new Map<string, Term>([[termKey(current), current]]);
    const withAssess = new Set(state.assessments.map((a) => a.courseId));
    for (const c of state.courses) if (c.status === 'inProgress' || withAssess.has(c.id)) m.set(termKey(c.term), c.term);
    return [...m.values()].sort((a, b) => compareTerms(b, a));
  }, [state.courses, state.assessments, current]);
  const term = terms.find((t) => termKey(t) === termSel) ?? current;
  const isCurrent = sameTerm(term, current);

  // 현재 학기: '수강 중' 과목. 지난 학기 열람: 그 학기에 평가 기록이 있는 과목.
  const courses = state.courses.filter((c) => sameTerm(c.term, term)
    && (c.status === 'inProgress' || (!isCurrent && state.assessments.some((a) => a.courseId === c.id))));
  const events = useMemo(() => deriveEvaluationEvents(state.assessments, state.courses, state.completions, current),
    [state.assessments, state.courses, state.completions, current]);
  const todayCounts = countEventsForDate(events, today);
  const find = (courseId: string, phase: Phase) => state.assessments.find((a) => a.courseId === courseId && a.phase === phase);
  // 패널은 닫힐 때 원래 버튼으로 포커스를 돌려준다. 시간 미정 줄↔요일 칸으로 옮겨졌으면 그 과목의 새 버튼으로.
  const closeDetail = (id: string) => {
    setDetail(null);
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      document.querySelector<HTMLElement>(`[data-course="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="screen">
      <div className="row-between">
        <p className="eyebrow">{termLabel(term)}</p>
        {terms.length > 1 && (
          <label className="inline-select">
            <span className="sr-only">학기 선택</span>
            <select value={termSel} onChange={(e) => setTermSel(e.target.value)}>
              {terms.map((t) => <option key={termKey(t)} value={termKey(t)}>{termLabel(t)}</option>)}
            </select>
          </label>
        )}
      </div>
      <h1>평가일정</h1>

      {isCurrent && (
        <button type="button" className="today-line" onClick={() => setTodayDate(today)} aria-haspopup="dialog">
          <span>{todayCounts.total ? `오늘 ${countText(todayCounts)}` : '오늘 등록된 평가가 없어요'}</span> <span aria-hidden="true">›</span>
        </button>
      )}

      <div className="row-between">
        <h2 className="h3">{isCurrent ? '이번 학기' : '그 학기'} 과목 · {courses.length}과목</h2>
        {isCurrent && <button type="button" className="btn small" onClick={() => openEditor({ preset: { status: 'inProgress', term: current } })}>과목 추가</button>}
      </div>

      <Timetable courses={courses} times={state.classTimes} find={find} onOpen={setDetail}
        hasMemo={(id) => state.courseMemos.some((m) => m.courseId === id)} />
      {isCurrent && !calendarFor(state.profile!.homeCampus, current) && (
        <p className="muted small">학교 공식 시험 기간 데이터는 아직 없어요. 과목별 날짜는 직접 입력해 주세요.</p>
      )}

      {detail && <DetailPanel courseId={detail} onClose={() => closeDetail(detail)} />}
      {todayDate && (
        <TodaySheet date={todayDate} setDate={setTodayDate} onClose={() => setTodayDate(null)}
          onOpenCourse={(id) => { setTodayDate(null); setDetail(id); }} />
      )}
    </div>
  );
}

/** 월~금 시간표. 과목 블록 = 큰 과목명 + 작은 중간·기말 표시. 한 과목이 여러 칸에 나올 수 있다. */
function Timetable({ courses, times, find, onOpen, hasMemo }: {
  courses: Course[]; times: ClassTime[]; find: (courseId: string, phase: Phase) => Assessment | undefined;
  onOpen: (courseId: string) => void; hasMemo: (courseId: string) => boolean;
}) {
  const byId = new Map(courses.map((c, i) => [c.id, { c, tint: TINTS[i % TINTS.length] }]));
  const { blocks, fromHour, toHour } = layoutWeek(times.filter((t) => byId.has(t.courseId)));
  const timed = new Set(blocks.map((b) => b.courseId));
  const pending = courses.filter((c) => !timed.has(c.id));
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);

  // 요일 칸과 시간 미정 줄이 같은 버튼을 사용하므로 모양·상세 패널 동작이 같다.
  const renderBlock = (courseId: string, time?: ClassTime) => {
    const { c, tint } = byId.get(courseId)!;
    const mid = find(c.id, 'midterm');
    const fin = find(c.id, 'final');
    const memo = hasMemo(c.id);
    return (
      <button type="button" className="tt-block" data-course={c.id} style={{ background: tint }} onClick={() => onOpen(c.id)} aria-haspopup="dialog"
        aria-label={`${c.name}, ${time ? classTimeText(time) : '시간 미정'}, 중간 ${phaseLabel(mid)}, 기말 ${phaseLabel(fin)}${memo ? ', 메모 있음' : ''}`}>
        <span className="tt-name">{c.name}</span>
        <span className="tt-eval">중간 {shortLabel(mid)}</span>
        <span className="tt-eval">기말 {shortLabel(fin)}</span>
        {memo && <span className="tt-memo" aria-hidden="true">✎</span>}
      </button>
    );
  };

  return (
    <section className="timetable-wrap" aria-labelledby="tt-title">
      <h2 id="tt-title" className="h4">수업 시간표</h2>
      {pending.length > 0 && <p className="muted small">시간 미정 과목을 눌러 요일·시간을 넣어 주세요.</p>}
      <div className="timetable">
        <div className="tt-days" aria-hidden="true"><span />{DAY_LABEL.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="tt-body" style={{ height: hours.length * HOUR_PX, ['--hour' as string]: `${HOUR_PX}px` }}>
          <div className="tt-hours" aria-hidden="true">
            {hours.map((h, i) => <span key={h} style={{ top: i * HOUR_PX }}>{h}</span>)}
          </div>
          {DAY_LABEL.map((dayName, day) => (
            <ul key={dayName} className="tt-col" aria-label={`${dayName}요일`}>
              {blocks.filter((b) => b.day === day).map((b, i) => {
                const top = ((toMinutes(b.start) - fromHour * 60) / 60) * HOUR_PX;
                const height = ((toMinutes(b.end) - toMinutes(b.start)) / 60) * HOUR_PX;
                return (
                  <li key={`${b.courseId}-${i}`} style={{ top, height, left: `${(b.lane / b.lanes) * 100}%`, width: `${100 / b.lanes}%` }}>
                    {renderBlock(b.courseId, b)}
                  </li>
                );
              })}
            </ul>
          ))}
        </div>
        {pending.length > 0 && (
          <div className="tt-pending">
            <span className="tt-pending-label" id="tt-pending-label">시간 미정</span>
            <ul className="tt-pending-list" aria-labelledby="tt-pending-label">
              {pending.map((c) => <li key={c.id}>{renderBlock(c.id)}</li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

type Draft = Omit<Assessment, 'id' | 'courseId' | 'phase' | 'origin' | 'updatedAt'>;
const emptyDraft = (): Draft => ({ mode: null, notes: '' });

function DetailPanel({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const { state, save, now, openEditor } = useStore();
  const course = state.courses.find((c) => c.id === courseId);
  const existing = (p: Phase) => state.assessments.find((a) => a.courseId === courseId && a.phase === p);
  const myTimes = state.classTimes.filter((t) => t.courseId === courseId);
  // null = 보기, exam = 시험 정보 수정, times = 수업 시간 수정 (메모는 보기 화면에서 따로 저장)
  const [editing, setEditing] = useState<null | 'exam' | 'times'>(null);
  const [drafts, setDrafts] = useState<Record<Phase, Draft>>(() => ({
    midterm: existing('midterm') ?? emptyDraft(), final: existing('final') ?? emptyDraft(),
  }));
  const [timeRows, setTimeRows] = useState<TimeRow[]>([]);
  const [error, setError] = useState('');
  if (!course) return null;

  const startEdit = () => { setDrafts({ midterm: existing('midterm') ?? emptyDraft(), final: existing('final') ?? emptyDraft() }); setError(''); setEditing('exam'); };
  const startTimes = () => {
    setTimeRows(myTimes.length ? myTimes.map(({ day, start, end }) => ({ day, start, end })) : [{ day: 0, start: '', end: '' }]);
    setError('');
    setEditing('times');
  };
  const cancel = () => { setEditing(null); setError(''); }; // 저장 전 상태로 복귀

  async function submitTimes() {
    const next: ClassTime[] = [];
    for (const [i, row] of timeRows.entries()) {
      if (!row.start || !row.end) return setError(`수업 ${i + 1}: 시작·종료 시각을 모두 입력해 주세요.`);
      const r = classTimeSchema.safeParse({ courseId, ...row });
      if (!r.success) return setError(`수업 ${i + 1}: ${firstIssue(r.error)}`);
      next.push(r.data);
    }
    // 수업 시간만 바꾼다 — 메모·시험 정보·성적은 그대로
    const ok = await save((s) => ({ ...s, classTimes: [...s.classTimes.filter((t) => t.courseId !== courseId), ...next] }));
    if (ok) setEditing(null);
  }

  async function submit() {
    const next: Assessment[] = [];
    for (const p of PHASES) {
      const d = drafts[p];
      const old = existing(p);
      if (!old && d.mode === null) continue;
      // 모드에 맞는 필드만 남긴다 ('없음'이면 날짜·메모·알림 대상 없음)
      const base = { id: old?.id ?? newId('as'), courseId, phase: p, mode: d.mode, notes: d.notes.trim(), origin: 'student' as const, updatedAt: now.toISOString() };
      const a: Assessment = d.mode === 'exam'
        ? { ...base, examDate: d.examDate || undefined, examStartTime: d.examStartTime || undefined, examEndTime: d.examEndTime || undefined }
        : d.mode === 'replacement'
          ? { ...base, replacementType: d.replacementType ?? 'other', submissionDate: d.submissionDate || undefined, submissionTime: d.submissionTime || undefined, presentationDate: d.presentationDate || undefined, presentationTime: d.presentationTime || undefined }
          : { ...base, notes: d.mode === 'none' ? '' : base.notes };
      const r = assessmentSchema.safeParse(a);
      if (!r.success) return setError(`${PHASE_LABEL[p]}고사: ${firstIssue(r.error)}`);
      next.push(r.data);
    }
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
      // 시험 정보(assessments)만 바꾼다 — 자유 메모(courseMemos)는 건드리지 않는다
      return { ...s, assessments: [...s.assessments.filter((a) => !ids.has(a.id)), ...next], completions: s.completions.filter((c) => !changed.has(c.eventId)) };
    });
    if (ok) setEditing(null);
  }

  const cal = calendarFor(state.profile!.homeCampus, course.term);
  return (
    <Sheet
      title={<span className="name">{course.name}</span>}
      onClose={onClose}
      footer={editing ? (
        <div className="row">
          <button type="button" className="btn ghost" onClick={cancel}>취소</button>
          <button type="button" className="btn primary" onClick={editing === 'exam' ? submit : submitTimes}>저장</button>
        </div>
      ) : (
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => { onClose(); openEditor({ courseId }); }}>과목 정보 수정</button>
          <button type="button" className="btn primary" onClick={startEdit}>시험 정보 수정</button>
        </div>
      )}
    >
      <p className="muted">{AREA_LABEL[course.area]} · {formatUnits(course.creditUnits)}학점 · {STATUS_LABEL[course.status]}</p>
      {editing === null && (
        <>
          <section className="phase" aria-label="수업 시간">
            <div className="row-between">
              <h3>수업 시간</h3>
              <button type="button" className="btn small" onClick={startTimes}>{myTimes.length ? '수업 시간 수정' : '수업 시간 입력'}</button>
            </div>
            {myTimes.length
              ? <p>{[...myTimes].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)).map(classTimeText).join(' · ')}</p>
              : <p className="muted small">아직 없어요. 요일·시간을 넣으면 시간표에 표시돼요.</p>}
          </section>
          <ConsentGate><MemoBox courseId={courseId} /></ConsentGate>
          <h3 className="phase-head">중간 · 기말 정보</h3>
          {PHASES.map((p) => <PhaseView key={p} phase={p} a={existing(p)} />)}
        </>
      )}
      {editing === 'exam' && (
        <ConsentGate>
          <p className="muted small">시험 정보만 저장돼요. 자유 메모는 바뀌지 않아요.</p>
          {PHASES.map((p) => (
            <PhaseEdit key={p} phase={p} draft={drafts[p]} onChange={(d) => setDrafts((x) => ({ ...x, [p]: { ...x[p], ...d } }))}
              period={p === 'midterm' ? cal?.midtermPeriod : cal?.finalPeriod} />
          ))}
          {error && <p className="error" role="alert">{error}</p>}
        </ConsentGate>
      )}
      {editing === 'times' && (
        <ConsentGate>
          <TimesEdit rows={timeRows} setRows={setTimeRows} />
          {error && <p className="error" role="alert">{error}</p>}
        </ConsentGate>
      )}
    </Sheet>
  );
}

type TimeRow = Pick<ClassTime, 'day' | 'start' | 'end'>;
const MAX_TIMES = 10;

/** 한 과목의 수업 시간 여러 개 (월~금, 시작·종료). 0개로 저장하면 시간표의 '시간 미정' 줄로 간다. */
function TimesEdit({ rows, setRows }: { rows: TimeRow[]; setRows: (r: TimeRow[]) => void }) {
  const set = (i: number, d: Partial<TimeRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...d } : r)));
  return (
    <>
      <p className="muted small">시간표 배치에만 써요. 성적·졸업요건 계산에는 영향이 없어요.</p>
      {rows.map((r, i) => (
        <fieldset key={i} className="phase">
          <div className="row-between">
            <legend>수업 {i + 1}</legend>
            <button type="button" className="link small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>이 시간 삭제</button>
          </div>
          <div className="time-row">
            <label>요일
              <select value={r.day} onChange={(e) => set(i, { day: Number(e.target.value) as TimeRow['day'] })}>
                {DAY_LABEL.map((d, v) => <option key={d} value={v}>{d}</option>)}
              </select>
            </label>
            <label>시작<input type="time" value={r.start} onChange={(e) => set(i, { start: e.target.value })} /></label>
            <label>종료<input type="time" value={r.end} onChange={(e) => set(i, { end: e.target.value })} /></label>
          </div>
        </fieldset>
      ))}
      {rows.length === 0 && <p className="muted small">수업 시간이 없어요. 저장하면 시간표의 ‘시간 미정’ 줄에 표시돼요.</p>}
      {rows.length < MAX_TIMES && (
        <button type="button" className="btn ghost" onClick={() => setRows([...rows, { day: rows.at(-1)?.day ?? 0, start: '', end: '' }])}>+ 수업 시간 추가</button>
      )}
    </>
  );
}

/** 과목별 자유 메모. '메모 저장'은 courseMemos만 바꾸며, 메모 속 날짜로 알림을 만들지 않는다. */
function MemoBox({ courseId }: { courseId: string }) {
  const { state, save, now } = useStore();
  const id = useId();
  const saved = state.courseMemos.find((m) => m.courseId === courseId)?.text ?? '';
  const [text, setText] = useState(() => memoDrafts.get(courseId) ?? saved);
  const [msg, setMsg] = useState('');
  const dirty = text !== saved;
  useEffect(() => {
    if (dirty) memoDrafts.set(courseId, text); else memoDrafts.delete(courseId);
  }, [courseId, text, dirty]);

  async function saveMemo() {
    const r = courseMemoSchema.safeParse({ courseId, text, updatedAt: now.toISOString() });
    if (!r.success) return setMsg(firstIssue(r.error));
    // 빈 메모는 기록을 지운다
    const ok = await save((s) => ({ ...s, courseMemos: [...s.courseMemos.filter((m) => m.courseId !== courseId), ...(text.trim() ? [r.data] : [])] }));
    setMsg(ok ? '저장했어요' : '');
  }

  return (
    <section className="memo">
      <div className="row-between">
        <label htmlFor={id} className="h4">내 메모</label>
        <span className="muted small" aria-live="polite">{dirty ? '저장 전' : msg || '과목별 자유 메모'}</span>
      </div>
      <textarea id={id} rows={4} maxLength={MEMO_MAX} value={text} onChange={(e) => { setText(e.target.value); setMsg(''); }}
        placeholder="수업 내용, 준비물, 과제 주의사항을 적어 두세요." />
      <div className="row-between">
        <span className="muted small">{text.length} / {MEMO_MAX.toLocaleString()}</span>
        <button type="button" className="btn small primary" disabled={!dirty} onClick={saveMemo}>메모 저장</button>
      </div>
      <p className="muted small">메모에 적은 날짜는 알림으로 만들지 않아요. 알림은 시험 정보의 날짜로만 와요.</p>
    </section>
  );
}

function PhaseView({ phase, a }: { phase: Phase; a?: Assessment }) {
  return (
    <section className="phase">
      <h3>{PHASE_LABEL[phase]}고사 · {phaseLabel(a)}</h3>
      {(!a || a.mode === null) && <p className="muted small">아직 선택하지 않았어요. ‘시험 정보 수정’에서 시험 여부를 골라 주세요.</p>}
      {a?.mode === 'exam' && (
        <p>{prettyDate(a.examDate)}{a.examStartTime && ` ${a.examStartTime}`}{a.examEndTime && `~${a.examEndTime}`}{a.examDate && !a.examStartTime && ' · 시간 미입력'}</p>
      )}
      {a?.mode === 'replacement' && (
        <>
          <p className="small">제출 마감: {a.submissionDate ? `${prettyDate(a.submissionDate)}${a.submissionTime ? ` ${a.submissionTime}` : ''}` : '미입력'}</p>
          {(a.presentationDate || a.replacementType === 'presentation') && (
            <p className="small">발표: {a.presentationDate ? `${prettyDate(a.presentationDate)}${a.presentationTime ? ` ${a.presentationTime}` : ''}` : '미입력'}</p>
          )}
        </>
      )}
      {a?.mode === 'none' && <p className="muted small">이 평가는 없어요. (과목 통과를 뜻하지 않아요)</p>}
      {a?.notes && <p className="small notes">{a.notes}</p>}
    </section>
  );
}

function PhaseEdit({ phase, draft, onChange, period }: {
  phase: Phase; draft: Draft; onChange: (d: Partial<Draft>) => void; period?: { from: string; to: string };
}) {
  const name = `mode-${phase}`;
  return (
    <fieldset className="phase">
      <legend>{PHASE_LABEL[phase]}고사</legend>
      <div className="seg three">
        {([['exam', 'O · 시험 있음'], ['replacement', '대체 평가'], ['none', 'X · 시험 없음']] as const).map(([v, l]) => (
          <label key={v} className={draft.mode === v ? 'on' : ''}>
            <input type="radio" name={name} checked={draft.mode === v} onChange={() => onChange({ mode: v })} />{l}
          </label>
        ))}
      </div>
      {draft.mode === null && <p className="muted small">아직 선택하지 않았어요. 고르지 않으면 ‘—’로 남아요.</p>}
      {period && draft.mode !== 'none' && <p className="muted small">학교 {PHASE_LABEL[phase]}고사 기간: {period.from} ~ {period.to} (참고용 · 기간 밖 날짜도 입력할 수 있어요)</p>}
      {draft.mode === 'exam' && (
        <>
          <label>시험일<input type="date" value={draft.examDate ?? ''} onChange={(e) => onChange({ examDate: e.target.value })} /></label>
          <div className="row2">
            <label>시작 (선택)<input type="time" value={draft.examStartTime ?? ''} onChange={(e) => onChange({ examStartTime: e.target.value })} /></label>
            <label>종료 (선택)<input type="time" value={draft.examEndTime ?? ''} onChange={(e) => onChange({ examEndTime: e.target.value })} /></label>
          </div>
        </>
      )}
      {draft.mode === 'replacement' && (
        <>
          <label>대체 방식
            <select value={draft.replacementType ?? 'other'} onChange={(e) => onChange({ replacementType: e.target.value as Draft['replacementType'] })}>
              {Object.entries(REPL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="row2">
            <label>제출 마감일<input type="date" value={draft.submissionDate ?? ''} onChange={(e) => onChange({ submissionDate: e.target.value })} /></label>
            <label>마감 시각<input type="time" value={draft.submissionTime ?? ''} onChange={(e) => onChange({ submissionTime: e.target.value })} /></label>
          </div>
          <div className="row2">
            <label>발표일 (있으면)<input type="date" value={draft.presentationDate ?? ''} onChange={(e) => onChange({ presentationDate: e.target.value })} /></label>
            <label>발표 시각<input type="time" value={draft.presentationTime ?? ''} onChange={(e) => onChange({ presentationTime: e.target.value })} /></label>
          </div>
        </>
      )}
      {(draft.mode === 'exam' || draft.mode === 'replacement') && (
        <label>방식 메모 (300자)
          <textarea rows={2} maxLength={300} value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} />
        </label>
      )}
    </fieldset>
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
