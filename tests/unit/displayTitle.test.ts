import { describe, expect, it } from 'vitest';
import { prettyTitle, shortTitle } from '../../src/domain/requirements/displayTitle';

describe('졸업평가 제목을 읽기 좋게', () => {
  it('내부 이름표(seoul/general/primary…)를 한글로 바꾼다', () => {
    expect(prettyTitle('seoul 비영어1전공 general: 시험경로 중 하나 또는 승인 대체과정. FLEX=대한상공회의소 FLEX'))
      .toBe('서울 비영어1전공 일반: 시험경로 중 하나 또는 승인 대체과정. FLEX=대한상공회의소 FLEX');
    expect(prettyTitle('일본언어문화 primary: FLEX700 OR JLPTN1합격+120 OR JPT750')).toBe('일본언어문화 주전공: FLEX700 OR JLPTN1합격+120 OR JPT750');
  });
  it('학과 — 영문-이름표 형태는 학과 + 읽을 수 있는 이름으로 바꾼다', () => {
    expect(prettyTitle('노어과 — russian-minor-no-course-exam')).toBe('노어과 부전공 졸업시험');
    expect(prettyTitle('그리스·불가리아학과 — greek-bulgarian-exam-nominal')).not.toContain('없음');
    expect(prettyTitle('폴란드학과 — polish-project-dual')).toBe('폴란드학과 이중전공 프로젝트');
    expect(prettyTitle('중국언어문화학부 — language-seoul-f94625560c-primary')).toBe('중국언어문화학부 주전공 어학 인증');
    expect(prettyTitle('컴퓨터공학부 — temporary')).toBe('컴퓨터공학부 졸업평가 (임시)');
  });
  it('처음 보는 이름표여도 영어 이름표를 그대로 보여 주지 않는다', () => {
    const t = prettyTitle('새학과 — brand-new-thing-2031');
    expect(t).toBe('새학과 졸업평가');
    expect(t).not.toMatch(/[a-z]{3,}/);
  });
  it('이미 읽기 좋은 제목과 시험 이름(FLEX·TOEIC)은 그대로 둔다', () => {
    expect(prettyTitle('독일어과 2026-2 졸업 주전공: 영역별 백분율 평균 60% 이상')).toBe('독일어과 2026-2 졸업 주전공: 영역별 백분율 평균 60% 이상');
    expect(prettyTitle('TOEIC 850 OR FLEX 700')).toBe('TOEIC 850 OR FLEX 700');
  });
  it('짧은 제목은 : 앞까지, 너무 길면 20자에서 …로 줄이고 설명은 따로 둔다', () => {
    const a = shortTitle('seoul 비영어1전공 general: 시험경로 중 하나 또는 승인 대체과정.');
    expect(a.short).toBe('서울 비영어1전공 일반');
    expect(a.rest).toBe('시험경로 중 하나 또는 승인 대체과정.');
    const b = shortTitle('말레이·인도네시아어과 졸업 인증 기준 안내 문서 전체 보기');
    expect([...b.short].length).toBeLessThanOrEqual(21);
    expect(b.short.endsWith('…')).toBe(true);
  });
});
