// 학사현황의 공식 규칙 부분: 판정 범위 → 기본값 없는 질문 → 계산 결과 → 접힌 기본값 수정란.
// 확정·학생 입력 필요·조사 미확정·앱 미지원·요건 없음 명시를 서로 다른 상태로 보여준다.
import { useState } from 'react';
import { useStore } from '../../app/store';
import { departmentMetaById, departmentName, sourceById } from '../../data';
import { ASKABLE_FIELDS, type Scalar } from '../../domain/requirements/conditions';
import { normalizeCourseName, ruleTitle, type CoverageRow, type CourseRuleProgress, type NodeProgress, type NoteKind, type Question, type RuleEval } from '../../domain/requirements/officialRules';
import { profileSchema } from '../../domain/validation/schemas';
import type { CourseExpr, Course } from '../../domain/types';
import { SafeLink } from '../common';

const CORE_LABEL: Record<CoverageRow['category'], string> = {
  credits: '졸업 학점 (총·영역)', requiredCourses: '필수과목', departmentAssessment: '졸업평가·학과 인증', languageCertification: '학교 외국어 졸업인증',
};
const NOTE_LABEL: Record<NoteKind, string> = {
  needsInput: '추가 입력 필요', unconfirmed: '학교 확인 필요', conflict: '근거 충돌', gap: '자료 미지원', unsupported: '앱 미지원', partialList: '일부 목록만 확인', schoolDefault: '학교 기준상 없음 · 학과 확인 필요', schoolCommonOnly: '학교 기준: 시험 또는 논문 필요 · 학과 세부 기준 미제공',
};

function rowState(r: CoverageRow): string {
  if (r.determinable) return r.basis === 'none' ? '원문에 요건 없음' : '확인됨';
  if (!r.notes.length) return '제공되는 자료 없음';
  return [...new Set(r.notes.map((n) => NOTE_LABEL[n.kind]))].join(' · ');
}

export function Sources({ ids, label = '출처' }: { ids: string[]; label?: string }) {
  const list = ids.map(sourceById).filter((s) => !!s);
  if (!list.length) return null;
  return (
    <p className="muted small">{label}: {list.map((s, i) => (
      <span key={s.id}>{i > 0 && ', '}{s.status === 'demo' || !s.url ? s.title : <SafeLink href={s.url}>{s.title}{s.checkedAt ? ` (확인 ${s.checkedAt})` : ''}</SafeLink>}</span>
    ))}</p>
  );
}

/** 확인이 필요한 줄에 학과 공개 연락처. 확인일은 핵심 정보와 구분되게 흐린 작은 글씨로 */
export function DepartmentContact({ id }: { id: string }) {
  const c = departmentMetaById(id)?.contact;
  if (!c) return null;
  const page = c.graduationPageUrl ?? c.homepageUrl;
  const parts = [c.phone && `📞 ${c.phone}`, c.email && `✉ ${c.email}`].filter(Boolean).join(' · ');
  return (
    <p className="small contact-line">{c.schoolMain ? '학교에 문의하세요' : '학과에 확인하세요'}: {parts}{page && <>{parts ? ' · ' : ''}<SafeLink href={page}>{c.graduationPageUrl ? '졸업요건 페이지' : c.schoolMain ? '학교 홈페이지' : '학과 홈페이지'} ↗</SafeLink></>}
      <span className="contact-checked"> 확인 {c.checkedAt}{c.note ? ` · ${c.note}` : ''}</span></p>
  );
}

