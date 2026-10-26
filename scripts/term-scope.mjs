// 졸업 학기 제한 교정 (원문 대조 2026-10-24).
// 데이터 프로젝트는 시행일이 따로 없으면 공지가 게시된 학기를 졸업 학기 조건으로 넣었다
// (예: "2026-2 졸업 공지" → graduationTerm = 2026-2). 그러면 같은 학번·전공의 상시 기준
// (학점·필수과목·어학)이 이후 졸업 예정자에게서 빠진다. 여기서 바로잡는다.
//  - graduationTerm(eq/in)·graduationMonthIndex(eq)는 게시 맥락으로 보고 지운다. 학번·전공 등 나머지 조건은 그대로.
//  - 원문이 밝힌 시작·종료는 학위수여월 범위로 남긴다: 확정된 effectivePeriod(사유 없음), 문구에서 읽은 START_TERM.
//    예) 중국언어문화 "2025년 9월 1일부터 폐지" → graduationMonthIndex ≥ 202509 (2025-1 졸업=8월은 폐지 전)
//  - 학기 전용 안내(시험 실시·접수·인증 기준일)는 그 학기 조건을 그대로 둔다: TERM_ONLY_TYPES.
//  - 상시 기준에 섞인 마감일·시험일은 detail에서 빼 termSpecific(그 학기 한정)으로 옮긴다.
//  - graduationMonth·graduationMonthIndex 범위(원문의 명시적 시행·한시 구간)는 건드리지 않는다.

/** 학기 자체가 내용인 기록: 다른 학기에 재사용하지 않는다 */
const TERM_ONLY_TYPES = new Set(['termSpecificExamAdministration', 'departmentExamApplication', 'certificationReferenceDate']);

/** 원문이 밝힌 적용 시작 졸업 학기 (근거: 각 기록의 원문 문구) */
export const START_TERM = {
  'dept-exam-elc-added-tests-2023-2': '2023-2', // "2023학년도 하반기부터 적용되는 졸업 인증 기준"
  'dept-exam-elc-seoul': '2023-2', // 같은 since2023H2 기준
  'stage2-gbt-project-route-candidate': '2026-2', // 학과 공지 "2026-2부터 이중전공도 졸업프로젝트 Pass"
  'extended-french-global-assessment-2016': '2021-1', // 2021 졸업요건 안내
  'extended-french-global-minor-exemption': '2021-1',
  'extended-media-brand-required-removed': '2026-2', // 브랜드의이해 전필 해제
  'boundary-spanish-core-abolished-2017-2019': '2025-1',
  'boundary-politics-current-exam': '2026-1',
  'dept-gbt-project-pass-or-exam-primary': '2026-2',
};

const START_DATE = { 'remaining-chinese-education-2016': '2025-03-01' };
const LD_RULES = new Set(['extended-ld-qualification', 'extended-ld-exam',
  'extended-ld-primary-courses-2017', 'extended-ld-dual-courses-2017',
  'extended-ld-primary-courses-2023', 'extended-ld-dual-courses-2023']);

/** 그 학기 공지에만 해당하는 일정 키 (상시 기준과 분리) */
const TERM_FIELD = /(^d|D)eadline$|(^e|E)xamDate$|^exactPresentationDate|^presentationPeriod$|^applicationEndDate|^newSubmissionForGraduationMonth$/;

const isPostingLeaf = (c) => (c.field === 'graduationTerm' && (c.op === 'eq' || c.op === 'in'))
  || (c.field === 'graduationMonthIndex' && c.op === 'eq');

/** 1학기 졸업 = 그해 8월, 2학기 졸업 = 다음 해 2월 (conditions.ts factsFor와 같은 계산) */
const monthIndex = (term) => {
  const [y, s] = term.split('-').map(Number);
  return s === 1 ? y * 100 + 8 : (y + 1) * 100 + 2;
};

function strip(c, removed) {
  const hasPosting = (x) => isPostingLeaf(x) || (x.conditions ?? []).some(hasPosting) || (x.condition && hasPosting(x.condition));
  if ((c.op === 'OR' || c.op === 'NOT') && hasPosting(c)) throw new Error('OR/NOT 안의 졸업 학기 조건은 개별 검토가 필요합니다');
  if (c.op === 'AND' || c.op === 'OR') {
    const kept = [];
    for (const x of c.conditions) {
      if (isPostingLeaf(x)) removed.push(x);
      else kept.push(strip(x, removed));
    }
    // OR 안의 학기 잎을 지우면 의미가 바뀌므로 멈춘다 (현재 데이터에는 없음)
    if (c.op === 'OR' && kept.length !== c.conditions.length) throw new Error('OR 안의 졸업 학기 조건은 교정 규칙이 없습니다');
    return { ...c, conditions: kept };
  }
  if (c.op === 'NOT') return { ...c, condition: strip(c.condition, removed) };
  if (isPostingLeaf(c)) throw new Error('최상위 졸업 학기 조건은 교정 규칙이 없습니다');
  return c;
}

/**
 * 원문 시행일 → 학위수여월 경계. 학기(2024-2)·월(2025-08)·매월 1일 시작(2025-09-01)만 바꾼다.
 * 그 밖의 형식(월 중간 날짜 등)은 졸업월로 떨어지지 않으므로 추측하지 않고 멈춘다.
 */
export function periodBound(v, edge) {
  if (v == null) return null;
  if (/^\d{4}-[12]$/.test(v)) return monthIndex(v);
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12
    && (m[3] === undefined || (edge === 'from' && m[3] === '01'))) return Number(m[1]) * 100 + Number(m[2]);
  throw new Error(`시행일을 졸업월로 바꾸는 규칙이 없습니다: ${v}`);
}

