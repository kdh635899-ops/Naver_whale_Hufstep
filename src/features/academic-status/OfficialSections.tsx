// 학사현황의 공식 규칙 부분: 판정 범위 → 기본값 없는 질문 → 계산 결과 → 접힌 기본값 수정란.
// 확정·학생 입력 필요·조사 미확정·앱 미지원·요건 없음 명시를 서로 다른 상태로 보여준다.
import { briefAssessment, describeAssessment } from '../../domain/requirements/assessment';
import { useState } from 'react';
import { useStore } from '../../app/store';
import { catalog, departmentById, departmentFacts, departmentMetaById, departmentName, sourceById } from '../../data';
import { isAskedOnScreen, type Scalar } from '../../domain/requirements/conditions';
import { buildQuestions, evaluateRules, leafDisplay, linkableLeaves, normalizeCourseName, noteFrom, ruleTitle, type CoreCategory, type CoverageNote, type CoverageRow, type CourseRuleProgress, type NodeProgress, type NoteKind, type Question, type RuleEval } from '../../domain/requirements/officialRules';
import { profileSchema } from '../../domain/validation/schemas';
import type { CampusId, CourseExpr, Course } from '../../domain/types';
import { SafeLink } from '../common';
import { ProfileSelect } from '../profile/ProfileSelect';

const CORE_LABEL: Record<CoverageRow['category'], string> = {
  credits: '졸업 학점 (총·영역)', requiredCourses: '필수과목', departmentAssessment: '졸업평가·학과 인증', languageCertification: '학교 외국어 졸업인증',
};
const NOTE_LABEL: Record<NoteKind, string> = {
  needsInput: '추가 입력 필요', unconfirmed: '학교 확인 필요', conflict: '근거 충돌', gap: '자료 미지원', unsupported: '앱 미지원', partialList: '일부 목록만 확인', schoolDefault: '학교 기준상 없음 · 학과 확인 필요', schoolCommonOnly: '학교 기준: 시험 또는 논문 필요 · 학과 세부 기준 미제공',
};

/** 학교 확인이 필요한 줄은 배지를 쓰지 않는다 (줄마다 아래에 이유를 한 줄로 적는다). */
const isInquiry = (n: CoverageNote) => n.kind !== 'needsInput';

