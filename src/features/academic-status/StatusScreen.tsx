// 학사 현황 (Figma, §3.4). 내 조건 → 남은 학점 카드 → [이수학점 / 필수과목 / 졸업시험] 알약 탭 → 01 영역별 이수학점 → 02 졸업 필수 과목 → 03 졸업 시험 및 요건.
// 값은 모두 종정시에서 저장한 데이터 + 졸업요건 규칙으로 계산한다. 필수과목은 이수한 줄에 '이수 완료'만 붙고(학생이 체크하는 칸은 없다),
// 세부 과목을 모두 이수하면 카드 전체가 '이수 완료'가 된다. 졸업시험·요건은 학과마다 달라서 학생이 스스로 표시하는 체크리스트로만 보여 준다.
// 졸업 충족을 확정하지 않는다.
import { useState } from 'react';
import { useStore } from '../../app/store';
import { departmentName } from '../../data';
import { ruleTitle, type NodeProgress } from '../../domain/requirements/officialRules';
import { formatUnits } from '../../domain/terms';
import type { BundleScope, CertificationRequirement, CourseExpr } from '../../domain/types';
import { AREA_LABEL, CAMPUS_LABEL, ENTRY_LABEL } from '../common';
import { assessmentCriteria } from './OfficialSections';
import { useProgress } from './useProgress';

type Section = 'credits' | 'courses' | 'exams';
const SECTIONS: { key: Section; label: string }[] = [{ key: 'credits', label: '01 이수학점' }, { key: 'courses', label: '02 필수과목' }, { key: 'exams', label: '03 졸업시험' }];
const CONFIRMABLE = new Set(['departmentAssessment', 'commonLanguageCertification']);

