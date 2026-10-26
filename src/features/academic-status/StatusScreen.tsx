// 학사현황 (§3.4). 피그마 순서: 내 조건 → 전체 진행 → 영역별 → 필수과목 → 전공별 시험·인증 → 공통요건.
import { useMemo, useState } from 'react';
import { useStore } from '../../app/store';
import { catalog, departmentById, departmentName } from '../../data';
import { formatGpa, graduationGpa } from '../../domain/gpa/gpa';
import { evaluateCourseRules } from '../../domain/requirements/officialRules';
import { evaluateProgress, type ReqStatus } from '../../domain/requirements/resolve';
import { latestSnapshot } from '../../domain/state';
import { compareTerms, formatUnits, termKey, termLabel } from '../../domain/terms';
import type { BundleScope, CertificationRequirement, Course } from '../../domain/types';
import { ProfileForm } from '../profile/ProfileForm';
import { AREA_LABEL, Bar, CAMPUS_LABEL, ENTRY_LABEL, PROGRAM_LABEL, Sheet, STATUS_LABEL } from '../common';
import { CourseRulesBlock, CoverageCard, QuestionsCard, RuleItemsCard } from './OfficialSections';

const STATUS_TEXT: Record<ReqStatus, string> = { met: '충족', unmet: '미충족', insufficient: '판단 자료 부족', notApplicable: '기준 없음' };
const SCOPE_TITLE: Record<BundleScope, string> = { common: '학교 공통', program: '전공 구성', primary: '주전공', secondary: '두 번째 전공' };

