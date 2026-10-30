// 전공 정보로 확인할 수 있는 답만 정한다. 미입력을 false/null로 바꾸지 않는다.
// profile.facts에 학생이 직접 저장한 답이 있으면 호출하는 쪽에서 그 답을 우선한다.
import type { Question } from './officialRules';
import type { Scalar } from './conditions';

export interface MajorInfo { name?: string; college?: string }

const ENGLISH_MAJOR = /영어|영문|영미|English|TESOL|ELLT|EICC/i;

export function assumeAnswers(questions: Question[], major: MajorInfo): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const q of questions) {
    if (q.optional) continue; // 기본값이 있는 질문은 규칙 엔진이 이미 기본값을 쓴다
    const has = (v: Scalar) => q.options.some((o) => o.value === v);
    let value: Scalar | undefined;
    if (q.field === 'primaryMajorIsEnglish') value = ENGLISH_MAJOR.test(major.name ?? '');
    else if (q.field === 'primaryMajorCollegeIsEnglishCollege') value = /영어/.test(major.college ?? '');
    else if (q.field === 'certificationLanguage') {
      // '중국어과'면 중국어 인증 기준 (선택지 이름이 학과명에 들어 있을 때)
      value = q.options.find((o) => typeof o.value === 'string' && !!major.name && major.name.includes(o.label))?.value;
    }
    if (value !== undefined && has(value)) out[q.field] = value;
  }
  return out;
}