interface ReqItem { id: string; label: string; done: boolean; group?: boolean; depth: number }
interface Card { key: string; who: string; dept: string; items: ReqItem[]; met: number; total: number }
interface ExamItem { id: string; title: string; detail: string; confirmed: boolean }
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
  const { state, save, setView, resolved, report, now } = useStore();
  const { progress, courseProgress } = useProgress();
  const [sec, setSec] = useState<Section>('credits');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const profile = state.profile!;
  const confirmed = new Set(state.certConfirmations.map((c) => c.requirementId));
  const secondLabel = profile.programType === 'double' ? '이중전공' : '부전공';
  const secondary = profile.secondaryDepartmentId;

  const toggleConfirm = (id: string) => void save((s) => ({
    ...s,
    certConfirmations: confirmed.has(id)
      ? s.certConfirmations.filter((c) => c.requirementId !== id)
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
    const done = g.status === 'met';
    card.items.push({ id: g.group.id, label: g.group.title, done, depth: 0 });
    card.total += 1; card.met += done ? 1 : 0;
  }
  const walk = (p: NodeProgress, depth: number, out: ReqItem[]) => {
    const n = p.node as CourseExpr;
    if (n.op === 'course') {
      out.push({ id: n.id, label: n.name, done: p.level > 0, depth });
      return;
    }
    const head = n.op === 'AT_LEAST' ? `다음 중 ${n.count}과목 이상` : n.op === 'OR' ? '다음 중 1과목' : null;
    if (head) out.push({ id: `${depth}-${out.length}-${head}`, label: head, done: p.level > 0, group: true, depth });
    for (const c of p.children ?? []) walk(c, head ? depth + 1 : depth, out);
  };
  for (const cp of courseProgress) {
    const card = cards[cardKeyOf(cp.eval.rule.departmentId)];
    walk(cp.root, 0, card.items);
    const [m, t] = countOf(cp.root);
    card.met += m; card.total += t;
  }
  const reqCards = [cards.primary, ...(secondary ? [cards.secondary] : []), ...(cards.common.items.length ? [cards.common] : [])];

  // ---- 03 졸업 시험 및 요건 카드 만들기 ----
  const examCards: Record<'primary' | 'secondary' | 'common', ExamCard> = {
    primary: { key: 'primary', who: '주전공', dept: cards.primary.dept, items: [] },
    secondary: { key: 'secondary', who: secondLabel, dept: cards.secondary.dept, items: [] },
    common: { key: 'common', who: '학교 공통', dept: '', items: [] },
  };
  const certDetail = (c: CertificationRequirement) => c.kind === 'departmentExam' ? `통과 기준: ${c.passCriteria}`
    : c.kind === 'externalCertificate' ? c.acceptedTests.map((t) => `${t.name}: ${t.passCriteria}`).join(' / ') : c.description;
  for (const { scope, cert } of resolved?.certifications ?? []) {
    examCards[cardKeyOf(null, scope)].items.push({ id: cert.id, title: cert.title, detail: certDetail(cert), confirmed: confirmed.has(cert.id) });
  }
  for (const e of report?.items ?? []) {
    if (!CONFIRMABLE.has(e.rule.category) || e.rule.none) continue;
    const dept = e.rule.departmentId;
    examCards[cardKeyOf(dept)].items.push({
      id: e.rule.id, title: ruleTitle(e.rule, dept ? departmentName(dept) : undefined),
      detail: assessmentCriteria(e.rule.detail as Record<string, unknown> | null | undefined), confirmed: confirmed.has(e.rule.id),
    });
  }
  const examList = [examCards.primary, ...(secondary ? [examCards.secondary] : []), examCards.common].filter((c) => c.items.length);

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

      {/* 사진이 들어올 자리(Figma 351×290 중 카드 위쪽). 사진이 들어오면 아래 내용이 그만큼 밀려 내려간다. */}
      <div className="photo-slot status" aria-hidden="true" />
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
                <button type="button" className={`sc-row${c.total > 0 && !done ? ' todo' : ''}${open[k] ? ' open' : ''}`} aria-expanded={!!open[k]} disabled={c.total === 0} onClick={() => flip(k)}>
                  <span>{c.total === 0 ? '확인할 과목이 없어요' : `${c.met}/${c.total}과목`}</span><i className="icon ic-chevron" aria-hidden="true" />
                </button>
                {open[k] && (
                  <ul className="sc-list-in">
                    {c.items.map((it, i) => (
                      <li key={`${it.id}-${i}`} className={`sc-item${it.done ? ' met' : ''}${it.depth > 0 ? ' nest' : ''}`}>
                        {it.group ? <span className="grp">{it.label}</span> : (
                          <>
                            <span className="tx">{it.label}</span>
                            {it.done && <span className="sc-done"><i className="icon ic-check" aria-hidden="true" />이수 완료</span>}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section id="st-exams" className="st-section" aria-labelledby="h-exams">
        <h2 id="h-exams" className="num-head"><b>03</b>졸업 시험 및 요건</h2>
        {examList.length === 0 ? <p className="st-empty">확인할 졸업시험·요건이 없어요.</p> : (
          <div className="sc-list">
            {examList.map((c) => {
              const done = c.items.every((i) => i.confirmed);
              const k = `exam:${c.key}`;
              return (
                <div key={c.key} className="sc">
                  <div className="sc-top">
                    <p className="who">{c.who}</p>
                    <div className="line">
                      <span className="dept">{c.dept}</span>
                      {done ? <span className="sc-state done"><i className="icon ic-check" aria-hidden="true" />응시 완료</span>
                        : <span className="sc-state todo"><i className="icon ic-dash" aria-hidden="true" />미응시</span>}
                    </div>
                  </div>
                  <button type="button" className={`sc-row${done ? '' : ' todo'}${open[k] ? ' open' : ''}`} aria-expanded={!!open[k]} onClick={() => flip(k)}>
                    <span>{c.items[0].title}{c.items.length > 1 ? ` 외 ${c.items.length - 1}건` : ''}</span><i className="icon ic-chevron" aria-hidden="true" />
                  </button>
                  {open[k] && (
                    <ul className="sc-list-in">
                      {c.items.map((it) => (
                        <li key={it.id} className={`sc-item${it.confirmed ? ' met' : ''}`}>
                          <span className="tx">{it.title}{it.detail && <span className="sub">{it.detail}</span>}</span>
                          <button type="button" className="cbx" role="checkbox" aria-checked={it.confirmed} aria-label={`${it.title} 응시·통과 체크`} onClick={() => toggleConfirm(it.id)}>
                            {it.confirmed && <i className="icon ic-check" aria-hidden="true" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <button type="button" className="btn cta" style={{ marginTop: 40 }} onClick={() => setView('assessments')}>종정시 정보 저장</button>
    </div>
  );
}
