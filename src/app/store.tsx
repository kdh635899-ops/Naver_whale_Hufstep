// 앱 전역 상태: 저장된 학생 상태 + 데모 모드 + 실제 '오늘' 날짜 + 화면 이동.
// 저장은 모두 여기 save()를 거친다: 검사 → IndexedDB 한 번에 저장 → 성공 시에만 화면 상태 교체 → 알림 예약 갱신.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { catalog, departmentFacts, departmentMetaById } from '../data';
import { buildDemoState } from '../data/demo';
import { assumeAnswers } from '../domain/requirements/assumptions';
import { buildOfficialReport, type OfficialReport } from '../domain/requirements/officialRules';
import { resolveRequirements } from '../domain/requirements/resolve';
import { emptyState, type AppState, type View } from '../domain/state';
import { dateKey, advancedTerm } from '../domain/terms';
import type { Course } from '../domain/types';
import { notifyBackground } from '../platform/browser';
import { clearEverything, KEYS, kvDelete, kvGet, loadState, saveState, type PendingRoute } from '../storage/repository';

export type Mode = 'real' | 'demo';
export interface EditorTarget { courseId?: string; preset?: Partial<Course> }

interface Store {
  status: 'loading' | 'ready' | 'error';
  loadError: string;
  mode: Mode;
  state: AppState;
  now: Date;
  today: string;
  view: View;
  setView: (v: View) => void;
  /** 저장 성공 여부를 돌려준다. 실패하면 화면 상태와 기존 저장값은 그대로. */
  save: (next: AppState | ((s: AppState) => AppState)) => Promise<boolean>;
  saveError: string;
  clearSaveError: () => void;
  startDemo: () => void;
  exitDemo: () => void;
  resetAll: () => Promise<void>;
  editor: EditorTarget | null;
  openEditor: (t: EditorTarget | null) => void;
  /** 알림 클릭 등으로 열어야 할 날짜별 평가 목록 */
  todayRoute: string | null;
  consumeTodayRoute: () => void;
  /** 종정시 입력창에 붙여넣은 글. 화면을 옮겨 다녀도 남지만 저장소에는 쓰지 않는다 (사이드바를 닫으면 사라진다) */
  pasteText: string;
  setPasteText: (t: string) => void;
  resolved: ReturnType<typeof resolveRequirements>;
  /** 실제 모드의 공식 규칙 평가 (데모 모드에서는 null — 공식 데이터와 섞지 않음) */
  report: OfficialReport | null;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider가 필요해요');
  return s;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Store['status']>('loading');
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<Mode>('real');
  const [state, setState] = useState<AppState>(emptyState);
  const realState = useRef<AppState>(emptyState());
  const [now, setNow] = useState(() => new Date());
  const [view, setViewState] = useState<View>('status');
  const [saveError, setSaveError] = useState('');
  const [editor, openEditor] = useState<EditorTarget | null>(null);
  const [todayRoute, setTodayRoute] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const stateRef = useRef(state);
  stateRef.current = state;

  const checkRoute = useCallback(async () => {
    try {
      const r = await kvGet<PendingRoute>(KEYS.route);
      if (r?.view === 'today') {
        await kvDelete([KEYS.route]);
        setViewState('assessments');
        setTodayRoute(r.date);
      }
    } catch { /* 무시 */ }
  }, []);

  // 처음 열 때: 저장값 불러오기. 실패하면 덮어쓰지 않고 오류 화면.
  useEffect(() => {
    let cancelled = false; // 개발 모드(StrictMode)에서 효과가 두 번 돌 때, 앞선 요청의 늦은 결과가 지금 상태를 덮어쓰지 않게 한다
    loadState().then(
      (s) => {
        if (cancelled) return;
        const loaded = s ?? emptyState();
        realState.current = loaded;
        setState(loaded);
        setViewState(loaded.profile ? loaded.settings.lastView : 'status');
        setStatus('ready');
        void checkRoute();
      },
      (e: Error) => { if (cancelled) return; setLoadError(e.message); setStatus('error'); },
    );
    return () => { cancelled = true; };
  }, [checkRoute]);

