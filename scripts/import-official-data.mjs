// 데이터 프로젝트의 앱 전달본(outputs/app-import)을 읽어 src/data/ 배포 JSON을 만든다.
// 원본 폴더는 읽기만 한다. 다시 실행해도 같은 결과가 나온다.
//   node scripts/import-official-data.mjs [app-import 경로]          → src/data/ 갱신
//   node scripts/import-official-data.mjs [app-import 경로] --check  → 파일을 바꾸지 않고 동기화 여부만 검사
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { correctTermScope } from './term-scope.mjs';

const DEFAULT_SRC = 'C:/Users/USER/Documents/Codex/2026-10-13/files-pasted-by-the-user-c/outputs/app-import';
const args = process.argv.slice(2);
const check = args.includes('--check');
const SRC = args.find((a) => !a.startsWith('--')) ?? DEFAULT_SRC;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
if (check && !existsSync(join(SRC, 'integration-manifest.json'))) {
  console.log(`전달본 폴더가 없어 동기화 검사를 건너뛰었어요 (통과 아님): ${SRC}`);
  process.exit(0);
}
const manifest = read(SRC, 'integration-manifest.json');

// ---- 1) 앱 형식 배열 6종: 그대로 사용 (값 변환 없음) ----
const ARRAYS = ['departments.json', 'requirement-bundles.json', 'course-equivalences.json', 'grading-policies.json', 'academic-calendars.json', 'sources.json'];
const out = Object.fromEntries(ARRAYS.map((f) => [f, read(SRC, f)]));

// 기존 학생 저장 정보가 참조하는 학과 ID·데모 출처가 새 전달본에도 있어야 한다
const LEGACY_DEPARTMENT_IDS = ['seoul-malay-indonesian', 'seoul-business', 'seoul-german', 'seoul-japanese-language-culture'];
const deptIds = new Set(out['departments.json'].map((d) => d.id));
for (const id of LEGACY_DEPARTMENT_IDS) if (!deptIds.has(id)) throw new Error(`기존 학과 ID 누락: ${id}`);
const oldSources = read(OUT, 'sources.json');
const newSourceIds = new Set(out['sources.json'].map((s) => s.id));
for (const s of oldSources) if (!newSourceIds.has(s.id)) throw new Error(`기존 출처 ID 누락: ${s.id}`);

// ---- 2) 조건 처리가 필요한 기록 → official-rules.json ----
const STATE = { conditionProcessingPending: 'pending', researchUnconfirmed: 'unconfirmed', appCompatible: 'compatible' };
const STATUS = { verified: 'verified', needsReview: 'unverified', conflict: 'conflict' };
const NOISE = /^(sourceRefs|creditSourceRefs|identitySourceRefs|timetable2026|timetableObservations|sourceRows|sourceSheetRow|sourceRow)$/;

const collectSourceIds = (o, acc = new Set()) => {
  if (Array.isArray(o)) o.forEach((x) => collectSourceIds(x, acc));
  else if (o && typeof o === 'object') {
    if (typeof o.sourceId === 'string') acc.add(o.sourceId);
    Object.values(o).forEach((x) => collectSourceIds(x, acc));
  }
  return acc;
};
/** 화면 표시용 원문 요건: 출처 참조·시간표 관찰 같은 연구 메타데이터만 뺀다 (원래 단위 그대로) */
const sanitize = (o) => (o == null ? null : JSON.parse(JSON.stringify(o, (k, v) => (NOISE.test(k) ? undefined : v))));

/** 필수과목 식: ALL/OR/AT_LEAST 중첩과 과목 잎을 그대로 유지한다. 학점은 이미 ×100 정수(creditUnits). */
function convertExpr(e, ruleId, path = 'r') {
  if (!e) return null;
  if (e.type === 'course') {
    return {
      op: 'course', id: `${ruleId}/${path}`, code: e.courseCode ?? null, name: e.courseName,
      creditUnits: e.creditUnits ?? null,
      matching: e.matchingMode === 'studentConfirmation' || !e.courseCode ? 'studentConfirmation' : 'code',
      ...(e.waiverRuleIds?.length && { waiverRuleIds: e.waiverRuleIds }),
      ...(e.officialIdenticalCourseNames?.length && { identicalNames: e.officialIdenticalCourseNames }),
    };
  }
  if (!['ALL', 'OR', 'AT_LEAST'].includes(e.op)) throw new Error(`${ruleId}: 알 수 없는 과목 식 ${e.op ?? e.type}`);
  return {
    op: e.op, ...(e.op === 'AT_LEAST' && { count: e.count }),
    items: e.items.map((x, i) => convertExpr(x, ruleId, `${path}.${i}`)),
  };
}

