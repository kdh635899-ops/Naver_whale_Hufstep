// 재붙여넣기·수동 기록 병합 (§6.4). 확인 전까지 기존 상태를 바꾸지 않고, 확정 시 새 상태를 한 번에 만든다.
import type { ParseResult, ParsedRow } from '../parser/parseTranscript';
import { newId, type AppState } from '../state';
import { sameTerm } from '../terms';
import type { AcademicSnapshot, Course, CreditArea } from '../types';

export const MERGE_FIELDS = ['name', 'officialCode', 'area', 'creditUnits', 'grade', 'status', 'gradingMode'] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export interface FieldConflict { field: MergeField; current: unknown; imported: unknown }
export interface MergePlan {
  matched: { courseId: string; rowKey: string; changes: MergeField[]; conflicts: FieldConflict[] }[];
  /** 학생이 직접 추가한 수강 중/예정 과목과 같아 보이는 가져온 행 → 같은 Course ID로 연결 후보 */
  linkCandidates: { courseId: string; rowKey: string }[];
  added: string[];
  /** 이번 자료에 없는 이전 가져온 과목 (자동 삭제하지 않음) */
  missing: string[];
}
export interface MergeDecisions {
  /** rowKey → 연결 여부 (기본 연결) */
  link: Record<string, boolean>;
  /** `${courseId}:${field}` → 어느 값을 쓸지 (기본: 학생이 수정한 값 유지) */
  conflictChoice: Record<string, 'current' | 'imported'>;
  /** '완전한 최신 목록'임을 확인하고 missing 과목을 지울지 */
  removeMissing: boolean;
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

function importedValues(r: ParsedRow) {
  return {
    name: r.name, officialCode: r.officialCode, area: r.area, creditUnits: r.creditUnits, grade: r.grade,
    status: 'completed' as const, gradingMode: r.gradingMode, term: r.term, rawAreaLabel: r.rawAreaLabel,
    offeringDepartmentName: r.offeringDepartment,
    recordKind: r.recordKind, gpaInclusion: r.gpaInclusion, earnedInclusion: r.earnedInclusion,
  };
}

export function planMerge(state: AppState, parse: ParseResult): MergePlan {
  const plan: MergePlan = { matched: [], linkCandidates: [], added: [], missing: [] };
  const taken = new Set<string>();
  const courses = state.courses;

  for (const r of parse.rows) {
    // 1) 이전 반영 때의 source mapping
    let hit = courses.find((c) => !taken.has(c.id) && c.sourceRowKey === r.rowKey);
    // 2) 코드+학기 (같은 코드·학기가 여러 개면 이미 매칭된 것은 건너뛰어 순서대로 — 무조건 합치지 않음)
    if (!hit && r.officialCode) {
      hit = courses.find((c) => !taken.has(c.id) && c.origin !== 'manual' && c.officialCode === r.officialCode && sameTerm(c.term, r.term));
    }
    // 3) 코드 없는 인정학점: 학기+정규화 이름+영역+기록 종류
    if (!hit && !r.officialCode) {
      hit = courses.find((c) => !taken.has(c.id) && c.origin !== 'manual' && !c.officialCode && sameTerm(c.term, r.term)
        && norm(c.name) === norm(r.name) && c.area === r.area && c.recordKind === r.recordKind);
    }
    if (hit) {
      taken.add(hit.id);
      const imp = importedValues(r);
      const changes = MERGE_FIELDS.filter((f) => (hit![f] ?? undefined) !== (imp[f] ?? undefined));
      const conflicts = changes.filter((f) => hit!.overriddenFields.includes(f)).map((f) => ({ field: f, current: hit![f], imported: imp[f] }));
      plan.matched.push({ courseId: hit.id, rowKey: r.rowKey, changes, conflicts });
      continue;
    }
    // 4) 수동 추가한 수강 중/예정 과목 → 연결 후보 (이름이 '정확히' 같거나 코드가 같을 때만)
    const manual = courses.find((c) => !taken.has(c.id) && c.origin === 'manual' && !c.sourceRowKey
      && (c.status === 'inProgress' || c.status === 'planned') && sameTerm(c.term, r.term)
      && ((c.officialCode && c.officialCode === r.officialCode) || norm(c.name) === norm(r.name)));
    if (manual) { taken.add(manual.id); plan.linkCandidates.push({ courseId: manual.id, rowKey: r.rowKey }); continue; }
    plan.added.push(r.rowKey);
  }
  plan.missing = courses.filter((c) => c.origin === 'paste' && !taken.has(c.id)).map((c) => c.id);
  return plan;
}

export function applyMerge(state: AppState, parse: ParseResult, plan: MergePlan, d: MergeDecisions, now: Date): AppState {
  const at = now.toISOString();
  const snapshotId = newId('snap');
  const rowByKey = new Map(parse.rows.map((r) => [r.rowKey, r]));
  const byId = new Map(state.courses.map((c) => [c.id, c]));
  const snapshotCourseIds: string[] = [];

  const fromRow = (r: ParsedRow, base?: Course): Course => ({
    id: base?.id ?? newId('course'),
    requiredClaim: base?.requiredClaim ?? 'none',
    ...(base?.requirementLinks && { requirementLinks: base.requirementLinks }), // 학생이 연결한 요건은 재붙여넣기에도 유지
    replacesCourseId: base?.replacesCourseId,
    recognizedDepartmentId: base?.recognizedDepartmentId,
    overriddenFields: base?.overriddenFields ?? [],
    origin: base?.origin ?? 'paste',
    ...importedValues(r),
    sourceRowKey: r.rowKey,
    sourceSnapshotId: snapshotId,
    updatedAt: at,
  });

  for (const m of plan.matched) {
    const cur = byId.get(m.courseId)!;
    const next = fromRow(rowByKey.get(m.rowKey)!, cur);
    // 학생이 고친 필드는 선택한 값만 반영
    for (const c of m.conflicts) {
      if ((d.conflictChoice[`${m.courseId}:${c.field}`] ?? 'current') === 'current') {
        (next as unknown as Record<string, unknown>)[c.field] = cur[c.field];
      } else next.overriddenFields = next.overriddenFields.filter((f) => f !== c.field);
    }
    if (m.conflicts.some((c) => ['grade', 'status', 'gradingMode'].includes(c.field)
      && (d.conflictChoice[`${m.courseId}:${c.field}`] ?? 'current') === 'current')) {
      // 등급 계열을 학생 값으로 유지했다면 포함 여부도 학생 값 기준을 유지
      next.gpaInclusion = cur.gpaInclusion;
      next.earnedInclusion = cur.earnedInclusion;
    }
    byId.set(next.id, next);
    snapshotCourseIds.push(next.id);
  }
  for (const l of plan.linkCandidates) {
    const r = rowByKey.get(l.rowKey)!;
    // 연결하면 같은 Course ID를 유지 → 시간표·메모가 그대로 남고 학점이 두 번 더해지지 않는다
    const next = (d.link[l.rowKey] ?? true) ? fromRow(r, byId.get(l.courseId)) : fromRow(r);
    byId.set(next.id, next);
    snapshotCourseIds.push(next.id);
  }
  for (const key of plan.added) {
    const next = fromRow(rowByKey.get(key)!);
    byId.set(next.id, next);
    snapshotCourseIds.push(next.id);
  }

  // 메모·수업 시간·평가는 Course ID에 붙어 있어 과목이 유지되면 그대로 남는다. 지운 과목 것만 정리.
  let refs: ReturnType<typeof dropCourseRefs> = {
    assessments: state.assessments, completions: state.completions, scenarios: state.scenarios,
    courseMemos: state.courseMemos, classTimes: state.classTimes,
  };
  if (d.removeMissing && plan.missing.length) {
    const gone = new Set(plan.missing);
    gone.forEach((id) => byId.delete(id));
    refs = dropCourseRefs(state, gone);
  }

  const snapshot: AcademicSnapshot = {
    id: snapshotId,
    importedAt: at,
    source: 'studentPaste',
    courseIds: snapshotCourseIds,
    reportedEarnedByArea: parse.reportedEarnedByArea,
    reportedTotalEarnedUnits: parse.reportedTotalEarnedUnits,
    completeness: parse.completeness,
    warnings: parse.warnings.slice(0, 3000),
  };
  return {
    ...state,
    courses: [...byId.values()],
    ...refs,
    snapshots: [...state.snapshots, snapshot].slice(-20),
  };
}

/** 과목을 지울 때 그 과목을 가리키는 평가·완료표시·메모·수업 시간·시나리오 항목도 함께 정리 */
export function dropCourseRefs(state: AppState, gone: Set<string>) {
  const assessments = state.assessments.filter((a) => !gone.has(a.courseId));
  const alive = new Set(assessments.map((a) => a.id));
  return {
    assessments,
    courseMemos: state.courseMemos.filter((m) => !gone.has(m.courseId)),
    classTimes: state.classTimes.filter((t) => !gone.has(t.courseId)),
    completions: state.completions.filter((c) => alive.has(c.eventId.slice(0, c.eventId.lastIndexOf(':')))),
    scenarios: state.scenarios.map((s) => ({
      ...s,
      entries: s.entries.filter((e) => !gone.has(e.courseId) && !(e.replacesCourseId && gone.has(e.replacesCourseId))),
    })),
  };
}

/** 붙여넣기가 불가능할 때의 보조 경로: 영역별 취득학점·(선택) 요약 평점 직접 입력 */
export function summarySnapshot(
  byArea: Partial<Record<CreditArea, number>>, total: number | undefined, gpa: AcademicSnapshot['reportedGpa'], now: Date,
): AcademicSnapshot {
  return {
    id: newId('snap'),
    importedAt: now.toISOString(),
    source: 'summaryInput',
    courseIds: [],
    reportedEarnedByArea: byArea,
    reportedTotalEarnedUnits: total,
    reportedGpa: gpa,
    completeness: { earnedTotals: true, courses: false, gpa: false },
    warnings: [],
  };
}