  // 실제 오늘 날짜: 자정·창 재활성화·절전 복귀 때 다시 계산 (날짜를 고정하지 않음)
  useEffect(() => {
    const refresh = () => setNow((prev) => {
      const n = new Date();
      return dateKey(n) === dateKey(prev) && n.getTime() - prev.getTime() < 60_000 ? prev : n;
    });
    const onVisible = () => { if (document.visibilityState === 'visible') { refresh(); void checkRoute(); } };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [checkRoute]);

  const save = useCallback(async (next: AppState | ((s: AppState) => AppState)) => {
    const value = typeof next === 'function' ? next(stateRef.current) : next;
    if (mode === 'demo') { setState(value); return true; } // 데모는 메모리에서만
    try {
      await saveState(value);
      realState.current = value;
      setState(value);
      setSaveError('');
      void notifyBackground({ type: 'reconcile' });
      return true;
    } catch (e) {
      setSaveError(`저장하지 못했어요. 기존 기록은 그대로예요. (${(e as Error).message})`);
      return false;
    }
  }, [mode]);

  // 현재 학기는 달력으로 자동 갱신한다 (화면에서 고르는 곳이 없다). 새 학기 성적·수강 과목은 종정시 입력(초기화 → 저장)으로 가져온다.
  const curYear = state.profile?.currentTerm.academicYear;
  const curSem = state.profile?.currentTerm.semester;
  const dayKey = dateKey(now);
  useEffect(() => {
    if (status !== 'ready' || mode !== 'real' || curYear === undefined || curSem === undefined) return;
    const next = advancedTerm({ academicYear: curYear, semester: curSem }, new Date());
    if (next) void save((s) => (s.profile ? { ...s, profile: { ...s.profile, currentTerm: next } } : s));
  }, [status, mode, curYear, curSem, dayKey, save]);

  const setView = useCallback((v: View) => {
    setViewState(v);
    window.scrollTo(0, 0);
    // 방금 save()가 끝났어도 아직 다시 그려지기 전이면 stateRef는 옛 값이다 → 항상 마지막으로 저장한 realState를 기준으로 쓴다
    // (그렇지 않으면 '저장 직후 화면 이동'이 방금 저장한 과목을 옛 상태로 덮어쓴다)
    const cur = realState.current;
    if (mode === 'real' && cur.profile) {
      const next = { ...cur, settings: { ...cur.settings, lastView: v } };
      saveState(next).then(() => { realState.current = next; setState(next); }, () => { /* 마지막 화면 기억 실패는 무시 */ });
    }
  }, [mode]);

  const startDemo = useCallback(() => {
    setMode('demo');
    setState(buildDemoState(new Date()));
    setViewState('status');
  }, []);
  const exitDemo = useCallback(() => {
    setMode('real');
    setState(realState.current);
    openEditor(null);
    setViewState(realState.current.profile ? realState.current.settings.lastView : 'status');
  }, []);

  const resetAll = useCallback(async () => {
    await clearEverything();
    await notifyBackground({ type: 'clearAll' });
    realState.current = emptyState();
    setMode('real');
    setState(emptyState());
    setLoadError('');
    setStatus('ready');
    setViewState('status');
    setPasteText('');
  }, []);

  const today = dateKey(now);
  const report = useMemo(() => {
    if (!state.profile || mode !== 'real') return null;
    const input = { bundles: catalog.bundles, rules: catalog.officialRules, supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById, today };
    const first = buildOfficialReport({ profile: state.profile, ...input });
    // 추가 질문 화면은 Figma에 없다 → 학생이 답하지 않은 '꼭 필요한' 질문은 전공에서 정하거나('영어 전공인가', '인증 언어' 등)
    // 나머지는 '아니요 / 해당 없음'으로 가정해 계산한다. profile.facts에 직접 저장된 답이 있으면 그 답이 우선이다.
    // 특별전형 등에 해당하는 학생은 결과가 다를 수 있다 (해당 규칙은 학교 공지로 확인해야 한다).
    const major = departmentFacts(state.profile.primaryDepartmentId);
    const assumed = assumeAnswers(first.questions, { name: major?.name, college: major?.college });
    if (!Object.keys(assumed).length) return first;
    return buildOfficialReport({ profile: { ...state.profile, facts: { ...assumed, ...(state.profile.facts ?? {}) } }, ...input });
  }, [state.profile, mode, today]);
  const resolved = useMemo(() => (!state.profile ? null
    : mode === 'demo' ? resolveRequirements(state.profile, catalog.demoBundles, ['demo'], today)
      : report?.resolved ?? null), [state.profile, mode, today, report]);

  const value: Store = {
    status, loadError, mode, state, now, today, view, setView, save, saveError, clearSaveError: () => setSaveError(''),
    startDemo, exitDemo, resetAll, editor, openEditor, todayRoute, consumeTodayRoute: () => setTodayRoute(null), pasteText, setPasteText, resolved, report,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
