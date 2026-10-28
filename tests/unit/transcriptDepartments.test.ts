import { describe, expect, it } from 'vitest';
import { catalog } from '../../src/data';
import { computeGpa, earnedUnits } from '../../src/domain/gpa/gpa';
import { applyMerge, planMerge } from '../../src/domain/merge/mergeImport';
import { parseTranscript, validateTranscript } from '../../src/domain/parser/parseTranscript';
import { emptyState } from '../../src/domain/state';
import { appStateSchema } from '../../src/domain/validation/schemas';
import { departmentTranscript } from '../fixtures/importTranscript';

describe('학과별 공통 성적 입력 형식', () => {
  it.each(catalog.departments)('$campus / $name: 탭·공백·CRLF 입력을 검증하고 저장 형식으로 병합한다', (department) => {
    const text = departmentTranscript(department.name);
    for (const input of [text, text.replaceAll('\t', ' '), text.replaceAll('\n', '\r\n')]) {
      const parsed = parseTranscript(input, catalog.policy.gradeAliases);
      expect(validateTranscript(parsed)).toEqual({ parts: { grades: true, summary: true }, problems: [], canSave: true });
      expect(parsed.rows).toHaveLength(10);
      expect(parsed.computedEarnedByArea).toEqual({ primary: 300, double: 200, second: 150, minor: 100, practicalLanguage: 200, liberalArts: 700, teaching: 200 });
      expect(parsed.computedTotalUnits).toBe(1850);
      expect(parsed.rows.filter((r) => r.officialCode).map((r) => r.offeringDepartment)).toEqual(Array(9).fill(department.name));
      expect(parsed.rows.at(-1)?.term).toEqual({ academicYear: 2025, semester: 'winter' });

      const state = emptyState();
      state.profile = {
        schemaVersion: 1, homeCampus: department.campus, primaryDepartmentId: department.id,
        cohortYear: 2024, entryType: 'freshman', programType: 'single', currentTerm: { academicYear: 2026, semester: '2' },
      };
      const saved = applyMerge(state, parsed, planMerge(state, parsed), { link: {}, conflictChoice: {}, removeMissing: false }, new Date('2026-10-29T00:00:00Z'));
      expect(appStateSchema.safeParse(saved).success).toBe(true);
      expect(saved.profile).toEqual(state.profile);
      expect(earnedUnits(saved.courses)).toBe(1850);
      expect(computeGpa(saved.courses)).toMatchObject({ complete: true, creditUnits: 1450, hundredths: 258 });
      expect(saved.courses.find((c) => c.officialCode === 'O10002')?.grade).toBe('B+');
      const again = applyMerge(saved, parsed, planMerge(saved, parsed), { link: {}, conflictChoice: {}, removeMissing: false }, new Date('2026-10-29T00:01:00Z'));
      expect(again.courses.map((c) => c.id)).toEqual(saved.courses.map((c) => c.id));
    }
  });
});
