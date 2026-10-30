import { describe, expect, it } from 'vitest';
import { catalog, departmentFacts } from '../../src/data';
import { departmentAssessmentGuides, describeAssessment } from '../../src/domain/requirements/assessment';
import type { StudentProfile } from '../../src/domain/types';

const exposed = /german2023Revision|listeningReading|languageTest|new scale|\[object Object\]/;
describe('졸업평가 안내 내부 문자열 한글화', () => {
  it.each([
    ['german2023Revision', '2023년 개정 평가 기준'],
    ['FLEX Japanese listeningReading', 'FLEX 일본어 듣기·읽기'],
    ['FLEX German listeningReading', 'FLEX 독일어 듣기·읽기'],
    ['FLEX French listeningReading', 'FLEX 프랑스어 듣기·읽기'],
    ['TOEFL iBT new scale', 'TOEFL iBT (개정 점수 체계)'],
  ])('%s를 학생용 표현으로 바꾼다', (input, expected) => {
    expect(describeAssessment(input)).toBe(expected);
    expect(describeAssessment({ type: 'languageTest', test: input, minimumScore: 600 })).toContain('600');
  });
  it.each([
    ['독일어과', 'primary', '2023년 개정 평가 기준'],
    ['융합일본지역학부', 'primary', '일본어'],
    ['융합일본지역학부', 'dual', '일본어'],
    ['독일어통번역학과', 'primary', '독일어'],
    ['독일어통번역학과', 'dual', '독일어'],
    ['프랑스학과', 'primary', '프랑스어'],
    ['ELLT학과', 'primary', '개정 점수 체계'],
  ])('%s %s의 실제 학과 안내에도 같은 변환을 사용한다', (name, role, expected) => {
    const d = catalog.departments.find(d => d.name === name)!;
    const partner = catalog.departments.find(x => x.id !== d.id && x.campus === d.campus
      && (x.id === 'seoul-business' || x.name === '통계학과'))!;
    const p: StudentProfile = { schemaVersion: 1, homeCampus: d.campus, cohortYear: 2025, entryType: 'freshman',
      primaryDepartmentId: role === 'primary' ? d.id : partner.id,
      secondaryDepartmentId: role === 'dual' ? d.id : partner.id, programType: 'double',
      currentTerm: { academicYear: 2026, semester: '2' },
      facts: { foreignLanguageSpecialAdmission: false, pureForeignAdmission: false } };
    const text = departmentAssessmentGuides(p, catalog.officialRules, departmentFacts)
      .filter(g => g.scope === (role === 'primary' ? 'primary' : 'secondary')).map(g => g.text).join(' ');
    expect(text).not.toMatch(exposed);
    expect(text).toContain(expected);
  });
});
