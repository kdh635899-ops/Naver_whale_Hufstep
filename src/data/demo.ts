// 가상(합성) 데모 데이터. 실제 학생의 성적·수강 이력과 무관하며 그것을 참고해 만들지도 않았다 (§11).
// 데모 상태는 메모리에만 있고 실제 학생 기록(IndexedDB)에 섞이지 않는다.
import { applyMerge, planMerge } from '../domain/merge/mergeImport';
import { parseTranscript } from '../domain/parser/parseTranscript';
import { CONSENT_VERSION, emptyState, type AppState } from '../domain/state';
import { addDays, dateKey, suggestTerm } from '../domain/terms';
import type { Assessment, ClassTime, Course, Term } from '../domain/types';

/** §11.1 성적 붙여넣기 합성 fixture */
export const DEMO_TRANSCRIPT = `년도/학기별 취득성적
(직전학기)재수강누적 학점 : 0 / 21 학점
개설학과 교과목코드 교과목명 이수구분 학점 등급 재수강 비고 인정학과
2020 - 1
교양인정학점(예시) (Example Recognized Credits) 교양 6
2020 - 2
자유선택인정학점(예시) (Example Free Choice Credits) 자선 4
2021 - 1
가상학과 T90001 예시과목(1) (Example Subject (1)) 1전공 3 A0
가상학과 O90002 예시과목(2) (Example Subject (2)) 1전공 2 B+
2021 - 2
가상학과 T90003 예시이중전공과목 이중전공 3 C0
가상학과 T90004 예시교양과목 교양 2 D0
조회합계 20.0 학점
이수구분별 취득학점 계
이수구분 1전공 이중전공 2전공 부전공 실용외국어 교양 교직 자선 기초 총 계
이수구분별 취득학점 계 5.0 3.0 0.0 0.0 0.0 8.0 0.0 4.0 0.0 20.0`;

const now = () => new Date().toISOString();

/** §11.3: 이번 학기 '수강 중' 합성 과목 6개 (취득성적 20학점에 더하지 않음) */
export function demoCurrentCourses(term: Term): Course[] {
  const base = {
    term, origin: 'demo' as const, recordKind: 'course' as const, status: 'inProgress' as const, grade: null,
    gradingMode: 'graded' as const, gpaInclusion: 'excluded' as const, earnedInclusion: 'excluded' as const,
    requiredClaim: 'none' as const, overriddenFields: [], updatedAt: now(),
  };
  return [
    { ...base, id: 'demo-c1', name: '예시 과목 A', creditUnits: 300, area: 'primary' },
    { ...base, id: 'demo-c2', name: '예시 과목 B', creditUnits: 300, area: 'double' },
    { ...base, id: 'demo-c3', name: '예시 과목 C', creditUnits: 200, area: 'liberalArts' },
    { ...base, id: 'demo-c4', name: '예시 과목 D', creditUnits: 300, area: 'primary' },
    { ...base, id: 'demo-c5', name: '아주 긴 이름을 가진 예시 과목: 가상 지역의 언어와 문화 현장 연구 방법론', creditUnits: 300, area: 'primary' },
    { ...base, id: 'demo-c6', name: '예시 과목 F', creditUnits: 300, area: 'double' },
  ];
}

/** base 날짜에 시험 2개·제출 1개가 생기도록 만든 평가 조합 */
export function demoAssessments(base: string): Assessment[] {
  const a = (id: string, courseId: string, phase: Assessment['phase'], rest: Partial<Assessment>): Assessment => ({
    id, courseId, phase, mode: null, notes: '', origin: 'student', updatedAt: now(), ...rest,
  });
  return [
    // 중간 발표 대체 + 기말 시험
    a('demo-a1m', 'demo-c1', 'midterm', { mode: 'replacement', replacementType: 'presentation', submissionDate: addDays(base, -10), presentationDate: addDays(base, -9), presentationTime: '10:30', notes: '발표 10분 (예시)' }),
    a('demo-a1f', 'demo-c1', 'final', { mode: 'exam', examDate: base, examStartTime: '10:00', examEndTime: '11:15', notes: '강의실 지필 (예시)' }),
    // 중간 시험 + 기말 없음
    a('demo-a2m', 'demo-c2', 'midterm', { mode: 'exam', examDate: base, examStartTime: '13:00' }),
    a('demo-a2f', 'demo-c2', 'final', { mode: 'none' }),
    // 중간 없음 + 기말 보고서 대체
    a('demo-a3m', 'demo-c3', 'midterm', { mode: 'none' }),
    a('demo-a3f', 'demo-c3', 'final', { mode: 'replacement', replacementType: 'report', submissionDate: base, submissionTime: '23:59', notes: 'PDF 제출 (예시)' }),
    // 양쪽 시험, 기말은 날짜 미입력
    a('demo-a4m', 'demo-c4', 'midterm', { mode: 'exam', examDate: addDays(base, 7) }),
    a('demo-a4f', 'demo-c4', 'final', { mode: 'exam' }),
    // demo-c5(긴 이름 과목)는 양쪽 미선택(null) — 평가 기록 없음
    // 제출일과 발표일이 다른 대체평가
    a('demo-a6m', 'demo-c6', 'midterm', { mode: 'replacement', replacementType: 'presentation', submissionDate: addDays(base, 2), presentationDate: addDays(base, 4), presentationTime: '15:00' }),
  ];
}

/** 데모 모드 전체 상태. today 기준으로 평가 날짜를 만든다 (제품 코드의 오늘 날짜를 고정하지 않음). */
export function buildDemoState(today: Date): AppState {
  const term = suggestTerm(today);
  const start: AppState = {
    ...emptyState(),
    profile: {
      schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2020, entryType: 'freshman',
      primaryDepartmentId: 'seoul-malay-indonesian', programType: 'double', secondaryDepartmentId: 'seoul-business', currentTerm: term,
    },
    consent: { academicData: { version: CONSENT_VERSION, at: today.toISOString() } },
  };
  const parse = parseTranscript(DEMO_TRANSCRIPT);
  const merged = applyMerge(start, parse, planMerge(start, parse), { link: {}, conflictChoice: {}, removeMissing: false }, today);
  return {
    ...merged,
    courses: [...merged.courses.map((c) => ({ ...c, origin: 'demo' as const })), ...demoCurrentCourses(term)],
    assessments: demoAssessments(dateKey(today)),
    classTimes: demoClassTimes(),
    courseMemos: [{ courseId: 'demo-c1', text: '다음 수업: 발표 주제 한 가지 준비하기 (예시 메모)', updatedAt: now() }],
  };
}

/** 데모 수업 시간 (가상). demo-c5(긴 이름)는 일부러 비워 '수업 시간 미입력' 목록을 보여 준다. */
export function demoClassTimes(): ClassTime[] {
  return [
    { courseId: 'demo-c1', day: 0, start: '09:00', end: '10:15' }, { courseId: 'demo-c1', day: 2, start: '09:00', end: '10:15' },
    { courseId: 'demo-c2', day: 1, start: '10:30', end: '12:00' },
    { courseId: 'demo-c3', day: 2, start: '13:00', end: '15:00' },
    { courseId: 'demo-c4', day: 3, start: '13:00', end: '14:15' }, { courseId: 'demo-c4', day: 4, start: '10:30', end: '11:45' },
    { courseId: 'demo-c6', day: 0, start: '14:00', end: '16:00' },
  ];
}
