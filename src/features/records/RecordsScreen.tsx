// 종정시 입력 (Figma, §3.3, §6). 학생이 직접 복사해 붙여넣은 text/plain만 이 기기에서 분석한다.
// 입력이 바뀌면 분석 미리보기만 갱신하고, 저장 버튼을 누를 때 검증된 결과를 병합한다.
// 반영 기본값(사람이 고르던 선택): 직접 추가한 같은 과목은 연결, 내가 고친 값은 유지, 이번에 없는 과목은 지우지 않는다.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import { catalog } from '../../data';
import { analyzeTranscript } from '../../domain/parser/analyzeTranscript';
import { applyMerge, dropCourseRefs, planMerge, type MergeDecisions } from '../../domain/merge/mergeImport';
import { validateTranscript, type ParseResult } from '../../domain/parser/parseTranscript';
import bannerImg from '../../assets/logo/start-banner.png';
import { ConsentGate } from '../common';
import { GuideModal } from './GuideModal';
import { SuccessModal } from './SuccessModal';
import { WarningModal } from './WarningModal';

const WIS_URL = 'https://wis.hufs.ac.kr/src08/jsp/index.jsp';

/** 기존 안내 문구는 유지하고 분석 결과로 표시 상태만 바꾼다. */
const PARTS = [
  { key: 'grades', label: '년도/학기별 취득성적' },
  { key: 'summary', label: '이수구분별 취득학점 계' },
] as const;
type PartKey = (typeof PARTS)[number]['key'];

const NO_DECISIONS: MergeDecisions = { link: {}, conflictChoice: {}, removeMissing: false };

/** 파서 경고 문구에서 '골라 주세요'처럼 이 화면에 없는 조작 안내를 덜어 낸다 */
const cleanMessage = (m: string) => m.replace(/ 학점 반영 영역을 골라 주세요\./, '').replace(/ F로 처리하지 않고 보류했어요\./, '');

export function RecordsScreen() {
  return (
    <div className="page">
      <img className="records-banner" src={bannerImg} alt="" />
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
    <div className="guide">
      <ol className="guide-card plain" style={{ margin: 0, listStyle: 'none' }}>
        <li className="guide-step"><b aria-hidden="true">1</b><span>종합정보시스템에서 성적취득현황 메뉴 열기</span></li>
        <li className="guide-step"><b aria-hidden="true">2</b><span>전체 영역을 드래그해 복사하기</span></li>
        <li className="guide-step"><b aria-hidden="true">3</b><span>아래 입력창에 붙여넣고 분석하기</span>
          <button type="button" className="help-btn" aria-label="붙여넣기 도움말" aria-haspopup="dialog" aria-expanded={help} onClick={() => setHelp(true)}>?</button>
        </li>
      </ol>
      {help && <GuideModal onClose={() => setHelp(false)} />}
    </div>
  );
}

