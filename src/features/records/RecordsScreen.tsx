// 종정시 입력 (§3.3, §6). 학생이 직접 복사해 붙여넣은 text/plain만 이 기기에서 분석한다.
// 분석 결과는 '확인하고 반영'을 눌러야 저장되며, 반영 후 원문은 비운다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { catalog } from '../../data';
import { defaultGradingMode, deriveInclusion, LETTER_GRADES } from '../../domain/grades';
import { computeGpa, formatGpa } from '../../domain/gpa/gpa';
import { applyMerge, planMerge, summarySnapshot, type MergeDecisions } from '../../domain/merge/mergeImport';
import { parseTranscript, type ParseResult, type ParsedRow } from '../../domain/parser/parseTranscript';
import { formatUnits, termLabel, toUnits } from '../../domain/terms';
import type { Course, CreditArea, Grade, Term } from '../../domain/types';
import { AREA_LABEL, ConsentGate, SafeLink } from '../common';

const WIS_URL = 'https://wis.hufs.ac.kr/src08/jsp/index.jsp';
const NO_DECISIONS: MergeDecisions = { link: {}, conflictChoice: {}, removeMissing: false };
const PROBLEM_CODES = new Set(['unknownArea', 'unknownGrade', 'noTerm', 'duplicate', 'retakeUnresolved', 'noCode']);

function runParse(text: string): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL('../../domain/parser/parser.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      try { resolve(parseTranscript(text, catalog.policy.gradeAliases)); } catch (e) { reject(e); }
      return;
    }
    const timer = window.setTimeout(() => { w.terminate(); reject(new Error('분석이 너무 오래 걸려요. 성적 목록 부분만 붙여넣어 주세요.')); }, 15_000);
    w.onmessage = (e) => { window.clearTimeout(timer); w.terminate(); if (e.data.ok) resolve(e.data.result); else reject(new Error(e.data.message)); };
    w.onerror = () => { window.clearTimeout(timer); w.terminate(); reject(new Error('분석 중 오류가 났어요.')); };
    w.postMessage({ text, aliases: catalog.policy.gradeAliases });
  });
}

export function RecordsScreen() {
  const { setView } = useStore();
  return (
    <div className="screen">
      <p className="eyebrow">성적 데이터 불러오기</p>
      <h1>종정시 입력</h1>
      <p className="lead">종합정보시스템에 직접 로그인해 성적 화면을 복사한 뒤 아래에 붙여넣어 주세요. 학교 시스템에 자동으로 접속하지 않아요.</p>
      <ol className="steps">
        <li>종정시에서 <b>년도/학기별 취득성적</b> 화면 열기</li>
        <li>과목 목록과 화면 하단 <b>‘이수구분별 취득학점 계’</b>까지 드래그해 복사</li>
        <li>아래 입력란에 붙여넣고 분석하기</li>
      </ol>
      <ConsentGate>
        <PasteImport />
        <SummaryInput />
      </ConsentGate>
      <button type="button" className="btn ghost block" onClick={() => setView('status')}>이수정보 없이 요건 보기</button>
    </div>
  );
}

