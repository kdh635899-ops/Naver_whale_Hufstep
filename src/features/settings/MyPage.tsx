// 마이페이지 (§3.8). 조건 수정·현재 학기·알림 설정·개인정보 안내·동의 철회·삭제·전체 초기화.
import { useState } from 'react';
import { useStore } from '../../app/store';
import { catalog, departmentName } from '../../data';
import { CONSENT_VERSION, withoutAcademicData } from '../../domain/state';
import { termLabel } from '../../domain/terms';
import type { Term } from '../../domain/types';
import { ProfileForm } from '../profile/ProfileForm';
import { CAMPUS_LABEL, ConfirmButton, ENTRY_LABEL, PrivacySummary, PROGRAM_LABEL, Sheet } from '../common';

export function MyPage() {
  const { state, save, setView, mode, exitDemo, resetAll, now } = useStore();
  const [editProfile, setEditProfile] = useState(false);
  const p = state.profile!;
  const n = state.settings.notifications;
  const notifConsent = !!state.consent.notifications;

  // 알림 설정이 바뀔 때마다 version을 올려 이전 예약이 실행되지 않게 한다
  const setNotif = (patch: Partial<typeof n>) => save((s) => ({
    ...s, settings: { ...s.settings, notifications: { ...s.settings.notifications, ...patch, version: s.settings.notifications.version + 1 } },
  }));
  const setTerm = (t: Term) => save((s) => ({ ...s, profile: { ...s.profile!, currentTerm: t } }));

  return (
    <div className="screen">
      <p className="eyebrow">마이페이지</p>
      <h1>내 정보와 설정</h1>

      <section className="card">
        <h2 className="h3">내 학적 조건</h2>
        <dl className="kv">
          <div><dt>캠퍼스</dt><dd>{CAMPUS_LABEL[p.homeCampus]}</dd></div>
          <div><dt>주전공</dt><dd>{departmentName(p.primaryDepartmentId)}</dd></div>
          {p.secondaryDepartmentId && <div><dt>{PROGRAM_LABEL[p.programType]}</dt><dd>{departmentName(p.secondaryDepartmentId)}</dd></div>}
          <div><dt>학번 / 현재 학년</dt><dd>{String(p.cohortYear).slice(2)}학번{p.currentYear ? ` / ${p.currentYear}학년` : ''}</dd></div>
          <div><dt>입학 유형</dt><dd>{ENTRY_LABEL[p.entryType]}</dd></div>
        </dl>
        <button type="button" className="btn ghost block" onClick={() => setEditProfile(true)}>학적 정보 수정하기</button>
      </section>

      <section className="card">
        <h2 className="h3">현재 학기</h2>
        <p className="muted small">시간표·오늘 집계·알림·예상 성적의 기준 학기예요. 날짜가 지나도 자동으로 바뀌지 않아요.</p>
        <TermPicker term={p.currentTerm} onChange={setTerm} />
      </section>

      <section className="card">
        <h2 className="h3">정보 관리</h2>
        <button type="button" className="btn ghost block" onClick={() => setView('records')}>종정시 성적 다시 붙여넣기</button>
        <button type="button" className="btn ghost block" onClick={() => setView('status')}>졸업요건 기준 확인하기</button>
      </section>

      <section className="card" aria-labelledby="notif-title">
        <h2 id="notif-title" className="h3">평가 알림</h2>
        <p className="muted small">시험·제출·발표 전날·당일에 날짜별로 한 번 알려요. 잠금화면 노출을 줄이려고 과목명·성적 없이 건수만 보여줘요. PC나 브라우저가 꺼져 있거나 운영체제가 알림을 막으면 알림이 오지 않을 수 있어요.</p>
        {mode === 'demo' && <p className="muted small">가상 데이터 모드에서는 시스템 알림을 예약하지 않아요.</p>}
        {!notifConsent ? (
          <button type="button" className="btn primary block" disabled={mode === 'demo'}
            onClick={() => save((s) => ({ ...s, consent: { ...s.consent, notifications: { version: CONSENT_VERSION, at: now.toISOString() } }, settings: { ...s.settings, notifications: { ...s.settings.notifications, enabled: true, version: s.settings.notifications.version + 1 } } }))}>
            알림 받기에 동의하고 켜기
          </button>
        ) : (
          <div className="form">
            <label className="check"><input type="checkbox" checked={n.enabled} onChange={(e) => setNotif({ enabled: e.target.checked })} /> 알림 켜기</label>
            <label className="check"><input type="checkbox" disabled={!n.enabled} checked={n.dayBefore} onChange={(e) => setNotif({ dayBefore: e.target.checked })} /> 전날 알림</label>
            <label className="check"><input type="checkbox" disabled={!n.enabled} checked={n.sameDay} onChange={(e) => setNotif({ sameDay: e.target.checked })} /> 당일 알림 (첫 일정 30분 전보다 늦지 않게)</label>
            <label>알림 시각<input type="time" disabled={!n.enabled} value={n.time} onChange={(e) => e.target.value && setNotif({ time: e.target.value })} /></label>
            <button type="button" className="btn ghost" onClick={() => save((s) => ({ ...s, consent: { ...s.consent, notifications: undefined }, settings: { ...s.settings, notifications: { ...s.settings.notifications, enabled: false, version: s.settings.notifications.version + 1 } } }))}>
              알림 동의 철회
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="h3">개인정보와 저장</h2>
        <PrivacySummary />
        {state.consent.academicData && <p className="muted small">학업정보 처리 동의: {new Date(state.consent.academicData.at).toLocaleDateString('ko-KR')} (안내 버전 {state.consent.academicData.version})</p>}
        {state.consent.academicData && (
          <ConfirmButton label="학업정보 동의 철회" className="btn danger-ghost block"
            confirmText="동의를 철회하면 과목·성적 요약·시간표·완료 표시·예상 성적·인증 확인·알림 예약이 모두 지워져요. 학생 조건은 남아요."
            onConfirm={() => save((s) => ({ ...withoutAcademicData(s), consent: {}, settings: { ...s.settings, notifications: { ...s.settings.notifications, enabled: false, version: s.settings.notifications.version + 1 } } }))} />
        )}
        <ConfirmButton label="학업정보 삭제" className="btn danger-ghost block"
          confirmText="과목·성적 요약·시간표·완료 표시·예상 성적·인증 확인을 지워요. 학생 조건·알림 설정·동의 기록은 남아요."
          onConfirm={() => save(withoutAcademicData)} />
        {mode === 'demo'
          ? <button type="button" className="btn danger block" onClick={exitDemo}>가상 데이터 둘러보기 끝내기</button>
          : <ConfirmButton label="전체 초기화" className="btn danger block"
              confirmText="학생 조건·성적·과목·평가·시나리오·설정·동의 기록·알림 예약과 발송 이력까지 이 브라우저에서 모두 지워요. 되돌릴 수 없어요."
              onConfirm={resetAll} />}
      </section>

      <p className="muted small center">HUFStep 0.2.0 · 데이터 형식 v{state.schemaVersion} · 공식 졸업요건 묶음 {catalog.bundles.length}개 · 가상 예시 묶음 {catalog.demoBundles.length}개 · 현재 학기 {termLabel(p.currentTerm)}</p>

      {editProfile && (
        <Sheet title="학생 조건 수정" onClose={() => setEditProfile(false)}>
          <p className="muted small">조건을 바꿔도 성적·평가 기록은 지워지지 않아요.</p>
          <ProfileForm submitLabel="저장" onDone={() => setEditProfile(false)} />
        </Sheet>
      )}
    </div>
  );
}

function TermPicker({ term, onChange }: { term: Term; onChange: (t: Term) => void }) {
  const [year, setYear] = useState(String(term.academicYear));
  const [sem, setSem] = useState(term.semester);
  const valid = /^\d{4}$/.test(year) && Number(year) >= 2019 && Number(year) <= 2100;
  const dirty = Number(year) !== term.academicYear || sem !== term.semester;
  return (
    <div className="row2 align-end">
      <label>학년도<input type="number" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></label>
      <label>학기
        <select value={sem} onChange={(e) => setSem(e.target.value as Term['semester'])}>
          <option value="1">1학기</option><option value="summer">여름 계절</option><option value="2">2학기</option><option value="winter">겨울 계절</option>
        </select>
      </label>
      <button type="button" className="btn" disabled={!valid || !dirty} onClick={() => onChange({ academicYear: Number(year), semester: sem })}>적용</button>
    </div>
  );
}
