// 학생 조건 선택 (§3.2). 조건을 바꿔도 성적·평가 기록은 지우지 않고 규칙만 다시 평가한다.
import { useState } from 'react';
import { useStore } from '../../app/store';
import { catalog, departmentMetaById } from '../../data';
import { secondaryRestriction } from '../../domain/requirements/officialRules';
import { suggestTerm } from '../../domain/terms';
import type { CampusId, Department, EntryType, ProgramType, StudentProfile } from '../../domain/types';
import { firstIssue, profileSchema } from '../../domain/validation/schemas';
import { CAMPUS_LABEL, ENTRY_LABEL, PROGRAM_LABEL } from '../common';

const COHORTS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

// 학과 카탈로그에는 모집 중지·세부전공·모듈도 들어 있다. 모두 독립 학과로 보이지 않게 묶어서 보여준다.
const GROUPS = ['학과·학부·전공', '모집 중지·과거 조직 (해당 학번만)', '세부전공·모듈 (상위 전공 소속)', '편람 수강안내 표기 전공 (현재·과거 여부 확인 중)'];
function deptGroup(id: string): number {
  const m = departmentMetaById(id);
  if (!m) return 0;
  if (m.kind === 'module' || m.kind.startsWith('submajor') || m.kind === 'individualDesignFramework' || m.kind === 'majorNamedInDepartmentRules') return 2;
  if (['recruitmentStopped', 'newApplicationsClosed', 'legacyListed'].includes(m.status)) return 1;
  if (m.status === 'currentOrLegacyUnresolved') return 3;
  return 0;
}
function DeptOptions({ list, withCampus }: { list: Department[]; withCampus?: boolean }) {
  return (
    <>
      {GROUPS.map((label, g) => {
        const items = list.filter((d) => deptGroup(d.id) === g);
        return items.length > 0 && (
          <optgroup key={label} label={label}>
            {items.map((d) => <option key={d.id} value={d.id}>{d.name}{withCampus ? ` (${CAMPUS_LABEL[d.campus]})` : ''}</option>)}
          </optgroup>
        );
      })}
    </>
  );
}

export function ProfileForm({ onDone, submitLabel }: { onDone: () => void; submitLabel: string }) {
  const { state, save, now } = useStore();
  const p = state.profile;
  const [campus, setCampus] = useState<CampusId>(p?.homeCampus ?? 'seoul');
  const [cohort, setCohort] = useState(p?.cohortYear ?? 0);
  const [entry, setEntry] = useState<EntryType>(p?.entryType ?? 'freshman');
  const [primary, setPrimary] = useState(p?.primaryDepartmentId ?? '');
  const [program, setProgram] = useState<ProgramType>(p?.programType ?? 'single');
  const [secondary, setSecondary] = useState(p?.secondaryDepartmentId ?? '');
  const [year, setYear] = useState<string>(p?.currentYear ? String(p.currentYear) : '');
  const [error, setError] = useState('');

  const needsSecond = program === 'double' || program === 'minor';
  const allowsSecond = needsSecond || program === 'intensive'; // 전공심화는 부전공을 함께 할 수도 있다
  const role = program === 'double' ? 'dual' : 'minor';
  const primaryOptions = catalog.departments.filter((d) => d.campus === campus);
  const restricted = (d: Department) => secondaryRestriction(departmentMetaById(d.id), d.campus, role, { homeCampus: campus, cohortYear: cohort || 2026 });
  const secondCandidates = catalog.departments.filter((d) => d.id !== primary);
  const secondOptions = secondCandidates.filter((d) => !restricted(d));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!primary) return setError('주전공을 골라 주세요');
    if (!cohort) return setError('학번(입학 연도)을 골라 주세요');
    const sec = allowsSecond && secondary ? catalog.departments.find((d) => d.id === secondary) : undefined;
    const why = sec && restricted(sec);
    if (why) return setError(`이 학과는 지금 조건에서 ${role === 'dual' ? '이중전공' : '부전공'}으로 고를 수 없어요: ${why}`);
    const next: StudentProfile = {
      schemaVersion: 1, homeCampus: campus, cohortYear: cohort, entryType: entry, primaryDepartmentId: primary,
      programType: program, secondaryDepartmentId: allowsSecond ? secondary || undefined : undefined,
      currentYear: year ? (Number(year) as 1 | 2 | 3 | 4) : undefined,
      currentTerm: p?.currentTerm ?? suggestTerm(now),
      ...(p?.facts && { facts: p.facts }), // 추가 조건 답은 조건을 바꿔도 유지 (필요 없어진 답은 쓰이지 않음)
    };
    const r = profileSchema.safeParse(next);
    if (!r.success) return setError(firstIssue(r.error));
    if (await save((s) => ({ ...s, profile: r.data }))) onDone();
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label>캠퍼스 (주전공 소속)
        <select value={campus} onChange={(e) => { setCampus(e.target.value as CampusId); setPrimary(''); }}>
          {Object.entries(CAMPUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label>주전공
        <select value={primary} onChange={(e) => { setPrimary(e.target.value); if (e.target.value === secondary) setSecondary(''); }}>
          <option value="">선택해 주세요</option>
          <DeptOptions list={primaryOptions} />
        </select>
      </label>
      {primaryOptions.length === 0 && <p className="muted small">이 캠퍼스의 학과 목록이 아직 준비되지 않았어요.</p>}
      <fieldset>
        <legend>전공 구성</legend>
        <div className="seg">
          {(Object.keys(PROGRAM_LABEL) as ProgramType[]).map((v) => (
            <label key={v} className={program === v ? 'on' : ''}>
              <input type="radio" name="program" value={v} checked={program === v} onChange={() => setProgram(v)} />
              {PROGRAM_LABEL[v]}
            </label>
          ))}
        </div>
      </fieldset>
      {allowsSecond && (
        <label>{program === 'double' ? '이중전공 학과' : program === 'minor' ? '부전공 학과' : '함께 하는 부전공 학과 (선택)'}
          <select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
            <option value="">{needsSecond ? '선택해 주세요' : '부전공 없음 (전공심화만)'}</option>
            <DeptOptions list={secondOptions} withCampus />
          </select>
        </label>
      )}
      {allowsSecond && secondCandidates.length > secondOptions.length && (
        <p className="muted small">캠퍼스 간 이중·부전공 제한 등으로 지금 조건에서 고를 수 없는 학과 {secondCandidates.length - secondOptions.length}개는 목록에서 뺐어요.</p>
      )}
      <div className="row2">
        <label>학번 (입학 연도)
          <select value={cohort} onChange={(e) => setCohort(Number(e.target.value))}>
            <option value={0}>선택</option>
            {COHORTS.map((y) => <option key={y} value={y}>{String(y).slice(2)}학번 ({y})</option>)}
          </select>
        </label>
        <label>현재 학년 (선택)
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">선택 안 함</option>
            {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y}학년</option>)}
          </select>
        </label>
      </div>
      <label>입학 유형
        <select value={entry} onChange={(e) => setEntry(e.target.value as EntryType)}>
          {Object.entries(ENTRY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <p className="muted small">전체 학번이 아닌 입학 연도만 받아요. 목록에 있어도 모든 학과의 졸업요건이 준비된 것은 아니에요.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn primary block">{submitLabel}</button>
    </form>
  );
}
