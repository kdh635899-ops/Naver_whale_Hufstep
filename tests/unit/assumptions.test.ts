import { describe, expect, it } from 'vitest';
import { assumeAnswers } from '../../src/domain/requirements/assumptions';
import type { Question } from '../../src/domain/requirements/officialRules';

const bool = (field: string): Question => ({ field, spec: { label: field, kind: 'bool' }, ruleIds: [], options: [{ value: true, label: '예' }, { value: false, label: '아니요' }] });
const lang: Question = { field: 'certificationLanguage', spec: { label: '졸업인증 언어', kind: 'choice' }, ruleIds: [],
  options: [{ value: 'Chinese', label: '중국어' }, { value: null, label: '목록에 없음 / 해당 없음' }] };

describe('필수 질문의 답을 전공에서 정하기', () => {
  it('영어 전공 여부와 영어대학 소속은 학과명·단과대에서 정한다', () => {
    const qs = [bool('primaryMajorIsEnglish'), bool('primaryMajorCollegeIsEnglishCollege')];
    expect(assumeAnswers(qs, { name: '영어통번역학부', college: '영어대학' })).toEqual({ primaryMajorIsEnglish: true, primaryMajorCollegeIsEnglishCollege: true });
    expect(assumeAnswers(qs, { name: '말레이·인도네시아어과', college: '동양어대학' })).toEqual({ primaryMajorIsEnglish: false, primaryMajorCollegeIsEnglishCollege: false });
  });
  it('졸업인증 언어는 학과명에 든 언어, 확인되지 않으면 미입력 유지', () => {
    expect(assumeAnswers([lang], { name: '중국어과' })).toEqual({ certificationLanguage: 'Chinese' });
    expect(assumeAnswers([lang], { name: '말레이·인도네시아어과' })).toEqual({});
  });
  it('확인하지 않은 특별전형 답은 만들어내지 않는다', () => {
    expect(assumeAnswers([bool('foreignLanguageSpecialAdmission')], { name: '독일어과' })).toEqual({});
  });
  it('기본값이 있는 질문(optional)은 건드리지 않는다', () => {
    expect(assumeAnswers([{ ...bool('teacherTraining'), optional: true }], { name: '독일어과' })).toEqual({});
  });
});