/** 원문에 '요건 없음/적용 제외'가 명시된 범주. 빈 배열·누락은 여기서 만들지 않는다. */
function noneFor(req) {
  if (!req) return undefined;
  const cats = new Set();
  let exceptCompositions;
  const t = req.type;
  if (t === 'requiredCourses' && req.explicitNoRequirement && req.expression?.items?.length === 0) cats.add('requiredCourses');
  if (t === 'explicitNoRequiredCourses' && req.explicitNoRequirement) cats.add('requiredCourses');
  if (t === 'requiredCoursePolicy' && req.requiresMajorRequiredCourses === false) cats.add('requiredCourses');
  if ((t === 'assessmentRequired' && req.required === false) || (t === 'departmentAssessment' && req.explicitNoRequirement)) cats.add('departmentAssessment');
  if (t === 'explicitNoAssessment' && req.explicitNoRequirement) cats.add('departmentAssessment');
  if (t === 'explicitDepartmentExemption') {
    if (req.requiredCoursesRequired === false) cats.add('requiredCourses');
    const flags = Object.entries(req).filter(([k, v]) => /Required$/.test(k) && k !== 'requiredCoursesRequired' && typeof v === 'boolean');
    if (flags.length && flags.every(([, v]) => v === false)) cats.add('departmentAssessment');
  }
  if (t === 'waiver' && req.waiver === true && req.targetCategory) {
    cats.add(req.targetCategory);
    exceptCompositions = (req.exceptions?.items ?? []).filter((x) => x.type === 'composition').map((x) => x.name);
  }
  if (!cats.size) return undefined;
  return { categories: [...cats], ...(exceptCompositions && { exceptCompositions }), ...(req.departmentMayImpose === true && { departmentMayImpose: true }) };
}

/** 과목 코드가 명시된 대체·택일 관계만 자동 인정 후보로 만든다. 이름만 있는 관계는 학생 연결로 남긴다. */
function substitutionsFor(req) {
  if (!req) return undefined;
  const subs = [];
  if (req.type === 'approvedCourseReplacement' && req.originalCourseCode && req.replacementCourseCode) {
    subs.push({ from: [req.originalCourseCode], to: [req.replacementCourseCode], ...(req.effectiveFromTerm && { fromTerm: req.effectiveFromTerm }) });
  }
  if (req.type === 'requiredCourseAlternative' && req.expression?.op === 'OR') {
    const leaves = req.expression.items.filter((x) => x.type === 'course');
    const codes = leaves.map((x) => x.courseCode).filter(Boolean);
    const names = leaves.filter((x) => !x.courseCode).map((x) => x.courseName);
    if (codes.length) subs.push({ from: codes, to: codes, ...(names.length && { names }) });
  }
  return subs.length ? subs : undefined;
}

const rules = [];
const counts = {};
for (const rec of manifest.records) {
  counts[rec.deliveryState] = (counts[rec.deliveryState] ?? 0) + 1;
  const state = STATE[rec.deliveryState];
  if (!state) continue; // excludedInactive: 실행 배열에서 제외 (원형은 데이터 프로젝트에 보존)
  const o = rec.originalRecord;
  const sp = rec.stagedProjection;
  const req = o.requirement ?? o.sourceRequirement ?? null;
  const areaNotes = Object.entries(sp.areaValueStates ?? {})
    .filter(([, v]) => v.creditUnits == null && v.unknownReason)
    .map(([area, v]) => ({ area, reason: v.unknownReason }));
  const title = o.summary ?? (o.title && o.title !== rec.ruleId ? o.title : null);
  const isCompat = state === 'compatible';
  const scoped = isCompat ? null : correctTermScope(rec.ruleId, req?.type, sp.applicabilityCondition, sanitize(req), rec.reasons, o.effectivePeriod);
  rules.push({
    id: rec.ruleId,
    state,
    status: STATUS[rec.researchVerificationStatus],
    departmentId: rec.departmentId ?? null,
    category: o.category,
    type: req?.type ?? o.category,
    ...(title && { title }),
    condition: isCompat ? null : scoped.condition,
    ...(isCompat && { bundleIds: rec.bundleIds }),
    totalRequiredUnits: isCompat ? null : sp.totalRequiredUnits ?? null,
    requiredUnitsByArea: isCompat ? {} : sp.requiredUnitsByArea ?? {},
    ...(areaNotes.length && !isCompat && { areaNotes }),
    ...(!isCompat && sp.requiredCourseExpression?.items?.length && { courses: convertExpr(sp.requiredCourseExpression, rec.ruleId) }),
    ...(req?.listCompleteness && { listCompleteness: req.listCompleteness }),
    ...(noneFor(req) && { none: noneFor(req) }),
    ...(substitutionsFor(req) && { substitutions: substitutionsFor(req) }),
    detail: isCompat ? null : scoped.detail,
    ...(scoped?.termSpecific && { termSpecific: scoped.termSpecific }),
    reasons: isCompat ? rec.reasons : scoped.reasons,
    ...(o.unknownReason && { note: o.unknownReason }),
    sourceIds: [...collectSourceIds([rec.sourceRefs, o])].sort(),
  });
}

