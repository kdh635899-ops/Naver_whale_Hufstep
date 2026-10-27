// 학점 계산 (Figma, §3.7, §7). 예상 성적은 시나리오에만 저장하고 실제 이수 현황은 바꾸지 않는다.
// 학년 알약 탭 → 그 학년의 학기 카드가 순서대로. 현재 학기 카드만 강의를 추가하고 예상 등급을 넣을 수 있다.
// 저장 데이터(학년도+학기)는 그대로 두고 화면에서만 gradeYearOf()로 학년을 묶는다.
import { useMemo, useState } from 'react';
import { useStore } from '../../app/store';
import { calculateScenario, computeGpa, effectiveCourses, formatGpa, type GpaResult } from '../../domain/gpa/gpa';
import { gradeTermLabel, gradeYearOf, semesterOrder } from '../../domain/gradeYear';
import { LETTER_GRADES } from '../../domain/grades';
import { gradeCourses, latestSnapshot } from '../../domain/state';
import { formatUnits, sameTerm, termKey } from '../../domain/terms';
import type { Course, Grade, GradeScenario, ScenarioEntry, Term } from '../../domain/types';

const YEARS = [1, 2, 3, 4] as const;
const gpaNum = (g: GpaResult) => (g.hundredths === null ? '—' : formatGpa(g.hundredths));
const sumUnits = (list: Course[]) => list.reduce((s, c) => s + c.creditUnits, 0);
const gradeText = (c: Course) => c.grade ?? (c.recordKind === 'recognizedCredit' ? '인정' : '—');

