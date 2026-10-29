// 이전 성적을 고르는 공통 화면(View). 실제 성적은 바꾸지 않고 예상 계산의 연결만 전달한다.
import { autoProjectedRetake, projectedRetakeCandidates, type RetakeSubject } from '../../domain/retake';
import { termLabel } from '../../domain/terms';
import type { Course } from '../../domain/types';
import { useId } from 'react';
import { ProfileSelect } from '../profile/ProfileSelect';

export function RetakeRecordSelect({ courses, subject, selectedId, onChange }: {
  courses: Course[]; subject: RetakeSubject; selectedId?: string; onChange: (id: string) => void;
}) {
  const candidates = projectedRetakeCandidates(courses, subject);
  const value = selectedId || autoProjectedRetake(courses, subject)?.id || '';
  const hintId = useId();
  return <div className="retake-record-field"><span className="retake-record-label">대체하는 이전 기록</span>
    <ProfileSelect downward compact aria-label="대체하는 이전 기록" aria-describedby={hintId}
      value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">이전 기록 선택</option>
      {value && !candidates.some((c) => c.id === value) && <option value={value}>연결된 기록 확인 필요</option>}
      {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} ({termLabel(c.term)} · {c.grade ?? '성적 모름'})</option>)}
    </ProfileSelect>
    <span id={hintId} className="retake-record-hint">{value ? '예상 평점에서만 이전 성적을 대체해요.'
      : '이전 기록을 선택하면 재수강 예상 평점을 계산해요.'}</span>
  </div>;
}
