// 학사 현황 (Figma, §3.4). 내 조건 → 남은 학점 카드 → [이수학점 / 필수과목 / 졸업시험] 알약 탭 → 01 영역별 이수학점 → 02 졸업 필수 과목 → 03 졸업 시험 및 요건.
// 값은 종정시 데이터 + 졸업요건 규칙 + 학생이 직접 확인한 이수 기록으로 계산한다.
// 세부 과목을 모두 이수하면 카드 전체가 '이수 완료'가 된다. 졸업시험·요건은 학과마다 달라서 학생이 스스로 표시하는 체크리스트로만 보여 준다.
// 졸업 충족을 확정하지 않는다.
import { useEffect, useState, type ReactNode } from 'react';
import { stairCharacter, STAIRS_IMG } from '../../app/stairs';
import { useStore } from '../../app/store';
import { departmentName } from '../../data';
import { shortTitle } from '../../domain/requirements/displayTitle';
import { courseConfirmationIds, normalizeCourseName, ruleTitle, type NodeProgress } from '../../domain/requirements/officialRules';
import { emptyEdits, gradeCourses, newId, type AppState } from '../../domain/state';
import { formatUnits } from '../../domain/terms';
import { timetableRequirementStates } from '../../domain/timetableStatus';
import type { BoxKind, BundleScope, CertificationRequirement, CourseExpr, StatusEdits } from '../../domain/types';
import { AREA_LABEL, CAMPUS_LABEL, ENTRY_LABEL } from '../common';
import { BoxPrompt, FieldPrompt } from './AddPrompt';
import { assessmentCriteria } from './OfficialSections';
import { useProgress } from './useProgress';

type Section = 'credits' | 'courses' | 'exams';
const SECTIONS: { key: Section; label: string }[] = [{ key: 'credits', label: '01 이수학점' }, { key: 'courses', label: '02 필수과목' }, { key: 'exams', label: '03 졸업시험' }];
const CONFIRMABLE = new Set(['departmentAssessment', 'commonLanguageCertification']);
interface ReqItem { id: string; label: string; done: boolean; canCheck?: boolean; extra?: boolean; group?: boolean; depth: number; attending?: { isRetake: boolean } }
interface Card { key: string; who: string; dept: string; items: ReqItem[]; met: number; total: number }
/** title = 접힌 줄에 보이는 짧은 제목(길면 …), head = 펼친 목록에 보이는 줄이지 않은 제목, full = 전체 제목, detail·rest = 기준·설명(모두 보여 준다) */
interface ExamItem { id: string; title: string; head: string; full: string; detail: string; rest: string; confirmed: boolean; extra?: boolean }
interface ExamCard { key: string; who: string; dept: string; items: ExamItem[] }

/** [이수한 수, 필요한 수]: 택일(OR)은 1, AT_LEAST는 count로 센다 (택일 후보를 모두 필수처럼 세지 않는다) */
function countOf(p: NodeProgress): [number, number] {
  const n = p.node as CourseExpr;
  if (n.op === 'course') return [p.level > 0 ? 1 : 0, 1];
  const kids = p.children ?? [];
  if (n.op === 'OR') return [kids.some((k) => countOf(k)[0] >= countOf(k)[1] && countOf(k)[1] > 0) ? 1 : 0, 1];
  if (n.op === 'AT_LEAST') {
    const done = kids.filter((k) => { const [m, t] = countOf(k); return t > 0 && m >= t; }).length;
    return [Math.min(n.count, done), n.count];
  }
  return kids.reduce<[number, number]>((s, k) => { const [m, t] = countOf(k); return [s[0] + m, s[1] + t]; }, [0, 0]);
}

