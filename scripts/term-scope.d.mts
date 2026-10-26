// term-scope.mjs 타입 선언 (테스트에서 같은 교정 함수를 쓰기 위함)
export const START_TERM: Record<string, string>;
export interface EffectivePeriod { effectiveFrom?: string | null; effectiveThrough?: string | null; unknownReason?: string | null }
export function periodBound(v: string | null | undefined, edge: 'from' | 'through'): number | null;
export function correctTermScope(ruleId: string, type: string | undefined, condition: unknown, detail: unknown, reasons: string[], effectivePeriod?: EffectivePeriod): {
  condition: unknown; detail: unknown; reasons: string[]; termSpecific?: { term: string; fields: Record<string, unknown> };
};
