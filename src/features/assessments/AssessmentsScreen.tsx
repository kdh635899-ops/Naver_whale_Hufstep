// 시간표: 월~금 격자와 맨 아래 '시간 미정' 줄을 하나의 시간표로 표시한다.
// 시간표(학생이 입력한 수업 시간) → 과목 누르면 하단 상세 패널(자유 메모 + 중간·기말 정보) → 메모 저장과 시험 정보 수정은 따로.
// 시험 정보 저장은 store.save()를 거쳐 오늘 집계·알림 예약을 갱신한다. 자유 메모는 알림을 만들지 않는다.
import { Fragment, useEffect, useId, useState } from 'react';
import { useStore } from '../../app/store';
import { calendarFor } from '../../data';
import { deriveEvaluationEvents, eventsOn, KIND_LABEL, PHASE_LABEL } from '../../domain/assessment-events/events';
import { newId } from '../../domain/state';
import { formatUnits, localDateTime, sameTerm } from '../../domain/terms';
import { classTimeText, DAY_LABEL, layoutWeek, toMinutes } from '../../domain/timetable';
import type { Assessment, ClassTime, Course } from '../../domain/types';
import { assessmentSchema, classTimeSchema, courseMemoSchema, firstIssue, MEMO_MAX } from '../../domain/validation/schemas';
import { AREA_LABEL, ConsentGate, Sheet, STATUS_LABEL } from '../common';

/** 시간표 한 시간의 높이(px) — Figma 70px, CSS(.tt-cell)와 같아야 한다 */
const HOUR_PX = 70;
/** 과목 블록 배경 (Figma 시간표 파스텔) */
const TINTS = ['#dff1ed', '#e3edf9', '#eee8f8', '#f9e9de', '#f5efcf'];
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

/** 시간표 블록용 짧은 표시(Figma): 시험O / 시험X / — / 발표·보고서… */
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
  const { state, openEditor, todayRoute, consumeTodayRoute } = useStore();
  const current = state.profile!.currentTerm;
  const [detail, setDetail] = useState<string | null>(null);
  const [todayDate, setTodayDate] = useState<string | null>(null);

  // 알림을 눌러 들어오면 그 날짜의 평가 목록을 연다 (화면에는 '오늘 평가' 줄이 없지만 알림 연결은 그대로)
  useEffect(() => {
    if (todayRoute) { setTodayDate(todayRoute); consumeTodayRoute(); }
  }, [todayRoute, consumeTodayRoute]);

  // 이번 학기 '수강 중' 과목
  const courses = state.courses.filter((c) => sameTerm(c.term, current) && c.status === 'inProgress');
  const find = (courseId: string, phase: Phase) => state.assessments.find((a) => a.courseId === courseId && a.phase === phase);
  // 패널은 닫힐 때 원래 버튼으로 포커스를 돌려준다.
  const closeDetail = (id: string) => {
    setDetail(null);
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      document.querySelector<HTMLElement>(`[data-course="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="page">
      <h1 className="page-title">시간표</h1>
      <p className="page-lead">이번 학기 수강하는 수업 시간표를 추가하고,<br />시험 정보나 기억할 내용을 메모로 남길 수 있어요.</p>

      <Timetable courses={courses} times={state.classTimes} find={find} onOpen={setDetail}
        onAdd={() => openEditor({ preset: { status: 'inProgress', term: current } })} />

      {detail && <DetailPanel courseId={detail} onClose={() => closeDetail(detail)} />}
      {todayDate && (
        <TodaySheet date={todayDate} setDate={setTodayDate} onClose={() => setTodayDate(null)}
          onOpenCourse={(id) => { setTodayDate(null); setDetail(id); }} />
      )}
    </div>
  );
}

/** 월~금 시간표(Figma 격자). 과목 블록 = 과목명 + 아래칸에 '중간 …/기말 …'. 한 과목이 여러 칸에 나올 수 있다. */
function Timetable({ courses, times, find, onOpen, onAdd }: {
  courses: Course[]; times: ClassTime[]; find: (courseId: string, phase: Phase) => Assessment | undefined;
  onOpen: (courseId: string) => void; onAdd: () => void;
}) {
  const byId = new Map(courses.map((c, i) => [c.id, { c, tint: TINTS[i % TINTS.length] }]));
  const { blocks, fromHour } = layoutWeek(times.filter((t) => byId.has(t.courseId)));
  const toHour = Math.max(17, ...blocks.map((b) => Math.ceil(toMinutes(b.end) / 60)));
  const hours = Array.from({ length: toHour - fromHour }, (_, i) => fromHour + i);
  const timed = new Set(blocks.map((b) => b.courseId));
  const pending = courses.filter((c) => !timed.has(c.id));

  return (
    <>
      <div className="tt" role="group" aria-label="수업 시간표">
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
        <div className="tt-over">
          <div />
          {DAY_LABEL.map((dayName, day) => (
            <div key={dayName} className="tt-lane" role="list" aria-label={`${dayName}요일`}>
              {blocks.filter((b) => b.day === day).map((b, i) => {
                const { c, tint } = byId.get(b.courseId)!;
                const mid = find(c.id, 'midterm');
                const fin = find(c.id, 'final');
                const top = ((toMinutes(b.start) - fromHour * 60) / 60) * HOUR_PX;
                const height = ((toMinutes(b.end) - toMinutes(b.start)) / 60) * HOUR_PX;
                return (
                  <button key={`${b.courseId}-${i}`} type="button" role="listitem" data-course={c.id} aria-haspopup="dialog"
                    className={`tt-blk${height <= HOUR_PX ? ' short' : ''}`}
                    style={{ top, height, left: `${(b.lane / b.lanes) * 100}%`, width: `${100 / b.lanes}%`, right: 'auto', background: tint }}
                    onClick={() => onOpen(c.id)}
                    aria-label={`${c.name}, ${classTimeText(b)}, 중간 ${phaseLabel(mid)}, 기말 ${phaseLabel(fin)}`}>
                    <span className="nm">{c.name}</span>
                    <span className="ev">중간 {evText(mid)}</span>
                    <span className="ev">기말 {evText(fin)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Figma에는 없지만 수업 시간을 넣을 입구가 필요해서 최소로 둔다 (시간 미정 과목 + 과목 추가) */}
      <div className="tt-extra">
        {pending.length > 0 && <span>시간 미정</span>}
        {pending.map((c) => (
          <button key={c.id} type="button" className="pill" data-course={c.id} aria-haspopup="dialog" onClick={() => onOpen(c.id)}>{c.name}</button>
        ))}
        <button type="button" className="pill" onClick={onAdd}>+ 과목 추가</button>
      </div>
    </>
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
