// 학사 현황·마이페이지가 같이 쓰는 졸업 진행 계산 (화면과 무관한 계산은 domain에 있고, 여기서는 스토어 값만 묶는다).
import { useMemo } from 'react';
import { useStore } from '../../app/store';
import { catalog, departmentById } from '../../data';
import { evaluateCourseRules } from '../../domain/requirements/officialRules';
import { evaluateProgress } from '../../domain/requirements/resolve';
import { gradeCourses, latestSnapshot } from '../../domain/state';

export function useProgress() {
  const { state, resolved, report } = useStore();
  const snap = latestSnapshot(state);
  const courses = useMemo(() => gradeCourses(state.courses), [state.courses]); // 시간표 과목은 제외
  const progress = useMemo(() => evaluateProgress(resolved, courses, snap, catalog.equivalences), [resolved, courses, snap]);
  // 공식 필수과목 식: 기존 필수 묶음에서 이미 쓴 과목은 다시 쓰지 않는다 (중복 인정은 규정에 명시된 경우만)
  const courseProgress = useMemo(() => (report
    ? evaluateCourseRules(report, courses, snap, {
      alreadyUsed: resolved?.allowCourseReuseAcrossGroups ? [] : progress.groups.flatMap((g) => g.matchedCourseIds),
      dept: departmentById, // 코드 없는 전필을 '개설학과(별칭 포함) + 과목명'으로 대조
      confirmedLeafIds: state.certConfirmations.map((c) => c.requirementId),
    })
    : []), [report, courses, snap, resolved, progress, state.certConfirmations]);
  const checklistProgress = useMemo(() => report ? evaluateCourseRules(report, courses, snap, {
    alreadyUsed: resolved?.allowCourseReuseAcrossGroups ? [] : progress.groups.flatMap((g) => g.matchedCourseIds),
    dept: departmentById, confirmedLeafIds: state.certConfirmations.map((c) => c.requirementId),
    excludedLeafIds: state.statusEdits?.removed,
  }) : [], [report, courses, snap, resolved, progress, state.certConfirmations, state.statusEdits]);
  return { snap, progress, courseProgress, checklistProgress };
}