const idMap = manifest.idMap;
const mapId = (id) => (id ? idMap[id] ?? id : null);
const officialRules = {
  dataVersion: manifest.dataVersion,
  asOf: manifest.asOf,
  wholeResearchComplete: manifest.wholeResearchComplete,
  counts,
  rules,
  supportGaps: manifest.initialFourSupportGaps.map((g) => ({ ...g, departmentId: mapId(g.departmentId) })),
};

// ---- 3) 학과 메타데이터: 종류·모집 상태·상위 전공·역할 제한 ----
const departmentMeta = manifest.departmentMetadata.map((d) => ({
  id: mapId(d.majorId),
  kind: d.kind,
  status: d.status,
  ...(d.college && { college: d.college }),
  ...(d.parentMajorId && { parentId: mapId(d.parentMajorId) }),
  ...(d.formerNames?.length && { formerNames: d.formerNames }),
  requirementsComplete: d.requirementsComplete === true,
  roleRestrictions: (d.roleEligibility ?? []).filter((e) => e.status === 'notPermitted').map((e) => ({
    roles: e.roles, condition: e.condition ?? null, cohortFrom: e.cohortFrom ?? null, cohortTo: e.cohortThrough ?? null, reason: e.reason,
  })),
  reorganization: (d.reorganizationRelations ?? []).map((r) => ({ relation: r.relation, relatedId: mapId(r.relatedMajorId) })),
  ...(d.officeContact && { contact: { phone: d.officeContact.phone, email: d.officeContact.email, homepageUrl: d.officeContact.homepageUrl,
    graduationPageUrl: d.officeContact.graduationPageUrl, checkedAt: d.officeContact.checkedAt,
    ...(d.officeContact.note && { note: d.officeContact.note }), ...(d.officeContact.fallbackToSchoolMain && { schoolMain: true }) } }),
}));

// ---- 4) 단위 점검: 학점×100이 다시 100배 되지 않았는지 (총학점 10~200학점 범위) ----
for (const r of rules) {
  const vals = [r.totalRequiredUnits, ...Object.values(r.requiredUnitsByArea)].filter((v) => v != null);
  for (const v of vals) if (!Number.isInteger(v) || v < 0 || v > 20000) throw new Error(`${r.id}: 학점 단위 이상 ${v}`);
}

out['official-rules.json'] = officialRules;
out['department-meta.json'] = departmentMeta;

let diff = 0;
for (const [file, value] of Object.entries(out)) {
  const text = `${JSON.stringify(value, null, 1)}\n`;
  let prev = '';
  try { prev = readFileSync(join(OUT, file), 'utf8'); } catch { /* 새 파일 */ }
  if (prev === text) continue;
  diff++;
  if (check) console.log(`동기화 안 됨: ${file}`);
  else writeFileSync(join(OUT, file), text);
}
const by = (k) => rules.filter((r) => r.state === k).length;
console.log(`원본 기록 ${manifest.records.length} → 앱 규칙 ${rules.length} (호환 ${by('compatible')} / 조건 처리 ${by('pending')} / 조사 미확정 ${by('unconfirmed')}), 제외 ${counts.excludedInactive ?? 0}`);
console.log(`학과 ${departmentMeta.length}, 출처 ${out['sources.json'].length}, 호환 묶음 ${out['requirement-bundles.json'].length}`);
if (check && diff) process.exit(1);
console.log(check ? '동기화 확인 완료' : `${diff}개 파일 갱신`);
