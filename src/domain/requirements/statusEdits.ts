// 개인 체크리스트는 공식 규칙·성적과 분리하고, 학생 조건이 같은 문맥에서만 사용한다.
import { emptyEdits, gradeCourses, type AppState } from '../state';
import { effectiveCourses } from '../gpa/gpa';
import type { StudentProfile } from '../types';
import type { NodeProgress } from './officialRules';
import idMigration from '../../data/requirement-id-migration.json' with { type: 'json' };

const stableId = (id: string) => (idMigration as Record<string, string>)[id] ?? id;
/** 과목 편집기에서 학생이 명시적으로 연결한 실제 이수 성적만 사용한다. 이름은 연결 키가 아니다. */
export function linkedChecklistIds(courses: AppState['courses']): Set<string> {
  return new Set(effectiveCourses(gradeCourses(courses)).filter((c) => c.status === 'completed' && c.earnedInclusion === 'included')
    .flatMap((c) => c.requirementLinks ?? []));
}
export function migrateChecklistIds(saved: NonNullable<AppState['statusEditContexts']>[string]) {
  return { edits: { ...saved.edits,
    renamed: Object.fromEntries(Object.entries(saved.edits.renamed).map(([id, name]) => [stableId(id), name])),
    redetailed: Object.fromEntries(Object.entries(saved.edits.redetailed ?? {}).map(([id, detail]) => [stableId(id), detail])),
    removed: saved.edits.removed.map(stableId),
  }, confirmations: saved.confirmations.map((c) => ({ ...c, requirementId: stableId(c.requirementId) })),
  links: Object.fromEntries(Object.entries(saved.links).map(([id, links]) => [id, links.map(stableId)])) };
}

export function statusContextKey(p: StudentProfile | null): string {
  return JSON.stringify(p ? [p.homeCampus, p.primaryDepartmentId, p.secondaryDepartmentId ?? null,
    p.programType, p.cohortYear, p.entryType, Object.entries(p.facts ?? {}).sort(([a], [b]) => a.localeCompare(b))] : null);
}

export function scopeStatusEdits(s: AppState): AppState {
  const key = statusContextKey(s.profile);
  if (s.statusEditContext === key) return s;
  const contexts = { ...s.statusEditContexts };
  const oldKey = s.statusEditContext ?? 'legacy-unassigned';
  // 이전 버전은 소속을 기록하지 않았다. 추측해서 현재 전공에 붙이지 않고 원형을 보관한다.
  contexts[oldKey] = { edits: s.statusEdits ?? emptyEdits(), confirmations: s.certConfirmations,
    links: Object.fromEntries(s.courses.filter((c) => c.requirementLinks?.length).map((c) => [c.id, c.requirementLinks!])) };
  const saved = contexts[key] && migrateChecklistIds(contexts[key]);
  return { ...s, statusEditContext: key, statusEditContexts: contexts,
    statusEdits: saved?.edits ?? emptyEdits(), certConfirmations: saved?.confirmations ?? [],
    courses: s.courses.map((c) => c.requirementLinks?.length || saved?.links[c.id]
      ? { ...c, requirementLinks: saved?.links[c.id] ?? [],
        requiredClaim: !saved?.links[c.id]?.length && c.requiredClaim === 'studentMarked' ? 'none' : c.requiredClaim } : c) };
}

/** 제외한 택일 후보는 충족하지 않는다. 택일 의무의 필요량도 그대로 둔다. */
export function checklistCount(p: NodeProgress, removed: ReadonlySet<string>, inChoice = false): [number, number] {
  const n = p.node;
  if (n.op === 'course') return removed.has(n.id) ? [0, inChoice ? 1 : 0] : [Number(p.level > 0), 1];
  const kids = p.children ?? n.items.map((node) => ({ node, level: 0 as const }));
  const counts = kids.map((k) => checklistCount(k, removed, inChoice || n.op !== 'ALL'));
  if (n.op === 'OR' || n.op === 'AT_LEAST') {
    const need = n.op === 'AT_LEAST' ? n.count : 1;
    const met = counts.filter(([m, t]) => t > 0 && m >= t).length;
    return [Math.min(need, met), need];
  }
  return counts.reduce<[number, number]>(([m, t], [cm, ct]) => [m + cm, t + ct], [0, 0]);
}

export function deleteChecklistItem(s: AppState, id: string, extra: boolean): AppState {
  const e = s.statusEdits ?? emptyEdits();
  return { ...s, statusEdits: extra ? { ...e,
    extraCourses: e.extraCourses.filter((x) => x.id !== id), extraExams: e.extraExams.filter((x) => x.id !== id),
    renamed: Object.fromEntries(Object.entries(e.renamed).filter(([k]) => k !== id)),
    redetailed: Object.fromEntries(Object.entries(e.redetailed ?? {}).filter(([k]) => k !== id)),
  } : { ...e, removed: e.removed.includes(id) ? e.removed.filter((x) => x !== id) : [...e.removed, id] },
  // 공식 항목은 복구할 수 있으므로 체크·연결도 보존한다. 개인 항목은 함께 정리한다.
  certConfirmations: extra ? s.certConfirmations.filter((c) => c.requirementId !== id) : s.certConfirmations,
  courses: extra ? s.courses.map((c) => {
    if (!c.requirementLinks?.includes(id)) return c;
    const links = c.requirementLinks.filter((x) => x !== id);
    return { ...c, requirementLinks: links, requiredClaim: !links.length && c.requiredClaim === 'studentMarked' ? 'none' as const : c.requiredClaim };
  }) : s.courses };
}