export function StatusScreen() {
  const { state, save, resolved, report, now } = useStore();
  const { progress, courseProgress } = useProgress();
  const [sec, setSec] = useState<Section>('credits');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const profile = state.profile!;
  const confirmed = new Set(state.certConfirmations.flatMap((c) => courseConfirmationIds(report, c.requirementId)));
  const attending = timetableRequirementStates(state, report);
  const secondLabel = profile.programType === 'double' ? '이중전공' : '부전공';
  const secondary = profile.secondaryDepartmentId;
  const edits = state.statusEdits ?? emptyEdits();
  const [mode, setMode] = useState<Record<string, 'edit' | 'delete' | undefined>>({});
  const [prompt, setPrompt] = useState<{ kind: 'course' | 'exam'; card: string } | { kind: 'box' } | null>(null);
  const toggleMode = (k: string, m: 'edit' | 'delete') => setMode((o) => ({ ...o, [k]: o[k] === m ? undefined : m }));
  const setEdits = (fn: (e: StatusEdits) => StatusEdits, more?: (s: AppState) => Partial<AppState>) =>
    save((s) => ({ ...s, ...more?.(s), statusEdits: fn(s.statusEdits ?? emptyEdits()) }));
  const cleanName = (v: string) => v.trim().replace(/\s+/g, ' ');
  const renameCourse = (it: ReqItem, v: string) => {
    const name = cleanName(v);
    if (name) void setEdits((e) => it.extra ? { ...e, extraCourses: e.extraCourses.map((x) => (x.id === it.id ? { ...x, name } : x)) } : { ...e, renamed: { ...e.renamed, [it.id]: name } });
  };
  const removeCourse = (it: ReqItem) => void setEdits((e) => it.extra ? { ...e, extraCourses: e.extraCourses.filter((x) => x.id !== it.id) } : { ...e, removed: [...e.removed, it.id] });
  const renameExam = (it: ExamItem, v: string) => {
    const name = cleanName(v);
    if (name) void setEdits((e) => it.extra ? { ...e, extraExams: e.extraExams.map((x) => (x.id === it.id ? { ...x, title: name } : x)) } : { ...e, renamed: { ...e.renamed, [it.id]: name } });
  };
  const removeExam = (it: ExamItem) => void setEdits(
    (e) => it.extra ? { ...e, extraExams: e.extraExams.filter((x) => x.id !== it.id) } : { ...e, removed: [...e.removed, it.id] },
    (s) => ({ certConfirmations: s.certConfirmations.filter((c) => c.requirementId !== it.id) }),
  );

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
  const cards: Record<'primary' | 'secondary' | 'common', Card> = {
    primary: { key: 'primary', who: '주전공', dept: departmentName(profile.primaryDepartmentId), items: [], met: 0, total: 0 },
    secondary: { key: 'secondary', who: secondLabel, dept: departmentName(secondary), items: [], met: 0, total: 0 },
    common: { key: 'common', who: '학교 공통', dept: '', items: [], met: 0, total: 0 },
  };
  for (const g of progress.groups) {
    const card = cards[cardKeyOf(null, g.scope)];
    const done = g.status === 'met' || confirmed.has(g.group.id);
    card.items.push({ id: g.group.id, label: g.group.title, done, canCheck: g.status !== 'met', depth: 0 });
    card.total += 1; card.met += done ? 1 : 0;
  }
  const walk = (p: NodeProgress, depth: number, out: ReqItem[]) => {
    const n = p.node as CourseExpr;
    if (n.op === 'course') {
      // 성적표로 확인된 이수는 그대로 두고, 미이수·직접 확인한 줄에만 버튼을 둔다.
      out.push({ id: n.id, label: n.name, done: p.level > 0 || confirmed.has(n.id), canCheck: p.level === 0 || p.state === 'selfConfirmed' || confirmed.has(n.id), depth, attending: attending.get(n.id) });
      return;
    }
    const head = n.op === 'AT_LEAST' ? `다음 중 ${n.count}과목 이상` : n.op === 'OR' ? '다음 중 1과목' : null;
    if (head) out.push({ id: `${depth}-${out.length}-${head}`, label: head, done: p.level > 0, group: true, depth });
    // 택일에서 선택되지 않은 갈래도 펼쳐서, 학생이 다른 후보를 직접 이수 표시할 수 있다.
    for (const c of p.children ?? n.items.map((node) => ({ node, level: 0 as const }))) walk(c, head ? depth + 1 : depth, out);
  };
  for (const cp of courseProgress) {
    const card = cards[cardKeyOf(cp.eval.rule.departmentId)];
    walk(cp.root, 0, card.items);
    const [m, t] = countOf(cp.root);
    card.met += m; card.total += t;
  }
  // 학생이 고친 내용: 지운 과목은 세지 않고, 더한 과목은 같은 이름의 이수 과목이 있으면 이수로 센다
  const removedIds = new Set(edits.removed);
  const taken = new Set(gradeCourses(state.courses).filter((c) => c.status === 'completed').map((c) => normalizeCourseName(c.name)));
  for (const card of Object.values(cards)) {
    const kept: ReqItem[] = [];
    for (const it of card.items) {
      if (!it.group && removedIds.has(it.id)) {
        card.total = Math.max(0, card.total - 1);
        if (it.done) card.met = Math.max(0, card.met - 1);
        continue;
      }
      kept.push({ ...it, label: edits.renamed[it.id] ?? it.label });
    }
    for (const x of edits.extraCourses.filter((c) => c.card === card.key)) {
      const done = taken.has(normalizeCourseName(x.name)) || confirmed.has(x.id);
      kept.push({ id: x.id, label: x.name, done, canCheck: true, depth: 0, extra: true });
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
    const st = shortTitle(cert.title);
    examCards[cardKeyOf(null, scope)].items.push({ id: cert.id, title: st.short, head: st.head, full: st.full, detail: certDetail(cert), rest: st.rest, confirmed: confirmed.has(cert.id) });
  }
  for (const e of report?.items ?? []) {
    if (!CONFIRMABLE.has(e.rule.category) || e.rule.none) continue;
    const dept = e.rule.departmentId;
    const st = shortTitle(ruleTitle(e.rule, dept ? departmentName(dept) : undefined));
    examCards[cardKeyOf(dept)].items.push({
      id: e.rule.id, title: st.short, head: st.head, full: st.full,
      detail: assessmentCriteria(e.rule.detail as Record<string, unknown> | null | undefined), rest: st.rest, confirmed: confirmed.has(e.rule.id),
    });
  }
  for (const card of Object.values(examCards)) {
    card.items = card.items.filter((i) => !removedIds.has(i.id)).map((i) => {
      const n = edits.renamed[i.id];
      return n ? { ...i, title: n, head: n, full: n, rest: '' } : i;
    });
    for (const x of edits.extraExams.filter((e) => e.card === card.key)) {
      card.items.push({ id: x.id, title: x.title, head: x.title, full: x.title, detail: x.detail, rest: '', confirmed: confirmed.has(x.id), extra: true });
    }
  }
  const examList = [examCards.primary, ...(secondary ? [examCards.secondary] : []), examCards.common].filter((c) => c.items.length)
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
  const addBox = (kind: BoxKind) => {
    const bid = newId('bx');
    void setEdits((e) => ({ ...e, boxes: [...e.boxes, { id: bid, kind }] }));
    setPrompt(null); setOpen((o) => ({ ...o, [`exam:${bid}`]: true }));
  };
  const coursePrompt = prompt && 'card' in prompt && prompt.kind === 'course' ? prompt : null;
  const examPrompt = prompt && 'card' in prompt && prompt.kind === 'exam' ? prompt : null;

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

      <section id="st-courses" className="st-section" aria-labelledby="h-courses">
        <h2 id="h-courses" className="num-head"><b>02</b>졸업 필수 과목</h2>
        <div className="sc-list">
          {reqCards.map((c) => {
            const done = c.total > 0 && c.met >= c.total;
            const k = `req:${c.key}`;
            return (
              <div key={c.key} className="sc">
                <div className="sc-top">
                  <p className="who">{c.who}</p>
                  <div className="line">
                    <span className="dept">{c.dept}</span>
                    {c.total === 0 ? <span className="sc-state">—</span> : done
                      ? <span className="sc-state done"><i className="icon ic-check" aria-hidden="true" />이수 완료</span>
                      : <span className="sc-state todo"><i className="icon ic-dash" aria-hidden="true" />미이수</span>}
                  </div>
                </div>
                <button type="button" className={`sc-row${c.total > 0 && !done ? ' todo' : ''}${open[k] ? ' open' : ''}`} aria-expanded={!!open[k]} onClick={() => flip(k)}>
                  <span>{c.total === 0 ? '확인할 과목이 없어요' : `${c.met}/${c.total}과목`}</span><i className="icon ic-chevron" aria-hidden="true" />
                </button>
                {open[k] && (
                  <Panel filled={c.items.length > 0} mode={mode[k]} onMode={(m) => toggleMode(k, m)} addLabel="졸업 필수 과목 추가하기" onAdd={() => setPrompt({ kind: 'course', card: c.key })}>
                    {c.items.map((it, i) => (
                      <li key={`${it.id}-${i}`} className={`sc-item${it.done ? ' met' : ''}${it.depth > 0 ? ' nest' : ''}`}>
                        {it.group ? <span className="grp">{it.label}</span> : (
                          <>
                            {mode[k] === 'edit'
                              ? <NameInput value={it.label} label={`${it.label} 이름`} onCommit={(v) => renameCourse(it, v)} />
                              : <span className="tx">{it.label}</span>}
                            {mode[k] === 'delete' ? <button type="button" className="sc-pill del" aria-label={`${it.label} 삭제`} onClick={() => removeCourse(it)}>삭제</button> : (
                            <span className="sc-course-status">
                            {it.attending && <span className="sc-state todo sc-attending"><i className="icon ic-dash" aria-hidden="true" />{it.attending.isRetake ? '재수강 중' : '수강 중'}</span>}
                            {it.canCheck ? (
                              <button type="button" className={it.done ? 'sc-done' : 'sc-check'} aria-pressed={confirmed.has(it.id)}
                                aria-label={`${it.label} ${confirmed.has(it.id) ? '이수 취소' : '이수'}`} onClick={() => toggleConfirm(it.id)}>
                                {it.done && <i className="icon ic-check" aria-hidden="true" />}{it.done ? '이수 완료' : '이수'}
                              </button>
                            ) : it.done && <span className="sc-done"><i className="icon ic-check" aria-hidden="true" />이수 완료</span>}
                            </span>
                            )}
                          </>
                        )}
                      </li>
                    ))}
                  </Panel>
                )}
                {open[k] && c.items.some((it) => it.canCheck) && <p className="sc-check-hint">직접 이수 표시는 취득학점·평점에 더해지지 않아요.</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section id="st-exams" className="st-section" aria-labelledby="h-exams">
        <h2 id="h-exams" className="num-head"><b>03</b>졸업 시험 및 요건</h2>
        {examList.length === 0 && <p className="st-empty">확인할 졸업시험·요건이 없어요.</p>}
        {examList.length > 0 && (
          <div className="sc-list">
            {examList.map((c) => {
              const has = c.items.length > 0;
              const done = has && c.items.every((i) => i.confirmed);
              const k = `exam:${c.key}`;
              return (
                <div key={c.key} className="sc">
                  <div className="sc-top">
                    <p className="who">{c.who}</p>
                    <div className="line">
                      <span className="dept">{c.dept}</span>
                      {!has ? <span className="sc-state">—</span> : done ? <span className="sc-state done"><i className="icon ic-check" aria-hidden="true" />응시 완료</span>
                        : <span className="sc-state todo"><i className="icon ic-dash" aria-hidden="true" />미응시</span>}
                    </div>
                  </div>
                  <button type="button" className={`sc-row${has && !done ? ' todo' : ''}${open[k] ? ' open' : ''}`} aria-expanded={!!open[k]} onClick={() => flip(k)}>
                    {has ? <span title={c.items[0].full}>{c.items[0].title}{c.items.length > 1 ? ` 외 ${c.items.length - 1}건` : ''}</span> : <span>확인할 시험이 없어요</span>}
                    <i className="icon ic-chevron" aria-hidden="true" />
                  </button>
                  {open[k] && (
                    <Panel filled={has} mode={mode[k]} onMode={(m) => toggleMode(k, m)} addLabel="졸업 시험 추가하기" onAdd={() => setPrompt({ kind: 'exam', card: c.key })}>
                      {c.items.map((it) => (
                        <li key={it.id} className={`sc-item${it.confirmed ? ' met' : ''}`}>
                          <button type="button" className="cbx" role="checkbox" aria-checked={mode[k] === 'delete' ? false : it.confirmed}
                            aria-label={mode[k] === 'delete' ? `${it.full} 삭제` : `${it.full} 응시·통과 체크`}
                            onClick={() => (mode[k] === 'delete' ? removeExam(it) : toggleConfirm(it.id))}>
                            {it.confirmed && mode[k] !== 'delete' && <i className="icon ic-check" aria-hidden="true" />}
                          </button>
                          <span className="tx">
                            {mode[k] === 'edit' ? <NameInput value={it.head} label={`${it.full} 이름`} onCommit={(v) => renameExam(it, v)} /> : it.head}
                            {it.detail && <span className="sub">{it.detail}</span>}
                            {it.rest && it.rest !== it.detail && !it.detail.includes(it.rest) && <span className="sub">{it.rest}</span>}
                          </span>
                        </li>
                      ))}
                    </Panel>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className="sc-addbox" onClick={() => setPrompt({ kind: 'box' })}><i className="icon ic-plus" aria-hidden="true" />졸업 요건 추가하기</button>
      </section>

      {coursePrompt && <FieldPrompt title="졸업 필수 과목 추가" fields={[{ label: '과목명', required: true, max: 60 }]} submitLabel="해당 과목 추가하기"
        onClose={() => setPrompt(null)} onSubmit={([name]) => addCourse(coursePrompt.card, name)} />}
      {examPrompt && <FieldPrompt title="졸업 시험 추가" fields={[{ label: '시험명', required: true, max: 60 }, { label: '점수 요건', required: false, max: 100 }]} submitLabel="해당 시험 정보 추가하기"
        onClose={() => setPrompt(null)} onSubmit={([title, detail]) => addExam(examPrompt.card, title, detail)} />}
      {prompt?.kind === 'box' && <BoxPrompt onClose={() => setPrompt(null)} onSubmit={addBox} />}
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

/** 이름 고치기: 칸을 벗어나거나 Enter를 누르면 저장한다. 비워 두면 원래 이름으로 돌아간다. */
function NameInput({ value, label, onCommit }: { value: string; label: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className="nm-in" aria-label={label} value={v} maxLength={60} spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() && v.trim() !== value) onCommit(v); else setV(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}
