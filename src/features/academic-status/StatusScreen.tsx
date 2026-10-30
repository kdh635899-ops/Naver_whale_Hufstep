// 학사 현황 (Figma, §3.4). 내 조건 → 남은 학점 카드 → [이수학점 / 필수과목 / 졸업시험] 알약 탭 → 01 영역별 이수학점 → 02 졸업 필수 과목 → 03 졸업 시험 및 요건.
// 값은 종정시 데이터 + 졸업요건 규칙 + 학생이 직접 확인한 이수 기록으로 계산한다.
// 세부 과목을 모두 이수하면 카드 전체가 '이수 완료'가 된다. 졸업시험·요건은 학과마다 달라서 학생이 스스로 표시하는 체크리스트로만 보여 준다.
// 졸업 충족을 확정하지 않는다.
import { useEffect, useState, type ReactNode } from 'react';
import { stairCharacter, STAIRS_IMG } from '../../app/stairs';
import { useStore } from '../../app/store';
import { catalog, departmentFacts, departmentMetaById, departmentName } from '../../data';
import { shortTitle } from '../../domain/requirements/displayTitle';
import { courseConfirmationIds, normalizeCourseName, replacementNeedsPermission, ruleTitle, type NodeProgress } from '../../domain/requirements/officialRules';
import { departmentAssessmentGuides, groupAssessments } from '../../domain/requirements/assessment';
import { checklistCount, deleteChecklistItem, linkedChecklistIds } from '../../domain/requirements/statusEdits';
import { emptyEdits, newId } from '../../domain/state';
import { formatUnits } from '../../domain/terms';
import { timetableRequirementStates } from '../../domain/timetableStatus';
import type { BoxKind, BundleScope, CertificationRequirement, CourseExpr, StatusEdits } from '../../domain/types';
import { AREA_LABEL, CAMPUS_LABEL, ENTRY_LABEL, Confirm, SafeLink } from '../common';
import { FieldPrompt } from './AddPrompt';
import { assessmentCriteria, InquiryContact, QuestionsCard } from './OfficialSections';
import { useProgress } from './useProgress';

type Section = 'credits' | 'courses' | 'exams';
const SECTIONS: { key: Section; label: string }[] = [{ key: 'credits', label: '01 이수학점' }, { key: 'courses', label: '02 필수과목' }, { key: 'exams', label: '03 졸업시험' }];
interface ReqItem { id: string; label: string; done: boolean; canCheck?: boolean; direct?: boolean; extra?: boolean; note?: string; group?: boolean; depth: number; attending?: { isRetake: boolean } }
interface Card { key: string; who: string; dept: string; items: ReqItem[]; met: number; total: number }
/** title = 접힌 줄에 보이는 짧은 제목(길면 …), head = 펼친 목록에 보이는 줄이지 않은 제목, full = 전체 제목, detail·rest = 기준·설명(모두 보여 준다) */
interface ExamItem { id: string; title: string; head: string; full: string; detail: string; rest: string; confirmed: boolean; extra?: boolean;
  /** 학생이 요건을 고친 기본 시험의 원래 학교 기준 (고치지 않았으면 없음) */ baseDetail?: string }
interface ExamCard { key: string; who: string; dept: string; items: ExamItem[] }

