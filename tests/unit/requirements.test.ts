import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../../src/domain/parser/parseTranscript';
import { applyMerge, planMerge } from '../../src/domain/merge/mergeImport';
import { evaluateProgress, resolveRequirements } from '../../src/domain/requirements/resolve';
import { latestSnapshot } from '../../src/domain/state';
import { catalog } from '../../src/data';
import { course, PROFILE, stateWith, TEST_BUNDLES, TRANSCRIPT_FIXTURE } from '../fixtures';
import type { RequirementBundle } from '../../src/domain/types';

const importText = (text: string) => {
  const s = stateWith();
  const p = parseTranscript(text);
  return applyMerge(s, p, planMerge(s, p), { link: {}, conflictChoice: {}, removeMissing: false }, new Date('2026-10-23T00:00:00'));
};

describe('규칙 선택', () => {
  it('§11.2: 총 10 부족, 주전공 3·이중 3 부족, 교양 충족 (영역 부족 합 ≠ 총 부족)', () => {
    const s = importText(TRANSCRIPT_FIXTURE);
    const resolved = resolveRequirements(PROFILE, TEST_BUNDLES, ['verified'])!;
    const p = evaluateProgress(resolved, s.courses, latestSnapshot(s));
    expect(p.total).toMatchObject({ earned: 2000, required: 3000, remaining: 1000, status: 'unmet' });
    const area = Object.fromEntries(p.areas.map((a) => [a.area, a]));
    expect(area.primary.shortfall).toBe(300);
    expect(area.double.shortfall).toBe(300);
    expect(area.liberalArts.status).toBe('met');
    expect(area.primary.shortfall! + area.double.shortfall!).not.toBe(p.total.remaining);
  });
  it('총학점 충족이어도 전공 부족은 따로 남는다 (교양 초과로 상쇄하지 않음)', () => {
    const resolved = resolveRequirements(PROFILE, TEST_BUNDLES, ['verified'])!;
    const p = evaluateProgress(resolved, [course({ area: 'liberalArts', grade: 'A0', credits: 30 })], null);
    expect(p.total.status).toBe('met');
    expect(p.areas.find((a) => a.area === 'primary')!.status).toBe('unmet');
  });
  it('주전공·이중전공 총학점을 더하지 않고, 다른 값은 충돌로 남긴다', () => {
    const conflicting: RequirementBundle = { ...TEST_BUNDLES[2], id: 'x', totalRequiredUnits: 4000 };
    const r = resolveRequirements(PROFILE, [...TEST_BUNDLES, conflicting], ['verified'])!;
    expect(r.totalRequiredUnits).toBeNull();
    expect(r.conflicts).toContain('졸업 총학점');
  });
  it('캠퍼스·학번·입학유형이 맞지 않으면 null (필요학점을 0으로 넣지 않음)', () => {
    expect(resolveRequirements({ ...PROFILE, homeCampus: 'global' }, TEST_BUNDLES, ['verified'])).toBeNull();
    expect(resolveRequirements({ ...PROFILE, cohortYear: 2018 }, TEST_BUNDLES, ['verified'])).toBeNull();
    expect(resolveRequirements({ ...PROFILE, entryType: 'transferBachelor' }, TEST_BUNDLES, ['verified'])).toBeNull();
    const p = evaluateProgress(null, [course({ grade: 'A0' })], null);
    expect(p.total).toMatchObject({ earned: 300, required: null, remaining: null });
  });
  it('demo와 verified를 섞지 않는다', () => {
    const demo = TEST_BUNDLES.map((b) => ({ ...b, status: 'demo' as const }));
    expect(resolveRequirements(PROFILE, demo, ['verified'])).toBeNull();
    expect(resolveRequirements(PROFILE, demo, ['demo'])!.verification).toBe('demo');
  });
  it('두 번째 전공 규칙이 없으면 범위 누락을 알린다', () => {
    const r = resolveRequirements(PROFILE, TEST_BUNDLES.slice(0, 2), ['verified'])!;
    expect(r.missingScopes).toEqual(['secondary']);
  });
  it('배포 데이터: 공식 묶음은 데모 기준을 쓰지 않고, 데모 묶음은 데모 모드에서만 맞는다', () => {
    expect(catalog.bundles.length).toBeGreaterThan(0);
    expect(catalog.rejected).toEqual([]);
    const demoProfile = { ...PROFILE, cohortYear: 2020, primaryDepartmentId: 'seoul-malay-indonesian', secondaryDepartmentId: 'seoul-business' };
    // 공식 묶음은 학교 공통 평점 규칙 등 일부만 맞고, 데모의 가상 총학점 30학점을 만들지 않는다
    const real = resolveRequirements(demoProfile, catalog.bundles, ['verified']);
    expect(real?.verification).toBe('verified');
    expect(real?.totalRequiredUnits ?? null).not.toBe(3000);
    expect(real?.sourceIds ?? []).not.toContain('src-demo');
    expect(resolveRequirements(demoProfile, catalog.demoBundles, ['demo'])!.totalRequiredUnits).toBe(3000);
  });
});

