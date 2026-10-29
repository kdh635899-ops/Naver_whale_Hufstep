import { describe, expect, it } from 'vitest';
import { catalog, departmentFacts, departmentMetaById } from '../../src/data';
import { buildOfficialReport, autoLinkTargets } from '../../src/domain/requirements/officialRules';
import { previousTimetableCourse, timetableRequirementStates, timetableTargets } from '../../src/domain/timetableStatus';
import { emptyState } from '../../src/domain/state';
import { appStateSchema } from '../../src/domain/validation/schemas';
import { course } from '../fixtures';
import type { StudentProfile } from '../../src/domain/types';

const profile: StudentProfile = { schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2024, entryType: 'freshman',
  primaryDepartmentId: 'seoul-malay-indonesian', programType: 'double', secondaryDepartmentId: 'seoul-business',
  currentTerm: { academicYear: 2026, semester: '2' },
  facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false, approvedRequiredCourseWaiver: false } };
const report = buildOfficialReport({ profile, bundles: catalog.bundles, rules: catalog.officialRules,
  supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById });

describe('시간표 수강 상태는 이수 판정과 별도로 연결한다', () => {
  it('유일한 정확한 이름만 연결하며, 다른 코드가 있으면 이름으로 대신 연결하지 않는다', () => {
    expect(timetableTargets(report, { name: '지역과 지역학' })).toHaveLength(1);
    expect(timetableTargets(report, { name: '지역과지역학 입문' })).toHaveLength(0);
    expect(timetableTargets(report, { name: '지역과지역학', officialCode: 'OTHER' })).toHaveLength(0);
    const source = autoLinkTargets(report, '지역과지역학')[0].leaf;
    const duplicate = { ...report, courseRules: [...report.courseRules, { ...report.courseRules[0],
      rule: { ...report.courseRules[0].rule, courses: { ...source, id: 'duplicate-leaf' } } }] };
    expect(timetableTargets(duplicate, { name: source.name })).toHaveLength(0);
  });

  it('현재 학기·배치된 수강 중 과목만 연결하고, 시간 삭제·학기 변경·이수 완료 시 해제한다', () => {
    const current = course({ name: '지역과지역학', origin: 'timetable', status: 'inProgress',
      term: profile.currentTerm, isRetake: true });
    const state = { ...emptyState(), profile, courses: [current],
      classTimes: [{ courseId: current.id, day: 0 as const, start: '09:00', end: '10:00' }] };
    const before = JSON.stringify(state);
    const leafId = timetableTargets(report, current)[0].leaf.id;
    expect(timetableRequirementStates(state, report).get(leafId)).toEqual({ isRetake: true });
    expect(JSON.stringify(state)).toBe(before);
    expect(timetableRequirementStates({ ...state, classTimes: [] }, report).size).toBe(0);
    expect(timetableRequirementStates({ ...state, courses: [{ ...current, status: 'completed' }] }, report).size).toBe(0);
    expect(timetableRequirementStates({ ...state, courses: [{ ...current, term: { academicYear: 2025, semester: '2' } }] }, report).size).toBe(0);
    expect(appStateSchema.parse(state).courses[0].isRetake).toBe(true);
  });

  it('이전 이수·F 기록은 재수강 안내에 사용하며 미래·시간표 기록은 제외한다', () => {
    const failed = course({ id: 'failed', name: '지역과지역학', grade: 'F', status: 'notEarned', term: { academicYear: 2025, semester: '2' } });
    const old = course({ name: failed.name, grade: 'C0' });
    const current = course({ name: failed.name, term: profile.currentTerm });
    const timetable = course({ name: failed.name, origin: 'timetable', term: failed.term });
    const state = { ...emptyState(), profile, courses: [failed, old, current, timetable] };
    expect(previousTimetableCourse(state, { name: failed.name })?.id).toBe('failed');
    expect(previousTimetableCourse(state, { name: '다른과목' })).toBeUndefined();
    expect(previousTimetableCourse({ ...state, courses: [{ ...failed, officialCode: 'OLD' }] }, { name: failed.name, officialCode: 'NEW' })).toBeUndefined();
  });

  it('이름이 달라진 재수강도 연결한 이전 전공필수에 상태를 표시한다', () => {
    const old = course({ name: '지역과지역학', officialCode: 'B03131', grade: 'B0' });
    const now = course({ name: '이름이 바뀐 과목', origin: 'timetable', status: 'inProgress',
      term: profile.currentTerm, isRetake: true, replacesCourseId: old.id });
    const state = { ...emptyState(), profile, courses: [old, now],
      classTimes: [{ courseId: now.id, day: 0 as const, start: '09:00', end: '10:00' }] };
    const id = timetableTargets(report, old)[0].leaf.id;
    expect(timetableRequirementStates(state, report).get(id)).toEqual({ isRetake: true });
    expect(old.status).toBe('completed');
    expect(timetableRequirementStates({ ...state, courses: [old, { ...now, isRetake: false, replacesCourseId: undefined }] }, report).has(id)).toBe(false);
  });
});
