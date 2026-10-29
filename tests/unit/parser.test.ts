import { describe, expect, it } from 'vitest';
import { formatTranscriptDiagnostic, MAX_LINES, ParseLimitError, parseTranscript, validateTranscript } from '../../src/domain/parser/parseTranscript';
import { computeGpa } from '../../src/domain/gpa/gpa';
import { TRANSCRIPT_FIXTURE } from '../fixtures';
import type { Course } from '../../src/domain/types';
import { CAPTIONED_TRANSCRIPT, CONTROLS_TRANSCRIPT, FOOTER_TRANSCRIPT, INCOMPLETE_TRANSCRIPTS, TITLELESS_TRANSCRIPT, WRAPPED_TRANSCRIPT } from '../fixtures/importTranscript';

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
  it.each([' ', '\t'])('PASS와 부전 표기를 읽고 하단 합계·평점까지 대조한다 (%j)', (separator) => {
    const text = [
      '2024 - 1',
      ['가상학과', 'T1001', '합성전공', '1전공', '2', 'PASS'].join(separator),
      ['가상학과', 'T1002', '합성교양', '교양', '1', 'PASS'].join(separator),
      ['가상학과', 'T1003', '합성부전', '부전', '3', 'B+'].join(separator),
      '이수구분 1전공 교양 부전공 총계',
      '2 1 3 6',
    ].join('\n');
    const result = parseTranscript(text);
    expect(result.rows.map((r) => [r.rawGrade, r.grade, r.area])).toEqual([
      ['PASS', 'P', 'primary'], ['PASS', 'P', 'liberalArts'], ['B+', 'B+', 'minor'],
    ]);
    expect(result.rows.slice(0, 2).every((r) => r.gradingMode === 'passFail'
      && r.earnedInclusion === 'included' && r.gpaInclusion === 'excluded')).toBe(true);
    expect(result.computedEarnedByArea).toEqual({ primary: 200, liberalArts: 100, minor: 300 });
    expect(result.computedTotalUnits).toBe(600);
    expect(computeGpa(asCourses(result.rows))).toMatchObject({ creditUnits: 300, hundredths: 350 });
    expect(validateTranscript(result)).toMatchObject({ canSave: true, problems: [] });
  });
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
  it('객체 기본 속성 이름도 등급·영역으로 오인하지 않는다', () => {
    const result = parseTranscript('2022 - 1\n가상학과\tT1001\t합성\tconstructor\t3\ttoString');
    expect(result.rows[0]).toMatchObject({ grade: null, area: 'unknown' });
    expect(result.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['unknownGrade', 'unknownArea']));
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

describe('저장에 사용하는 공통 검증', () => {
  it.each([TITLELESS_TRANSCRIPT, WRAPPED_TRANSCRIPT, FOOTER_TRANSCRIPT])('제목 누락·합계 줄바꿈에도 실제 과목과 합계가 맞으면 저장 가능', (text) => {
    const result = parseTranscript(text);
    expect(result.rows).toHaveLength(6);
    expect(result.computedTotalUnits).toBe(2000);
    expect(result.reportedTotalEarnedUnits).toBe(2000);
    expect(validateTranscript(result)).toEqual({ parts: { grades: true, summary: true }, problems: [], canSave: true });
    expect(result.rows.filter((r) => r.recordKind === 'recognizedCredit')).toHaveLength(2);
    expect(result.rows.find((r) => r.officialCode === 'O90002')?.name).toContain('Example Subject (2)');
  });
  it.each(Object.entries(INCOMPLETE_TRANSCRIPTS))('%s는 경고하고 저장하지 않는다', (_name, text) => {
    const result = parseTranscript(text);
    expect(validateTranscript(result).canSave).toBe(false);
    expect(validateTranscript(result).problems.length).toBeGreaterThan(0);
    expect(result.completeness.gpa).toBe(false);
  });
  it.each([
    '이수구분 1전공 총계\n이수구분별 취득학점 계 3',
    '이수구분 1전공 총계\n이수구분별 취득학점 계 3 3 3',
    '이수구분 1전공 총계\n이수구분별 취득학점 계 -3 -3',
    '이수구분 1전공 총계\n이수구분별 취득학점 계 3.001 3.001',
    '이수구분 1전공 총계\n이수구분별 취득학점 계 10001 10001',
    '이수구분 1전공 1전공 총계\n이수구분별 취득학점 계 3 3 6',
    '이수구분 부전 부전공 총계\n이수구분별 취득학점 계 3 3 6',
    '이수구분 미상 총계\n이수구분별 취득학점 계 3 3',
    '이수구분 1전공 총계\n이수구분별 취득학점 계 3 4',
  ])('하단 표의 열·값·범위·자체 합계가 틀리면 불완전', (text) => {
    const result = parseTranscript(text);
    expect(result.completeness.earnedTotals).toBe(false);
    expect(validateTranscript(result).canSave).toBe(false);
  });
  it.each(['숫자 2026 3 4.5', '2026 - 1\n아무 문장 1전공 3\n이수구분 1전공 총계\n3 3'])('숫자와 영역만 있는 문장은 성적으로 통과시키지 않는다', (text) => {
    expect(validateTranscript(parseTranscript(text)).canSave).toBe(false);
  });
  it.each(['0', '151'])('과목 학점 범위를 검사한다: %s', (credit) => {
    const result = parseTranscript(`2026 - 1\n가상학과 T1001 합성과목 1전공 ${credit} A0\n이수구분 1전공 총계\n${credit} ${credit}`);
    expect(result.warnings.some((w) => w.code === 'invalidCredit')).toBe(true);
    expect(validateTranscript(result).canSave).toBe(false);
  });
});

describe('하단 안내문과 영역별 취득학점 표', () => {
  it.each([
    CAPTIONED_TRANSCRIPT,
    CAPTIONED_TRANSCRIPT.replace('영역별 취득학점\n', ''),
    TRANSCRIPT_FIXTURE.replace('개설학과 교과목코드', '영역별 취득학점\n개설학과 교과목코드'),
  ])('상단 표 제목과 하단 중복 제목 때문에 과목을 합계로 읽지 않는다', (text) => {
    const result = parseTranscript(text);
    expect(result.rows).toHaveLength(6);
    expect(result.reportedTotalEarnedUnits).toBe(2000);
    expect(validateTranscript(result)).toEqual({ parts: { grades: true, summary: true }, problems: [], canSave: true });
  });
  it.each([
    CAPTIONED_TRANSCRIPT.replace('5.0 3.0', '6.0 3.0'),
    CAPTIONED_TRANSCRIPT.replace('1전공 이중전공', '미상영역 이중전공'),
    CAPTIONED_TRANSCRIPT.slice(0, CAPTIONED_TRANSCRIPT.indexOf('이수구분별 취득학점 계')),
  ])('제목을 구분해도 잘못되거나 누락된 합계는 차단한다', (text) => {
    expect(validateTranscript(parseTranscript(text)).canSave).toBe(false);
  });
  it.each(['총계', '합계', '계', '총 학점', '총 취득학점'])('확인 가능한 총계 열 표기를 대응한다: %s', (totalLabel) => {
    const result = parseTranscript(FOOTER_TRANSCRIPT.replace('\t합계', `\t${totalLabel}`));
    expect(validateTranscript(result).canSave).toBe(true);
    expect(result.rows).toHaveLength(6);
    expect(result.computedTotalUnits).toBe(2000);
    expect(result.warnings).toEqual([]);
  });
  it('제목·행 제목·열 이름·값이 여러 줄에 나뉜 표도 같은 결과', () => {
    const result = parseTranscript(FOOTER_TRANSCRIPT.replace('영역별 취득학점', '영역별\n취득학점').replaceAll('\t', '\n'));
    expect(validateTranscript(result).canSave).toBe(true);
    expect(result.reportedTotalEarnedUnits).toBe(2000);
  });
  it('영역과 학점이 한 쌍씩 반복되는 표도 대응한다', () => {
    const text = FOOTER_TRANSCRIPT.slice(0, FOOTER_TRANSCRIPT.indexOf('영역별 취득학점'))
      + '영역별 취득학점\n1전공\t5\n이중전공\t3\n교양\t8\n자선\t4\n합계\t20';
    const result = parseTranscript(text);
    expect(validateTranscript(result).canSave).toBe(true);
    expect(result.reportedEarnedByArea).toEqual({ primary: 500, double: 300, liberalArts: 800, freeChoice: 400 });
  });
  it('안내문에 합계 관련 단어가 있어도 그곳에서 과목 목록을 자르지 않는다', () => {
    const text = TITLELESS_TRANSCRIPT.replace('2021 - 1', '※ 이수구분별 합계 정보는 화면 하단에서 확인 가능합니다.\n2021 - 1');
    expect(validateTranscript(parseTranscript(text)).canSave).toBe(true);
  });
  it.each([
    FOOTER_TRANSCRIPT.replace('취득학점\t5.0', '취득학점\t6.0'),
    FOOTER_TRANSCRIPT.replace('\t기초', '\t미상영역'),
    FOOTER_TRANSCRIPT.replace('취득학점\t5.0\t3.0', '취득학점\t5.0'),
    FOOTER_TRANSCRIPT + '\n해석할 수 없는 합성 행',
    FOOTER_TRANSCRIPT.replace('※ 이수구분별 합계 정보는 화면 하단에서 확인 가능합니다.', '※ 해석할 수 없는 합성 안내문'),
  ])('안내문·표 형식을 지원해도 미상 값·누락·합계 불일치는 차단한다', (text) => {
    expect(validateTranscript(parseTranscript(text)).canSave).toBe(false);
  });
});

describe('전체 영역 복사와 오류 진단', () => {
  it.each(['이수영역 선택\t\t년도/학기 선택\t', '이수영역 선택 년도/학기 선택'])('실제 화면에서 한 줄로 복사되는 검색조건도 제외한다: %s', (line) => {
    const result = parseTranscript(`검색조건\n년도/학기 선택\n${line}\n${FOOTER_TRANSCRIPT}`);
    expect(result).toEqual(parseTranscript(FOOTER_TRANSCRIPT));
    expect(validateTranscript(result).canSave).toBe(true);
  });
  it.each([CONTROLS_TRANSCRIPT, CONTROLS_TRANSCRIPT.replaceAll(' ', '\t').replaceAll('\n', '\r\n')])('확인된 메뉴 문구만 제외하고 성적과 합계를 검증한다', (text) => {
    const result = parseTranscript(text);
    expect(result.rows).toHaveLength(6);
    expect(result.computedTotalUnits).toBe(2000);
    expect(validateTranscript(result)).toEqual({ parts: { grades: true, summary: true }, problems: [], canSave: true });
  });
  it.each(['검색조건 추가 내용', '년도/학기 선택 2026', '+ 전체보기(View all) 누락 과목', '이수영역 선택 년도/학기 선택 누락 과목'])('메뉴 문구와 비슷한 미상 행은 계속 차단한다: %s', (line) => {
    const result = parseTranscript(`${line}\n${CONTROLS_TRANSCRIPT}`);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'unparsedLine', lineNumber: 1 }));
    expect(validateTranscript(result).canSave).toBe(false);
  });
  it('제외한 안내문과 메뉴도 세어 원래 입력의 문제 줄 번호를 진단문에 표시한다', () => {
    const input = `※ 이수구분별 합계 정보는 화면 하단에서 확인 가능합니다.\r\n검색조건\r\n해석 불가 합성 행\r\n${CONTROLS_TRANSCRIPT}`;
    const result = parseTranscript(input);
    const report = formatTranscriptDiagnostic(input, result, validateTranscript(result).problems);
    expect(report).toContain('[unparsedLine] 3번째 줄 해석하지 못한 줄이 있어요: “해석 불가 합성 행”');
    expect(report).toContain('검증: 저장 차단');
    expect(report).toContain('총 취득학점: 과목 합 20 / 하단 총계 20');
    expect(report).toContain('분석: 6행 (인정학점 2행)');
    expect(report).not.toContain('T90001');
    expect(report).not.toContain('개설학과 교과목코드');
  });
  it('분석 결과가 없어도 실행 오류를 진단하며 입력 원문은 넣지 않는다', () => {
    const report = formatTranscriptDiagnostic('이름: 합성학생\n학번: 202612345', null, ['분석 Worker를 시작하지 못했어요.']);
    expect(report).toContain('분석: 결과 없음');
    expect(report).toContain('분석 Worker를 시작하지 못했어요.');
    expect(report).not.toContain('합성학생');
    expect(report).not.toContain('202612345');
  });
});
