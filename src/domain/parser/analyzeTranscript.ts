import type { LetterGrade } from '../types';
import type { ParseResult } from './parseTranscript';

/** 입력이 바뀌면 Worker도 종료한다. 분석은 저장소를 건드리지 않는다. */
export function analyzeTranscript(text: string, aliases: Record<string, LetterGrade>, signal: AbortSignal): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('분석 취소', 'AbortError')); return; }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      reject(new Error('분석 Worker를 시작하지 못했어요. 다시 붙여넣어 주세요.'));
      return;
    }
    const finish = (error?: Error, result?: ParseResult) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException('분석 취소', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('분석이 너무 오래 걸려요. 성적 목록 부분만 붙여넣어 주세요.')), 15_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      if (event.data?.ok && event.data.result) finish(undefined, event.data.result);
      else finish(new Error(event.data?.message ?? '분석 결과를 읽지 못했어요.'));
    };
    worker.onerror = () => finish(new Error('분석 중 Worker 오류가 났어요. 다시 붙여넣어 주세요.'));
    worker.onmessageerror = () => finish(new Error('분석 결과를 읽지 못했어요. 다시 붙여넣어 주세요.'));
    try { worker.postMessage({ text, aliases }); }
    catch { finish(new Error('분석 요청을 보내지 못했어요. 다시 붙여넣어 주세요.')); }
  });
}