export function StatusScreen() {
  const { state, save, resolved, report, now } = useStore();
  const { progress, checklistProgress: courseProgress } = useProgress();
  const [sec, setSec] = useState<Section>('credits');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const profile = state.profile!;
  const confirmed = new Set(state.certConfirmations.flatMap((c) => courseConfirmationIds(report, c.requirementId)));
  const attending = timetableRequirementStates(state, report);
  const secondLabel = profile.programType === 'double' ? '이중전공' : '부전공';
  const secondary = profile.secondaryDepartmentId;
  const edits = state.statusEdits ?? emptyEdits();
  const linkedExtras = linkedChecklistIds(state.courses);
  const [mode, setMode] = useState<Record<string, 'edit' | 'delete' | undefined>>({});
  const [prompt, setPrompt] = useState<{ kind: 'course' | 'exam'; card: string } | null>(null);
  const [askDel, setAskDel] = useState<{ kind: 'course'; it: ReqItem } | { kind: 'exam'; it: ExamItem } | null>(null); // 삭제 확인 창
  const toggleMode = (k: string, m: 'edit' | 'delete') => setMode((o) => ({ ...o, [k]: o[k] === m ? undefined : m }));
  const setEdits = (fn: (e: StatusEdits) => StatusEdits) =>
    save((s) => ({ ...s, statusEdits: fn(s.statusEdits ?? emptyEdits()) }));
  const cleanName = (v: string) => v.trim().replace(/\s+/g, ' ');
  const renameCourse = (it: ReqItem, v: string) => {
    const name = cleanName(v);
    if (name) void setEdits((e) => it.extra ? { ...e, extraCourses: e.extraCourses.map((x) => (x.id === it.id ? { ...x, name } : x)) } : { ...e, renamed: { ...e.renamed, [it.id]: name } });
  };
  const removeCourse = (it: ReqItem) => void save((s) => deleteChecklistItem(s, it.id, !!it.extra));
  const renameExam = (it: ExamItem, v: string) => {
    const name = cleanName(v);
    if (name) void setEdits((e) => it.extra ? { ...e, extraExams: e.extraExams.map((x) => (x.id === it.id ? { ...x, title: name } : x)) } : { ...e, renamed: { ...e.renamed, [it.id]: name } });
  };
  const removeExam = (it: ExamItem) => void save((s) => deleteChecklistItem(s, it.id, !!it.extra));
  // 요건(합격 기준) 고치기. 직접 추가한 시험은 그 항목의 detail을, 학교 자료 시험은 redetailed에 따로 담는다.
  const redetailExam = (it: ExamItem, v: string) => {
    const detail = cleanName(v);
    if (detail) void setEdits((e) => it.extra ? { ...e, extraExams: e.extraExams.map((x) => (x.id === it.id ? { ...x, detail } : x)) } : { ...e, redetailed: { ...e.redetailed, [it.id]: detail } });
  };

  const toggleConfirm = (id: string) => void save((s) => ({
    ...s,
    certConfirmations: s.certConfirmations.some((c) => courseConfirmationIds(report, id).includes(c.requirementId))
      ? s.certConfirmations.filter((c) => !courseConfirmationIds(report, id).includes(c.requirementId))
      : [...s.certConfirmations, { requirementId: id, confirmedAt: now.toISOString() }],
  }));
  // ---- 02 필수과목 카드 만들기 ----
  const cardKeyOf = (departmentId: string | null | undefined, scope?: BundleScope): 'primary' | 'secondary' | 'common' => {
    if (departmentId) return departmentId === profile.primaryDepartmentId ? 'primary' : departmentId === secondary ? 'secondary' : 'common';
    return scope === 'primary' ? 'primary' : scope === 'secondary' ? 'secondary' : 'common';
  };
  const removedIds = new Set(edits.removed);
  const cards: Record<'primary' | 'secondary' | 'common', Card> = {
    primary: { key: 'primary', who: '주전공', dept: departmentName(profile.primaryDepartmentId), items: [], met: 0, total: 0 },
    secondary: { key: 'secondary', who: secondLabel, dept: departmentName(secondary), items: [], met: 0, total: 0 },
    common: { key: 'common', who: '학교 공통', dept: '', items: [], met: 0, total: 0 },
  };
  for (const g of progress.groups) {
    const card = cards[cardKeyOf(null, g.scope)];
    const done = g.status === 'met' || confirmed.has(g.group.id);
    card.items.push({ id: g.group.id, label: g.group.title, done, canCheck: g.status !== 'met', direct: confirmed.has(g.group.id), depth: 0 });
    if (!removedIds.has(g.group.id)) { card.total += 1; card.met += done ? 1 : 0; }
  }
  const walk = (p: NodeProgress, depth: number, out: ReqItem[], departmentId: string | null) => {
    const n = p.node as CourseExpr;
    if (n.op === 'course') {
      // 성적표로 확인된 이수는 그대로 두고, 미이수·직접 확인한 줄에만 버튼을 둔다.
      out.push({ id: n.id, label: n.name, done: p.level > 0 || confirmed.has(n.id), canCheck: p.level === 0 || p.state === 'selfConfirmed' || confirmed.has(n.id), depth, attending: attending.get(n.id),
        direct: p.state === 'selfConfirmed' || p.state === 'studentLinked' || confirmed.has(n.id),
        note: replacementNeedsPermission(report, n, departmentId) ? '대체과목 인정에는 학과 승인이 필요해요. 승인받았는지 확인해 주세요.' : undefined });
      return;
    }
    const head = n.op === 'AT_LEAST' ? `다음 중 ${n.count}과목 이상` : n.op === 'OR' ? '다음 중 1과목' : null;
    if (head) out.push({ id: `${depth}-${out.length}-${head}`, label: head, done: p.level > 0, group: true, depth });
    // 택일에서 선택되지 않은 갈래도 펼쳐서, 학생이 다른 후보를 직접 이수 표시할 수 있다.
    for (const c of p.children ?? n.items.map((node) => ({ node, level: 0 as const }))) walk(c, head ? depth + 1 : depth, out, departmentId);
  };
  // 외국어 특기자 전형을 기본값(아니요)으로 판정한 목록에만 '바꿔 주세요' 안내를 붙인다 (체크한 학생·편입생은 기본값을 쓰지 않아 빠진다)
  const specialDefault = new Set<string>();
  for (const cp of courseProgress) {
    const card = cards[cardKeyOf(cp.eval.rule.departmentId)];
    if (cp.eval.fallbackFields.includes('foreignLanguageSpecialAdmission')) specialDefault.add(card.key);
    walk(cp.root, 0, card.items, cp.eval.rule.departmentId);
    const [m, t] = checklistCount(cp.root, removedIds);
    card.met += m; card.total += t;
  }
  // 직접 추가한 과목은 명시적인 성적 연결 또는 학생이 확인한 표시만 사용한다.
  for (const card of Object.values(cards)) {
    const kept: ReqItem[] = [];
    for (const it of card.items) {
      kept.push({ ...it, label: edits.renamed[it.id] ?? it.label });
    }
    for (const x of edits.extraCourses.filter((c) => c.card === card.key)) {
      const done = confirmed.has(x.id) || linkedExtras.has(x.id);
      kept.push({ id: x.id, label: x.name, done, canCheck: !linkedExtras.has(x.id), direct: true, depth: 0, extra: true });
      card.total += 1;
      card.met += done ? 1 : 0;
    }
    card.items = kept;
  }
  const reqCards = [cards.primary, ...(secondary ? [cards.secondary] : []), ...(cards.common.items.length ? [cards.common] : [])];

  // ---- 03 졸업 시험 및 요건 카드 만들기 ----
  const examCards: Record<string, ExamCard> = {
    primary: { key: 'primary', who: '주전공', dept: cards.primary.dept, items: [] },
    secondary: { key: 'secondary', who: secondLabel, dept: cards.secondary.dept, items: [] },
    common: { key: 'common', who: '학교 공통', dept: '', items: [] },
  };
  const boxInfo = (k: BoxKind) => k === 'common' ? { who: '학교 공통', dept: '' }
    : k === 'primary' ? { who: '주전공', dept: cards.primary.dept } : k === 'double' ? { who: '이중전공', dept: cards.secondary.dept }
    : k === 'minor' ? { who: '부전공', dept: cards.secondary.dept } : k === 'advanced' ? { who: '전공심화', dept: cards.primary.dept }
    : { who: '단일전공', dept: cards.primary.dept };
  for (const b of edits.boxes) examCards[b.id] = { key: b.id, ...boxInfo(b.kind), items: [] };
  const certDetail = (c: CertificationRequirement) => c.kind === 'departmentExam' ? `통과 기준: ${c.passCriteria}`
    : c.kind === 'externalCertificate' ? c.acceptedTests.map((t) => `${t.name}: ${t.passCriteria}`).join(' / ') : c.description;
  for (const { scope, cert } of resolved?.certifications ?? []) {
    if (report && cert.kind === 'departmentExam' && !confirmed.has(cert.id) && !edits.renamed[cert.id] && !edits.redetailed?.[cert.id]) continue;
    const st = shortTitle(cert.title);
    examCards[cardKeyOf(null, scope)].items.push({ id: cert.id, title: st.short, head: st.head, full: st.full, detail: certDetail(cert), rest: st.rest, confirmed: confirmed.has(cert.id) });
  }
  const assessmentGroups = report ? groupAssessments(report) : [];
  const assessmentGuides = report ? departmentAssessmentGuides(profile, catalog.officialRules, departmentFacts) : [];
  for (const g of assessmentGroups) {
    const e = g.eval;
    const dept = e.rule.departmentId;
    const st = shortTitle(ruleTitle(e.rule, dept ? departmentName(dept) : undefined));
    const criterion = (item: typeof e) => assessmentCriteria(item.rule.detail as Record<string, unknown> | null | undefined);
    const choices = [criterion(e), ...g.alternatives.map(criterion)];
    const detail = (choices.length > 1 ? `하나 선택 [${choices.join(' / ')}]` : choices[0])
      + (g.information.length ? ` · ${g.information.map(criterion).join(' · ')}` : '');
    const school = e.rule.category === 'commonLanguageCertification';
    // 학과 기준은 안내로만 제공한다. 사용자가 이미 수정·체크한 항목은 기존 목록에 보존한다.
    if (!school && !confirmed.has(e.rule.id) && !edits.renamed[e.rule.id] && !edits.redetailed?.[e.rule.id]) continue;
    examCards[school ? 'common' : cardKeyOf(dept)].items.push({
      id: e.rule.id, title: st.short, head: st.head, full: st.full, detail, rest: '', confirmed: confirmed.has(e.rule.id),
    });
  }
  for (const card of Object.values(examCards)) {
    card.items = card.items.map((i) => {
      const n = edits.renamed[i.id];
      const d = edits.redetailed?.[i.id];
      const named = n ? { ...i, title: n, head: n, full: n, rest: '' } : i;
      return d === undefined ? named : { ...named, detail: d, baseDetail: i.detail };
    });
    for (const x of edits.extraExams.filter((e) => e.card === card.key)) {
      card.items.push({ id: x.id, title: x.title, head: x.title, full: x.title, detail: x.detail, rest: '', confirmed: confirmed.has(x.id), extra: true });
    }
  }
  const examList = [examCards.primary, ...(secondary ? [examCards.secondary] : []), examCards.common].filter((c) => c.key !== 'common' || c.items.length)
    .concat(edits.boxes.map((b) => examCards[b.id])); // 직접 만든 구분은 비어 있어도 보인다

  // ---- 항목 더하기 ----
  const addCourse = (card: string, name: string): string | null => {
    const list = reqCards.find((c) => c.key === card)?.items ?? [];
    if (list.some((it) => !it.group && normalizeCourseName(it.label) === normalizeCourseName(name))) return '이미 있는 과목이에요.';
    void setEdits((e) => ({ ...e, extraCourses: [...e.extraCourses, { id: newId('xc'), card, name }] }));
    setPrompt(null); setMode((o) => ({ ...o, [`req:${card}`]: undefined })); setOpen((o) => ({ ...o, [`req:${card}`]: true }));
    return null;
  };
  const addExam = (card: string, title: string, detail: string): string | null => {
    const list = examList.find((c) => c.key === card)?.items ?? [];
    if (list.some((it) => normalizeCourseName(it.full) === normalizeCourseName(title))) return '이미 있는 시험이에요.';
    void setEdits((e) => ({ ...e, extraExams: [...e.extraExams, { id: newId('xe'), card, title, detail }] }));
    setPrompt(null); setMode((o) => ({ ...o, [`exam:${card}`]: undefined })); setOpen((o) => ({ ...o, [`exam:${card}`]: true }));
    return null;
  };
  const coursePrompt = prompt && 'card' in prompt && prompt.kind === 'course' ? prompt : null;
  const examPrompt = prompt && 'card' in prompt && prompt.kind === 'exam' ? prompt : null;

  const coverageFor = (key: string, category: 'requiredCourses' | 'departmentAssessment') => report?.coverage.find((r) => r.scope === key && r.category === category);
  const emptyMessage = (key: string, category: 'requiredCourses' | 'departmentAssessment') => {
    const row = coverageFor(key, category);
    if (row?.basis === 'none' && row.determinable) return '요건 없음';
    const input = [...new Set(row?.notes.filter((n) => n.kind === 'needsInput').map((n) => n.text))];
    return input?.length ? `확인 필요 · ${input.join(' · ')}` : '확인 필요';
  };
  const specialAdmission = profile.facts?.foreignLanguageSpecialAdmission === true;
  /** shown = 카드 제목 줄에 이미 같은 '확인 필요 · …' 문구가 보이는 상태 (안내에서 되풀이하지 않는다) */
  const inquiry = (key: string, category: 'requiredCourses' | 'departmentAssessment', shown = false) => {
    const row = coverageFor(key, category);
    if (category === 'departmentAssessment') {
      const guides = assessmentGuides.filter((g) => g.scope === key);
      const departmentId = key === 'primary' ? profile.primaryDepartmentId : secondary;
      const contact = departmentId ? departmentMetaById(departmentId)?.contact : undefined;
      const url = contact?.graduationPageUrl || contact?.homepageUrl;
      return <div className="sc-check-hint">
        {guides.length ? guides.map((g) => <p key={g.id}>{key === 'primary' ? '주전공' : secondLabel} · {departmentName(departmentId)} · {g.text}</p>)
          : <p>{departmentName(departmentId)} · 학과 졸업시험·논문 세부 기준은 학과 안내를 확인해 주세요.</p>}
        <p>본인에게 해당하는 졸업 요건을 직접 추가해 관리해 주세요. 학교 외국어 졸업인증은 별도예요.</p>
        {url && <p><SafeLink href={url}>학과 공식 안내</SafeLink></p>}
      </div>;
    }
    if (!row || row.determinable) return null;
    // LD의 연도·학기 미입력은 상단 학생 조건 입력에서 해결한다.
    // 입력 후에도 남는 실제 소급 적용·자료 불확실성은 문의 안내를 유지한다.
    const pending = report?.evals.filter((e) => e.scope === key && e.rule.category === category
      && e.cls !== 'confirmed' && !e.rule.none) ?? [];
    if (row.departmentId === 'seoul-ba8cdb1563' && pending.length > 0
      && pending.every((e) => e.askFields.some((field) => ['dualSelectionYear', 'graduationTerm'].includes(field)
        && (profile.facts?.[field] === undefined || profile.facts?.[field] === null)))) return null;
    return <div className="sc-check-hint">{row.notes.some((n) => n.kind === 'needsInput')
      ? shown ? null : emptyMessage(key, category)
      : <>학과 확인이 필요해요. 현재 자료만으로는 본인에게 적용되는 기준을 확인하기 어려워요. 학과에 문의해 주세요.</>}
      <InquiryContact departmentId={row.departmentId} /></div>;
  };
  /** 특별전형으로 입학한 학생에게 전용 목록이 없는 카드: 일반 목록을 적용하지 않고 학과 확인으로 안내한다 */
  const specialInquiry = (key: string, total: number) => {
    if (!specialAdmission || total > 0) return null;
    const departmentId = key === 'primary' ? profile.primaryDepartmentId : key === 'secondary' ? secondary : undefined;
    return <div className="sc-check-hint">특별전형 입학생 기준은 학과에 확인해 주세요<InquiryContact departmentId={departmentId} /></div>;
  };
  // ---- 상단 요약 ----
  const required = progress.total.required;
  const remaining = progress.hasRecords ? progress.total.remaining : null;
  const pct = required && required > 0 ? Math.min(100, Math.round((progress.total.earned / required) * 100)) : 0;
  const goSection = (k: Section) => { setSec(k); document.getElementById(`st-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const flip = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const areas = progress.areas.filter((a) => a.required !== undefined);

  return (
    <div className="page">
      <h1 className="page-title">내 학사현황</h1>
      <p className="st-meta">
        {String(profile.cohortYear).slice(2)}학번{profile.currentYear ? <><span className="sep">ㅣ</span>{profile.currentYear}학년</> : null}
        <span className="sep">ㅣ</span>{ENTRY_LABEL[profile.entryType]}<span className="sep">ㅣ</span>{CAMPUS_LABEL[profile.homeCampus]}
        <br /><b>{cards.primary.dept}</b>{secondary && <> <span className="sep">|</span> <b>{cards.secondary.dept}</b></>}
      </p>

      {/* Figma: 계단 위에 현재 학년의 캐릭터가 선다 (학년을 바꾸면 같이 바뀐다) */}
      <div className="stairs" role="img" aria-label={profile.currentYear ? `${profile.currentYear}학년: 계단 ${profile.currentYear}층` : '계단'}>
        <img className="stairs-bg" src={STAIRS_IMG} alt="" />
        {profile.currentYear && <img className={`stair-char s${profile.currentYear}`} data-year={profile.currentYear} src={stairCharacter(profile.currentYear)} alt="" />}
      </div>
      <section className="remain-card" aria-label="졸업까지 남은 학점">
        <p className="t">졸업까지 남은 총 학점</p>
        <p className="big"><span>{remaining === null ? '—' : formatUnits(Math.max(0, remaining))}</span><small>학점</small></p>
        <div className="line" role="progressbar" aria-label="전체 이수 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
        <p className="got">{progress.hasRecords
          ? <><b>{formatUnits(progress.total.earned)}</b>{required !== null && <span>/{formatUnits(required)}</span>} 학점 취득</>
          : '종정시 정보를 저장하면 표시돼요'}</p>
      </section>

      <div className="pill-tabs" role="group" aria-label="학사 현황 구간" style={{ marginTop: 24 }}>
        {SECTIONS.map((s) => <button key={s.key} type="button" aria-pressed={sec === s.key} onClick={() => goSection(s.key)}>{s.label}</button>)}
      </div>

      <section id="st-credits" className="st-section" aria-labelledby="h-credits">
        <h2 id="h-credits" className="num-head"><b>01</b>영역별 이수학점</h2>
        {areas.length === 0 ? <p className="st-empty">종정시 정보를 저장하면 영역별 이수학점이 표시돼요.</p> : (
          <div className="area-box">
            {areas.map((a) => {
              const pctA = a.required ? Math.min(100, Math.round((a.earned / a.required) * 100)) : 0;
              return (
                <div key={a.area} className={`area-row${a.status === 'met' ? ' met' : ''}`}>
                  <p className="top"><span>{AREA_LABEL[a.area]}</span><span><span className="got">{formatUnits(a.earned)}</span><span className="of">/{formatUnits(a.required!)}학점</span></span></p>
                  <div className="area-bar" role="progressbar" aria-label={`${AREA_LABEL[a.area]} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctA}><i style={{ width: `${pctA}%` }} /></div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <QuestionsCard />
      <section id="st-courses" className="st-section" aria-labelledby="h-courses">
        <h2 id="h-courses" className="num-head"><b>02</b>졸업 필수 과목</h2>
        <div className="sc-list">
          {reqCards.map((c) => {
            const done = c.total > 0 && c.met >= c.total;
            const personal = c.items.some((it) => it.extra || removedIds.has(it.id) || it.done && it.direct);
            const k = `req:${c.key}`;
            return (
              <div key={c.key} className="sc">
                <div className="sc-top">
                  <p className="who">{c.who}</p>
                  <div className="line">
                    <span className="dept">{c.dept}</span>
                    {c.total === 0 ? <span className="sc-state">—</span> : done
                      ? <span className="sc-state done"><i className="icon ic-check" aria-hidden="true" />{personal ? '개인 기준 완료' : coverageFor(c.key, 'requiredCourses')?.determinable === false ? '확인된 목록 이수' : '이수 완료'}</span>
                      : <span className="sc-state todo"><i className="icon ic-dash" aria-hidden="true" />미이수</span>}
                  </div>
                </div>
                <button type="button" className={`sc-row${c.total > 0 && !done ? ' todo' : ''}${open[k] ? ' open' : ''}`} aria-expanded={!!open[k]} onClick={() => flip(k)}>
                  <span>{c.total === 0 ? personal ? '개인 제외 적용' : emptyMessage(c.key, 'requiredCourses') : `${c.met}/${c.total}과목`}</span><i className="icon ic-chevron" aria-hidden="true" />
                </button>
                {open[k] && (
                  <Panel filled={c.items.length > 0} mode={mode[k]} onMode={(m) => toggleMode(k, m)} addLabel="졸업 필수 과목 추가하기" onAdd={() => setPrompt({ kind: 'course', card: c.key })}>
                    {c.items.filter((it) => mode[k] === 'delete' || !removedIds.has(it.id)).map((it, i) => (
                      <li key={`${it.id}-${i}`} className={`sc-item${it.done ? ' met' : ''}${it.depth > 0 ? ' nest' : ''}`}>
                        {it.group ? <span className="grp">{it.label}</span> : (
                          <>
                            {mode[k] === 'edit'
                              ? <NameInput value={it.label} label={`${it.label} 이름`} onCommit={(v) => renameCourse(it, v)} />
                              : <span className="tx">{it.label}{it.note && <span className="sub">{it.note}</span>}</span>}
                            {mode[k] === 'delete' ? <button type="button" className="sc-pill del" aria-label={`${it.label} ${removedIds.has(it.id) ? '복구' : '삭제'}`} onClick={() => (removedIds.has(it.id) ? removeCourse(it) : setAskDel({ kind: 'course', it }))}>{removedIds.has(it.id) ? '복구' : '삭제'}</button> : (
                            <span className="sc-course-status">
                            {it.attending && <span className="sc-state todo sc-attending"><i className="icon ic-dash" aria-hidden="true" />{it.attending.isRetake ? '재수강 중' : '수강 중'}</span>}
                            {it.canCheck ? (
                              <button type="button" className={it.done ? 'sc-done' : 'sc-check'} aria-pressed={confirmed.has(it.id)}
                                aria-label={`${it.label} ${confirmed.has(it.id) ? '이수 취소' : '이수'}`} onClick={() => toggleConfirm(it.id)}>
                                {it.done && <i className="icon ic-check" aria-hidden="true" />}{it.done ? `이수 완료${it.direct ? ' · 직접 확인' : ''}` : it.extra ? '미이수' : '이수'}
                              </button>
                            ) : it.done && <span className="sc-done"><i className="icon ic-check" aria-hidden="true" />이수 완료{it.direct && ' · 직접 확인'}</span>}
                            </span>
                            )}
                          </>
                        )}
                      </li>
                    ))}
                  </Panel>
                )}
                {specialAdmission && c.total === 0 ? specialInquiry(c.key, c.total) : inquiry(c.key, 'requiredCourses', c.total === 0)}
                {specialDefault.has(c.key) && <p className="sc-check-hint">외국어 특기자 등 특별전형으로 입학했다면 전공 정보에서 바꿔 주세요</p>}
                {open[k] && c.items.some((it) => it.canCheck) && <p className="sc-check-hint">직접 이수 표시는 취득학점·평점에 더해지지 않아요.</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section id="st-exams" className="st-section" aria-labelledby="h-exams">
        <h2 id="h-exams" className="num-head"><b>03</b>졸업 시험 및 요건</h2>
        {examList.length === 0 && <p className="st-empty">{report?.coverage.filter((r) => r.category === 'departmentAssessment')
          .every((r) => r.basis === 'none' && r.determinable) ? '요건 없음' : '학과 확인이 필요해요. 현재 자료만으로는 본인에게 적용되는 기준을 확인하기 어려워요. 학과에 문의해 주세요.'}</p>}
        {examList.length > 0 && (
          <div className="sc-list">
            {examList.map((c) => {
              const active = c.items.filter((it) => !removedIds.has(it.id));
              const has = active.length > 0;
              const done = has && active.some((i) => i.confirmed); // 하나만 충족해도 졸업 가능한 학과가 있어 하나만 체크해도 이수
              const k = `exam:${c.key}`;
              return (
                <div key={c.key} className="sc">
                  <div className="sc-top">
                    <p className="who">{c.who}</p>
                    <div className="line">
                      <span className="dept">{c.dept}</span>
                      {!has ? <span className="sc-state">—</span> : done ? <span className="sc-state done"><i className="icon ic-check" aria-hidden="true" />이수 완료</span>
                        : <span className="sc-state todo"><i className="icon ic-dash" aria-hidden="true" />미이수</span>}
                    </div>
                  </div>
                  <button type="button" className={`sc-row${has && !done ? ' todo' : ''}${open[k] ? ' open' : ''}`} aria-expanded={!!open[k]} onClick={() => flip(k)}>
                    {has ? <span title={active[0].full}>{active[0].title}{active.length > 1 ? ` 외 ${active.length - 1}건` : ''}</span> : <span>{c.items.length ? '개인 제외 적용' : '졸업 시험 및 요건 안내'}</span>}
                    <i className="icon ic-chevron" aria-hidden="true" />
                  </button>
                  {open[k] && (
                    <Panel filled={c.items.length > 0} mode={mode[k]} onMode={(m) => toggleMode(k, m)} addLabel="졸업 시험 추가하기" onAdd={() => setPrompt({ kind: 'exam', card: c.key })}>
                      {c.items.filter((it) => mode[k] === 'delete' || !removedIds.has(it.id)).map((it) => (
                        <li key={it.id} className={`sc-item${it.confirmed ? ' met' : ''}`}>
                          {mode[k] !== 'delete' && (
                            <button type="button" className="cbx" role="checkbox" aria-checked={it.confirmed}
                              aria-label={`${it.full} 응시·통과 체크`} onClick={() => toggleConfirm(it.id)}>
                              {it.confirmed && <i className="icon ic-check" aria-hidden="true" />}
                            </button>
                          )}
                          <span className="tx">
                            {mode[k] === 'delete' && removedIds.has(it.id) && '복구 · '}{mode[k] === 'edit' ? <NameInput value={it.head} label={`${it.full} 이름`} onCommit={(v) => renameExam(it, v)} /> : it.head}
                            {mode[k] === 'edit'
                              ? <NameInput value={it.detail} max={120} label={`${it.full} 합격 기준`} onCommit={(v) => redetailExam(it, v)} />
                              : it.detail && <span className="sub">{it.detail}{it.baseDetail !== undefined && <span className="contact-checked">내가 수정함</span>}</span>}
                            {/* 학생이 고쳐도 원래 학교 기준을 함께 둔다 */}
                            {mode[k] !== 'edit' && it.baseDetail && <span className="sub">원래 기준: {it.baseDetail}</span>}
                            {it.rest && it.rest !== it.detail && !it.detail.includes(it.rest) && <span className="sub">{it.rest}</span>}
                          </span>
                          {mode[k] === 'delete' && (
                            <button type="button" className="sc-pill del" aria-label={`${it.full} ${removedIds.has(it.id) ? '복구' : '삭제'}`}
                              onClick={() => (removedIds.has(it.id) ? removeExam(it) : setAskDel({ kind: 'exam', it }))}>{removedIds.has(it.id) ? '복구' : '삭제'}</button>
                          )}
                        </li>
                      ))}
                    </Panel>
                  )}
                  {open[k] && (c.key === 'primary' || c.key === 'secondary') && inquiry(c.key, 'departmentAssessment')}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {askDel && (
        <Confirm title={`‘${askDel.kind === 'course' ? askDel.it.label : askDel.it.full}’ \n${askDel.kind === 'course' ? '과목을' : '졸업 시험을'} 삭제하시겠습니까?`} yes="삭제" no="취소" danger
          onYes={() => { if (askDel.kind === 'course') removeCourse(askDel.it); else removeExam(askDel.it); setAskDel(null); }}
          onNo={() => setAskDel(null)} />
      )}
      {coursePrompt && <FieldPrompt title="졸업 필수 과목 추가" fields={[{ label: '과목명', required: true, max: 60 }]} submitLabel="해당 과목 추가하기"
        onClose={() => setPrompt(null)} onSubmit={([name]) => addCourse(coursePrompt.card, name)} />}
      {examPrompt && <FieldPrompt title="졸업 시험 추가" fields={[{ label: '시험명', required: true, max: 60 }, { label: '점수 요건', required: false, max: 100 }]} submitLabel="해당 시험 정보 추가하기"
        onClose={() => setPrompt(null)} onSubmit={([title, detail]) => addExam(examPrompt.card, title, detail)} />}
    </div>
  );
}

/** 열린 목록: 연필(이름 고치기)·휴지통(지우기) 도구, 줄들, '추가하기'. 항목이 없으면 추가하기만 (Figma 229:709 · 232:838) */
function Panel({ filled, mode, onMode, addLabel, onAdd, children }: {
  filled: boolean; mode: 'edit' | 'delete' | undefined; onMode: (m: 'edit' | 'delete') => void; addLabel: string; onAdd: () => void; children: ReactNode;
}) {
  return (
    <div className={`sc-list-in${filled ? '' : ' empty'}`}>
      {filled && (
        <div className="sc-tools">
          <button type="button" className="sc-tool" aria-label="이름 고치기" aria-pressed={mode === 'edit'} onClick={() => onMode('edit')}><i className="icon ic-pencil" aria-hidden="true" /></button>
          <button type="button" className="sc-tool" aria-label="지우기" aria-pressed={mode === 'delete'} onClick={() => onMode('delete')}><i className="icon ic-trash" aria-hidden="true" /></button>
        </div>
      )}
      {filled && <ul className="sc-rows">{children}</ul>}
      <button type="button" className="sc-add" onClick={onAdd}><i className="icon ic-plus" aria-hidden="true" />{addLabel}</button>
    </div>
  );
}

/** 이름·요건 고치기: 칸을 벗어나거나 Enter를 누르면 저장한다. 비워 두면 원래 값으로 돌아간다. */
function NameInput({ value, label, max = 60, onCommit }: { value: string; label: string; max?: number; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className="nm-in" aria-label={label} value={v} maxLength={max} spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() && v.trim() !== value) onCommit(v); else setV(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}
