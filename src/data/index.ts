// 배포 패키지에 포함된 학교 데이터 JSON을 읽고 검증한다 (§5.1, §5.4).
// 스키마를 통과하지 못한 항목은 로딩에서 제외(거절)하고 나머지 정상 항목만 쓴다.
// 공식 데이터 교체 = 이 폴더의 JSON 교체 → `npm run check:data` → `npm run build`.
import type { z } from 'zod';
import {
  bundleSchema, calendarSchema, departmentMetaSchema, departmentSchema, equivalenceSchema, gradingPolicySchema,
  officialRuleSchema, sourceSchema, supportGapSchema,
} from '../domain/validation/schemas';
import type { CampusId, Term } from '../domain/types';
import { sameTerm } from '../domain/terms';
import departmentsRaw from './departments.json';
import departmentMetaRaw from './department-meta.json';
import bundlesRaw from './requirement-bundles.json';
import demoBundlesRaw from './requirement-bundles.demo.json';
import officialRulesRaw from './official-rules.json';
import equivalencesRaw from './course-equivalences.json';
import calendarsRaw from './academic-calendars.json';
import policiesRaw from './grading-policies.json';
import sourcesRaw from './sources.json';

export interface Rejected { file: string; index: number; reason: string }

export function loadList<T>(file: string, raw: unknown, schema: z.ZodType<T>, rejected: Rejected[]): T[] {
  if (!Array.isArray(raw)) { rejected.push({ file, index: -1, reason: '배열이 아니에요' }); return []; }
  const out: T[] = [];
  const ids = new Set<string>();
  raw.forEach((item, index) => {
    const r = schema.safeParse(item);
    if (!r.success) { rejected.push({ file, index, reason: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
    const id = (r.data as { id?: string }).id;
    if (id && ids.has(id)) { rejected.push({ file, index, reason: `중복 id ${id}` }); return; }
    if (id) ids.add(id);
    out.push(r.data);
  });
  return out;
}

const rejected: Rejected[] = [];
const keepStatus = <T extends { id: string; status: string }>(file: string, list: T[], ok: (s: string) => boolean) =>
  list.filter((b) => ok(b.status) || (rejected.push({ file, index: -1, reason: `${b.id}: 상태 ${b.status}는 이 파일에 둘 수 없어요` }), false));

export const catalog = {
  departments: loadList('departments.json', departmentsRaw, departmentSchema, rejected),
  // 정식 묶음 파일에는 demo를 섞지 않는다 (demo / verified 분리)
  bundles: keepStatus('requirement-bundles.json', loadList('requirement-bundles.json', bundlesRaw, bundleSchema, rejected), (s) => s !== 'demo'),
  demoBundles: keepStatus('requirement-bundles.demo.json', loadList('requirement-bundles.demo.json', demoBundlesRaw, bundleSchema, rejected), (s) => s === 'demo'),
  equivalences: loadList('course-equivalences.json', equivalencesRaw, equivalenceSchema, rejected).filter((e) => e.status === 'verified'),
  calendars: loadList('academic-calendars.json', calendarsRaw, calendarSchema, rejected),
  policy: loadList('grading-policies.json', policiesRaw, gradingPolicySchema, rejected)[0] ?? {
    id: 'fallback', gradeAliases: {}, maxCreditUnitsPerCourse: 2000, sourceIds: [], status: 'unverified' as const,
  },
  sources: loadList('sources.json', sourcesRaw, sourceSchema, rejected),
  // 조건식이 붙은 공식 규칙 (호환 14 / 조건 처리 500 / 조사 미확정 65). demo와 섞지 않는다.
  officialRules: loadList('official-rules.json', officialRulesRaw.rules, officialRuleSchema, rejected),
  supportGaps: loadList('official-rules.json#supportGaps', officialRulesRaw.supportGaps, supportGapSchema, rejected),
  departmentMeta: loadList('department-meta.json', departmentMetaRaw, departmentMetaSchema, rejected),
  rejected,
};

const deptById = new Map(catalog.departments.map((d) => [d.id, d]));
const metaById = new Map(catalog.departmentMeta.map((m) => [m.id, m]));
export const departmentById = (id: string) => deptById.get(id);
export const departmentMetaById = (id: string) => metaById.get(id);
// 동일 단위의 카탈로그 표기만 양방향 연결한다. 학부·세부전공·개편 승계는 추정하지 않는다.
const equivalentIdsById = new Map<string, string[]>();
for (const m of catalog.departmentMeta) for (const r of m.reorganization) {
  if (!r.relatedId || !['sameUnitCatalogLabel', 'sameUnitAlternateLabel'].includes(r.relation)) continue;
  equivalentIdsById.set(m.id, [...(equivalentIdsById.get(m.id) ?? []), r.relatedId]);
  equivalentIdsById.set(r.relatedId, [...(equivalentIdsById.get(r.relatedId) ?? []), m.id]);
}
/** 조건식에 넣을 학과 사실 (카탈로그에서 확정되는 값만) */
export const departmentFacts = (id: string) => {
  const d = deptById.get(id);
  return d && { campus: d.campus, name: d.name, college: metaById.get(id)?.college, equivalentIds: equivalentIdsById.get(id) ?? [] };
};

export const departmentName = (id?: string) => catalog.departments.find((d) => d.id === id)?.name ?? (id ? '알 수 없는 학과' : '');
export const sourceById = (id: string) => catalog.sources.find((s) => s.id === id);
export const calendarFor = (campus: CampusId, term: Term) =>
  catalog.calendars.find((c) => c.campus === campus && sameTerm(c.term, term));
