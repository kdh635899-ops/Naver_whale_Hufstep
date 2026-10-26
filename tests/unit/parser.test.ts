import { describe, expect, it } from 'vitest';
import { MAX_LINES, ParseLimitError, parseTranscript } from '../../src/domain/parser/parseTranscript';
import { computeGpa } from '../../src/domain/gpa/gpa';
import { TRANSCRIPT_FIXTURE } from '../fixtures';
import type { Course } from '../../src/domain/types';

const asCourses = (rows: ReturnType<typeof parseTranscript>['rows']) => rows.map((r) => ({ ...r, id: r.rowKey }) as unknown as Course);

describe('§11.1 합성 fixture', () => {
  const r = parseTranscript(TRANSCRIPT_FIXTURE, { A: 'A0' });

  it('일반 성적 과목 4 / 인정 내역 2', () => {
    expect(r.rows.filter((x) => x.recordKind === 'course')).toHaveLength(4);
    expect(r.rows.filter((x) => x.recordKind === 'recognizedCredit')).toHaveLength(2);
  });
  it('영역별 5 / 3 / 8 / 4학점, 총 20학점 (하단 합계·재수강 누적을 중복 가산하지 않음)', () => {
    expect(r.computedEarnedByArea).toEqual({ liberalArts: 800, freeChoice: 400, primary: 500, double: 300 });
    expect(r.computedTotalUnits).toBe(2000);
    expect(r.reportedTotalEarnedUnits).toBe(2000);
    expect(r.reportedEarnedByArea.primary).toBe(500);
    expect(r.lookupTotalUnits).toBe(2000);
  });
  it('GPA 대상 10학점, Q 270000, 표시 2.70', () => {
    const g = computeGpa(asCourses(r.rows));
    expect(g.creditUnits).toBe(1000);
    expect(g.points).toBe(270000);
    expect(g.hundredths).toBe(270);
  });
  it('과목명 괄호·영문 병기와 코드의 O를 보존', () => {
    const s2 = r.rows.find((x) => x.officialCode === 'O90002')!;
    expect(s2.name).toBe('예시과목(2) (Example Subject (2))');
    expect(s2.creditUnits).toBe(200); // 이름 속 (2)를 학점으로 오인하지 않음
    expect(r.rows.find((x) => x.officialCode === '090002')).toBeUndefined();
  });
  it('합계가 맞으면 경고 없이 완전', () => {
    expect(r.completeness).toEqual({ earnedTotals: true, courses: true, gpa: true });
    expect(r.warnings).toEqual([]);
  });
});

describe('입력 형식 변형', () => {
  it('탭·CRLF·NBSP를 정규화하고 같은 결과', () => {
    const tabbed = TRANSCRIPT_FIXTURE
      .replace('가상학과 T90001 예시과목(1) (Example Subject (1)) 1전공 3 A0', '가상학과\tT90001\t예시과목(1) (Example Subject (1))\t1전공\t3\tA0\t\t\t')
      .replace('예시교양과목 교양', '예시교양과목 교양')
      .replace(/\n/g, '\r\n');
    const r = parseTranscript(tabbed);
    expect(r.rows).toHaveLength(6);
    expect(r.rows.find((x) => x.officialCode === 'T90001')!.name).toBe('예시과목(1) (Example Subject (1))');
    expect(r.computedTotalUnits).toBe(2000);
  });
  it('교과목코드 앞의 개설학과 칸을 저장한다 (코드 없는 전필 이름 대조용)', () => {
    const r = parseTranscript(TRANSCRIPT_FIXTURE);
    expect(r.rows.find((x) => x.officialCode === 'T90001')!.offeringDepartment).toBe('가상학과');
    // 코드가 없는 인정학점 행에는 개설학과 칸도 없다
    expect(r.rows.find((x) => !x.officialCode)!.offeringDepartment).toBeUndefined();
    // 탭으로 나뉜 셀 구조에서도 같다
    const tabbed = parseTranscript('2021 - 1\n가상학과\tT90001\t예시과목\t1전공\t3\tA0');
    expect(tabbed.rows[0].offeringDepartment).toBe('가상학과');
  });
  it('줄바꿈된 긴 과목명을 앞 줄과 합친다', () => {
    const r = parseTranscript('2022 - 1\n가상학과 T90009 아주 긴 예시 과목명\n(Very Long Example) 1전공 3 B0');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].officialCode).toBe('T90009');
    expect(r.rows[0].name).toBe('아주 긴 예시 과목명\n(Very Long Example)');
  });
  it('계절학기를 1/2학기로 바꾸지 않는다', () => {
    const r = parseTranscript('2022 - 여름\n가상학과 T90010 계절과목 교양 2 A+');
    expect(r.rows[0].term).toEqual({ academicYear: 2022, semester: 'summer' });
  });
  it('2전공과 이중전공을 합치지 않는다', () => {
    const r = parseTranscript('2022 - 1\n가상학과 T1001 가 2전공 3 A0\n가상학과 T1002 나 이중전공 3 A0');
    expect(r.rows.map((x) => x.area)).toEqual(['second', 'double']);
  });
});

