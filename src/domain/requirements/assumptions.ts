// 학생에게 묻지 않고 정하는 '필수 질문'의 답. (화면에 추가 질문이 없다)
// 전공에서 알 수 있는 것은 전공에서 정하고(영어 전공 여부·영어대학 소속·인증 언어), 나머지는 '아니요 / 해당 없음'으로 가정한다.
// profile.facts에 학생이 직접 저장한 답이 있으면 호출하는 쪽에서 그 답을 우선한다.
import type { Question } from './officialRules';
import type { Scalar } from './conditions';

export interface MajorInfo { name?: string; college?: string }

const ENGLISH_MAJOR = /영어|영문|English|TESOL/i;

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
      value = q.options.find((o) => typeof o.value === 'string' && !!major.name && major.name.includes(o.label))?.value ?? null;
    } else value = false;
    if (value !== undefined && has(value)) out[q.field] = value;
    else if (has(false)) out[q.field] = false;
    else if (has(null)) out[q.field] = null;
  }
  return out;
}
