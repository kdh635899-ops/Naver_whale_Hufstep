// 마이페이지 (Figma): 인사 → 프로필 카드 → 내 학적 정보(톱니바퀴로 수정) → 하단 문의 문구.
// Figma에 없는 현재 학기·알림·개인정보·삭제·초기화는 톱니바퀴를 누르면 열리는 수정 패널 맨 아래 '기타 설정'에 둔다(기능은 그대로).
// '정보 관리'(종정시 성적 다시 불러오기 / 졸업요건 기준 확인하기)는 보류 중이라 만들지 않았다.
import { useState } from 'react';
import { useStore } from '../../app/store';
import { departmentName } from '../../data';
import { CONSENT_VERSION, withoutAcademicData } from '../../domain/state';
import type { Term } from '../../domain/types';
import { formatUnits } from '../../domain/terms';
import { useProgress } from '../academic-status/useProgress';
import { ProfileForm } from '../profile/ProfileForm';
import { CAMPUS_LABEL, ConfirmButton, ENTRY_LABEL, PrivacySummary, Sheet } from '../common';

export function MyPage() {
  const { state } = useStore();
  const { progress } = useProgress();
  const [edit, setEdit] = useState(false);
  const p = state.profile!;
  const name = p.name?.trim() ?? '';
  const remaining = progress.hasRecords ? progress.total.remaining : null;
  const secondLabel = p.programType === 'double' ? '이중전공' : '부전공';
  const yy = `${String(p.cohortYear).slice(2)}학번`;

  return (
    <div className="page">
      <h1 className="page-title">{name ? <>안녕하세요,<br />{name}님</> : '안녕하세요'}</h1>
      <p className="page-lead">
        {remaining === null ? <>종정시 정보를 저장하면<br />졸업까지 남은 학점을 알려드려요.</>
          : remaining > 0 ? <>졸업까지 {formatUnits(remaining)}학점 남았어요.<br />이대로 차근차근 채워가요.</>
            : <>졸업 학점을 모두 채웠어요.<br />영역별 기준은 학사 현황에서 확인해요.</>}
      </p>

      <div className="profile-card">
        <div className="avatar" aria-hidden="true">{name ? [...name][0] : 'W'}</div>
        <div>
          <p className="pc-name">{name || '이름 없음'}</p>
          <p className="pc-sub">{yy}{p.currentYear ? ` · ${p.currentYear}학년` : ''}</p>
        </div>
      </div>

      <h2 className="sec-head sec-gap">
        내 학적 정보
        <button type="button" className="icon-link" aria-label="학적 정보 수정하기" onClick={() => setEdit(true)}><i className="icon ic-setting" aria-hidden="true" /></button>
      </h2>
      <dl className="info-table">
        <div className="info-row"><dt>이름 / 닉네임</dt><dd>{name || '—'}</dd></div>
        <div className="info-row"><dt>소속 캠퍼스</dt><dd>{CAMPUS_LABEL[p.homeCampus]}</dd></div>
        <div className="info-row"><dt>주전공</dt><dd>{departmentName(p.primaryDepartmentId)}</dd></div>
        {p.secondaryDepartmentId && <div className="info-row"><dt>{secondLabel}</dt><dd>{departmentName(p.secondaryDepartmentId)}</dd></div>}
        <div className="info-row"><dt>학번 / 현재 학년</dt><dd>{yy}{p.currentYear ? ` / ${p.currentYear}학년` : ''}</dd></div>
        <div className="info-row"><dt>입학 유형</dt><dd>{ENTRY_LABEL[p.entryType]}</dd></div>
      </dl>

      <p className="mp-foot"><span>오류 신고•수정 요청</span><span>개발자 이메일 주소</span></p>

      {edit && (
        <Sheet title="내 정보 수정" onClose={() => setEdit(false)}>
          <ProfileForm submitLabel="저장" onDone={() => setEdit(false)} />
          <MoreSettings />
        </Sheet>
      )}
    </div>
  );
}

/** 수정 패널 맨 아래: 현재 학기 · 평가 알림 · 개인정보와 저장(동의 철회·삭제·초기화) */
function MoreSettings() {
  const { state, save, mode, exitDemo, resetAll, now } = useStore();
  const p = state.profile!;
  const n = state.settings.notifications;
  const notifConsent = !!state.consent.notifications;
  // 알림 설정이 바뀔 때마다 version을 올려 이전 예약이 실행되지 않게 한다
  const setNotif = (patch: Partial<typeof n>) => save((s) => ({
    ...s, settings: { ...s.settings, notifications: { ...s.settings.notifications, ...patch, version: s.settings.notifications.version + 1 } },
  }));
  const setTerm = (t: Term) => save((s) => ({ ...s, profile: { ...s.profile!, currentTerm: t } }));

  return (
    <details className="card">
      <summary>기타 설정 (현재 학기 · 알림 · 데이터 관리)</summary>

      <section aria-label="현재 학기">
        <h3 className="h3">현재 학기</h3>
        <p className="muted small">시간표·알림·예상 성적의 기준 학기예요. 날짜가 지나도 자동으로 바뀌지 않아요.</p>
        <TermPicker term={p.currentTerm} onChange={setTerm} />
      </section>

      <section aria-labelledby="notif-title">
        <h3 id="notif-title" className="h3">평가 알림</h3>
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

      <section aria-label="개인정보와 저장">
        <h3 className="h3">개인정보와 저장</h3>
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
    </details>
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
