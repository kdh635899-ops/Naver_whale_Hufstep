// 공유 과목 편집기 (§3.5). 학사현황·학점계산·시간표가 모두 이 편집기와 같은 Course ID를 쓴다.
import { useMemo, useState } from 'react';
import { useStore } from '../../app/store';
import { catalog, departmentName } from '../../data';
import { deriveInclusion, LETTER_GRADES } from '../../domain/grades';
import { dropCourseRefs, MERGE_FIELDS } from '../../domain/merge/mergeImport';
import { autoLinkTargets, normalizeCourseName } from '../../domain/requirements/officialRules';
import { autoProjectedRetake, initialReplacesCourseId, retakeCandidates } from '../../domain/retake';
import { gradeCourses, newId } from '../../domain/state';
import { formatUnits, termLabel, toUnits } from '../../domain/terms';
import type { Course, CourseStatus, CreditArea, Grade, Term } from '../../domain/types';
import { courseSchema, firstIssue, MAX_COURSE_NAME_LENGTH } from '../../domain/validation/schemas';
import { AREA_LABEL, ConfirmButton, ConsentGate, Sheet, STATUS_LABEL } from '../common';
import { RetakeRecordSelect } from './RetakeRecordSelect';

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
  const [required, setRequired] = useState(init.requiredClaim === 'studentMarked' || !!init.requirementLinks?.length);
  const [code, setCode] = useState(init.officialCode ?? '');
  const [link, setLink] = useState(init.requirementLinks?.[0] ?? '');
  // 성적표에 '재수강' 표시만 있는 과목은 체크를 켠 채로 열고 같은 이름의 이전 기록을 미리 골라 둔다 (저장은 학생이 누를 때만)
  const [replaces, setReplaces] = useState(() => initialReplacesCourseId(gradeCourses(state.courses), state.snapshots, {
    id: existing?.id,
    name: init.name ?? '',
    term: init.term ?? { academicYear: Number(year), semester: sem },
    sourceRowKey: init.sourceRowKey,
    replacesCourseId: init.replacesCourseId,
  }) ?? '');
  const [isRetake, setIsRetake] = useState(init.isRetake ?? !!replaces);
  const timetableOnly = init.origin === 'timetable';
  // 체크 한 번으로 끝내기 위해, 과목명과 이름이 맞는 요건(leaf)을 그때그때 찾는다
  const matches = useMemo(() => [
    ...autoLinkTargets(report, name, departmentName),
    ...(state.statusEdits?.extraCourses ?? []).filter((x) => normalizeCourseName(x.name) === normalizeCourseName(name)
      || init.requirementLinks?.includes(x.id)).map((x) => ({
      leaf: { op: 'course' as const, id: x.id, code: null, name: x.name, creditUnits: null, matching: 'studentConfirmation' as const },
      ruleTitle: '직접 추가한 필수과목',
    })),
  ], [report, name, state.statusEdits, init.requirementLinks]);
  // 과목명을 바꾸면 이전 이름에 연결했던 요건을 저장하지 않는다.
  const autoLinkId = matches.length === 1 ? matches[0].leaf.id : '';
  const effectiveLink = required ? (matches.some((m) => m.leaf.id === link) ? link : autoLinkId) : '';
  const linkedName = matches.find((m) => m.leaf.id === effectiveLink)?.leaf.name;
  const candidates = retakeCandidates(gradeCourses(state.courses), { id: existing?.id, name, term: { academicYear: Number(year), semester: sem } });
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
    if (isRetake && !replaces && !timetableOnly) return setError('대체하는 이전 기록을 골라 주세요');
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
      requirementLinks: existing?.requiredClaim === 'officialMatched' ? existing.requirementLinks
        : effectiveLink ? [effectiveLink] : undefined,
      replacesCourseId: isRetake ? replaces || (timetableOnly ? autoProjectedRetake(state.courses,
        { id: existing?.id, name, officialCode: code, term: { academicYear: Number(year), semester: sem } })?.id : undefined) : undefined,
      isRetake,
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
          <label>과목명
            <input value={name} maxLength={MAX_COURSE_NAME_LENGTH} onChange={(e) => setName(e.target.value)} required />
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
            <label>학점
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
          <label className="check">
            <input type="checkbox" checked={isRetake} onChange={(e) => { setIsRetake(e.target.checked); if (!e.target.checked) setReplaces(''); }} />
            재수강 과목이에요
          </label>
          {isRetake && timetableOnly && <RetakeRecordSelect courses={state.courses}
            subject={{ id: existing?.id, name, officialCode: code, term: { academicYear: Number(year), semester: sem } }}
            selectedId={replaces} onChange={setReplaces} />}
          {isRetake && !timetableOnly && (
            <label>대체하는 이전 기록
              <select value={replaces} onChange={(e) => setReplaces(e.target.value)}>
                <option value="">고르지 않음</option>
                {replaces && !candidates.some((c) => c.id === replaces) && <option value={replaces}>현재 조건에 없는 기록 (선택 유지)</option>}
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({termLabel(c.term)} {c.grade ?? '성적 모름'})</option>
                ))}
              </select>
              <span className="muted small">
                {candidates.length === 0
                  ? '고를 수 있는 이전 기록이 없어요. 이 과목보다 이전 학기의 이수 완료 과목만 고를 수 있어요.'
                  : '이전 기록의 학점·점수는 평점과 취득학점에서 빠져요. 이미 다른 과목이 대체한 기록은 목록에 없어요.'}
              </span>
            </label>
          )}
          <details>
            <summary>추가 정보</summary>
            <label>공식 과목 코드 (선택)
              <input value={code} maxLength={30} readOnly={!!existing?.sourceRowKey}
                onChange={(e) => setCode(e.target.value)} placeholder="모르면 비워 두세요" />
              {existing?.sourceRowKey && <span className="muted small">성적표에서 가져온 코드라 여기서는 고칠 수 없어요.</span>}
            </label>
          </details>
          {existing?.requiredClaim === 'officialMatched'
            ? <p className="muted small">공식 규칙으로 필수과목에 매칭된 과목이에요.</p>
            : (
              <>
                <label className="check">
                  <input type="checkbox" checked={required}
                    onChange={(e) => { setRequired(e.target.checked); if (!e.target.checked) setLink(''); }} />
                  이 과목은 전공필수예요
                </label>
                {required && (matches.length > 1 ? (
                  // 이름이 맞는 요건이 여러 개일 때만 고르게 한다
                  <label>어느 요건인가요?
                    <select value={effectiveLink} onChange={(e) => setLink(e.target.value)}>
                      <option value="">고르지 않음</option>
                      {matches.map(({ leaf, ruleTitle }) => (
                        <option key={leaf.id} value={leaf.id}>{leaf.name}{leaf.code ? ` (${leaf.code})` : ''} — {ruleTitle.slice(0, 40)}</option>
                      ))}
                    </select>
                  </label>
                ) : effectiveLink && linkedName
                  ? <p className="muted small">{linkedName} 요건에 연결했어요</p>
                  : <p className="muted small">연결할 요건이 없어요</p>
                )}
              </>
            )}
          {existing?.sourceRowKey && <p className="muted small">종정시에서 가져온 과목이에요. 직접 고친 항목은 다음 붙여넣기 때 덮어쓰기 전에 확인해요.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="btn ghost" onClick={close}>취소</button>
            <button type="submit" className="btn primary">저장</button>
          </div>
          {existing && (
            <ConfirmButton label="과목 삭제" className="btn danger-ghost"
              confirmText="이 과목과 연결된 시간표·예상 성적도 함께 지워져요." onConfirm={remove} />
          )}
        </form>
      </ConsentGate>
    </Sheet>
  );
}
