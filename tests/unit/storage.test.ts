import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyState, SCHEMA_VERSION, withoutAcademicData } from '../../src/domain/state';
import { buildDemoState } from '../../src/data/demo';
import {
  clearEverything, KEYS, kvGet, kvPut, loadState, migrate, MIGRATIONS, saveState, StateLoadError,
} from '../../src/storage/repository';
import { assessmentSchema, classTimeSchema, courseMemoSchema, courseSchema, profileSchema } from '../../src/domain/validation/schemas';
import { course, PROFILE } from '../fixtures';

beforeEach(async () => { await clearEverything(); });

describe('IndexedDB 저장소', () => {
  it('저장 후 다시 열면 복원된다', async () => {
    const s = buildDemoState(new Date(2026, 10, 5));
    await saveState(s);
    expect(await loadState()).toEqual(s);
  });
  it('처음이면 null', async () => {
    expect(await loadState()).toBeNull();
  });
  it('검사에 실패한 상태는 저장하지 않고 기존 정상 데이터를 유지', async () => {
    const good = { ...emptyState(), profile: PROFILE };
    await saveState(good);
    const bad = { ...good, courses: [{ ...course(), creditUnits: -5 }] };
    await expect(saveState(bad)).rejects.toThrow();
    expect(await loadState()).toEqual(good);
  });
  it('손상된 저장값은 예외로 알리고 지우지 않는다', async () => {
    await kvPut({ [KEYS.state]: { schemaVersion: 1, courses: 'oops' } });
    await expect(loadState()).rejects.toBeInstanceOf(StateLoadError);
    expect(await kvGet(KEYS.state)).toEqual({ schemaVersion: 1, courses: 'oops' });
  });
  it('미래 버전 데이터는 거절', () => {
    expect(() => migrate({ ...emptyState(), schemaVersion: 99 })).toThrow(StateLoadError);
  });
  it('migration 단계가 원본을 바꾸지 않고 순서대로 적용된다', () => {
    const v = SCHEMA_VERSION;
    MIGRATIONS[v] = (raw) => ({ ...raw, courses: [] }); // 가상의 다음 버전 단계
    try {
      const raw = { ...emptyState(), courses: [course()] };
      const migrated = migrate(raw, v + 1);
      expect(migrated.schemaVersion).toBe(v + 1);
      expect(migrated.courses).toEqual([]);
      expect(raw.schemaVersion).toBe(v);
      expect(raw.courses).toHaveLength(1);
    } finally {
      delete MIGRATIONS[v];
    }
  });
  it('v1 저장값(메모·수업 시간 없음)은 v2로 올리며 성적·평가·설정을 그대로 둔다', async () => {
    const v2 = buildDemoState(new Date(2026, 10, 5));
    const { courseMemos: _m, classTimes: _t, ...rest } = v2;
    const v1 = { ...rest, schemaVersion: 1 };
    await kvPut({ [KEYS.state]: v1 });
    const loaded = (await loadState())!;
    expect(loaded).toEqual({ ...v2, courseMemos: [], classTimes: [] });
    expect((await kvGet<{ schemaVersion: number }>(KEYS.state))!.schemaVersion).toBe(1); // 읽기만으로 원본을 덮어쓰지 않음
  });
  it('옛 일본언어문화학부 ID(글로벌)로 저장된 연결을 서울 ID로 보정하고 다른 값은 유지', async () => {
    const OLD = 'global-japanese-language-culture';
    const NEW = 'seoul-japanese-language-culture';
    const c = course({ recognizedDepartmentId: OLD });
    const other = course();
    const asPrimary = {
      ...emptyState(), courses: [c, other],
      profile: { ...PROFILE, homeCampus: 'global' as const, primaryDepartmentId: OLD, secondaryDepartmentId: 'seoul-business' },
    };
    await kvPut({ [KEYS.state]: asPrimary });
    const loaded = (await loadState())!;
    expect(loaded.profile).toEqual({ ...asPrimary.profile, homeCampus: 'seoul', primaryDepartmentId: NEW });
    expect(loaded.courses).toEqual([{ ...c, recognizedDepartmentId: NEW }, other]);
    expect((await kvGet<typeof asPrimary>(KEYS.state))!.profile.primaryDepartmentId).toBe(OLD); // 저장 원본은 그대로

    // 두 번째 전공으로만 연결된 경우 학생의 캠퍼스는 바꾸지 않는다
    const asSecondary = { ...emptyState(), profile: { ...PROFILE, homeCampus: 'global' as const, secondaryDepartmentId: OLD } };
    expect(migrate(asSecondary).profile).toEqual({ ...asSecondary.profile, secondaryDepartmentId: NEW });
    // 다른 학과 프로필은 그대로
    expect(migrate({ ...emptyState(), profile: PROFILE }).profile).toEqual(PROFILE);
  });
  it('전체 초기화 후 성적·평가·시나리오·발송 이력이 남지 않는다', async () => {
    await saveState(buildDemoState(new Date(2026, 10, 5)));
    await kvPut({ [KEYS.notifLog]: { sent: ['x'] }, [KEYS.route]: { view: 'today', date: '2026-11-05' } });
    await clearEverything();
    expect(await loadState()).toBeNull();
    expect(await kvGet(KEYS.notifLog)).toBeUndefined();
    expect(await kvGet(KEYS.route)).toBeUndefined();
  });
  it('학업정보 삭제는 조건·설정만 남긴다', () => {
    const s = withoutAcademicData(buildDemoState(new Date(2026, 10, 5)));
    expect(s.courses).toEqual([]);
    expect(s.assessments).toEqual([]);
    expect(s.snapshots).toEqual([]);
    expect(s.courseMemos).toEqual([]);
    expect(s.classTimes).toEqual([]);
    expect(s.profile).not.toBeNull();
  });
  it('메모·수업 시간은 저장 후 다시 열어도(앱 재실행) 남는다', async () => {
    const s = { ...emptyState(), profile: PROFILE, courses: [course({ id: 'm1', status: 'inProgress' })],
      courseMemos: [{ courseId: 'm1', text: '준비물: 사전\n11/20 퀴즈', updatedAt: '2026-10-25T00:00:00.000Z' }],
      classTimes: [{ courseId: 'm1', day: 0 as const, start: '09:00', end: '10:15' }, { courseId: 'm1', day: 2 as const, start: '09:00', end: '10:15' }] };
    await saveState(s);
    expect(await loadState()).toEqual(s);
  });
});

