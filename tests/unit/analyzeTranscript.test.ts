import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeTranscript } from '../../src/domain/parser/analyzeTranscript';
import { parseTranscript } from '../../src/domain/parser/parseTranscript';
import { TRANSCRIPT_FIXTURE } from '../fixtures';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
}

beforeEach(() => {
  vi.useFakeTimers();
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Worker 수명과 실패 처리', () => {
  it('정상 결과를 반환하고 Worker와 타이머를 정리한다', async () => {
    const result = parseTranscript(TRANSCRIPT_FIXTURE);
    const promise = analyzeTranscript(TRANSCRIPT_FIXTURE, {}, new AbortController().signal);
    const worker = TestWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith({ text: TRANSCRIPT_FIXTURE, aliases: {} });
    worker.onmessage!({ data: { ok: true, result } });
    await expect(promise).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('입력 변경으로 취소하면 늦은 결과를 채택하지 않는다', async () => {
    const controller = new AbortController();
    const promise = analyzeTranscript('합성 입력', {}, controller.signal);
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    TestWorker.instances[0].onmessage!({ data: { ok: true, result: parseTranscript(TRANSCRIPT_FIXTURE) } });
    await rejected;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('15초 동안 응답이 없으면 오류로 종료한다', async () => {
    const promise = analyzeTranscript('합성 입력', {}, new AbortController().signal);
    const rejected = expect(promise).rejects.toThrow('너무 오래');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['onerror', 'onmessageerror'] as const)('%s를 화면에서 표시할 오류로 전달한다', async (event) => {
    const promise = analyzeTranscript('합성 입력', {}, new AbortController().signal);
    TestWorker.instances[0][event]!();
    await expect(promise).rejects.toThrow();
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('파서 실패를 그대로 전달한다', async () => {
    const promise = analyzeTranscript('합성 입력', {}, new AbortController().signal);
    TestWorker.instances[0].onmessage!({ data: { ok: false, message: '입력 크기 초과' } });
    await expect(promise).rejects.toThrow('입력 크기 초과');
  });
  it('Worker 시작 또는 메시지 전송 실패를 성공으로 바꾸지 않는다', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('시작 실패'); } });
    await expect(analyzeTranscript('합성 입력', {}, new AbortController().signal)).rejects.toThrow('시작하지 못했어요');
    vi.stubGlobal('Worker', class extends TestWorker { postMessage = vi.fn(() => { throw new Error('전송 실패'); }); });
    await expect(analyzeTranscript('합성 입력', {}, new AbortController().signal)).rejects.toThrow('보내지 못했어요');
    expect(vi.getTimerCount()).toBe(0);
  });
});