/** 상단에 한 번만: 핵심 항목별로 무엇이 확인됐고 무엇이 비어 있는지 */
export function CoverageCard() {
  const { report } = useStore();
  if (!report) return null;
  const rowTitle = (r: CoverageRow) => `${CORE_LABEL[r.category]}${r.departmentId ? ` · ${departmentName(r.departmentId)}` : ' · 학교 공통'}`;
  return (
    <section className="card" aria-labelledby="coverage-title">
      <h2 id="coverage-title" className="h3">졸업요건 판정 범위</h2>
      <p className={report.canDetermineGraduation ? '' : 'small'}>
        {report.canDetermineGraduation
          ? '핵심 항목의 공식 기준이 모두 준비됐어요. 아래 각 항목의 충족 여부를 확인하세요.'
          : '졸업 충족 여부는 확정하지 않아요. 확인된 기준만 계산하고, 비어 있거나 확인이 필요한 항목은 아래에 이유와 함께 표시해요.'}
      </p>
      {!report.researchComplete && <p className="muted small">선택한 전공의 학과별 졸업요건 전체 조사가 아직 끝나지 않았어요. 일부 규칙이 있어도 전공의 모든 요건이 준비됐다는 뜻은 아니에요.</p>}
      <ul className="plain">
        {report.coverage.map((r) => (
          <li key={`${r.category}-${r.scope}`} className="req-block">
            <p className="row-between"><span>{rowTitle(r)}</span><span className={`small ${r.determinable ? 'met' : ''}`}>{rowState(r)}</span></p>
            {r.notes.length > 0 && (
              <details>
                <summary className="small">이유 {r.notes.length}건 보기</summary>
                <ul className="plain small">
                  {r.notes.map((n, i) => (
                    <li key={i}><b>{NOTE_LABEL[n.kind]}</b> {n.text}<Sources ids={n.sourceIds} /></li>
                  ))}
                </ul>
              </details>
            )}
            {!r.determinable && r.departmentId && <DepartmentContact id={r.departmentId} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

const TERM_YEARS = Array.from({ length: 18 }, (_, i) => 2015 + i);

function QuestionInput({ q, onAnswer }: { q: Question; onAnswer: (v: Scalar) => void }) {
  const [year, setYear] = useState('');
  if (q.spec.kind === 'term') {
    return (
      <span className="row">
        <select aria-label={`${q.spec.label} 연도`} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">연도</option>
          {TERM_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select aria-label={`${q.spec.label} 학기`} value="" disabled={!year} onChange={(e) => e.target.value && onAnswer(`${year}-${e.target.value}`)}>
          <option value="">학기</option>
          <option value="1">1학기</option>
          <option value="2">2학기</option>
        </select>
      </span>
    );
  }
  if (q.spec.kind === 'year') {
    return (
      <select aria-label={q.spec.label} value="" onChange={(e) => e.target.value && onAnswer(Number(e.target.value))}>
        <option value="">연도 선택</option>
        {TERM_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    );
  }
  return (
    <select aria-label={q.spec.label} value="" onChange={(e) => e.target.value !== '' && onAnswer(q.options[Number(e.target.value)].value)}>
      <option value="">선택</option>
      {q.options.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
    </select>
  );
}

const showFact = (v: Scalar) => (v === true ? '예' : v === false ? '아니요' : v === null ? '해당 없음' : String(v));

/** 해당 규칙이 요구하는 추가 조건만 묻는다. 답은 학생 조건(profile.facts)에 저장하고 언제든 지울 수 있다. */
export function QuestionsCard({ defaults = false }: { defaults?: boolean }) {
  const { report, state, save } = useStore();
  const [error, setError] = useState('');
  const facts = state.profile?.facts ?? {};
  const answered = Object.entries(facts).filter(([k]) => k in ASKABLE_FIELDS);
  if (!report || (!report.questions.length && !answered.length)) return null;
  const required = report.questions.filter((q) => !q.optional).length;
  const questions = report.questions.filter((q) => !!q.optional === defaults);
  if (defaults ? !questions.length && !answered.length : !required) return null;

  const setFact = async (field: string, value: Scalar | undefined) => {
    const p = state.profile!;
    const next = { ...(p.facts ?? {}) };
    if (value === undefined) delete next[field]; else next[field] = value;
    const r = profileSchema.safeParse({ ...p, facts: next });
    if (!r.success) return setError('답을 저장하지 못했어요. 다시 골라 주세요.');
    setError('');
    await save((s) => ({ ...s, profile: r.data }));
  };

  const content = <>
      {!defaults && <p className="muted small">지금 조건에 해당할 수 있는 규칙을 고르려면 아래 정보가 필요해요. 입력하기 전에는 해당 규칙을 적용하지도, 제외하지도 않아요.</p>}
      <ul className="plain">
        {questions.map((q) => (
          <li key={q.field} className="req-block">
            <p><b>{q.spec.label}</b>{q.optional && <span className="small"> · 현재: {q.options.find((o) => o.value === q.defaultValue)?.label ?? showFact(q.defaultValue ?? null)}</span>}</p>
            {q.spec.help && <p className="muted small">{q.spec.help}</p>}
            <QuestionInput q={q} onAnswer={(v) => void setFact(q.field, v)} />
          </li>
        ))}
      </ul>
      {defaults && answered.length > 0 && (
        <details>
          <summary className="small">내가 입력한 추가 조건 {answered.length}개</summary>
          <ul className="plain small">
            {answered.map(([k, v]) => (
              <li key={k} className="row-between">
                <span>{ASKABLE_FIELDS[k].label}: <b>{showFact(v)}</b></span>
                <button type="button" className="link" onClick={() => void setFact(k, undefined)}>답 지우기</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error" role="alert">{error}</p>}
  </>;
  return defaults ? (
    <details className="card" data-testid="default-answers">
      <summary>기본값으로 계산했어요 · 다르면 수정</summary>
      {content}
    </details>
  ) : (
    <section className="card" aria-labelledby="questions-title">
      <h2 id="questions-title" className="h3">추가 입력 필요 {required}개</h2>
      {content}
    </section>
  );
}

// ---- 필수과목 식 ----

const LEAF_TEXT = {
  met: '이수', substituted: '대체 과목 이수', nameMatched: '이름 일치 (개설학과·과목명)', waived: '면제 규정 적용',
  studentLinked: '이수', selfConfirmed: '이수', unmet: '미이수',
} as const;
const RULE_STATUS = { met: '충족', studentConfirmed: '충족 (직접 확인 포함)', unmet: '미충족', insufficient: '판단 자료 부족' } as const;

/** 이수한 요건은 모두 ✓. 코드 일치(✓)와 이름 일치(=)만 기호로 구분하고, 학생 확인은 옆의 작은 글씨로 알린다. */
const leafMark = (p: NodeProgress) =>
  (p.level === 0 ? (p.skipped ? '·' : '○') : p.state === 'nameMatched' ? '=' : '✓');

interface NodeProps { p: NodeProgress; byId: Map<string, Course>; confirmed: Set<string>; onToggle: (leafId: string) => void }

function NodeView({ p, byId, confirmed, onToggle }: NodeProps) {
  const n = p.node as CourseExpr;
  if (n.op === 'course') {
    // 공식·이름으로 채워지지 않은 요건만 학생이 직접 체크할 수 있다 (연결된 과목이 있으면 그 과목 학점만 반영)
    const canConfirm = !p.skipped && p.level < 2 && p.state !== 'studentLinked';
    // 연결된 과목 이름은 요건 이름과 다를 때만 (영문명·구분점 차이는 같은 이름으로 보고 한 번만 적는다)
    const taken = p.courseId ? byId.get(p.courseId)?.name : undefined;
    const alsoKnownAs = taken && normalizeCourseName(taken) !== normalizeCourseName(n.name) ? taken : undefined;
    return (
      <li className={`req ${p.level > 0 ? 'met' : ''}`}>
        <span aria-hidden="true">{leafMark(p)}</span>
        <span className="name">{n.name}{n.code ? ` (${n.code})` : ''}
          {p.level === 1 && <span className="contact-checked"> 직접 확인</span>}</span>
        {canConfirm && (
          <button type="button" className="btn small self-check" aria-pressed={confirmed.has(n.id)}
            aria-label={`${n.name} 직접 체크`} onClick={() => onToggle(n.id)}>직접 체크</button>
        )}
        <span className="small">{p.skipped ? '다른 선택으로 충족' : LEAF_TEXT[p.state ?? 'unmet']}{alsoKnownAs && ` · ${alsoKnownAs}`}</span>
      </li>
    );
  }
  const head = n.op === 'AT_LEAST' ? `다음 중 ${n.count}과목 이상` : n.op === 'OR' ? '다음 중 1과목' : null;
  const inner = <ul className="plain">{(p.children ?? []).map((c, i) => <NodeView key={i} p={c} byId={byId} confirmed={confirmed} onToggle={onToggle} />)}</ul>;
  return head ? <li><span className="small"><b>{head}</b> {p.level > 0 ? '— 충족' : ''}</span>{inner}</li> : <li>{inner}</li>;
}

export function CourseRulesBlock({ progress, courses }: { progress: CourseRuleProgress[]; courses: Course[] }) {
  const { state, save, now } = useStore();
  if (!progress.length) return null;
  const byId = new Map(courses.map((c) => [c.id, c]));
  const confirmed = new Set(state.certConfirmations.map((c) => c.requirementId));
  // 졸업인증 '통과 확인'과 같은 저장소를 쓴다 (요건 ID 하나당 한 건, 언제든 해제 가능)
  const onToggle = (leafId: string) => void save((sv) => ({
    ...sv,
    certConfirmations: confirmed.has(leafId) ? sv.certConfirmations.filter((c) => c.requirementId !== leafId)
      : [...sv.certConfirmations, { requirementId: leafId, confirmedAt: now.toISOString() }],
  }));
  const scopeTitle = (e: RuleEval) => (e.rule.departmentId ? departmentName(e.rule.departmentId) : '학교 공통');
  // 배지에 학과를 이미 표시하므로 제목에서는 같은 학과명을 한 번 덜어 낸다.
  const title = (e: RuleEval) => ruleTitle(e.rule, scopeTitle(e)).replace(scopeTitle(e), '').trim();
  const leafCounts = (p: NodeProgress): [number, number] => p.node.op === 'course'
    ? [Number(p.level > 0), 1]
    : (p.children ?? []).reduce<[number, number]>((sum, c) => {
      const [met, total] = leafCounts(c);
      return [sum[0] + met, sum[1] + total];
    }, [0, 0]);
  // 택일 묶음은 모든 후보가 필수인 것처럼 보이지 않도록 과목 수를 합산해 표시하지 않는다.
  const countText = (p: NodeProgress) => p.node.op === 'ALL' && p.children?.every((c) => c.node.op === 'course')
    ? `${leafCounts(p).join(' / ')}과목 이수 · ` : '';
  return (
    <div className="req-block">
      {progress.map((p) => (
        <details key={p.eval.rule.id} open={p.status !== 'met'}>
          <summary className="row-between"><span><span className="chip">{scopeTitle(p.eval)}</span> {title(p.eval)}</span><span className="small">{countText(p.root)}{RULE_STATUS[p.status]}</span></summary>
          <ul className="plain"><NodeView p={p.root} byId={byId} confirmed={confirmed} onToggle={onToggle} /></ul>
          <Sources ids={p.eval.rule.sourceIds} />
        </details>
      ))}
      <p className="muted small" data-testid="course-legend">○ 미이수 · ✓ 코드·대체 · = 이름 일치<br />직접 확인: 학생 체크 · 학점 추가 없음</p>
    </div>
  );
}

// ---- 졸업평가·인증·기타 확정 항목 ----

/** 원문 요건 식을 읽기 쉬운 한 줄로 (원래 단위 그대로: 학점·점수·개월) */
export function describe(x: unknown): string {
  if (x == null) return '';
  if (typeof x !== 'object') return String(x);
  if (Array.isArray(x)) return x.map(describe).filter(Boolean).join(', ');
  const o = x as Record<string, unknown>;
  if (o.op === 'OR' && Array.isArray(o.items)
    && o.items.length === 2 && o.items.every((i) => ['departmentExamPassed', 'departmentThesisPassed'].includes(i?.type))) {
    return '학과 졸업시험 또는 졸업논문 통과';
  }
  if (o.op === 'OR' && Array.isArray(o.items)) return `다음 중 하나 [${o.items.map(describe).join(' / ')}]`;
  if ((o.op === 'AND' || o.op === 'ALL') && Array.isArray(o.items)) return o.items.map(describe).join(' + ');
  if (o.op === 'AT_LEAST' && Array.isArray(o.items)) return `${o.count}개 이상 [${o.items.map(describe).join(' / ')}]`;
  const labels: Record<string, string> = { departmentExamPassed: '학과 졸업시험 통과', departmentThesisPassed: '학과 졸업논문 통과' };
  const name = o.testName ?? o.name ?? o.courseName ?? o.exam ?? labels[String(o.type)] ?? o.type;
  const th = o.threshold as { value?: unknown } | undefined;
  const bits = [name, th?.value != null ? `${o.operator ?? '≥'} ${th.value}` : '', o.minimumGrade ? `${o.minimumGrade} 이상` : ''];
  return bits.filter(Boolean).join(' ');
}

/** 식 없이 점수·시험과목으로 제공된 기준도 화면에 보여 준다. */
export function assessmentCriteria(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return '';
  if (detail.expression) return describe(detail.expression);
  if (detail.normalMinimumScore != null) return `${detail.exam ?? '졸업시험'} ${detail.normalMinimumScore}점 이상`
    + (detail.reducedMinimumScore != null ? ` · 9학기 이상 등록하고 졸업시험 재응시 시 ${detail.reducedMinimumScore}점 이상 (최초 응시는 일반 기준)` : '');
  const parts: string[] = [];
  const value = (x: unknown) => x && typeof x === 'object' ? (x as { value?: unknown }).value : x;
  const test = detail.testName ?? detail.test ?? detail.exam;
  const score = value(detail.threshold ?? detail.minimumScore ?? detail.passScore);
  if (test) parts.push(`${test}${score != null ? ` ${score}점 이상` : ''}`);
  else if (score != null) parts.push(`${score}점 이상`);
  for (const [key, label] of [['subjects', '시험 과목'], ['requiredSubjects', '필수 과목'], ['electiveSubjects', '선택 과목'],
    ['subjectChoice', '선택 과목'], ['selectFrom', '선택 과목'], ['components', '평가 영역']] as const) {
    if (Array.isArray(detail[key])) parts.push(`${label}: ${(detail[key] as string[]).join(', ')}`);
  }
  if (detail.minimumEachScore) parts.push(`과목별 ${value(detail.minimumEachScore)}점 이상`);
  if (detail.minimumMeanScore) parts.push(`평균 ${value(detail.minimumMeanScore)}점 이상`);
  if (typeof detail.passRule === 'string') parts.push(detail.passRule);
  else if (detail.passRule && typeof detail.passRule === 'object') {
    const rule = detail.passRule as { perSubjectMin?: number; averageMin?: number };
    if (rule.perSubjectMin != null) parts.push(`과목별 ${rule.perSubjectMin}점 이상`);
    if (rule.averageMin != null) parts.push(`평균 ${rule.averageMin}점 이상`);
  }
  if (detail.minimumGrade) parts.push(`통과 등급 ${detail.minimumGrade} 이상`);
  if (detail.flexThreshold) parts.push(`FLEX ${value(detail.flexThreshold)}점 이상`);
  // 해석하지 않은 내부 type 이름을 학생에게 그대로 보여 주지 않는다.
  return parts.join(' · ') || (typeof detail.unknownReason === 'string' ? detail.unknownReason : '세부 기준은 학과 공지를 확인해 주세요.');
}

const CONFIRMABLE = new Set(['departmentAssessment', 'commonLanguageCertification']);

export function RuleItemsCard() {
  const { report, state, save, now } = useStore();
  if (!report?.items.length) return null;
  const confirmed = new Set(state.certConfirmations.map((c) => c.requirementId));
  const toggle = (id: string) => save((s) => ({
    ...s,
    certConfirmations: confirmed.has(id) ? s.certConfirmations.filter((c) => c.requirementId !== id)
      : [...s.certConfirmations, { requirementId: id, confirmedAt: now.toISOString() }],
  }));
  const groups = [
    { title: '졸업평가·인증', list: report.items.filter((e) => CONFIRMABLE.has(e.rule.category)) },
    { title: '참고 규정', list: report.items.filter((e) => !CONFIRMABLE.has(e.rule.category)) },
  ];
  return (
    <section className="card" aria-labelledby="items-title">
      <h2 id="items-title" className="h3">공식 확인된 기타 요건</h2>
      {groups.map((g) => g.list.length > 0 && (
        <details key={g.title} className="req-block" open={g.title === '졸업평가·인증' ? true : undefined}>
          <summary><b>{g.title}{g.title === '참고 규정' ? ` ${g.list.length}개` : ''}</b></summary>
          <ul className="plain">
            {g.list.map((e) => {
              const d = e.rule.detail as Record<string, unknown> | null | undefined;
              const expr = CONFIRMABLE.has(e.rule.category) ? assessmentCriteria(d)
                : d && typeof d === 'object' && 'expression' in d ? describe(d.expression) : '';
              return (
                <li key={e.rule.id} className="req-block">
                  <p><span className="chip">{e.rule.departmentId ? departmentName(e.rule.departmentId) : '학교 공통'}</span> <b>{ruleTitle(e.rule, e.rule.departmentId ? departmentName(e.rule.departmentId) : undefined)}</b></p>
                  {expr && <p className="small">기준(원문 단위): {expr}</p>}
                  {e.rule.none && <p className="small">원문에 해당 요건이 없거나 적용 제외로 명시돼 있어요.</p>}
                  {e.rule.note && <p className="muted small">{e.rule.note}</p>}
                  {e.rule.termSpecific && (state.profile?.facts?.graduationTerm === e.rule.termSpecific.term
                    ? <p className="small">{e.rule.termSpecific.term} 졸업 대상 공지의 일정: {Object.entries(e.rule.termSpecific.fields).filter(([, v]) => v != null).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</p>
                    : <p className="muted small">마감일·시험 일정은 {e.rule.termSpecific.term} 졸업 대상 공지에만 해당해요. 졸업 예정 학기의 공지에서 다시 확인해 주세요.</p>)}
                  {CONFIRMABLE.has(e.rule.category) && !e.rule.none && (
                    <label className="check"><input type="checkbox" checked={confirmed.has(e.rule.id)} onChange={() => void toggle(e.rule.id)} /> 통과했다고 직접 확인 (학생 확인 · 규정 확인을 대신하지 않아요)</label>
                  )}
                  <Sources ids={e.rule.sourceIds} />
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </section>
  );
}
