import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeGpa } from '../../src/domain/gpa/gpa';
import { applyMerge, planMerge } from '../../src/domain/merge/mergeImport';
import { parseTranscript, validateTranscript } from '../../src/domain/parser/parseTranscript';
import { emptyState } from '../../src/domain/state';
import { clearEverything, loadState, saveState } from '../../src/storage/repository';
import { LONG_ABROAD_NAME, TEAM_VARIANT_TRANSCRIPT, WORKSHOP_NAME } from '../fixtures/importTranscript';

beforeEach(async () => { await clearEverything(); });

describe('팀원 성적표 표기와 복사 형식 재현 (합성 자료)', () => {
  it.each([TEAM_VARIANT_TRANSCRIPT, TEAM_VARIANT_TRANSCRIPT.replaceAll('\n', '\r\n')])('PASS·부전·이중·긴 해외 과목을 분석하고 저장 후에도 보존한다', async (input) => {
    const parsed = parseTranscript(input);
    expect(parsed.rows).toHaveLength(8);
    expect(parsed.rows.map((r) => [r.area, r.creditUnits, r.grade])).toEqual([
      ['primary', 100, 'P'], ['liberalArts', 100, 'P'], ['minor', 300, 'B+'],
      ['double', 300, 'A0'], ['double', 300, 'A+'], ['primary', 300, 'P'],
      ['liberalArts', 200, 'P'], ['liberalArts', 300, 'P'],
    ]);
    expect(parsed.rows[4].rawAreaLabel).toBe('이 중');
    expect(parsed.rows[5].name).toBe('외국어로서의 독일어: B1(해외)\n(German as a Foreign Language: B1)');
    expect(parsed.rows[6].name).toBe(WORKSHOP_NAME);
    expect(parsed.rows[7].name).toBe(LONG_ABROAD_NAME);
    expect(parsed.computedTotalUnits).toBe(1900);
    expect(parsed.computedEarnedByArea).toEqual({ primary: 400, double: 600, minor: 300, liberalArts: 600 });
    expect(parsed.warnings.map((w) => w.code)).toEqual(['noCode']);
    expect(validateTranscript(parsed)).toMatchObject({ canSave: true, problems: [] });

    const initial = emptyState();
    const merged = applyMerge(initial, parsed, planMerge(initial, parsed), { link: {}, conflictChoice: {}, removeMissing: false }, new Date('2026-10-29T00:00:00Z'));
    await saveState(merged);
    const restored = await loadState();
    expect(restored).toEqual(merged);
    expect(restored!.courses.map((c) => c.name)).toEqual(parsed.rows.map((r) => r.name));
    expect(computeGpa(restored!.courses)).toMatchObject({ creditUnits: 900, hundredths: 400, complete: true });
  });

  it.each(['이중', '이 중', '이\t중', '이\n중'])('과목 행과 하단 표의 이중전공 표기를 동일하게 해석한다: %j', (label) => {
    const parsed = parseTranscript(`2024 - 1\n가상학과 T1001 합성과목 ${label} 3 A0\n이수구분 ${label} 총계\n3 3`);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ area: 'double', name: '합성과목', grade: 'A0' });
    expect(parsed.reportedEarnedByArea).toEqual({ double: 300 });
    expect(validateTranscript(parsed).canSave).toBe(true);
  });

  it('잘린 과목이나 미상 문구를 줄바꿈된 이름에 흡수하지 않는다', () => {
    const input = TEAM_VARIANT_TRANSCRIPT.replace('가상학과\tT92006', '알 수 없는 합성 문구\n가상학과\tT92006');
    const result = parseTranscript(input);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'unparsedLine', message: expect.stringContaining('알 수 없는 합성 문구') }));
    expect(validateTranscript(result).canSave).toBe(false);
    expect(result.rows[5].name).toBe('외국어로서의 독일어: B1(해외)\n(German as a Foreign Language: B1)');
  });

  it.each([
    TEAM_VARIANT_TRANSCRIPT.replace('PASS\n\t\t', 'XYZ\n\t\t'),
    TEAM_VARIANT_TRANSCRIPT.replace(`가상학과\tT92008\t${LONG_ABROAD_NAME}\t교양\t3\tPASS\n`, ''),
  ])('알 수 없는 등급이나 누락 과목의 합계 불일치는 계속 저장을 차단한다', (input) => {
    expect(validateTranscript(parseTranscript(input)).canSave).toBe(false);
  });

  it('코드 없는 긴 이름의 식별키와 안내도 저장 범위를 넘지 않는다', async () => {
    const name = '가'.repeat(500);
    const parsed = parseTranscript(`2024 - 1\n${name}\t교양\t3\tPASS\n이수구분 교양 총계\n3 3`);
    expect(validateTranscript(parsed).canSave).toBe(true);
    const initial = emptyState();
    const merged = applyMerge(initial, parsed, planMerge(initial, parsed), { link: {}, conflictChoice: {}, removeMissing: false }, new Date('2026-10-29T00:00:00Z'));
    await saveState(merged);
    expect((await loadState())?.courses[0].name).toBe(name);
    const tooLong = parseTranscript(`2024 - 1\n${name}가\t교양\t3\tPASS\n이수구분 교양 총계\n3 3`);
    expect(validateTranscript(tooLong).canSave).toBe(false);
  });
});
