// 긴 붙여넣기도 화면을 멈추지 않도록 Web Worker에서 분석한다. 결과는 같은 확장앱 페이지로만 돌려준다.
import { ParseLimitError, parseTranscript } from './parseTranscript';
import type { LetterGrade } from '../types';

self.onmessage = (e: MessageEvent<{ text: string; aliases: Record<string, LetterGrade> }>) => {
  try {
    self.postMessage({ ok: true, result: parseTranscript(String(e.data.text), e.data.aliases) });
  } catch (err) {
    self.postMessage({ ok: false, limit: err instanceof ParseLimitError, message: (err as Error).message });
  }
};