describe('필수과목 매칭', () => {
  const resolved = resolveRequirements(PROFILE, TEST_BUNDLES, ['verified'])!;
  const group = (p: ReturnType<typeof evaluateProgress>, id: string) => p.groups.find((x) => x.group.id === id)!;

  it('대체 과목을 둘 다 들어도 한 묶음에서 하나만 쓰고, 다른 묶음에 재사용하지 않는다', () => {
    const p = evaluateProgress(resolved, [course({ officialCode: 'X1', grade: 'A0' }), course({ officialCode: 'X2', grade: 'B0' })], null);
    expect(group(p, 'g-alt').matchedCount).toBe(1);
    expect(group(p, 'g-alt2').matchedCount).toBe(1);
    expect(group(p, 'g-alt').matchedCourseIds[0]).not.toBe(group(p, 'g-alt2').matchedCourseIds[0]);
  });
  it('하나뿐이면 두 번째 묶음은 미충족 (중복 사용 금지)', () => {
    const p = evaluateProgress(resolved, [course({ officialCode: 'X1', grade: 'A0' })], null);
    expect(group(p, 'g-alt2').status).toBe('unmet');
  });
  it('이름만 같으면 공식 매칭하지 않는다', () => {
    const p = evaluateProgress(resolved, [course({ name: '가상 필수 A', grade: 'A0' })], null);
    expect(group(p, 'g-a').status).toBe('unmet');
  });
  it('학생의 필수 체크는 학점을 더 만들지 않는다', () => {
    const c = course({ grade: 'A0', requiredClaim: 'studentMarked' });
    const p = evaluateProgress(resolved, [c], null);
    expect(p.total.earned).toBe(300);
    expect(p.studentMarkedCourseIds).toEqual([c.id]);
  });
  it('F 과목은 필수 충족으로 쓰지 않는다', () => {
    const p = evaluateProgress(resolved, [course({ officialCode: 'T90001', grade: 'F' })], null);
    expect(group(p, 'g-a').status).toBe('unmet');
  });
  it('과목 목록이 불완전하면 하단 합계 기준, 필수과목은 판단 자료 부족', () => {
    const s = importText(TRANSCRIPT_FIXTURE.replace('가상학과 T90004 예시교양과목 교양 2 D0\n', ''));
    const p = evaluateProgress(resolved, s.courses, latestSnapshot(s));
    expect(p.basis).toBe('reportedTotals');
    expect(p.total.earned).toBe(2000);
    expect(group(p, 'g-alt').status).toBe('insufficient');
  });
  it('기록이 전혀 없으면 0학점으로 단정하지 않는다', () => {
    const p = evaluateProgress(resolved, [], null);
    expect(p.hasRecords).toBe(false);
    expect(p.basis).toBe('none');
  });
  it('예정·수강 중 과목은 취득학점에 더하지 않는다', () => {
    const p = evaluateProgress(resolved, [course({ status: 'inProgress' }), course({ status: 'planned' })], null);
    expect(p.total.earned).toBe(0);
  });
});
