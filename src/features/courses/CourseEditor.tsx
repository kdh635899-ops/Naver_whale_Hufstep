// 공유 과목 편집기 (§3.5). 학사현황·학점계산·평가일정이 모두 이 편집기와 같은 Course ID를 쓴다.
import { useState } from 'react';
import { useStore } from '../../app/store';
import { catalog, departmentName } from '../../data';
import { deriveInclusion, LETTER_GRADES } from '../../domain/grades';
import { dropCourseRefs, MERGE_FIELDS } from '../../domain/merge/mergeImport';
import { linkableLeaves } from '../../domain/requirements/officialRules';
import { newId } from '../../domain/state';
import { formatUnits, toUnits } from '../../domain/terms';
import type { Course, CourseStatus, CreditArea, Grade, Term } from '../../domain/types';
import { courseSchema, firstIssue } from '../../domain/validation/schemas';
import { AREA_LABEL, ConfirmButton, ConsentGate, Sheet, STATUS_LABEL } from '../common';

const SEMESTERS: [Term['semester'], string][] = [['1', '1학기'], ['2', '2학기'], ['summer', '여름 계절'], ['winter', '겨울 계절']];
const MODES: [Course['gradingMode'], string][] = [['graded', '일반 등급'], ['passFail', 'P/F'], ['ungradedCredit', '등급 없는 인정학점'], ['unknown', '모름']];

