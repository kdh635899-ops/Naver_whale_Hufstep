import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMerge, planMerge } from '../../src/domain/merge/mergeImport';
import { parseTranscript, validateTranscript } from '../../src/domain/parser/parseTranscript';
import { emptyState } from '../../src/domain/state';
import { clearEverything, loadState, saveState } from '../../src/storage/repository';
import { departmentTranscript } from '../fixtures/importTranscript';

// 기대값은 파서로 만들지 않고, 합성 원문의 각 칸을 직접 대조해 적는다.
const expected = [
  [2024, '1', null, '교양인정학점(1) (Liberal Arts Credits (transferred))', null, '교양', 500, null, 'recognizedCredit'],
  [2025, '1', 'T10001', '합성 주전공과목', '대조용학과', '1전공', 300, 'A+', 'course'],
  [2025, '1', 'O10002', '합성 이중전공과목', '대조용학과', '이중전공', 200, 'B+', 'course'],
  [2025, '1', 'AB1234567', '합성 제2전공과목', '대조용학과', '2전공', 150, 'A0', 'course'],
  [2025, '1', 'ABCD123', '합성 부전공과목', '대조용학과', '부전공', 100, 'C0', 'course'],
  [2025, '1', 'P10005', '합성 외국어과목', '대조용학과', '실용외국어', 200, 'P', 'course'],
  [2025, '1', 'L10006', '합성 교양과목\n(Example Course)', '대조용학과', '교양', 200, 'B0', 'course'],
  [2025, '1', 'ED10007', '합성 교직과목', '대조용학과', '교직', 200, 'D+', 'course'],
  [2025, '1', 'F10008', '합성 자유선택과목', '대조용학과', '자선', 100, 'NP', 'course'],
  [2025, 'winter', 'BA10009', '합성 기초과목', '대조용학과', '기초', 300, 'F', 'course'],
];

beforeEach(async () => { await clearEverything(); });

describe('원문의 개별 항목 → 분석 → 저장소 복원 1:1 대조 (합성 자료)', () => {
  const original = departmentTranscript('대조용학과');
  const passAndMinor = original.replaceAll('\t부전공\t', '\t부전\t').replace('\tP\n', '\tPASS\n');
  it.each([original, original.replaceAll('\t', ' '), original.replaceAll('\n', '\r\n'), passAndMinor])('각 과목의 9개 항목과 순서를 저장소에서 다시 읽어 대조한다', async (input) => {
    const expectedRows = input === passAndMinor
      ? expected.map((row) => row.map((value, i) => i === 5 && value === '부전공' ? '부전' : value))
      : expected;
    const parsed = parseTranscript(input);
    expect(validateTranscript(parsed).canSave).toBe(true);
    expect(parsed.rows.map((r) => [r.term.academicYear, r.term.semester, r.officialCode ?? null, r.name, r.offeringDepartment ?? null, r.rawAreaLabel, r.creditUnits, r.grade, r.recordKind])).toEqual(expectedRows);
    const initial = emptyState();
    const merged = applyMerge(initial, parsed, planMerge(initial, parsed), { link: {}, conflictChoice: {}, removeMissing: false }, new Date('2026-10-29T00:00:00Z'));
    await saveState(merged);
    const restored = await loadState();
    expect(restored?.courses.map((c) => [c.term.academicYear, c.term.semester, c.officialCode ?? null, c.name, c.offeringDepartmentName ?? null, c.rawAreaLabel, c.creditUnits, c.grade, c.recordKind])).toEqual(expectedRows);
    expect(new Set(restored!.courses.map((c) => c.id)).size).toBe(expected.length);
    expect(restored!.snapshots.at(-1)?.courseIds).toEqual(restored!.courses.map((c) => c.id));
  });
});
