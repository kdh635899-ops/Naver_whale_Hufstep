import { describe, expect, it } from 'vitest';
import { catalog, departmentFacts, departmentMetaById } from '../../src/data';
import { buildOfficialReport } from '../../src/domain/requirements/officialRules';
import { evaluateProgress } from '../../src/domain/requirements/resolve';
import type { StudentProfile } from '../../src/domain/types';

describe('편입생 졸업 학점', () => {
  it('23학번 서울 말레이·인도네시아어과 학사편입의 109학점 취득 후 남은 학점을 계산한다', () => {
    const profile: StudentProfile = {
      schemaVersion: 1, homeCampus: 'seoul', cohortYear: 2023, entryType: 'transferBachelor',
      primaryDepartmentId: 'seoul-malay-indonesian', programType: 'single',
      currentTerm: { academicYear: 2026, semester: '2' },
    };
    const report = buildOfficialReport({ profile, bundles: catalog.bundles, rules: catalog.officialRules,
      supportGaps: catalog.supportGaps, dept: departmentFacts, meta: departmentMetaById });
    expect(report.resolved?.totalRequiredUnits).toBe(13400);
    const progress = evaluateProgress(report.resolved, [], {
      id: 'transfer-summary', importedAt: '2026-10-29T00:00:00Z', source: 'summaryInput', courseIds: [],
      reportedEarnedByArea: { primary: 3900, liberalArts: 3400, freeChoice: 3600 }, reportedTotalEarnedUnits: 10900,
      completeness: { earnedTotals: true, courses: false, gpa: false }, warnings: [],
    });
    expect(progress.total.remaining).toBe(2500);
  });
});
