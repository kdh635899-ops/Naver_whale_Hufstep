// 실제 학생 자료와 무관한 기존 합성 성적을 복사 형식별로 변형한다.
import { DEMO_TRANSCRIPT } from '../../src/data/demo';

export const TITLELESS_TRANSCRIPT = DEMO_TRANSCRIPT.replace('년도/학기별 취득성적\n', '');
export const WRAPPED_TRANSCRIPT = TITLELESS_TRANSCRIPT.replaceAll('이수구분별 취득학점 계', '이수구분별\n취득학점\n계')
  .replace('이수구분 1전공 이중전공 2전공 부전공 실용외국어 교양 교직 자선 기초 총 계',
    '이수구분\n1전공\n이중전공\n2전공\n부전공\n실용외국어\n교양\n교직\n자선\n기초\n총\n계')
  .replace('5.0 3.0 0.0 0.0 0.0 8.0 0.0 4.0 0.0 20.0', '5.0\n3.0\t0.0  0.0\n0.0\t8.0\n0.0 4.0\n0.0\n20.0');
// 스크린샷에서 확인한 안내문·제목만 사용하며, 과목과 숫자는 기존 합성 자료다.
export const FOOTER_TRANSCRIPT = TITLELESS_TRANSCRIPT.slice(0, TITLELESS_TRANSCRIPT.indexOf('이수구분별 취득학점 계'))
  + `※ 이수구분별 합계 정보는 화면 하단에서 확인 가능합니다.
영역별 취득학점
이수구분\t1전공\t이중전공\t2전공\t부전공\t실용외국어\t교양\t교직\t자선\t기초\t합계
취득학점\t5.0\t3.0\t0.0\t0.0\t0.0\t8.0\t0.0\t4.0\t0.0\t20.0`;
// 종정시의 상단 표 제목과 하단 중복 제목을 기존 가상 성적에 붙인다.
export const CAPTIONED_TRANSCRIPT = DEMO_TRANSCRIPT
  .replace('개설학과 교과목코드', '영역별 취득학점\n개설학과 교과목코드')
  .replace('이수구분별 취득학점 계\n', '이수구분별 취득학점 계\n이수구분별 취득학점\n')
  .replace('이수구분별 취득학점 계 5.0', '이수구분별\n취득학점 계\t5.0');
export const CONTROLS_TRANSCRIPT = `검색조건
년도/학기 선택
이수영역 선택
+ 전체보기(View all)
${CAPTIONED_TRANSCRIPT}`.replace('이수구분별 취득학점 계\n', '년도/학기 선택\n+ 전체보기(View all)\n이수구분별 취득학점 계\n');
export const INCOMPLETE_TRANSCRIPTS = {
  missingCourse: DEMO_TRANSCRIPT.replace('가상학과 T90004 예시교양과목 교양 2 D0\n', ''),
  unknownGrade: DEMO_TRANSCRIPT.replace('3 A0', '3 XYZ'),
  missingGrade: DEMO_TRANSCRIPT.replace('3 A0', '3'),
  unknownArea: DEMO_TRANSCRIPT.replace('1전공 3 A0', '알수없는영역 3 A0'),
  unparsedLine: DEMO_TRANSCRIPT.replace('2021 - 1', '해석할 수 없는 합성 행\n2021 - 1'),
  summaryOnly: DEMO_TRANSCRIPT.split('조회합계 20.0 학점\n')[1],
  noTerm: DEMO_TRANSCRIPT.replaceAll(/20\d{2} - [12]\n/g, ''),
  missingSummary: DEMO_TRANSCRIPT.slice(0, DEMO_TRANSCRIPT.indexOf('이수구분별 취득학점 계')),
};

/** 학과 이름만 실제 카탈로그에서 받고, 과목·코드·학점은 모두 합성한다. */
export function departmentTranscript(departmentName: string) {
  return `검색조건
년도/학기 선택
이수영역 선택
+ 전체보기(View all)
개설학과\t교과목코드\t교과목명\t이수구분\t학점\t등급\t재수강\t비고\t인정학과
2024 - 1
교양인정학점(1) (Liberal Arts Credits (transferred))\t교양\t5
2025 - 1
${departmentName}\tT10001\t합성 주전공과목\t1전공\t3\tA+
${departmentName}\tO10002\t합성 이중전공과목\t이중전공\t2\tB+
${departmentName}\tAB1234567\t합성 제2전공과목\t2전공\t1.5\tA0
${departmentName}\tABCD123\t합성 부전공과목\t부전공\t1\tC0
${departmentName}\tP10005\t합성 외국어과목\t실용외국어\t2\tP
${departmentName}\tL10006\t합성 교양과목
(Example Course)\t교양\t2\tB0
${departmentName}\tED10007\t합성 교직과목\t교직\t2\tD+
${departmentName}\tF10008\t합성 자유선택과목\t자선\t1\tNP
2025 - 겨울
${departmentName}\tBA10009\t합성 기초과목\t기초\t3\tF
년도/학기 선택
+ 전체보기(View all)
영역별 취득학점
이수구분\t1전공\t이중전공\t2전공\t부전공\t실용외국어\t교양\t교직\t자선\t기초\t합계
취득학점\t3\t2\t1.5\t1\t2\t7\t2\t0\t0\t18.5`;
}
