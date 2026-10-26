// 사이드바 앱 뼈대: 헤더 · 5개 메뉴 · 화면 · 공유 과목 편집기.
// 메뉴 순서(§2.2): 종정시 입력 → 학사현황 → 평가일정 → 학점계산 → 마이페이지
import { useState } from 'react';
import type { View } from '../domain/state';
import { AssessmentsScreen } from '../features/assessments/AssessmentsScreen';
import { CalculatorScreen } from '../features/calculator/CalculatorScreen';
import { CAMPUS_LABEL, ConfirmButton, PrivacySummary } from '../features/common';
import { CourseEditor } from '../features/courses/CourseEditor';
import { ProfileForm } from '../features/profile/ProfileForm';
import { RecordsScreen } from '../features/records/RecordsScreen';
import { MyPage } from '../features/settings/MyPage';
import { StatusScreen } from '../features/academic-status/StatusScreen';
import { useStore } from './store';

const TABS: { view: View; label: string; icon: string }[] = [
  { view: 'records', label: '종정시 입력', icon: 'M4 5h16v4H4zM5 9v10h14V9M9 13h6' },
  { view: 'status', label: '학사현황', icon: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6' },
  { view: 'assessments', label: '평가일정', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { view: 'calculator', label: '학점계산', icon: 'M6 3h12v18H6zM9 7h6M9 12h1M14 12h1M9 16h1M14 16h1' },
  { view: 'mypage', label: '마이페이지', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6' },
];

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"><path d={d} /></svg>;
}

function Header() {
  const { state } = useStore();
  return (
    <header className="app-header">
      <div className="logo" aria-hidden="true">W</div>
      <div className="brand">
        <p className="brand-name">HUFStep</p>
        <p className="brand-sub">외대생의 학사 도우미</p>
      </div>
      {state.profile && <span className="badge">{CAMPUS_LABEL[state.profile.homeCampus]}</span>}
    </header>
  );
}

export function App() {
  const s = useStore();
  if (s.status === 'loading') return <div className="loading" role="status">불러오는 중…</div>;
  if (s.status === 'error') return <LoadError />;
  if (!s.state.profile) return <Start />;

  return (
    <div className="app">
      <Header />
      <nav className="tabs" aria-label="주 메뉴">
        {TABS.map((t) => (
          <button key={t.view} type="button" className="tab" aria-current={s.view === t.view ? 'page' : undefined} onClick={() => s.setView(t.view)}>
            <Icon d={t.icon} /><span>{t.label}</span>
          </button>
        ))}
      </nav>
      {s.mode === 'demo' && (
        <div className="demo-banner" role="note">
          <span>가상 데이터로 보는 시안이에요 · 실제 기록과 섞이지 않고 저장되지 않아요</span>
          <button type="button" className="btn small light" onClick={s.exitDemo}>나가기</button>
        </div>
      )}
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

/** 첫 실행: 학생 조건 선택 → (성적 입력 또는 건너뛰기) → 학사현황 */
function Start() {
  const { startDemo, setView } = useStore();
  const [step, setStep] = useState<'welcome' | 'form'>('welcome');
  return (
    <div className="app">
      <Header />
      <main className="screen">
        {step === 'welcome' ? (
          <>
            <p className="eyebrow">나에게 맞는 졸업요건</p>
            <h1>이수학점과 평가일정을<br />한곳에서 관리해요</h1>
            <p className="lead">내 조건에 맞는 졸업요건과 앞으로 채워야 할 학점, 이번 학기 시험 일정과 예상 평점을 확인해요.</p>
            <section className="card">
              <h2 className="h3">시작 전에 알아 두세요</h2>
              <PrivacySummary />
            </section>
            <button type="button" className="btn primary block" onClick={() => setStep('form')}>내 조건 입력하고 시작하기 →</button>
            <button type="button" className="btn ghost block" onClick={startDemo}>가상 데이터로 둘러보기</button>
          </>
        ) : (
          <>
            <p className="eyebrow">나에게 맞는 졸업요건</p>
            <h1>어떤 전공을<br />공부하고 있나요?</h1>
            <p className="lead">내 조건에 맞는 졸업요건과 앞으로 채워야 할 학점을 확인해요.</p>
            <ProfileForm submitLabel="다음: 성적 입력 →" onDone={() => setView('records')} />
            <button type="button" className="btn ghost block" onClick={() => setStep('welcome')}>뒤로</button>
          </>
        )}
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