function PasteSave() {
  const { state, save, now, setView, pasteText: text, setPasteText: setText } = useStore();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState(false);
  const [found, setFound] = useState<Record<PartKey, boolean>>({ grades: false, summary: false });
  const [problems, setProblems] = useState<string[]>([]);
  const [warn, setWarn] = useState<[string, string] | null>(null); // 경고 모달 제목 두 줄
  const [done, setDone] = useState(false); // 저장 성공 모달
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef(text);
  const analysis = useRef<{ text: string; result: ParseResult } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  // 저장 기록 유무는 기존 초기화 버튼의 표시 여부에만 사용한다.
  const hasSaved = state.snapshots.length > 0 || state.courses.some((c) => c.origin === 'paste');

  function changeInput(value: string) {
    controller.current?.abort();
    inputRef.current = value;
    analysis.current = null;
    setText(value);
    setRevision((n) => n + 1);
    setChecked(false);
    setFound({ grades: false, summary: false });
    setProblems([]);
    setBusy(!!value.trim());
  }

  useEffect(() => {
    if (!text.trim()) { setBusy(false); return; }
    const request = new AbortController();
    controller.current = request;
    const timer = window.setTimeout(() => {
      void analyzeTranscript(text, catalog.policy.gradeAliases, request.signal).then((result) => {
        // 취소 직전에 도착한 메시지도 최신 입력의 결과를 덮어쓰지 못하게 한다.
        if (request.signal.aborted || inputRef.current !== text) return;
        analysis.current = { text, result };
        const validation = validateTranscript(result);
        setFound(validation.parts);
        setProblems(validation.problems.map(cleanMessage));
        setChecked(true);
      }).catch((error: Error) => {
        if (request.signal.aborted || inputRef.current !== text) return;
        setChecked(true);
        setProblems([`${error.message} 기존 기록은 그대로예요.`]);
      }).finally(() => {
        if (!request.signal.aborted && inputRef.current === text) setBusy(false);
      });
    }, 200);
    return () => { window.clearTimeout(timer); request.abort(); };
  }, [text, revision]);

  async function onReset() {
    if (savingRef.current) return;
    // 종정시에서 가져온 과목·요약만 지운다. 직접 추가한 과목과 그 시간표·메모는 남긴다.
    const gone = new Set(state.courses.filter((c) => c.origin === 'paste').map((c) => c.id));
    const ok = await save((s) => ({ ...s, courses: s.courses.filter((c) => !gone.has(c.id)), snapshots: [], ...dropCourseRefs(s, gone) }));
    if (ok) changeInput('');
  }

  /** 경고 모달의 '입력된 내용 삭제': 붙여넣은 내용을 비우고 다시 붙여넣게 한다 (저장된 기록은 건드리지 않는다) */
  function onClearInput() {
    changeInput(''); setWarn(null);
    window.requestAnimationFrame(() => pasteRef.current?.focus());
  }

  async function onSave() {
    if (savingRef.current || busy) return;
    setChecked(true);
    if (!text.trim()) {
      setFound({ grades: false, summary: false });
      setProblems(['붙여넣은 내용이 없어요. 종정시에서 복사한 내용을 붙여넣어 주세요.']);
      return;
    }
    const current = analysis.current;
    if (!current || current.text !== inputRef.current || current.text !== text) {
      setProblems((previous) => previous.length ? previous : ['현재 입력의 분석이 완료되지 않았어요. 내용을 다시 확인해 주세요.']);
      return;
    }
    const r = current.result;
    const validation = validateTranscript(r);
    setFound(validation.parts);
    setProblems(validation.problems.map(cleanMessage));
    if (!validation.canSave) {
      const lost = PARTS.filter((p) => !validation.parts[p.key]).map((p) => `‘${p.label}'`);
      setWarn(lost.length ? [lost.join(', '), '영역이 누락되었습니다.'] : ['입력한 내용을 확인하지 못했습니다.', '규격이 맞지 않는 내용이 있어요.']);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (await save((s) => applyMerge(s, r, planMerge(s, r), NO_DECISIONS, now))) {
        // 원문은 메모리 입력창에만 남기고 영구 저장하지 않는다.
        setDone(true); // 'HUFStep 시작하기'를 누르면 학사 현황으로
      } else {
        setProblems(['저장하지 못했어요. 기존 기록은 그대로예요. 다시 저장해 주세요.']);
      }
    } catch (e) {
      setProblems([`${(e as Error).message} 기존 기록은 그대로예요.`]);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // 확인한 뒤: 있는 부분은 검정, 없는 부분은 빨강.
  const partClass = (key: PartKey) => `part${checked && found[key] ? ' found' : ''}${checked && !found[key] ? ' missing' : ''}`;

  return (
    <div>
      <label htmlFor="paste" className="fig-label" style={{ display: 'block' }}>종정시 정보 붙여넣기</label>
      <textarea id="paste" className="paste" ref={pasteRef} value={text} spellCheck={false} disabled={saving}
        placeholder="종정시에서 복사한 성적 정보를 여기에 붙여 넣어주세요."
        onChange={(e) => changeInput(e.target.value)}
        onPaste={(e) => {
          e.preventDefault();
          const target = e.currentTarget;
          const value = text.slice(0, target.selectionStart) + e.clipboardData.getData('text/plain') + text.slice(target.selectionEnd);
          changeInput(value);
        }} />
      <p className="parts">
        {PARTS.map((p) => <span key={p.key} className={partClass(p.key)}>{p.label}</span>)}
      </p>
      {problems.length > 0 && (
        <ul className="red-list" role="alert">{problems.map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}
      {done && <SuccessModal onStart={() => { setDone(false); setView('status'); }} />}
      {warn && <WarningModal title={warn} onDelete={onClearInput} onClose={() => setWarn(null)} />}
      <div className="cta-row">
        <button type="button" className="btn cta" disabled={busy || saving} onClick={() => void onSave()}>
          {busy || saving ? '확인하는 중…' : '종정시 정보 저장'}
        </button>
        {hasSaved && (
          <button type="button" className="btn cta-reset" aria-label="저장된 종정시 정보 초기화" onClick={() => void onReset()}>초기화</button>
        )}
      </div>
    </div>
  );
}
