// 사이드바 앱 뼈대: 헤더 · 5개 메뉴 · 화면 · 공유 과목 편집기.
// 메뉴 순서(§2.2): 종정시 입력 → 학사 현황 → 시간표 → 학점 계산 → 마이페이지
import { useEffect } from 'react';
import type { View } from '../domain/state';
import { AssessmentsScreen } from '../features/assessments/AssessmentsScreen';
import { CalculatorScreen } from '../features/calculator/CalculatorScreen';
import { ConfirmButton } from '../features/common';
import { CourseEditor } from '../features/courses/CourseEditor';
import { ProfileForm } from '../features/profile/ProfileForm';
import { RecordsScreen } from '../features/records/RecordsScreen';
import { MyPage } from '../features/settings/MyPage';
import { StatusScreen } from '../features/academic-status/StatusScreen';
import { useStore } from './store';

// 아이콘은 Figma에서 내려받은 SVG(src/icons)를 CSS 마스크로 칠한다 → 선택/비선택 색이 글자색을 따라간다.
const TABS: { view: View; label: string }[] = [
  { view: 'records', label: '종정시 입력' },
  { view: 'status', label: '학사 현황' },
  { view: 'assessments', label: '시간표' },
  { view: 'calculator', label: '학점 계산' },
  { view: 'mypage', label: '마이페이지' },
];

function Header() {
  return (
    <header className="app-header">
      <div className="logo" aria-hidden="true">W</div>
      <div className="brand">
        <p className="brand-name">HUFStep</p>
        <p className="brand-sub">외대생의 학사 도우미</p>
      </div>
    </header>
  );
}

export function App() {
  const s = useStore();
  // 화면에는 가상 데이터 진입 버튼이 없다(Figma에 없음). 개발·점검용으로 주소 뒤에 ?demo를 붙이면 가상 데이터로 연다.
  const { status, mode, startDemo } = s;
  const noProfile = !s.state.profile;
  useEffect(() => {
    if (status === 'ready' && mode === 'real' && noProfile && new URLSearchParams(window.location.search).has('demo')) startDemo();
  }, [status, mode, noProfile, startDemo]);
  if (s.status === 'loading') return <div className="loading" role="status">불러오는 중…</div>;
  if (s.status === 'error') return <LoadError />;
  if (!s.state.profile) return <Start />;

  return (
    <div className="app">
      <Header />
      <nav className="tabs" aria-label="주 메뉴">
        {TABS.map((t) => (
          <button key={t.view} type="button" className="tab" aria-current={s.view === t.view ? 'page' : undefined} onClick={() => s.setView(t.view)}>
            <i className={`tab-icon ti-${t.view}`} aria-hidden="true" /><span>{t.label}</span>
          </button>
        ))}
      </nav>
      {s.saveError && (
        <div className="error-banner" role="alert">
          <span>{s.saveError}</span>
          <button type="button" className="icon-btn" aria-label="닫기" onClick={s.clearSaveError}>✕</button>
        </div>
      )}
      <main>
        {s.view === 'records' && <RecordsScreen />}
        {s.view === 'status' && <StatusScreen />}
        {s.view === 'assessments' && <AssessmentsScreen />}
        {s.view === 'calculator' && <CalculatorScreen />}
        {s.view === 'mypage' && <MyPage />}
      </main>
      {s.editor && <CourseEditor key={s.editor.courseId ?? 'new'} />}
    </div>
  );
}

/** 첫 실행: Figma 개인정보 입력 화면 (헤더·탭 없음) → 저장하면 종정시 입력으로 */
function Start() {
  const { setView } = useStore();
  return (
    <div className="app">
      <main className="start">
        <div className="logo-lg" aria-hidden="true">W</div>
        <h1 className="fig-title">학사정보를 입력하고<br />HUFStep을 이용해보세요!</h1>
        <p className="fig-lead">내 학사현황과 학점 시뮬레이션으로<br />편하게 학기 운용 계획을 세울 수 있어요.</p>
        <ProfileForm submitLabel="학사정보 저장" onDone={() => setView('records')} />
      </main>
    </div>
  );
}

/** 저장 데이터를 읽지 못했을 때: 기존 데이터를 덮어쓰지 않고 선택지를 준다 */
function LoadError() {
  const { loadError, startDemo, resetAll } = useStore();
  return (
    <div className="app">
      <Header />
      <main className="screen">
        <h1>저장된 기록을 열지 못했어요</h1>
        <p className="error" role="alert">{loadError}</p>
        <p className="lead">기존 기록은 지우지 않고 그대로 두었어요. 앱을 업데이트한 뒤 다시 열어 보거나, 직접 초기화할 수 있어요.</p>
        <button type="button" className="btn ghost block" onClick={startDemo}>가상 데이터로 둘러보기</button>
        <ConfirmButton label="전체 초기화" className="btn danger block" confirmText="이 브라우저에 저장된 HUFStep 기록을 모두 지워요. 되돌릴 수 없어요." onConfirm={resetAll} />
      </main>
    </div>
  );
}