describe('입력 검증', () => {
  it('학점·과목명·enum·날짜·메모 길이를 검사', () => {
    expect(courseSchema.safeParse({ ...course(), creditUnits: -1 }).success).toBe(false);
    expect(courseSchema.safeParse({ ...course(), creditUnits: 0 }).success).toBe(true); // 시간표에서 이름·시간만 넣어 만든 과목
    expect(courseSchema.safeParse({ ...course(), name: 'x'.repeat(121) }).success).toBe(false);
    expect(courseSchema.safeParse({ ...course(), area: 'hacker' }).success).toBe(false);
    expect(courseSchema.safeParse({ ...course(), creditUnits: 250 }).success).toBe(true); // 소수 학점 2.5
    const a = { id: 'a', courseId: 'c', phase: 'midterm', mode: 'exam', notes: '', origin: 'student', updatedAt: '' };
    expect(assessmentSchema.safeParse({ ...a, examDate: '2026-02-30' }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...a, examStartTime: '25:00' }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...a, notes: 'x'.repeat(301) }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...a, examDate: '2026-11-05', examStartTime: '10:00', examEndTime: '09:00' }).success).toBe(false);
  });
  it('학번은 2019~2026, 두 번째 전공은 주전공과 달라야 함', () => {
    expect(profileSchema.safeParse({ ...PROFILE, cohortYear: 2018 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...PROFILE, cohortYear: 2027 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...PROFILE, secondaryDepartmentId: PROFILE.primaryDepartmentId }).success).toBe(false);
    expect(profileSchema.safeParse({ ...PROFILE, programType: 'single', secondaryDepartmentId: undefined }).success).toBe(true);
  });
  it('수업 시간: 월~금·HH:mm·시작<종료, 메모 1000자', () => {
    const t = { courseId: 'c', day: 0, start: '09:00', end: '10:15' };
    expect(classTimeSchema.safeParse(t).success).toBe(true);
    expect(classTimeSchema.safeParse({ ...t, day: 5 }).success).toBe(false); // 토요일 없음
    expect(classTimeSchema.safeParse({ ...t, end: '09:00' }).success).toBe(false);
    expect(classTimeSchema.safeParse({ ...t, start: '9:00' }).success).toBe(false);
    const m = { courseId: 'c', text: 'x'.repeat(1000), updatedAt: '' };
    expect(courseMemoSchema.safeParse(m).success).toBe(true);
    expect(courseMemoSchema.safeParse({ ...m, text: 'x'.repeat(1001) }).success).toBe(false);
  });
});