function rowState(r: CoverageRow): string {
  if (r.determinable) return r.basis === 'none' ? '원문에 요건 없음' : '확인됨';
  // 학교 공통 기준이 '요건 없음'이면(예: 전공필수는 부전공 제외) 학과 확인이 남아도 해당 없음으로 둔다
  if (r.basis === 'none') return '해당 없음';
  if (r.notes.some((n) => n.kind === 'needsInput' && n.askable)) return NOTE_LABEL.needsInput;
  // 물을 질문이 없는 줄은 학생이 입력할 곳이 없다 (이유는 줄마다 아래에 적는다)
  if (r.notes.some((n) => n.kind === 'needsInput')) return '학과 확인 필요';
  if (r.notes.length) return '';
  return '제공되는 자료 없음';
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

/** 학과 사무실 연락처가 없을 때만 쓰는 학교 대표 번호 (개인 연락처는 쓰지 않는다) */
const SCHOOL_MAIN_PHONE: Record<CampusId, string> = { seoul: '02-2173-2114', global: '031-330-4114' };

/**
 * 학교 확인이 필요한 줄을 펼쳤을 때 보여 주는 문의처.
 * 설명 문장·문의 날짜·확인일·홈페이지 링크는 넣지 않는다. 전화·메일만 한 줄씩 둔다.
 */
export function InquiryContact({ departmentId }: { departmentId?: string }) {
  const { state } = useStore();
  const contact = departmentId ? departmentMetaById(departmentId)?.contact : undefined;
  const campus: CampusId = (departmentId && departmentById(departmentId)?.campus) || state.profile?.homeCampus || 'seoul';
  const phone = contact?.phone ?? SCHOOL_MAIN_PHONE[campus];
  // 학과 전용 번호가 없으면 학교 대표 번호임을 밝힌다
  const schoolMain = !contact?.phone || contact.schoolMain === true;
  return (
    <div className="inquiry-detail">
      <p className="small">정확한 기준은 학과에 확인할 수 있어요</p>
      <p className="small">문의 전화 <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a>{schoolMain && ' (학교 대표)'}</p>
      {contact?.email && <p className="small">문의 메일 <a href={`mailto:${contact.email}`}>{contact.email}</a></p>}
      {(contact?.graduationPageUrl || contact?.homepageUrl) && <p className="small"><SafeLink href={(contact.graduationPageUrl || contact.homepageUrl)!}>학과 공식 안내</SafeLink></p>}
    </div>
  );
}

/** 넘기기 버튼 글씨: 시험·인증은 '통과했어요', 학점·과목은 '이수했어요' */
const PASS_LABEL: Record<CoreCategory, string> = {
  credits: '이수했어요', requiredCourses: '이수했어요', departmentAssessment: '통과했어요', languageCertification: '통과했어요',
};

/**
 * 학교 확인이 필요한 요건 한 줄.
 * 접힌 상태는 '요건 제목 + 넘기기 버튼 + 회색 한 줄 이유 ›'. 누르면 문의처만 펼친다.
 * 자료가 없는 것이지 학생이 못 한 것이 아니므로 빨간색·'미충족'을 쓰지 않는다.
 */
function InquiryNote({ note, category, departmentId }: { note: CoverageNote; category: CoreCategory; departmentId?: string }) {
  const { state, save, now, report } = useStore();
  const [open, setOpen] = useState(false);
  const passed = state.certConfirmations.some((c) => c.requirementId === note.id);
  const ids = [note.id, ...linkableLeaves(report ? { ...report,
    courseRules: report.courseRules.filter((e) => note.ruleIds.includes(e.rule.id)),
  } : null).map(({ leaf }) => leaf.id)];
  // 졸업인증 '통과 확인'과 같은 저장소를 쓴다 (다시 누르면 해제)
  const toggle = () => void save((sv) => ({
    ...sv,
    certConfirmations: passed ? sv.certConfirmations.filter((c) => !ids.includes(c.requirementId))
      : [...sv.certConfirmations.filter((c) => !ids.includes(c.requirementId)),
        ...ids.map((id) => ({ requirementId: id, confirmedAt: now.toISOString() }))],
  }));
  // 학교 공통 기준상 '요건 없음'인 줄은 미이수(○)로 보이지 않게 한다 (해당 없음)
  const notApplicable = note.notApplicable || note.kind === 'schoolDefault';
  return (
    <li className={`req inquiry ${passed ? 'met' : ''}`}>
      <span aria-hidden="true">{passed ? '✓' : '○'}</span>
      <span className="name">{note.title ?? note.text}
        {notApplicable && !passed && <span className="contact-checked"> 해당 없음</span>}</span>
      <button type="button" className="btn small self-check" aria-pressed={passed}
        aria-label={`${note.title ?? note.text} ${PASS_LABEL[category]}`} onClick={toggle}>{PASS_LABEL[category]}</button>
      {note.displayReason && (
        <button type="button" className="link inquiry-why" aria-expanded={open} onClick={() => setOpen(!open)}>
          {notApplicable ? '학과 내규가 있을 수 있어요' : note.displayReason} <span aria-hidden="true">›</span>
        </button>
      )}
      {open && <InquiryContact departmentId={departmentId} />}
    </li>
  );
}

/** 상단에 한 번만: 핵심 항목별로 무엇이 확인됐고 무엇이 비어 있는지 */
export function CoverageCard() {
  const { report } = useStore();
  if (!report) return null;
  const rowTitle = (r: CoverageRow) => `${CORE_LABEL[r.category]}${r.departmentId ? ` · ${departmentName(r.departmentId)}` : ' · 학교 공통'}`;
  const shownIds = new Set(report.coverage.flatMap((r) => r.notes.flatMap((n) => n.ruleIds)));
  const otherInquiries = report.evals.filter((e) => e.cls !== 'confirmed' && e.cls !== 'needsInput' && !shownIds.has(e.rule.id));
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
            {r.notes.filter((n) => !isInquiry(n)).length > 0 && (
              <details>
                <summary className="small">이유 {r.notes.filter((n) => !isInquiry(n)).length}건 보기</summary>
                <ul className="plain small">
                  {r.notes.filter((n) => !isInquiry(n)).map((n, i) => (
                    // 물을 질문이 없는 줄은 제목 줄 배지와 같은 기준으로 적는다
                    <li key={i}><b>{n.kind === 'needsInput' && !n.askable ? '학과 확인 필요' : NOTE_LABEL[n.kind]}</b> {n.text}</li>
                  ))}
                </ul>
              </details>
            )}
            {r.notes.some(isInquiry) && (
              <ul className="plain">
                {r.notes.filter(isInquiry).map((n) => (
                  <InquiryNote key={n.id} note={n} category={r.category} departmentId={r.departmentId} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {otherInquiries.length > 0 && <ul className="plain">
        {otherInquiries.map((e) => <InquiryNote key={e.rule.id} note={noteFrom(e, departmentName)}
          category="requiredCourses" departmentId={e.rule.departmentId ?? undefined} />)}
      </ul>}
    </section>
  );
}

const TERM_YEARS = Array.from({ length: 41 }, (_, i) => 2000 + i);

function QuestionInput({ q, value, onAnswer }: { q: Question; value: Scalar | undefined; onAnswer: (v: Scalar | undefined) => void }) {
  const term = typeof value === 'string' ? value.split('-') : [];
  const [year, setYear] = useState(term[0] ?? '');
  if (q.spec.kind === 'term') return <span className="row">
    <ProfileSelect downward={false} aria-label={`${q.spec.label} 연도`} value={year} onChange={(e) => {
      setYear(e.target.value); onAnswer(e.target.value && term[1] ? `${e.target.value}-${term[1]}` : undefined);
    }}>
      <option value="">미정</option>{TERM_YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
    </ProfileSelect>
    <ProfileSelect downward={false} aria-label={`${q.spec.label} 학기`} value={term[1] ?? ''} disabled={!year}
      onChange={(e) => onAnswer(e.target.value ? `${year}-${e.target.value}` : undefined)}>
      <option value="">미정</option><option value="1">1학기</option><option value="2">2학기</option>
    </ProfileSelect>
  </span>;
  if (q.spec.kind === 'year') return <ProfileSelect downward={false} aria-label={q.spec.label} value={value === undefined ? '' : String(value)}
    onChange={(e) => onAnswer(e.target.value ? Number(e.target.value) : undefined)}>
    <option value="">미정</option>{TERM_YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
  </ProfileSelect>;
  const index = q.options.findIndex((o) => o.value === value);
  return <ProfileSelect downward={false} aria-label={q.spec.label} value={index < 0 ? '' : String(index)}
    onChange={(e) => onAnswer(e.target.value === '' ? undefined : q.options[Number(e.target.value)].value)}>
    <option value="">미정</option>{q.options.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
  </ProfileSelect>;
}

/** 선택에 필요한 질문만 기존 입력 스타일로 표시한다. 답한 뒤에도 같은 자리에서 수정한다. */
export function QuestionsCard() {
  const { report, state, save } = useStore();
  const [error, setError] = useState('');
  if (!report || !state.profile) return null;
  const facts = state.profile.facts ?? {};
  const selectionRules = catalog.officialRules.filter((r) => r.category !== 'departmentAssessment');
  const initial = buildQuestions(evaluateRules({ ...state.profile, facts: {} }, selectionRules, departmentFacts), selectionRules);
  const current = buildQuestions(report.evals.filter((e) => e.rule.category !== 'departmentAssessment'), selectionRules);
  // 묻지 않는 필드 목록은 conditions.ts(UNASKED_FIELDS)에 모아 두고 '추가 입력 필요' 문구와 함께 쓴다.
  const questions = [...new Map([...current, ...initial].filter((q) => !q.optional && isAskedOnScreen(q.field))
    .map((q) => [q.field, q])).values()];
  if (!questions.length) return null;
  const setFact = async (field: string, value: Scalar | undefined) => {
    const next = { ...facts };
    if (value === undefined) delete next[field]; else next[field] = value;
    const r = profileSchema.safeParse({ ...state.profile, facts: next });
    if (!r.success) return setError('답을 저장하지 못했어요. 다시 골라 주세요.');
    setError('');
    await save((s) => ({ ...s, profile: r.data }));
  };
  return <div className="form fig-form">
    {questions.map((q) => <label className="field" key={q.field}>{q.spec.label}
      <QuestionInput q={q} value={facts[q.field]} onAnswer={(v) => void setFact(q.field, v)} />
      {q.spec.help && <span className="small muted">{q.spec.help}</span>}
      {facts[q.field] === undefined && <span className="small">{q.spec.label} 확인 필요</span>}
    </label>)}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

// ---- 필수과목 식 ----

// 학생에게는 '들었다'가 하나의 뜻이라 어떤 방식으로 맞았든 '이수'로 적는다 (내부 상태값은 그대로 둔다)
const LEAF_TEXT = {
  met: '이수', substituted: '대체 과목 이수', nameMatched: '이수', waived: '면제 규정 적용',
  studentLinked: '이수', selfConfirmed: '이수', unmet: '미이수',
} as const;
const RULE_STATUS = { met: '충족', studentConfirmed: '충족 (직접 확인 포함)', unmet: '미충족', insufficient: '판단 자료 부족' } as const;

interface NodeProps { p: NodeProgress; byId: Map<string, Course>; onToggle: (leafId: string, checked: boolean) => void }

function NodeView({ p, byId, onToggle }: NodeProps) {
  const n = p.node as CourseExpr;
  if (n.op === 'course') {
    // 공식·이름으로 채워지지 않은 요건만 학생이 직접 체크할 수 있다 (연결된 과목이 있으면 그 과목 학점만 반영)
    const canConfirm = !p.skipped && p.level < 2;
    // 연결된 과목 이름은 요건 이름과 다를 때만 (영문명·구분점 차이는 같은 이름으로 보고 한 번만 적는다)
    const taken = p.courseId ? byId.get(p.courseId)?.name : undefined;
    const alsoKnownAs = taken && normalizeCourseName(taken) !== normalizeCourseName(n.name) ? taken : undefined;
    const { mark, selfChecked } = leafDisplay(p);
    return (
      <li className={`req ${p.level > 0 ? 'met' : ''}`}>
        <span aria-hidden="true">{mark}</span>
        <span className="name">{n.name}{n.code ? ` (${n.code})` : ''}</span>
        {canConfirm && (
          <button type="button" className="btn small self-check" aria-pressed={selfChecked}
            aria-label={`${n.name} 직접 체크`} onClick={() => onToggle(n.id, selfChecked)}>직접 체크</button>
        )}
        <span className="small">{p.skipped ? '다른 선택으로 충족' : LEAF_TEXT[p.state ?? 'unmet']}
          {/* 학생이 직접 체크한 줄만 표시한다. 코드·이름으로 맞은 줄에는 붙이지 않는다 */}
          {selfChecked && <span className="contact-checked"> · 내가 체크</span>}
          {alsoKnownAs && ` · ${alsoKnownAs}`}</span>
      </li>
    );
  }
  const head = n.op === 'AT_LEAST' ? `다음 중 ${n.count}과목 이상` : n.op === 'OR' ? '다음 중 1과목' : null;
  const inner = <ul className="plain">{(p.children ?? []).map((c, i) => <NodeView key={i} p={c} byId={byId} onToggle={onToggle} />)}</ul>;
  return head ? <li><span className="small"><b>{head}</b> {p.level > 0 ? '— 충족' : ''}</span>{inner}</li> : <li>{inner}</li>;
}

export function CourseRulesBlock({ progress, courses }: { progress: CourseRuleProgress[]; courses: Course[] }) {
  const { save, now } = useStore();
  if (!progress.length) return null;
  const byId = new Map(courses.map((c) => [c.id, c]));
  // 졸업인증 '통과 확인'과 같은 저장소를 쓴다 (요건 ID 하나당 한 건, 언제든 해제 가능)
  const onToggle = (leafId: string, checked: boolean) => void save((sv) => ({
    ...sv,
    courses: sv.courses.map((c) => {
      if (!checked || !c.requirementLinks?.includes(leafId)) return c;
      const requirementLinks = c.requirementLinks.filter((id) => id !== leafId);
      return { ...c, requirementLinks, requiredClaim: requirementLinks.length || c.requiredClaim !== 'studentMarked' ? c.requiredClaim : 'none' };
    }),
    certConfirmations: checked
      ? sv.certConfirmations.filter((c) => c.requirementId !== leafId)
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
          <summary className="row-between"><span><span className="chip">{scopeTitle(p.eval)}</span> {title(p.eval)}</span><span className="small">{countText(p.root)}{p.eval.rule.status === 'conflict' && p.root.level === 0 ? '확인 전' : RULE_STATUS[p.status]}</span></summary>
          <ul className="plain"><NodeView p={p.root} byId={byId} onToggle={onToggle} /></ul>
        </details>
      ))}
      <p className="muted small" data-testid="course-legend">○ 미이수 · ✓ 이수</p>
    </div>
  );
}

// ---- 졸업평가·인증·기타 확정 항목 ----

/** 원문 요건 식을 읽기 쉬운 한 줄로 (원래 단위 그대로: 학점·점수·개월) */
export const describe = describeAssessment;
export function assessmentCriteria(detail: Record<string, unknown> | null | undefined): string {
  return detail ? briefAssessment(detail) : '';
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
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </section>
  );
}