export function CourseEditor() {
  const { state, save, editor, openEditor, now, report } = useStore();
  const existing = state.courses.find((c) => c.id === editor?.courseId);
  const init: Partial<Course> = existing ?? editor?.preset ?? {};
  const [name, setName] = useState(init.name ?? '');
  const [year, setYear] = useState(String(init.term?.academicYear ?? state.profile?.currentTerm.academicYear ?? now.getFullYear()));
  const [sem, setSem] = useState<Term['semester']>(init.term?.semester ?? state.profile?.currentTerm.semester ?? '1');
  const [credits, setCredits] = useState(init.creditUnits ? formatUnits(init.creditUnits) : '');
  const [area, setArea] = useState<CreditArea>(init.area ?? 'primary');
  const [status, setStatus] = useState<CourseStatus>(init.status ?? 'inProgress');
  const [grade, setGrade] = useState<Grade>(init.grade ?? null);
  const [mode, setMode] = useState<Course['gradingMode']>(init.gradingMode ?? 'graded');
  const [required, setRequired] = useState(init.requiredClaim === 'studentMarked');
  const [code, setCode] = useState(init.officialCode ?? '');
  const [link, setLink] = useState(init.requirementLinks?.[0] ?? '');
  const leaves = linkableLeaves(report, departmentName);
  const [error, setError] = useState('');
  const close = () => openEditor(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = Number(credits);
    if (!credits || !Number.isFinite(c) || c <= 0) return setError('학점은 0보다 큰 숫자로 입력해 주세요 (예: 3, 1.5)');
    const recordKind = mode === 'ungradedCredit' ? 'recognizedCredit' : 'course';
    if (recordKind === 'course' && toUnits(c) > catalog.policy.maxCreditUnitsPerCourse) {
      return setError(`한 과목 학점은 ${catalog.policy.maxCreditUnitsPerCourse / 100}학점 이하로 입력해 주세요`);
    }
    const g = status === 'completed' || status === 'notEarned' ? grade : null;
    const draft: Course = {
      id: existing?.id ?? newId('course'),
      officialCode: code.trim() || undefined, // 모르면 비워 둔다 (가짜 코드 생성 금지)
      name: name.trim(),
      term: { academicYear: Number(year), semester: sem },
      creditUnits: toUnits(c),
      area, status, grade: g, gradingMode: mode, recordKind,
      rawAreaLabel: existing?.rawAreaLabel,
      offeringDepartmentName: existing?.offeringDepartmentName,
      recognizedDepartmentId: existing?.recognizedDepartmentId,
      origin: existing?.origin ?? 'manual',
      requiredClaim: existing?.requiredClaim === 'officialMatched' ? 'officialMatched' : required ? 'studentMarked' : 'none',
      ...(link && { requirementLinks: [link] }), // 학생 확인으로만 표시되고 공식 기준·학점은 바뀌지 않는다
      replacesCourseId: existing?.replacesCourseId,
      sourceSnapshotId: existing?.sourceSnapshotId,
      sourceRowKey: existing?.sourceRowKey,
      overriddenFields: existing?.overriddenFields ?? [],
      updatedAt: now.toISOString(),
      gpaInclusion: 'unresolved', earnedInclusion: 'unresolved',
    };
    Object.assign(draft, deriveInclusion(draft));
    // 가져온 과목을 직접 고쳤다면, 다음 재붙여넣기 때 덮어쓰기 전에 확인하도록 표시
    if (existing?.sourceRowKey) {
      const changed = MERGE_FIELDS.filter((f) => (existing[f] ?? undefined) !== (draft[f] ?? undefined));
      draft.overriddenFields = [...new Set([...draft.overriddenFields, ...changed])];
    }
    const r = courseSchema.safeParse(draft);
    if (!r.success) return setError(firstIssue(r.error));
    const ok = await save((s) => ({
      ...s,
      courses: existing ? s.courses.map((x) => (x.id === draft.id ? r.data : x)) : [...s.courses, r.data],
    }));
    if (ok) close();
  }

  async function remove() {
    if (!existing) return;
    const ok = await save((s) => ({
      ...s,
      ...dropCourseRefs(s, new Set([existing.id])),
      courses: s.courses.filter((x) => x.id !== existing.id)
        .map((x) => (x.replacesCourseId === existing.id ? { ...x, replacesCourseId: undefined } : x)),
    }));
    if (ok) close();
  }

  const showGrade = status === 'completed' || status === 'notEarned';
  return (
    <Sheet title={existing ? '과목 수정' : '과목 추가'} onClose={close}>
      <ConsentGate>
        <form className="form" onSubmit={submit} noValidate>
          <label>과목명 <span className="req">필수</span>
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required />
          </label>
          <div className="row2">
            <label>학년도
              <input type="number" inputMode="numeric" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
            </label>
            <label>학기
              <select value={sem} onChange={(e) => setSem(e.target.value as Term['semester'])}>
                {SEMESTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <div className="row2">
            <label>학점 <span className="req">필수</span>
              <input type="number" inputMode="decimal" step="0.5" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} />
            </label>
            <label>학점 반영 영역
              <select value={area} onChange={(e) => setArea(e.target.value as CreditArea)}>
                {Object.entries(AREA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <label>상태
            <select value={status} onChange={(e) => setStatus(e.target.value as CourseStatus)}>
              {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {showGrade && (
            <div className="row2">
              <label>성적
                <select value={grade ?? ''} onChange={(e) => setGrade((e.target.value || null) as Grade)}>
                  <option value="">모름 (평점 계산 보류)</option>
                  {LETTER_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label>성적 방식
                <select value={mode} onChange={(e) => setMode(e.target.value as Course['gradingMode'])}>
                  {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
          )}
          {!showGrade && <p className="muted small">수강 예정·수강 중 과목은 취득학점에 더하지 않아요. 학기가 끝나면 ‘이수 완료’로 바꾸거나 새 성적을 붙여넣어 주세요.</p>}
          <label>공식 과목 코드 (선택)
            <input value={code} maxLength={30} onChange={(e) => setCode(e.target.value)} placeholder="모르면 비워 두세요" />
          </label>
          {existing?.requiredClaim === 'officialMatched'
            ? <p className="muted small">공식 규칙으로 필수과목에 매칭된 과목이에요.</p>
            : (
              <label className="check">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                전공필수로 표시 (학생 확인 · 학점이 따로 더해지지 않아요)
              </label>
            )}
          {(leaves.length > 0 || link) && (
            <label>필수과목 요건에 직접 연결 (선택 · 학생 확인)
              <select value={link} onChange={(e) => setLink(e.target.value)}>
                <option value="">연결 안 함</option>
                {link && !leaves.some((l) => l.leaf.id === link) && <option value={link}>현재 조건에 없는 요건 (연결 유지)</option>}
                {leaves.map(({ leaf, ruleTitle }) => (
                  <option key={leaf.id} value={leaf.id}>{leaf.name}{leaf.code ? ` (${leaf.code})` : ''} — {ruleTitle.slice(0, 40)}</option>
                ))}
              </select>
              <span className="muted small">과목 코드가 맞으면 자동으로 매칭돼요. 코드가 없거나 다를 때만 직접 연결하고, 화면에는 ‘학생 연결’로 따로 표시돼요.</span>
            </label>
          )}
          {existing?.sourceRowKey && <p className="muted small">종정시에서 가져온 과목이에요. 직접 고친 항목은 다음 붙여넣기 때 덮어쓰기 전에 확인해요.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="btn ghost" onClick={close}>취소</button>
            <button type="submit" className="btn primary">저장</button>
          </div>
          {existing && (
            <ConfirmButton label="과목 삭제" className="btn danger-ghost"
              confirmText="이 과목과 연결된 평가일정·예상 성적도 함께 지워져요." onConfirm={remove} />
          )}
        </form>
      </ConsentGate>
    </Sheet>
  );
}
