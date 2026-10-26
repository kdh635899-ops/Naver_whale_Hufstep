// 학점계산 (§3.7, §7). 예상 성적은 시나리오에만 저장하고 실제 이수 현황은 바꾸지 않는다.
import { useMemo } from 'react';
import { useStore } from '../../app/store';
import { calculateScenario, computeGpa, effectiveCourses, formatGpa, type GpaResult } from '../../domain/gpa/gpa';
import { LETTER_GRADES } from '../../domain/grades';
import { latestSnapshot } from '../../domain/state';
import { compareTerms, formatUnits, sameTerm, termKey, termLabel } from '../../domain/terms';
import type { Course, Grade, GradeScenario, ScenarioEntry } from '../../domain/types';
import { AREA_LABEL, STATUS_LABEL } from '../common';

const gpaText = (g: GpaResult) => (g.hundredths === null ? '계산 대상 성적 없음' : formatGpa(g.hundredths));

export function CalculatorScreen() {
  const { state, save, openEditor } = useStore();
  const term = state.profile!.currentTerm;
  const scenarioId = `scn-${termKey(term)}`;
  const scenario = state.scenarios.find((s) => s.id === scenarioId) ?? null;
  const snap = latestSnapshot(state);
  // 상세 성적 없이 요약 평점만 있으면 '요약값 기반 추정'
  const summary = snap?.source === 'summaryInput' ? snap.reportedGpa : undefined;
  const r = useMemo(() => calculateScenario(state.courses, scenario, summary), [state.courses, scenario, summary]);

  const currentCourses = state.courses.filter((c) => sameTerm(c.term, term) && (c.status === 'inProgress' || c.status === 'planned'));
  const retakeTargets = effectiveCourses(state.courses).filter((c) => !sameTerm(c.term, term) && c.status === 'completed'
    && c.recordKind === 'course' && c.gpaInclusion !== 'excluded');
  const entry = (courseId: string) => scenario?.entries.find((e) => e.courseId === courseId);
  const errorFor = (courseId: string) => r.errors.find((e) => e.courseId === courseId)?.message;

  const setEntry = (courseId: string, patch: Partial<ScenarioEntry>) => save((s) => {
    const cur: GradeScenario = s.scenarios.find((x) => x.id === scenarioId) ?? { id: scenarioId, term, baselineSnapshotId: snap?.id ?? 'none', entries: [] };
    const old = cur.entries.find((e) => e.courseId === courseId) ?? { courseId, expectedGrade: null };
    const next = { ...old, ...patch };
    const entries = [...cur.entries.filter((e) => e.courseId !== courseId), ...(next.expectedGrade || next.replacesCourseId ? [next] : [])];
    return { ...s, scenarios: [...s.scenarios.filter((x) => x.id !== scenarioId), { ...cur, entries }] };
  });
  const clearScenario = () => save((s) => ({ ...s, scenarios: s.scenarios.filter((x) => x.id !== scenarioId) }));

  const pastTerms = useMemo(() => {
    const eff = effectiveCourses(state.courses).filter((c) => c.status === 'completed' || c.status === 'notEarned');
    const m = new Map<string, Course[]>();
    for (const c of eff.sort((a, b) => compareTerms(b.term, a.term))) {
      if (!m.has(termKey(c.term))) m.set(termKey(c.term), []);
      m.get(termKey(c.term))!.push(c);
    }
    return [...m.values()];
  }, [state.courses]);

  const base = r.baseline;
  const delta = r.projected.earned - base.earned;
  const hasScenario = !!scenario?.entries.some((e) => e.expectedGrade);
  return (
    <div className="screen">
      <p className="eyebrow">학점 시뮬레이션</p>
      <h1>학점 계산</h1>
      <p className="lead">이번 학기 예상 성적을 넣어 누적 평점이 어떻게 바뀌는지 확인해요. 실제 이수 현황은 바뀌지 않아요.</p>

      <div className="two">
        <section className="card stat">
          <p className="small muted">현재 누적 평점</p>
          <p className="num">{gpaText(base.gpa)}</p>
          <p className="small muted">{base.gpa.estimated ? '요약값 기반 추정' : '4.5점 만점'}</p>
        </section>
        <section className="card stat dark">
          <p className="small">예상 누적 평점</p>
          <p className="num">{hasScenario ? gpaText(r.projected.gpa) : '—'}</p>
          <p className="small">{hasScenario ? `취득학점 ${delta >= 0 ? '+' : ''}${formatUnits(delta)}학점` : '예상 성적을 넣어 보세요'}</p>
        </section>
      </div>
      <dl className="stats card">
        <div><dt>주전공 평점</dt><dd>{gpaText(base.majorGpa)}</dd></div>
        <div><dt>GPA 대상 학점</dt><dd>{formatUnits(base.gpa.creditUnits)}</dd></div>
        <div><dt>총 취득학점</dt><dd>{formatUnits(base.earned)}</dd></div>
      </dl>

      <section className="card accent" aria-labelledby="now-title">
        <p className="small"><span className="chip">현재 학기</span> {termLabel(term)}</p>
        <h2 id="now-title" className="h3">이번 학기 예상 성적</h2>
        {currentCourses.length === 0 && <p className="muted small">이번 학기 수강 중인 과목이 없어요. 과목을 추가해 주세요.</p>}
        <ul className="calc-list">
          {currentCourses.map((c) => {
            const e = entry(c.id);
            const usedElsewhere = new Set(scenario?.entries.filter((x) => x.courseId !== c.id && x.replacesCourseId).map((x) => x.replacesCourseId));
            const picked = e?.replacesCourseId ?? c.replacesCourseId ?? '';
            return (
              <li key={c.id}>
                <div className="row-between">
                  <span className="name">{c.name}</span>
                  <span className="small muted">{formatUnits(c.creditUnits)}학점</span>
                </div>
                <div className="row2">
                  <label>예상 등급
                    <select value={e?.expectedGrade ?? ''} onChange={(x) => setEntry(c.id, { expectedGrade: (x.target.value || null) as Grade })}>
                      <option value="">미입력</option>
                      {LETTER_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>
                  <label>재수강이면 기존 기록
                    <select value={picked} onChange={(x) => setEntry(c.id, { replacesCourseId: x.target.value || undefined })}>
                      <option value="">재수강 아님</option>
                      {/* 과목 수정에서 지정한 기록은 이미 계산에서 빠져 목록에 없으므로 따로 보여 준다 */}
                      {picked && !retakeTargets.some((t) => t.id === picked) && (
                        <option value={picked}>{state.courses.find((t) => t.id === picked)?.name ?? '이전 기록'} (과목 수정에서 지정)</option>
                      )}
                      {retakeTargets.filter((t) => !usedElsewhere.has(t.id)).map((t) => (
                        <option key={t.id} value={t.id}>{t.name} ({termLabel(t.term)} {t.grade ?? '?'})</option>
                      ))}
                    </select>
                  </label>
                </div>
                {errorFor(c.id) && <p className="error small" role="alert">{errorFor(c.id)}</p>}
              </li>
            );
          })}
        </ul>
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => openEditor({ preset: { status: 'inProgress', term } })}>과목 추가</button>
          {scenario && <button type="button" className="btn ghost" onClick={clearScenario}>시나리오 삭제</button>}
        </div>
        {hasScenario && (
          <dl className="stats">
            <div><dt>이번 학기 예상 평점</dt><dd>{gpaText(r.termGpa)}</dd></div>
            <div><dt>예상 누적 평점</dt><dd>{gpaText(r.projected.gpa)}</dd></div>
            <div><dt>예상 취득학점</dt><dd>{formatUnits(r.projected.earned)} ({delta >= 0 ? '+' : ''}{formatUnits(delta)})</dd></div>
          </dl>
        )}
        <details>
          <summary>계산 근거 보기</summary>
          <ul className="plain small">
            <li>평점 = 절사(Σ학점×등급점수 ÷ GPA 대상 학점), 소수 셋째자리 이하 버림</li>
            <li>현재: {(base.gpa.points / 10000).toFixed(2)} ÷ {formatUnits(base.gpa.creditUnits)} → {gpaText(base.gpa)}</li>
            {hasScenario && <li>예상: {(r.projected.gpa.points / 10000).toFixed(2)} ÷ {formatUnits(r.projected.gpa.creditUnits)} → {gpaText(r.projected.gpa)}</li>}
            <li>일반 F는 분모에 포함, P/F 과목·등급 없는 인정학점은 평점에서 제외, 성적 모름은 판단 보류 ({state.courses.filter((c) => c.gpaInclusion === 'unresolved').length}개)</li>
            <li>재수강을 고르면 기존 기록의 학점·점수를 빼고 새 등급으로 다시 계산해요. 같은 기존 과목은 한 번만 대체할 수 있어요.</li>
            {base.gpa.estimated && <li>요약 평점 × GPA 대상 학점으로 복원한 근사치라 실제와 조금 다를 수 있어요.</li>}
          </ul>
        </details>
      </section>

      {pastTerms.length > 0 && <h2 className="h3 divider">지난 학기</h2>}
      {pastTerms.map((list) => {
        const g = computeGpa(list);
        return (
          <section key={termKey(list[0].term)} className="card">
            <div className="row-between">
              <h3 className="h4">{termLabel(list[0].term)}</h3>
              <span className="small">{g.hundredths === null ? '평점 대상 없음' : `학기 평점 ${formatGpa(g.hundredths)}`}</span>
            </div>
            <ul className="course-list">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" className="course-row" onClick={() => openEditor({ courseId: c.id })}>
                    <span className="name">{c.name}</span>
                    <span className="small muted">{AREA_LABEL[c.area]} · {formatUnits(c.creditUnits)}학점 · {c.grade ?? (c.recordKind === 'recognizedCredit' ? '인정' : STATUS_LABEL[c.status])}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn small ghost" onClick={() => openEditor({ preset: { status: 'completed', term: list[0].term } })}>이 학기에 과목 추가</button>
          </section>
        );
      })}
    </div>
  );
}
