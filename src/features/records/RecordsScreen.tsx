// 종정시 입력 (Figma, §3.3, §6). 학생이 직접 복사해 붙여넣은 text/plain만 이 기기에서 분석한다.
// '종정시 정보 저장' 한 번으로: 분석 → 빠졌거나 애매한 것이 있으면 빨간 글씨로 알리고 저장을 막음 → 이상 없으면 저장하고 학사 현황으로.
// 반영 기본값(사람이 고르던 선택): 직접 추가한 같은 과목은 연결, 내가 고친 값은 유지, 이번에 없는 과목은 지우지 않는다.
import { useEffect, useState } from 'react';
import { useStore } from '../../app/store';
import { catalog } from '../../data';
import { applyMerge, dropCourseRefs, planMerge, type MergeDecisions } from '../../domain/merge/mergeImport';
import { parseTranscript, type ParseResult } from '../../domain/parser/parseTranscript';
import { ConsentGate } from '../common';

const WIS_URL = 'https://wis.hufs.ac.kr/src08/jsp/index.jsp';

/**
 * 붙여넣은 글에서 찾는 부분. required가 true인 부분이 없으면 저장하지 않는다.
 * 기준을 바꾸려면 이 목록만 고치면 된다.
 */
const PARTS = [
  { key: 'byArea', label: '영역별 취득학점', required: false },
  { key: 'majors', label: '이수중인 전공', required: false },
  { key: 'summary', label: '이수구분별 취득학점 계', required: true },
] as const;
type PartKey = (typeof PARTS)[number]['key'];

/** 하나라도 있으면 저장을 막는 '애매한' 분석 경고. (합계 줄 문제는 위 PARTS로 따로 안내) */
const BLOCKING_CODES = new Set(['noTerm', 'unknownArea', 'unknownGrade']);

const squash = (s: string) => s.replace(/\s+/g, '');
const NO_DECISIONS: MergeDecisions = { link: {}, conflictChoice: {}, removeMissing: false };

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

/** 파서 경고 문구에서 '골라 주세요'처럼 이 화면에 없는 조작 안내를 덜어 낸다 */
const cleanMessage = (m: string) => m.replace(/ 학점 반영 영역을 골라 주세요\./, '').replace(/ F로 처리하지 않고 보류했어요\./, '');

export function RecordsScreen() {
  return (
    <div className="page">
      {/* 안내 사진이 들어올 자리(Figma 330×106). 사진이 들어오면 아래 내용이 그만큼 밀려 내려간다. */}
      <div className="photo-slot records" aria-hidden="true" />
      <h1 className="page-title">종정시 정보를 입력하고<br />맞춤형 서비스를 이용해보세요!</h1>
      <p className="page-lead">종합정보시스템의 ‘성적취득현황’ 정보를 가져오면<br />자동으로 학사현황과 학점계산 페이지가 완성돼요.</p>

      <div className="stack" style={{ marginTop: 24 }}>
        <a className="btn cta-sub" href={WIS_URL} target="_blank" rel="noopener noreferrer">
          <span>종합정보시스템 바로가기</span><span aria-hidden="true">→</span>
        </a>
        <Guide />
        <ConsentGate>
          <PasteSave />
        </ConsentGate>
      </div>
    </div>
  );
}

function Guide() {
  const [help, setHelp] = useState(false);
  return (
    <div>
      <ol className="guide-card plain" style={{ margin: 0, listStyle: 'none' }}>
        <li className="guide-step"><b aria-hidden="true">1</b><span>종합정보시스템에서 성적취득현황 메뉴 열기</span></li>
        <li className="guide-step"><b aria-hidden="true">2</b><span>전체 영역을 드래그해 복사하기</span></li>
        <li className="guide-step"><b aria-hidden="true">3</b><span>아래 입력창에 붙여넣고 분석하기</span>
          <button type="button" className="help-btn" aria-label="붙여넣기 도움말" aria-expanded={help} onClick={() => setHelp((v) => !v)}>?</button>
        </li>
      </ol>
      {help && <p className="help-text" role="note">붙여넣은 내용은 이 기기 안에서만 분석하고, 저장 전에는 보관하지 않아요. 맨 아래 ‘이수구분별 취득학점 계’ 줄까지 함께 복사해야 저장할 수 있어요.</p>}
    </div>
  );
}