describe('경고·판단 보류', () => {
  it('알 수 없는 등급은 F가 아니라 보류', () => {
    const r = parseTranscript('2022 - 1\n가상학과 T1001 가상 1전공 3 B');
    expect(r.rows[0].grade).toBeNull();
    expect(r.rows[0].gpaInclusion).toBe('unresolved');
    expect(r.warnings.map((w) => w.code)).toContain('unknownGrade');
    expect(r.completeness.gpa).toBe(false);
  });
  it('알 수 없는 영역 경고', () => {
    const r = parseTranscript('2022 - 1\n가상학과 T1001 가상 특수영역 3 A0');
    expect(r.rows[0].area).toBe('unknown');
    expect(r.warnings.map((w) => w.code)).toContain('unknownArea');
  });
  it('일반 F: GPA 포함·취득 제외 / P: GPA 제외·취득 포함 / NP: 둘 다 제외', () => {
    const r = parseTranscript('2022 - 1\n가상학과 T1001 가 1전공 3 F\n가상학과 T1002 나 교양 1 P\n가상학과 T1003 다 교양 1 NP');
    expect(r.rows.map((x) => [x.gpaInclusion, x.earnedInclusion])).toEqual([
      ['included', 'excluded'], ['excluded', 'included'], ['excluded', 'excluded'],
    ]);
  });
  it('중복 행과 재수강 표시를 경고하고 무조건 합치지 않는다', () => {
    const r = parseTranscript('2022 - 1\n가상학과 T1001 가 1전공 3 A0 재수강\n가상학과 T1001 가 1전공 3 A0');
    expect(r.rows).toHaveLength(2);
    expect(new Set(r.rows.map((x) => x.rowKey)).size).toBe(2);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['duplicate', 'retakeUnresolved']));
  });
  it('부분 복사: 하단 합계와 과목 합이 다르면 경고하고 차이를 채우지 않는다', () => {
    const partial = TRANSCRIPT_FIXTURE.replace('가상학과 T90004 예시교양과목 교양 2 D0\n', '');
    const r = parseTranscript(partial);
    expect(r.computedTotalUnits).toBe(1800);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['areaMismatch', 'totalMismatch']));
    expect(r.completeness.courses).toBe(false);
    expect(r.completeness.earnedTotals).toBe(true);
  });
  it('하단 합계만 붙여넣으면 영역 합계만 사용 가능', () => {
    const r = parseTranscript(TRANSCRIPT_FIXTURE.split('조회합계 20.0 학점\n')[1]);
    expect(r.rows).toHaveLength(0);
    expect(r.completeness).toEqual({ earnedTotals: true, courses: false, gpa: false });
    expect(r.warnings.map((w) => w.code)).toContain('summaryOnly');
  });
  it('해석 못 한 줄은 조용히 버리지 않고 경고', () => {
    const r = parseTranscript('2022 - 1\n이상한 문장입니다\n가상학과 T1001 가 1전공 3 A0');
    expect(r.warnings.map((w) => w.code)).toContain('unparsedLine');
  });
  it('악성 HTML 문자열도 텍스트 데이터로만 남는다', () => {
    const r = parseTranscript('2022 - 1\n가상학과 T1001 <img src=x onerror=alert(1)> 1전공 3 A0');
    expect(r.rows[0].name).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('입력 크기 제한', () => {
  it('줄 수 초과는 자르지 않고 오류', () => {
    expect(() => parseTranscript('a\n'.repeat(MAX_LINES + 1))).toThrow(ParseLimitError);
  });
  it('1MiB 초과는 오류', () => {
    expect(() => parseTranscript('가'.repeat(400_000))).toThrow(ParseLimitError);
  });
});
