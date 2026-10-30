// 학생 조건 선택 (§3.2). 조건을 바꿔도 성적·평가 기록은 지우지 않고 규칙만 다시 평가한다.
import { useState } from 'react';
import { ProfileSelect } from './ProfileSelect';
import { useStore } from '../../app/store';
import { catalog, departmentMetaById } from '../../data';
import { secondaryRestriction } from '../../domain/requirements/officialRules';
import { suggestTerm } from '../../domain/terms';
import type { CampusId, Department, EntryType, ProgramType, StudentProfile } from '../../domain/types';
import { firstIssue, profileSchema } from '../../domain/validation/schemas';
import { CAMPUS_LABEL, ENTRY_LABEL } from '../common';

const COHORTS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
// 신입생의 기본 선택지. 편입생에게는 전공심화가 없는 단일전공 경로를 별도로 제공한다.
const PROGRAM_CHIPS: { v: ProgramType; label: string }[] = [
  { v: 'double', label: '이중전공' },
  { v: 'minor', label: '부전공' },
  { v: 'intensive', label: '전공심화' },
];

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

export function ProfileForm({ onDone, submitLabel, downward = false }: { onDone: () => void; submitLabel: string; downward?: boolean }) {
  const { state, save, now } = useStore();
  const p = state.profile;
  const [name, setName] = useState(p?.name ?? '');
  const [campus, setCampus] = useState<CampusId>(p?.homeCampus ?? 'seoul');
  const [cohort, setCohort] = useState(p?.cohortYear ?? 0);
  const [entry, setEntry] = useState<EntryType>(p?.entryType ?? 'freshman');
  const [primary, setPrimary] = useState(p?.primaryDepartmentId ?? '');
  const [program, setProgram] = useState<ProgramType>(
    p?.entryType === 'freshman' && p.programType === 'single' ? 'double' : p?.programType ?? 'double',
  );
  const [secondary, setSecondary] = useState(p?.secondaryDepartmentId ?? '');
  const [year, setYear] = useState<string>(p?.currentYear ? String(p.currentYear) : '');
  // 외국어 특기자 등 특별전형: 기본은 꺼짐(= 아니요). 신입학에만 해당한다.
  const [special, setSpecial] = useState(p?.facts?.foreignLanguageSpecialAdmission === true);
  const [error, setError] = useState('');

  const allowsSingle = entry === 'transferGeneral' || entry === 'transferBachelor';
  const programChips = allowsSingle
    ? [...PROGRAM_CHIPS, { v: 'single' as const, label: '단일전공' }] : PROGRAM_CHIPS;
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
    // 전공·학번·전형이 그대로면 이미 답한 조건을 보존한다 (조건이 바뀌면 다시 묻는다)
    const kept = p?.facts && p.primaryDepartmentId === primary && p.secondaryDepartmentId === (allowsSecond ? secondary || undefined : undefined)
      && p.cohortYear === cohort && p.entryType === entry && p.programType === program ? p.facts : undefined;
    const facts = { ...kept };
    // 체크하면 '예', 해제하면 키를 지워 기본값(아니요)으로 돌린다. 편입생에게는 묻지 않는다.
    if (entry === 'freshman' && special) facts.foreignLanguageSpecialAdmission = true;
    else delete facts.foreignLanguageSpecialAdmission;
    const next: StudentProfile = {
      schemaVersion: 1, ...(name.trim() ? { name: name.trim() } : {}), homeCampus: campus, cohortYear: cohort, entryType: entry, primaryDepartmentId: primary,
      programType: program, secondaryDepartmentId: allowsSecond ? secondary || undefined : undefined,
      currentYear: year ? (Number(year) as 1 | 2 | 3 | 4) : undefined,
      currentTerm: p?.currentTerm ?? suggestTerm(now),
      ...(Object.keys(facts).length ? { facts } : {}),
    };
    const r = profileSchema.safeParse(next);
    if (!r.success) return setError(firstIssue(r.error));
    if (await save((s) => ({ ...s, profile: r.data }))) onDone();
  }

  return (
    <form className="form fig-form" onSubmit={submit} noValidate>
      <label className="field">이름 / 닉네임
        <input type="text" value={name} maxLength={20} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">소속 캠퍼스
        <ProfileSelect aria-label="소속 캠퍼스" downward={downward} value={campus} onChange={(e) => { setCampus(e.target.value as CampusId); setPrimary(''); }}>
          {Object.entries(CAMPUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </ProfileSelect>
      </label>
      <label className="field">주전공
        <ProfileSelect aria-label="주전공" downward={downward} value={primary} onChange={(e) => { setPrimary(e.target.value); if (e.target.value === secondary) setSecondary(''); }}>
          <option value="">선택해 주세요</option>
          {DeptOptions({ list: primaryOptions })}
        </ProfileSelect>
      </label>
      <fieldset>
        <legend className="field-legend">이중전공 / 부전공 이수</legend>
        <div className="opt-chips">
          {programChips.map((c) => (
            <label key={c.v} className={program === c.v ? 'on' : ''}>
              <input type="radio" name="program" value={c.v} aria-label={c.label} checked={program === c.v} onChange={() => setProgram(c.v)} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      {allowsSecond && (
        <label className="field">{program === 'double' ? '이중전공' : program === 'minor' ? '부전공' : '부전공 (선택)'}
          <ProfileSelect aria-label="이중전공 / 부전공" downward={downward} value={secondary} onChange={(e) => setSecondary(e.target.value)}>
            <option value="">{needsSecond ? '선택해 주세요' : '부전공 없음 (전공심화만)'}</option>
            {DeptOptions({ list: secondOptions, withCampus: true })}
          </ProfileSelect>
        </label>
      )}
      <div className="fig-row">
        <label className="field">학번
          <ProfileSelect aria-label="학번" downward={downward} value={cohort} onChange={(e) => setCohort(Number(e.target.value))}>
            <option value={0}>선택</option>
            {COHORTS.map((y) => <option key={y} value={y}>{String(y).slice(2)}학번</option>)}
          </ProfileSelect>
        </label>
        <label className="field">현재 학년
          <ProfileSelect aria-label="현재 학년" downward={downward} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">선택</option>
            {[1, 2, 3, 4].map((y) => <option key={y} value={y}>{y}학년</option>)}
          </ProfileSelect>
        </label>
      </div>
      <label className="field">입학유형
        <ProfileSelect aria-label="입학유형" downward={downward} value={entry} onChange={(e) => {
          const nextEntry = e.target.value as EntryType;
          setEntry(nextEntry);
          // 신입학으로 바꾸면 편입생 전용 선택이 숨겨진 채 저장되지 않도록 한다.
          if (nextEntry === 'freshman' && program === 'single') setProgram('double');
        }}>
          {Object.entries(ENTRY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </ProfileSelect>
      </label>
      {entry === 'freshman' && (
        <label className="check">
          <input type="checkbox" checked={special} onChange={(e) => setSpecial(e.target.checked)} />
          외국어 특기자 등 특별전형으로 입학했어요
        </label>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn cta">{submitLabel}</button>
    </form>
  );
}