const withMonthRange = (c, min, max) => ({ op: 'AND', conditions: [c, { op: 'range', field: 'graduationMonthIndex', min, max }] });

/** 조항별 시행일은 그 조항에만 붙인다. 논문 전체에 발표 시작일을 적용하지 않는다. */
function datedClauses(ruleId, detail) {
  if (!detail) return detail;
  const d = structuredClone(detail);
  const period = (item, from, through = null) => ({ ...item,
    graduationPeriod: { min: periodBound(from, 'from'), max: periodBound(through, 'through') } });
  if (ruleId === 'computer-thesis-policy') {
    d.expression.items[1] = period(d.expression.items[1], '2025-2');
  } else if (ruleId === 'department-candidate-7ff9150fe820') {
    d.expression.items = d.expression.items.map((item) => item.effectiveFrom ? period(item, item.effectiveFrom) : item);
  } else if (ruleId === 'remaining-chinese-education-2016') {
    d.expression.items.push(period({ type: 'certificate', name: '외국어연수평가원 방학 외국어 특별과정 수료증' }, '2025-03-01', '2026-02'));
  } else if (ruleId === 'boundary-politics-current-approved-waiver') {
    const [civil, award, gpa, paper] = d.expression.items;
    d.expression.items = [
      { ...civil, finalPassed: [], laterRoutesFrom: undefined },
      period({ ...civil, firstStagePassed: [] }, '2025-2'),
      period({ ...award, eligibleCompetitionNames: ['대학(원)생 국제법 논문경시대회', '대학(원)생 통일 논문 및 홍보 영상 공모', '대한민국 열린 토론대회', '미래정치지도자 의회연수과정'] }, '2025-1'),
      period({ ...award, eligibleCompetitionNames: ['통일법제 논문 공모', '국제인권논문 공모', '전국 대학생 통일토론 경연대회', '통일 데이터 활용 아이디어 공모', '통일모의국무회의 경연대회', '외교 공공데이터 활용 경진대회'] }, '2025-2'),
      period(gpa, '2025-2'), period(paper, '2026-1'),
    ];
  }
  return d;
}

/** 교정된 조건·표시용 원문·사유 (+ 그 학기 한정 일정) */
// shortcut: 현재 전달본의 224기록을 기준으로 교정하며, 새 규정·개정 자료를 가져오면 원문 적용기간을 다시 확인한다.
export function correctTermScope(ruleId, type, condition, detail, reasons, effectivePeriod) {
  if (!condition || TERM_ONLY_TYPES.has(type)) return { condition, detail, reasons };
  const removed = [];
  let next = strip(condition, removed);
  if (!removed.length) return { condition, detail, reasons };

  // 원문이 밝힌 시작·종료는 실제 조건으로 남긴다 (자동으로 붙은 게시 학기만 지운다)
  const ep = effectivePeriod;
  const start = START_TERM[ruleId];
  if (start) next = withMonthRange(next, monthIndex(start), null);
  else if (START_DATE[ruleId]) next = withMonthRange(next, periodBound(START_DATE[ruleId], 'from'), null);
  else if (LD_RULES.has(ruleId)) next = { op: 'AND', conditions: [next, { op: 'OR', conditions: [
    { op: 'range', field: 'graduationMonthIndex', min: 202601, max: null },
    { op: 'unknown', reason: 'LD 내규는 2026-01-01 시행. 이전 졸업사정에 대한 소급 적용은 학교 확인 필요' },
  ] }] };
  else if (ep && ep.unknownReason == null && (ep.effectiveFrom || ep.effectiveThrough)
    && !JSON.stringify(next).includes('"field":"graduationMonthIndex"')) {
    next = withMonthRange(next, periodBound(ep.effectiveFrom, 'from'), periodBound(ep.effectiveThrough, 'through'));
  }

  // 조항별 분기를 고르려면 졸업 예정 학기가 필요하다. 범위 자체는 전체 규칙을 제한하지 않는다.
  if (['computer-thesis-policy', 'department-candidate-7ff9150fe820', 'boundary-politics-current-approved-waiver'].includes(ruleId)) {
    next = withMonthRange(next, null, null);
  }
  detail = datedClauses(ruleId, detail);

  let termSpecific;
  const moved = detail && typeof detail === 'object' ? Object.entries(detail).filter(([k]) => TERM_FIELD.test(k)) : [];
  if (moved.length) {
    const terms = removed.flatMap((c) => (c.field !== 'graduationTerm' ? [] : c.op === 'eq' ? [c.value] : c.values));
    termSpecific = { term: terms.sort().at(-1), fields: Object.fromEntries(moved) };
    detail = Object.fromEntries(Object.entries(detail).filter(([k]) => !TERM_FIELD.test(k)));
  }

  // "앱이 입력받지 못하는 조건 필드" 사유에서 조건에서 사라진 필드를 뺀다
  const still = JSON.stringify(next);
  const gone = new Set(removed.map((c) => c.field).filter((f) => !still.includes(`"field":"${f}"`)));
  reasons = reasons.flatMap((r) => {
    if (!r.startsWith('unsupportedApplicabilityFields:')) return [r];
    const left = r.slice('unsupportedApplicabilityFields:'.length).split(',').filter((f) => !gone.has(f));
    return left.length ? [`unsupportedApplicabilityFields:${left.join(',')}`] : [];
  });
  return { condition: next, detail, reasons, ...(termSpecific && { termSpecific }) };
}