function PasteImport() {
  const { state, save, now } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<ParsedRow>>>({});
  const [decisions, setDecisions] = useState<MergeDecisions>(NO_DECISIONS);
  const runId = useRef(0);

  async function analyze(value: string) {
    const id = ++runId.current;
    setError(''); setDone(''); setResult(null); setEdits({}); setDecisions(NO_DECISIONS);
    if (!value.trim()) { setError('붙여넣은 내용이 없어요.'); return; }
    setBusy(true);
    try {
      const r = await runParse(value);
      if (id !== runId.current) return; // 더 최근 분석이 시작됨
      if (!r.rows.length && !r.completeness.earnedTotals) setError('성적 목록을 찾지 못했어요. 년도/학기별 취득성적 화면을 복사했는지 확인해 주세요.');
      else setResult(r);
    } catch (e) {
      if (id === runId.current) setError(`${(e as Error).message} 기존 기록은 그대로예요.`);
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }

  // 학생이 고친 문제 행을 반영한 분석 결과
  const effective = useMemo<ParseResult | null>(() => {
    if (!result) return null;
    const rows = result.rows.map((r) => {
      const e = edits[r.rowKey];
      if (!e) return r;
      const merged = { ...r, ...e };
      const gradingMode = e.grade !== undefined ? defaultGradingMode(merged.grade) : merged.gradingMode;
      return { ...merged, gradingMode, ...deriveInclusion({ status: 'completed', grade: merged.grade, gradingMode, recordKind: merged.recordKind }) };
    });
    return { ...result, rows };
  }, [result, edits]);
  const plan = useMemo(() => (effective ? planMerge(state, effective) : null), [effective, state]);

  const problemKeys = new Set(result?.warnings.filter((w) => w.rowKey && PROBLEM_CODES.has(w.code)).map((w) => w.rowKey!));
  const blocking = effective?.rows.filter((r) => r.term.academicYear === 0) ?? [];
  const gpa = effective ? computeGpa(effective.rows.map((r) => ({ ...r, id: r.rowKey }) as unknown as Course)) : null;
  const edit = (key: string, patch: Partial<ParsedRow>) => setEdits((m) => ({ ...m, [key]: { ...m[key], ...patch } }));

  async function apply() {
    if (!effective || !plan) return;
    if (await save(applyMerge(state, effective, plan, decisions, now))) {
      setText(''); setResult(null); setEdits({}); // 원문·분석 결과를 비운다
      setDone(`반영했어요 · 새 과목 ${plan.added.length}개, 기존 과목 ${plan.matched.length}개 확인, 연결 ${plan.linkCandidates.length}개`);
    }
  }

  return (
    <section className="card" aria-labelledby="paste-title">
      <h2 id="paste-title" className="h3">성적 정보 붙여넣기</h2>
      <textarea
        aria-label="종정시에서 복사한 성적 내용" rows={7} value={text} spellCheck={false}
        placeholder="종정시에서 복사한 성적 정보를 여기에 붙여넣어 주세요."
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => { const el = e.currentTarget; requestAnimationFrame(() => void analyze(el.value)); }}
      />
      <button type="button" className="btn primary block" disabled={busy} onClick={() => analyze(text)}>
        {busy ? '분석 중…' : '분석하기'}
      </button>
      <p className="link-row"><SafeLink href={WIS_URL}>종정시 열기 ↗</SafeLink><span className="muted small">새 탭에서 직접 로그인해요</span></p>
      <p className="muted small">붙여넣은 내용은 이 기기 안에서만 분석하고, 확인하기 전에는 저장하지 않아요. 하단 합계만 붙여넣으면 영역별 현황은 볼 수 있지만 필수과목 자동 매칭과 과목별 평점은 제한돼요.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {done && <p className="ok" role="status">{done}</p>}

      {effective && plan && gpa && (
        <div className="result" aria-live="polite">
          <h3>분석 결과</h3>
          <dl className="stats">
            <div><dt>과목</dt><dd>{effective.rows.filter((r) => r.recordKind === 'course').length}개</dd></div>
            <div><dt>인정학점</dt><dd>{effective.rows.filter((r) => r.recordKind === 'recognizedCredit').length}건</dd></div>
            <div><dt>취득학점</dt><dd>{formatUnits(effective.reportedTotalEarnedUnits ?? effective.computedTotalUnits)}학점</dd></div>
            <div><dt>평점</dt><dd>{formatGpa(gpa.hundredths)}{!effective.completeness.gpa && gpa.hundredths !== null ? ' (일부 보류)' : ''}</dd></div>
          </dl>
          <AreaTable result={effective} />
          {effective.warnings.length > 0 && (
            <details open={effective.warnings.length <= 5}>
              <summary>확인이 필요한 항목 {effective.warnings.length}개</summary>
              <ul className="warn-list">{effective.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </details>
          )}

          {effective.rows.filter((r) => problemKeys.has(r.rowKey)).map((r) => (
            <fieldset key={r.rowKey} className="problem">
              <legend className="name">{r.name}</legend>
              <p className="muted small">{r.term.academicYear ? termLabel(r.term) : '학기 미상'} · {r.rawAreaLabel} · {formatUnits(r.creditUnits)}학점 · {r.rawGrade ?? '등급 없음'}</p>
              <div className="row2">
                <label>학점 반영 영역
                  <select value={r.area} onChange={(e) => edit(r.rowKey, { area: e.target.value as CreditArea })}>
                    {Object.entries(AREA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label>성적
                  <select value={r.grade ?? ''} onChange={(e) => edit(r.rowKey, { grade: (e.target.value || null) as Grade })}>
                    <option value="">모름 (보류)</option>
                    {LETTER_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
              </div>
              {result!.rows.find((x) => x.rowKey === r.rowKey)!.term.academicYear === 0 && <TermFix onChange={(t) => edit(r.rowKey, { term: t })} />}
            </fieldset>
          ))}

          <h3>반영 전 확인</h3>
          <ul className="plain small">
            <li>새로 추가될 과목 {plan.added.length}개 · 이미 있는 과목 {plan.matched.length}개 (중복으로 더하지 않아요)</li>
            {plan.matched.some((m) => m.changes.length) && <li>내용이 바뀐 과목 {plan.matched.filter((m) => m.changes.length).length}개</li>}
          </ul>
          {plan.linkCandidates.map((l) => {
            const c = state.courses.find((x) => x.id === l.courseId)!;
            return (
              <label key={l.rowKey} className="check">
                <input type="checkbox" checked={decisions.link[l.rowKey] ?? true}
                  onChange={(e) => setDecisions((d) => ({ ...d, link: { ...d.link, [l.rowKey]: e.target.checked } }))} />
                <span>직접 추가한 “{c.name}”({termLabel(c.term)})과 같은 과목으로 연결 (시간표·메모 유지, 학점은 한 번만 반영)</span>
              </label>
            );
          })}
          {plan.matched.flatMap((m) => m.conflicts.map((cf) => {
            const c = state.courses.find((x) => x.id === m.courseId)!;
            const key = `${m.courseId}:${cf.field}`;
            const choice = decisions.conflictChoice[key] ?? 'current';
            return (
              <fieldset key={key} className="problem">
                <legend>“{c.name}”의 {FIELD_LABEL[cf.field]}을(를) 직접 고친 적이 있어요</legend>
                {(['current', 'imported'] as const).map((opt) => (
                  <label key={opt} className="check">
                    <input type="radio" name={key} checked={choice === opt}
                      onChange={() => setDecisions((d) => ({ ...d, conflictChoice: { ...d.conflictChoice, [key]: opt } }))} />
                    <span>{opt === 'current' ? '내가 고친 값 유지' : '새로 붙여넣은 값 사용'}: {show(cf.field, opt === 'current' ? cf.current : cf.imported)}</span>
                  </label>
                ))}
              </fieldset>
            );
          }))}
          {plan.missing.length > 0 && (
            <div className="notice">
              <p>이전에 가져온 과목 {plan.missing.length}개가 이번 붙여넣기에 없어요. 자동으로 지우지 않아요.</p>
              <label className="check">
                <input type="checkbox" checked={decisions.removeMissing} onChange={(e) => setDecisions((d) => ({ ...d, removeMissing: e.target.checked }))} />
                <span>이번 자료가 전체 최신 목록이 맞아요. 없는 과목을 삭제할게요: {plan.missing.map((id) => state.courses.find((c) => c.id === id)?.name).join(', ')}</span>
              </label>
            </div>
          )}
          {blocking.length > 0 && <p className="error">학기를 찾지 못한 행 {blocking.length}개의 학기를 골라 주세요.</p>}
          <button type="button" className="btn primary block" disabled={blocking.length > 0} onClick={apply}>확인하고 반영</button>
        </div>
      )}
    </section>
  );
}

const FIELD_LABEL: Record<string, string> = { name: '과목명', officialCode: '과목 코드', area: '학점 반영 영역', creditUnits: '학점', grade: '성적', status: '상태', gradingMode: '성적 방식' };
function show(field: string, v: unknown): string {
  if (v === undefined || v === null) return '없음';
  if (field === 'area') return AREA_LABEL[v as CreditArea];
  if (field === 'creditUnits') return `${formatUnits(v as number)}학점`;
  return String(v);
}

function TermFix({ onChange }: { onChange: (t: Term) => void }) {
  const [y, setY] = useState('');
  const [s, setS] = useState<Term['semester']>('1');
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => { if (/^\d{4}$/.test(y)) cb.current({ academicYear: Number(y), semester: s }); }, [y, s]);
  return (
    <div className="row2">
      <label>학년도<input type="number" inputMode="numeric" value={y} onChange={(e) => setY(e.target.value)} placeholder="예: 2024" /></label>
      <label>학기
        <select value={s} onChange={(e) => setS(e.target.value as Term['semester'])}>
          <option value="1">1학기</option><option value="2">2학기</option><option value="summer">여름 계절</option><option value="winter">겨울 계절</option>
        </select>
      </label>
    </div>
  );
}

function AreaTable({ result }: { result: ParseResult }) {
  const areas = [...new Set([...Object.keys(result.reportedEarnedByArea), ...Object.keys(result.computedEarnedByArea)])] as CreditArea[];
  const shown = areas.filter((a) => (result.reportedEarnedByArea[a] ?? 0) > 0 || (result.computedEarnedByArea[a] ?? 0) > 0);
  if (!shown.length) return null;
  return (
    <table className="mini">
      <thead><tr><th scope="col">영역</th><th scope="col">과목 합</th><th scope="col">하단 합계</th></tr></thead>
      <tbody>
        {shown.map((a) => (
          <tr key={a}>
            <td>{AREA_LABEL[a]}</td>
            <td>{formatUnits(result.computedEarnedByArea[a] ?? 0)}</td>
            <td>{result.completeness.earnedTotals ? formatUnits(result.reportedEarnedByArea[a] ?? 0) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 붙여넣기가 어려울 때의 보조 경로: 영역별 취득학점·요약 평점 직접 입력 */
const SUMMARY_AREAS: CreditArea[] = ['primary', 'double', 'second', 'minor', 'practicalLanguage', 'liberalArts', 'teaching', 'freeChoice', 'foundation'];
function SummaryInput() {
  const { save, now } = useStore();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [gpa, setGpa] = useState('');
  const [gpaUnits, setGpaUnits] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    const byArea: Partial<Record<CreditArea, number>> = {};
    for (const a of SUMMARY_AREAS) {
      if (!vals[a]) continue;
      const n = Number(vals[a]);
      if (!Number.isFinite(n) || n < 0 || n > 300) return setErr(`${AREA_LABEL[a]} 학점을 확인해 주세요.`);
      byArea[a] = toUnits(n);
    }
    if (!Object.keys(byArea).length) return setErr('영역별 학점을 하나 이상 입력해 주세요.');
    let reportedGpa: { hundredths: number; gpaUnits: number } | undefined;
    if (gpa) {
      const g = Number(gpa), u = Number(gpaUnits);
      if (!Number.isFinite(g) || g < 0 || g > 4.5) return setErr('평점은 0~4.5 사이로 입력해 주세요.');
      // GPA 대상 학점은 총 취득학점과 다르다 (P/F·인정학점 제외, F 포함)
      if (!gpaUnits || !Number.isFinite(u) || u <= 0) return setErr('평점을 넣으려면 ‘GPA 대상 학점’도 입력해 주세요.');
      reportedGpa = { hundredths: Math.floor(Math.round(g * 1000) / 10), gpaUnits: toUnits(u) };
    }
    const total = Object.values(byArea).reduce((s, u) => s + (u ?? 0), 0);
    if (await save((s) => ({ ...s, snapshots: [...s.snapshots, summarySnapshot(byArea, total, reportedGpa, now)].slice(-20) }))) {
      setMsg('요약 학점을 반영했어요. 과목별 정보가 없어 필수과목 매칭과 정밀 평점 계산은 제한돼요.');
      setVals({}); setGpa(''); setGpaUnits('');
    }
  }

  return (
    <details className="card">
      <summary>붙여넣기가 어려우면: 영역별 학점 직접 입력</summary>
      <form className="form" onSubmit={submit} noValidate>
        <div className="grid3">
          {SUMMARY_AREAS.map((a) => (
            <label key={a}>{AREA_LABEL[a]}
              <input type="number" inputMode="decimal" min={0} value={vals[a] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [a]: e.target.value }))} />
            </label>
          ))}
        </div>
        <div className="row2">
          <label>요약 평점 (선택)<input type="number" inputMode="decimal" step="0.01" min={0} max={4.5} value={gpa} onChange={(e) => setGpa(e.target.value)} /></label>
          <label>GPA 대상 학점<input type="number" inputMode="decimal" min={0} value={gpaUnits} onChange={(e) => setGpaUnits(e.target.value)} /></label>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        {msg && <p className="ok" role="status">{msg}</p>}
        <button type="submit" className="btn block">요약 학점 반영</button>
      </form>
    </details>
  );
}