export function StatusScreen() {
  const { state, save, setView, mode, resolved, report, openEditor, now } = useStore();
  const [editProfile, setEditProfile] = useState(false);
  const profile = state.profile!;
  const snap = latestSnapshot(state);
  const gpa = graduationGpa(state.courses, snap);
  const progress = useMemo(() => evaluateProgress(resolved, state.courses, snap, catalog.equivalences), [resolved, state.courses, snap]);
  // 공식 필수과목 식: 기존 필수 묶음에서 이미 쓴 과목은 다시 쓰지 않는다 (중복 인정은 규정에 명시된 경우만)
  const courseProgress = useMemo(() => (report
    ? evaluateCourseRules(report, state.courses, snap, {
      alreadyUsed: resolved?.allowCourseReuseAcrossGroups ? [] : progress.groups.flatMap((g) => g.matchedCourseIds),
      dept: departmentById, // 코드 없는 전필을 '개설학과(별칭 포함) + 과목명'으로 대조
      confirmedLeafIds: state.certConfirmations.map((c) => c.requirementId),
    })
    : []), [report, state.courses, snap, resolved, progress, state.certConfirmations]);
  const confirmed = new Set(state.certConfirmations.map((c) => c.requirementId));
  const byId = new Map(state.courses.map((c) => [c.id, c]));
  const inquiryAreas = new Set(report?.evals.filter((e) => e.rule.status === 'conflict' && e.applies === true)
    .flatMap((e) => Object.keys(e.rule.requiredUnitsByArea)));

  const toggleConfirm = (id: string) => save((s) => ({
    ...s,
    certConfirmations: confirmed.has(id)
      ? s.certConfirmations.filter((c) => c.requirementId !== id)
      : [...s.certConfirmations, { requirementId: id, confirmedAt: now.toISOString() }],
  }));

  // 전공 구성과 맞지 않는 학점 반영 영역 → 해당 과목만 재확인 안내
  const hasMinor = profile.programType === 'minor' || (profile.programType === 'intensive' && !!profile.secondaryDepartmentId);
  const programText = profile.programType === 'intensive' && profile.secondaryDepartmentId ? '전공심화 + 부전공' : PROGRAM_LABEL[profile.programType];
  const mismatched = state.courses.filter((c) => (c.area === 'double' && profile.programType !== 'double') || (c.area === 'minor' && !hasMinor));
  const scopeName = (scope: BundleScope) => (scope === 'primary' ? departmentName(profile.primaryDepartmentId)
    : scope === 'secondary' ? departmentName(profile.secondaryDepartmentId) : SCOPE_TITLE[scope]);

  return (
    <div className="screen">
      <p className="eyebrow">{profile.cohortYear}학번 기준</p>
      <h1>내 학사현황</h1>

      <section className="card summary">
        <p className="big">{departmentName(profile.primaryDepartmentId)}{profile.secondaryDepartmentId && <> · {departmentName(profile.secondaryDepartmentId)}</>}</p>
        <p className="muted">{CAMPUS_LABEL[profile.homeCampus]} · {String(profile.cohortYear).slice(2)}학번 · {ENTRY_LABEL[profile.entryType]} · {programText}{profile.currentYear ? ` · ${profile.currentYear}학년` : ''}</p>
        <p className="muted small">마지막 성적 반영: {snap ? new Date(snap.importedAt).toLocaleDateString('ko-KR') : '아직 없음'}</p>
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setEditProfile(true)}>조건 수정</button>
          <button type="button" className="btn ghost" onClick={() => setView('records')}>성적 갱신</button>
        </div>
      </section>

      <ScopeNotice />
      <CoverageCard />
      <QuestionsCard />
      {mismatched.length > 0 && (
        <div className="notice" role="note">
          <p>지금 전공 구성({programText})과 맞지 않는 학점 반영 영역의 과목이 {mismatched.length}개 있어요. 해당 과목만 다시 확인해 주세요.</p>
          <ul className="plain">{mismatched.map((c) => <li key={c.id}><button type="button" className="link" onClick={() => openEditor({ courseId: c.id })}>{c.name} ({AREA_LABEL[c.area]})</button></li>)}</ul>
        </div>
      )}

      <section className="card hero" aria-labelledby="total-title">
        <h2 id="total-title" className="h3">전체 이수 진행</h2>
        {!progress.hasRecords ? (
          <>
            <p>성적을 입력하면 취득학점이 표시돼요.{progress.total.required !== null && <> 졸업 기준은 {formatUnits(progress.total.required)}학점이에요.</>}</p>
            <button type="button" className="btn light" onClick={() => setView('records')}>성적 입력하기</button>
          </>
        ) : (
          <>
            <p className="hero-num"><b>{formatUnits(progress.total.earned)}</b>학점 취득
              {progress.total.required !== null && <> / 필요 {formatUnits(progress.total.required)}학점</>}</p>
            {progress.total.required !== null && <Bar value={progress.total.earned} max={progress.total.required} label="전체 이수 진행률" />}
            {progress.total.remaining !== null && <p>{progress.total.remaining > 0 ? `남은 학점 ${formatUnits(progress.total.remaining)}학점` : '총학점 기준 충족 (영역별 기준은 따로 확인해요)'}</p>}
            {progress.basis === 'reportedTotals' && <p className="small">종정시 하단 합계 기준이에요. 과목 목록이 불완전해 필수과목 판단이 제한돼요.</p>}
          </>
        )}
      </section>

      {progress.areas.length > 0 && (
        <section className="card" aria-labelledby="area-title">
          <h2 id="area-title" className="h3">영역별 이수학점</h2>
          <ul className="areas">
            {progress.areas.map((a) => (
              <li key={a.area}>
                <div className="row-between">
                  <span>{AREA_LABEL[a.area]}</span>
                  <span>{formatUnits(a.earned)}{a.required !== undefined && ` / ${formatUnits(a.required)}`}학점</span>
                </div>
                {a.required !== undefined && <Bar value={a.earned} max={a.required} label={`${AREA_LABEL[a.area]} 진행률`} />}
                {a.required !== undefined && <p className={`small ${inquiryAreas.has(a.area) ? 'muted' : a.status}`}>
                  {inquiryAreas.has(a.area) ? `확인 중인 기준 ${formatUnits(a.required)}학점` : a.status === 'met' ? '충족' : `${formatUnits(a.shortfall!)}학점 부족`}
                </p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="req-title">
        <h2 id="req-title" className="h3">전공별 필수과목</h2>
        {progress.groups.length === 0 && courseProgress.length === 0 && <p className="muted small">지금 계산할 수 있는 필수과목 목록이 없어요. 이유는 위 ‘졸업요건 판정 범위’에서 확인하세요.</p>}
        {(['primary', 'secondary', 'program', 'common'] as BundleScope[]).map((scope) => {
          const groups = progress.groups.filter((g) => g.scope === scope);
          if (!groups.length) return null;
          // 공식 매칭과 학생이 직접 체크한 줄을 함께 '이수(✓)'로 센다. 학점은 공식 매칭분만 더한다.
          const isDone = (g: typeof groups[number]) => g.status === 'met' || confirmed.has(g.group.id);
          const met = groups.filter(isDone);
          return (
            <div key={scope} className="req-block">
              <p className="row-between"><b>{scopeName(scope)}</b><span className="small">{met.length} / {groups.length} 충족 · {formatUnits(groups.filter((g) => g.status === 'met').reduce((s, g) => s + g.matchedUnits, 0))}학점</span></p>
              <ul className="plain">
                {groups.map((g) => {
                  const done = isDone(g);
                  const selfChecked = g.status !== 'met' && confirmed.has(g.group.id);
                  return (
                    <li key={g.group.id} className={`req ${done ? 'met' : ''}`}>
                      <span aria-hidden="true">{done ? '✓' : '○'}</span>
                      <span className="name">{g.group.title}</span>
                      {g.status !== 'met' && (
                        <button type="button" className="btn small self-check" aria-pressed={selfChecked}
                          aria-label={`${g.group.title} 직접 체크`} onClick={() => toggleConfirm(g.group.id)}>직접 체크</button>
                      )}
                      <span className="small">{done ? '이수' : STATUS_TEXT[g.status]}
                        {selfChecked && <span className="contact-checked"> · 내가 체크</span>}
                        {g.matchedCourseIds.length > 0 && ` · ${g.matchedCourseIds.map((id) => byId.get(id)?.name).join(', ')}`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <CourseRulesBlock progress={courseProgress} courses={state.courses} />
        <button type="button" className="btn ghost block" onClick={() => openEditor({ preset: { status: 'completed', term: profile.currentTerm } })}>과목 추가·수정</button>
      </section>

      {resolved && resolved.certifications.length > 0 && (
        <section className="card" aria-labelledby="cert-title">
          <h2 id="cert-title" className="h3">전공별 졸업시험·인증</h2>
          {resolved.certifications.map(({ scope, cert }) => (
            <CertCard key={cert.id} scope={scopeName(scope)} cert={cert} confirmed={confirmed.has(cert.id)} onToggle={() => toggleConfirm(cert.id)} />
          ))}
        </section>
      )}

      <RuleItemsCard />

      {resolved && resolved.commonRequirements.length > 0 && (
        <section className="card" aria-labelledby="common-title">
          <h2 id="common-title" className="h3">학교 공통 요건</h2>
          <ul className="plain">
            {resolved.commonRequirements.map((r) => (
              <li key={r.id} className="req-block">
                <p><b>{r.title}</b></p>
                <p className="small">{r.description}</p>
                {/\:gpa$/.test(r.id) ? (
                  <p className={`small ${gpa.status}`}>계산 평점 {formatGpa(gpa.hundredths)} / 기준 2.00 · {gpa.status === 'met' ? '충족' : gpa.status === 'unmet' ? '미충족' : '판단 자료 부족'}{gpa.estimated ? ' (요약 평점 기준)' : ''}</p>
                ) : r.checkMethod === 'studentConfirm' && (
                  <label className="check"><input type="checkbox" checked={confirmed.has(r.id)} onChange={() => toggleConfirm(r.id)} /> 충족했다고 직접 확인 (학생 확인)</label>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <QuestionsCard defaults />
      <MyCourses courses={state.courses} />

      {mode === 'demo' && <p className="muted small">가상 데이터의 수치는 예시이며 공식 학교 기준이 아니에요.</p>}
      <button type="button" className="btn primary block" onClick={() => setView('calculator')}>학점 계산으로 이동 →</button>

      {editProfile && (
        <Sheet title="학생 조건 수정" onClose={() => setEditProfile(false)}>
          <p className="muted small">조건을 바꿔도 성적·평가 기록은 지워지지 않아요. 졸업 기준만 다시 계산해요.</p>
          <ProfileForm submitLabel="저장" onDone={() => setEditProfile(false)} />
        </Sheet>
      )}
    </div>
  );
}

function ScopeNotice() {
  const { mode, resolved, report } = useStore();
  let text = '';
  if (mode === 'demo') text = '가상 데이터로 보는 시안이에요. 졸업 기준·과목·성적은 모두 예시예요.';
  else if (report) text = ''; // 실제 모드: 아래 '졸업요건 판정 범위'에서 한 번에 안내
  else if (!resolved) text = '현재 선택 조건의 졸업 기준이 아직 제공되지 않아요. 취득학점·과목 관리·시간표·계산기는 그대로 쓸 수 있고, 필요·부족 학점은 비워 둬요.';
  else if (resolved.missingScopes.length || resolved.conflicts.length) {
    text = [
      resolved.missingScopes.length ? `${resolved.missingScopes.map((s) => SCOPE_TITLE[s]).join('·')} 기준은 아직 제공되지 않아요.` : '',
      resolved.conflicts.length ? `규정 값이 서로 달라 판단을 보류한 항목: ${resolved.conflicts.join(', ')}.` : '',
    ].join(' ');
  }
  if (!text) return null;
  return <div className="notice" role="note"><p>{text}</p></div>;
}

function CertCard({ scope, cert, confirmed, onToggle }: { scope: string; cert: CertificationRequirement; confirmed: boolean; onToggle: () => void }) {
  return (
    <div className="req-block">
      <p className="row-between"><span className="chip">{scope}</span><span className={`small ${confirmed ? 'met' : ''}`}>{confirmed ? '통과 확인 (학생 확인)' : '확인 전'}</span></p>
      <p><b>{cert.title}</b></p>
      {cert.kind === 'departmentExam' && (
        <>
          <p className="small">통과 기준: {cert.passCriteria}</p>
          {cert.publicExamInfo?.areas && <p className="small">공개 시험 영역: {cert.publicExamInfo.areas.join(', ')}</p>}
          {cert.publicExamInfo?.format && <p className="small">형식: {cert.publicExamInfo.format}</p>}
          {cert.publicExamInfo?.level && <p className="small">수준: {cert.publicExamInfo.level}</p>}
          {cert.alternatives.length > 0 && <p className="small">대체 경로: {cert.alternatives.join(' / ')}</p>}
        </>
      )}
      {cert.kind === 'externalCertificate' && (
        <ul className="plain small">{cert.acceptedTests.map((t) => <li key={t.name}>{t.name}: {t.passCriteria}</li>)}</ul>
      )}
      {cert.kind === 'other' && <p className="small">{cert.description}</p>}
      {cert.kind !== 'other' && cert.exemptions.length > 0 && <p className="small">면제: {cert.exemptions.join(' / ')}</p>}
      <label className="check"><input type="checkbox" checked={confirmed} onChange={onToggle} /> 통과했다고 직접 확인</label>
    </div>
  );
}

function MyCourses({ courses }: { courses: Course[] }) {
  const { openEditor, state } = useStore();
  const groups = useMemo(() => {
    const m = new Map<string, Course[]>();
    for (const c of [...courses].sort((a, b) => compareTerms(b.term, a.term))) {
      const k = termKey(c.term);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return [...m.values()];
  }, [courses]);
  return (
    <section className="card" aria-labelledby="mine-title">
      <div className="row-between">
        <h2 id="mine-title" className="h3">내 과목 {courses.length}개</h2>
        <button type="button" className="btn small" onClick={() => openEditor({ preset: { status: 'inProgress', term: state.profile!.currentTerm } })}>과목 추가</button>
      </div>
      {groups.map((list) => (
        <details key={termKey(list[0].term)}>
          <summary>{termLabel(list[0].term)} · {list.length}과목</summary>
          <ul className="course-list">
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" className="course-row" onClick={() => openEditor({ courseId: c.id })}>
                  <span className="name">{c.name}</span>
                  <span className="small muted">{AREA_LABEL[c.area]} · {formatUnits(c.creditUnits)}학점 · {c.status === 'completed' ? c.grade ?? (c.recordKind === 'recognizedCredit' ? '인정' : '성적 모름') : STATUS_LABEL[c.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