export function CalculatorScreen() {
  const { state, save, openEditor } = useStore();
  const profile = state.profile!;
  const term = profile.currentTerm;
  const currentYear = gradeYearOf(term, profile);
  const [yearSel, setYearSel] = useState<number>(currentYear);

  const scenarioId = `scn-${termKey(term)}`;
  const scenario = state.scenarios.find((s) => s.id === scenarioId) ?? null;
  const snap = latestSnapshot(state);
  // 상세 성적 없이 요약 평점만 있으면 '요약값 기반 추정'
  const summary = snap?.source === 'summaryInput' ? snap.reportedGpa : undefined;
  const courses = useMemo(() => gradeCourses(state.courses), [state.courses]); // 시간표에서 만든 과목은 학점 계산에 넣지 않는다
  const r = useMemo(() => calculateScenario(courses, scenario, summary), [courses, scenario, summary]);
  const base = r.baseline;
  const hasScenario = !!scenario?.entries.some((e) => e.expectedGrade);

  const setGrade = (courseId: string, expectedGrade: Grade) => save((s) => {
    const cur: GradeScenario = s.scenarios.find((x) => x.id === scenarioId) ?? { id: scenarioId, term, baselineSnapshotId: snap?.id ?? 'none', entries: [] };
    const old = cur.entries.find((e) => e.courseId === courseId) ?? { courseId, expectedGrade: null };
    const next: ScenarioEntry = { ...old, expectedGrade };
    const entries = [...cur.entries.filter((e) => e.courseId !== courseId), ...(next.expectedGrade || next.replacesCourseId ? [next] : [])];
    return { ...s, scenarios: [...s.scenarios.filter((x) => x.id !== scenarioId), { ...cur, entries }] };
  });

  // 이번 학기 과목 / 지난 학기(성적이 확정된 과목)
  const currentCourses = courses.filter((c) => sameTerm(c.term, term));
  const pastByTerm = useMemo(() => {
    const m = new Map<string, { term: Term; list: Course[] }>();
    for (const c of effectiveCourses(courses)) {
      if (sameTerm(c.term, term) || !(c.status === 'completed' || c.status === 'notEarned')) continue;
      const k = termKey(c.term);
      if (!m.has(k)) m.set(k, { term: c.term, list: [] });
      m.get(k)!.list.push(c);
    }
    return [...m.values()];
  }, [courses, term]);

  const showCurrent = currentYear === yearSel;
  const pastInYear = pastByTerm.filter((g) => gradeYearOf(g.term, profile) === yearSel)
    // 현재 학년은 최근 학기부터("지난 학기"), 지난 학년은 1학기 → 2학기 순서
    .sort((a, b) => (showCurrent ? semesterOrder(b.term) - semesterOrder(a.term) : semesterOrder(a.term) - semesterOrder(b.term)));

  return (
    <div className="page">
      <h1 className="page-title">학점 계산</h1>
      <p className="page-lead">지금까지 받은 학점 상세내역을 확인할 수 있어요.<br />예상 학점을 입력하면 총 학점을 미리 계산할 수 있어요.</p>

      <div className="gpa-cards" style={{ marginTop: 24 }}>
        <section className="gpa-card light" aria-label="현재 누적 평점">
          <p className="gpa-label">현재 누적 평점</p>
          <p className="gpa-num">{gpaNum(base.gpa)}</p>
          <p className="gpa-sub">{base.gpa.estimated ? '요약값 기반 추정' : '4.5점 만점'}</p>
        </section>
        <section className="gpa-card dark" aria-label="예상 누적 평점">
          <p className="gpa-label">예상 누적 평점</p>
          <p className="gpa-num">{hasScenario ? gpaNum(r.projected.gpa) : '—'}</p>
          <p className="gpa-sub">기존 취득학점 {formatUnits(base.earned)}학점</p>
        </section>
      </div>

      <div className="pill-tabs" role="group" aria-label="학년 선택" style={{ marginTop: 24 }}>
        {YEARS.map((y) => (
          <button key={y} type="button" aria-pressed={yearSel === y} onClick={() => setYearSel(y)}>{y}학년</button>
        ))}
      </div>

      <div className="stack" style={{ marginTop: 22 }}>
        {showCurrent && (
          <div>
            <section className="term-card current" aria-label={gradeTermLabel(term, profile)}>
              <div className="term-head">
                <span>{gradeTermLabel(term, profile)}</span>
                <span>{hasScenario ? gpaNum(r.termGpa) : '-'}</span>
              </div>
              {currentCourses.map((c) => {
                const open = c.status === 'inProgress' || c.status === 'planned';
                return (
                  <div key={c.id} className="term-row">
                    <button type="button" className="name-btn" onClick={() => openEditor({ courseId: c.id })}>
                      {c.name}<span className="units">({formatUnits(c.creditUnits)}학점)</span>
                    </button>
                    {open ? (
                      <select className="grade-select" aria-label={`${c.name} 예상 등급`}
                        value={scenario?.entries.find((e) => e.courseId === c.id)?.expectedGrade ?? ''}
                        onChange={(e) => setGrade(c.id, (e.target.value || null) as Grade)}>
                        <option value="">-</option>
                        {LETTER_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    ) : <span className="grade">{gradeText(c)}</span>}
                  </div>
                );
              })}
              <button type="button" className="term-add" onClick={() => openEditor({ preset: { status: 'inProgress', term } })}>
                <i className="icon ic-plus" aria-hidden="true" />강의 정보 추가하기
              </button>
              <div className="term-foot">{currentCourses.length ? `총 ${formatUnits(sumUnits(currentCourses))}학점` : '총 - 학점'}</div>
            </section>
            {currentCourses.length === 0 && <p className="term-hint">현재 이수 중인 강의 정보를 추가하고 예상 학점을 계산해보세요!</p>}
          </div>
        )}

        {showCurrent && pastInYear.length > 0 && <p className="divider-label">지난 학기</p>}

        {pastInYear.map((g) => <PastTerm key={termKey(g.term)} term={g.term} list={g.list} />)}

        {!showCurrent && pastInYear.length === 0 && <p className="st-empty">이 학년에 저장된 학기가 없어요.</p>}
      </div>
    </div>
  );
}

function PastTerm({ term, list }: { term: Term; list: Course[] }) {
  const { state, openEditor } = useStore();
  const g = computeGpa(list);
  const earned = list.filter((c) => c.earnedInclusion === 'included');
  return (
    <section className="term-card" aria-label={gradeTermLabel(term, state.profile!)}>
      <div className="term-head">
        <span>{gradeTermLabel(term, state.profile!)}</span>
        <span>{g.hundredths === null ? '-' : formatGpa(g.hundredths)}</span>
      </div>
      {list.map((c) => (
        <button key={c.id} type="button" className="term-row" onClick={() => openEditor({ courseId: c.id })}>
          <span>{c.name}<span className="units">({formatUnits(c.creditUnits)}학점)</span></span>
          <span className="grade">{gradeText(c)}</span>
        </button>
      ))}
      <div className="term-foot">총 {formatUnits(sumUnits(earned))}학점</div>
    </section>
  );
}
