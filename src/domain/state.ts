// IndexedDB에 저장되는 앱 전체 상태 (§9.1). 원문 붙여넣기 전문은 여기에 들어가지 않는다.
import type { NotificationSettings } from './notifications/plan';
import type {
  AcademicSnapshot, Assessment, ClassTime, Course, CourseMemo, EventCompletion, GradeScenario, StudentProfile,
} from './types';

/** 2: 과목별 자유 메모(courseMemos)·수업 시간(classTimes) 추가 */
export const SCHEMA_VERSION = 2;
/** 개인정보 안내 문구 버전 — 문구가 바뀌면 올린다 */
export const CONSENT_VERSION = '2026-10-23';

/** 학점 계산·학사 현황·종정시 반영이 쓰는 과목. 시간표에서 만든 과목은 여기에 들어오지 않는다 (시간표와 학점 계산은 이어지지 않는다) */
export const gradeCourses = (courses: Course[]): Course[] => courses.filter((c) => c.origin !== 'timetable');

export type View = 'records' | 'status' | 'assessments' | 'calculator' | 'mypage';

export interface AppState {
  schemaVersion: number;
  profile: StudentProfile | null;
  courses: Course[];
  snapshots: AcademicSnapshot[];
  assessments: Assessment[];
  completions: EventCompletion[];
  /** 과목 ID별 자유 메모 (과목당 최대 1개) */
  courseMemos: CourseMemo[];
  /** 시간표 배치용 수업 시간 (과목당 여러 개) */
  classTimes: ClassTime[];
  scenarios: GradeScenario[];
  /** 졸업시험·인증·공통요건을 학생이 '통과 확인'한 기록 */
  certConfirmations: { requirementId: string; confirmedAt: string }[];
  settings: { notifications: NotificationSettings; lastView: View };
  /** 동의 이력은 버전·시각만 */
  consent: { academicData?: { version: string; at: string }; notifications?: { version: string; at: string } };
}

export function emptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: null,
    courses: [],
    snapshots: [],
    assessments: [],
    completions: [],
    courseMemos: [],
    classTimes: [],
    scenarios: [],
    certConfirmations: [],
    settings: {
      notifications: { enabled: false, dayBefore: true, sameDay: true, time: '09:00', version: 1 },
      lastView: 'status',
    },
    consent: {},
  };
}

/** 학업정보만 지우기 (조건·설정은 유지). 알림 예약은 background가 상태를 보고 정리한다. */
export function withoutAcademicData(s: AppState): AppState {
  return { ...s, courses: [], snapshots: [], assessments: [], completions: [], courseMemos: [], classTimes: [], scenarios: [], certConfirmations: [] };
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const latestSnapshot = (s: AppState) => s.snapshots.at(-1) ?? null;