function PasteSave() {
  const { state, save, now, setView } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [found, setFound] = useState<Record<PartKey, boolean>>({ byArea: false, majors: false, summary: false });
  const [problems, setProblems] = useState<string[]>([]);
  // 이미 저장한 종정시 정보가 있으면 새로 붙여넣기 전에 '초기화'부터 해야 한다 (처음에는 '종정시 정보 저장' 버튼만 보인다)
  const hasSaved = state.snapshots.length > 0 || state.courses.some((c) => c.origin === 'paste');
  const [armed, setArmed] = useState(false); // 초기화는 두 번 눌러야 실행 (실수로 지우지 않게)
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  async function onReset() {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    // 종정시에서 가져온 과목·요약만 지운다. 직접 추가한 과목과 그 시간표·메모는 남긴다.
    const gone = new Set(state.courses.filter((c) => c.origin === 'paste').map((c) => c.id));
    const ok = await save((s) => ({ ...s, courses: s.courses.filter((c) => !gone.has(c.id)), snapshots: [], ...dropCourseRefs(s, gone) }));
    if (ok) { setText(''); setChecked(false); setProblems([]); }
  }

  async function onSave() {
    setChecked(true);
    setProblems([]);
    if (!text.trim()) {
      setFound({ byArea: false, majors: false, summary: false });
      setProblems(['붙여넣은 내용이 없어요. 종정시에서 복사한 내용을 붙여넣어 주세요.']);
      return;
    }
    setBusy(true);
    try {
      const r = await runParse(text);
      const flat = squash(text);
      const has = (label: string) => flat.includes(squash(label));
      const next: Record<PartKey, boolean> = {
        byArea: has('영역별 취득학점'),
        majors: has('이수중인 전공'),
        summary: has('이수구분별 취득학점 계') && r.completeness.earnedTotals,
      };
      setFound(next);

      const issues: string[] = [];
      for (const part of PARTS) {
        if (!part.required || next[part.key]) continue;
        issues.push(has(part.label)
          ? `‘${part.label}’의 열과 숫자를 읽지 못했어요. 화면 맨 아래까지 다시 복사해 주세요.`
          : `‘${part.label}’ 부분이 들어 있지 않아요. 화면 맨 아래까지 복사해 주세요.`);
      }
      if (!r.rows.length && !r.completeness.earnedTotals) issues.push('성적 목록을 찾지 못했어요. 성적취득현황 화면을 복사했는지 확인해 주세요.');
      for (const w of r.warnings) if (BLOCKING_CODES.has(w.code)) issues.push(cleanMessage(w.message));
      setProblems(issues);
      if (issues.length) return; // 저장 반려

      const plan = planMerge(state, r);
      const decisions: MergeDecisions = { ...NO_DECISIONS, link: Object.fromEntries(plan.linkCandidates.map((l) => [l.rowKey, true])) };
      if (await save(applyMerge(state, r, plan, decisions, now))) {
        setText(''); // 원문은 저장하지 않는다
        setChecked(false);
        setView('status');
      }
    } catch (e) {
      setProblems([`${(e as Error).message} 기존 기록은 그대로예요.`]);
    } finally {
      setBusy(false);
    }
  }

  // 확인한 뒤: 있는 부분은 검정, 없는 부분은 빨강 (아무것도 붙이지 않았으면 세 개 모두 빨강)
  const partClass = (key: PartKey) => `part${checked && found[key] ? ' found' : ''}${checked && !found[key] ? ' missing' : ''}`;

  return (
    <div>
      <label htmlFor="paste" className="fig-label" style={{ display: 'block' }}>종정시 정보 붙여넣기</label>
      <textarea id="paste" className="paste" value={text} spellCheck={false} disabled={hasSaved}
        placeholder="종정시에서 복사한 성적 정보를 여기에 붙여 넣어주세요."
        onChange={(e) => setText(e.target.value)} />
      <p className="parts">
        {PARTS.map((p) => <span key={p.key} className={partClass(p.key)}>{p.label}</span>)}
      </p>
      {problems.length > 0 && (
        <ul className="red-list" role="alert">{problems.map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}
      <div className="cta-row">
        <button type="button" className="btn cta" disabled={busy || hasSaved} onClick={() => void onSave()}>
          {busy ? '확인하는 중…' : '종정시 정보 저장'}
        </button>
        {hasSaved && (
          <button type="button" className="btn cta-reset" aria-label={armed ? '한 번 더 누르면 저장된 종정시 정보를 지워요' : '저장된 종정시 정보 초기화'} onClick={() => void onReset()}>
            {armed ? '한 번 더' : '초기화'}
          </button>
        )}
      </div>
    </div>
  );
}
