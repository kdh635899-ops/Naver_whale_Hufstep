// 공식 데이터 교체 시 빌드 전에 실행되는 검사 (npm run check:data).
import { describe, expect, it } from 'vitest';
import { catalog, loadList, type Rejected } from '../../src/data';
import { bundleSchema } from '../../src/domain/validation/schemas';
import manifest from '../../public/manifest.json';

describe('배포 데이터 묶음', () => {
  it('모든 JSON이 스키마를 통과 (거절된 항목 없음)', () => {
    expect(catalog.rejected).toEqual([]);
  });
  it('규칙이 참조하는 출처·학과 ID가 실제로 존재', () => {
    const sourceIds = new Set(catalog.sources.map((s) => s.id));
    const deptIds = new Set(catalog.departments.map((d) => d.id));
    for (const b of [...catalog.bundles, ...catalog.demoBundles]) {
      for (const id of b.sourceIds) expect(sourceIds, `${b.id} → ${id}`).toContain(id);
      for (const id of [...b.applicability.primaryDepartmentIds, ...(b.applicability.secondaryDepartmentIds ?? [])]) {
        expect(deptIds, `${b.id} → ${id}`).toContain(id);
      }
    }
  });
  it('공식(verified) 묶음은 데모 출처를 쓰지 않는다', () => {
    for (const b of catalog.bundles.filter((x) => x.status === 'verified')) {
      for (const id of b.sourceIds) expect(catalog.sources.find((s) => s.id === id)!.status).not.toBe('demo');
    }
  });
  it('데모 묶음은 데모 출처만 사용 (공식 확인처럼 보이지 않게)', () => {
    for (const b of catalog.demoBundles) expect(b.sourceIds).toEqual(['src-demo']);
  });
  it('잘못된 묶음은 로딩을 거절하고 정상 묶음만 남긴다', () => {
    const rejected: Rejected[] = [];
    const good = catalog.demoBundles[0];
    const bad = { ...good, id: 'bad', applicability: { ...good.applicability, cohortFrom: 2030, cohortTo: 2020 } };
    const list = loadList('x.json', [good, bad, { ...good }], bundleSchema, rejected);
    expect(list).toEqual([good]);
    expect(rejected).toHaveLength(2); // 범위 오류 + 중복 id
  });
  it('출처 링크는 http/https만', () => {
    for (const s of catalog.sources) if (s.url) expect(s.url).toMatch(/^https?:\/\//);
  });
});

describe('매니페스트 최소 권한', () => {
  it('학교 접근·탭·클립보드 권한을 요구하지 않는다', () => {
    const m = manifest as Record<string, unknown>;
    for (const k of ['permissions', 'host_permissions', 'content_scripts', 'externally_connectable', 'action']) expect(m[k]).toBeUndefined();
    expect(manifest.sidebar_action.default_page).toBe('sidebar.html');
    expect(manifest.content_security_policy.extension_pages).not.toMatch(/unsafe-eval|unsafe-inline|https?:/);
  });
});
