// 졸업평가·인증 규칙의 제목은 학교 규정 데이터에서 온 내부 이름이 섞여 있다
// ('seoul 비영어1전공 general: …', '노어과 — russian-minor-no-course-exam').
// 규칙 하나하나를 손으로 번역하지 않고, 패턴으로 읽기 좋게 바꾼다. 새 규칙이 들어와도 영어 이름표가 그대로 보이지 않는다.

/** 앞뒤가 영문·숫자가 아닌 곳에 있는 소문자 이름표만 바꾼다 (FLEX·TOEIC 같은 시험 이름은 그대로) */
const TOKEN_KO: Record<string, string> = {
  seoul: '서울', global: '글로벌', general: '일반', stem: 'STEM', primary: '주전공', dual: '이중전공', minor: '부전공',
};

const KIND: [string[], string][] = [
  [['thesis', 'essay'], '졸업논문'],
  [['exam', 'test'], '졸업시험'],
  [['language', 'flex', 'certificate', 'certification', 'topik', 'score', 'english'], '어학 인증'],
  [['project', 'capstone', 'publication'], '프로젝트'],
];
const NONE_WORDS = ['exemption', 'waiver', 'removed', 'no', 'nominal'];

/** '노어과 — russian-minor-no-course-exam' → '노어과 부전공 졸업시험 (면제·없음)' */
function fromSlug(head: string, slug: string): string {
  const words = slug.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2);
  const has = (...keys: string[]) => words.some((w) => keys.includes(w));
  const scope = [has('primary') && '주전공', has('dual') && '이중전공', has('minor') && '부전공'].filter(Boolean).join('·');
  const kind = KIND.find(([keys]) => has(...keys))?.[1] ?? '졸업평가';
  const mods = [has('temporary') && '임시', has(...NONE_WORDS) && '면제·없음'].filter(Boolean).join(', ');
  return [head.trim(), scope, kind].filter(Boolean).join(' ') + (mods ? ` (${mods})` : '');
}

export function prettyTitle(raw: string): string {
  const parts = raw.split(/\s+—\s+/);
  if (parts.length === 2 && /^[A-Za-z0-9._\-가-힣·]+$/.test(parts[1]) && /[a-z]/.test(parts[1])) return fromSlug(parts[0], parts[1]);
  return raw
    .replace(/(?<![A-Za-z0-9-])([a-z]+)(?![A-Za-z0-9-])/g, (m) => TOKEN_KO[m] ?? m)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const TITLE_MAX = 20;
const clip = (s: string, n = TITLE_MAX) => ([...s].length > n ? `${[...s].slice(0, n).join('').trimEnd()}…` : s);

/** 한 줄에 보이는 짧은 제목: ':' 앞의 이름만(너무 길면 20자까지), 나머지 설명은 `rest`로 */
export function shortTitle(raw: string): { short: string; head: string; rest: string; full: string } {
  const full = prettyTitle(raw);
  const i = full.indexOf(':');
  const head = i > 0 && i <= 28 ? full.slice(0, i).trim() : full;
  const rest = i > 0 && i <= 28 ? full.slice(i + 1).trim() : '';
  return { short: clip(head), head, rest, full }; // head = 줄이지 않은 ':' 앞 이름 (펼친 목록에서는 전부 보여 준다)
}
