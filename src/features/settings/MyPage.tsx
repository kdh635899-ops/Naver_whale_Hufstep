// 마이페이지 (Figma): 인사 → 프로필 카드 → 내 학적 정보(톱니바퀴로 수정) → 하단 문의 문구.
// 알림·동의 철회·삭제·전체 초기화·현재 학기 설정은 가볍게 가기 위해 뺐다. (종정시 정보를 지우고 다시 저장하는 것은 종정시 입력의 '초기화')
// '정보 관리'(종정시 성적 다시 불러오기 / 졸업요건 기준 확인하기)는 보류 중이라 만들지 않았다.
import { useState } from 'react';
import { useStore } from '../../app/store';
import { departmentName } from '../../data';
import { formatUnits } from '../../domain/terms';
import { useProgress } from '../academic-status/useProgress';
import { ProfileForm } from '../profile/ProfileForm';
import { CAMPUS_LABEL, ENTRY_LABEL, Sheet } from '../common';

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

      <p className="mp-foot">
        <span className="mp-ask"><i className="icon ic-mail" aria-hidden="true" />오류 신고 및 문의</span>
        <span className="mp-bar" aria-hidden="true">|</span>
        <a className="mp-mail" href="mailto:hufswavoo123@gmail.com">hufswavoo123@gmail.com</a>
      </p>

      {edit && (
        <Sheet title="내 정보 수정" onClose={() => setEdit(false)}>
          <ProfileForm submitLabel="저장" onDone={() => setEdit(false)} />
        </Sheet>
      )}
    </div>
  );
}
