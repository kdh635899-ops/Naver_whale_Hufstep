// 학사 현황에서 항목을 직접 더할 때 아래에서 올라오는 작은 입력 창 (Figma 233:893 · 234:285 · 234:319).
// 흰 바탕에 오른쪽 위 X, 입력칸, 남색 버튼. 뒤는 #000 50%로 어둡게 한다.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { BoxKind } from '../../domain/types';

/** 졸업 요건 구분 칩 (Figma 234:358): 한 줄에 셋씩 */
export const BOX_KINDS: { kind: BoxKind; label: string }[] = [
  { kind: 'common', label: '공통' }, { kind: 'primary', label: '전공' }, { kind: 'double', label: '이중전공' },
  { kind: 'minor', label: '부전공' }, { kind: 'advanced', label: '전공심화' }, { kind: 'single', label: '단일전공' },
];

function Frame({ title, onClose, children, onSubmit }: { title: string; onClose: () => void; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    document.body.classList.add('sheet-open');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      prev?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <div className="pm-layer">
      <div className="pm-back" onClick={onClose} aria-hidden="true" />
      <form className="pm" role="dialog" aria-modal="true" aria-label={title} onSubmit={onSubmit} noValidate>
        <button type="button" className="pm-x" onClick={onClose} aria-label="닫기"><i className="icon ic-sheet-x" aria-hidden="true" /></button>
        {children}
      </form>
    </div>
  );
}

export interface PromptField { label: string; required: boolean; max: number }

/** 이름(과 점수 요건)을 받아 더하는 창. onSubmit이 문장을 돌려주면 그 문장을 빨간 글씨로 보여 주고 열어 둔다. */
export function FieldPrompt({ title, fields, submitLabel, onSubmit, onClose }: {
  title: string; fields: PromptField[]; submitLabel: string;
  onSubmit: (values: string[]) => string | null | Promise<string | null>; onClose: () => void;
}) {
  const [vals, setVals] = useState(() => fields.map(() => ''));
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const out = vals.map((v) => v.trim().replace(/\s+/g, ' '));
    const miss = fields.findIndex((f, i) => f.required && !out[i]);
    if (miss >= 0) { setError(`${fields[miss].label}을 입력해 주세요.`); return; }
    const msg = await onSubmit(out);
    if (msg) setError(msg);
  }
  return (
    <Frame title={title} onClose={onClose} onSubmit={(e) => void submit(e)}>
      {fields.map((f, i) => (
        <div key={f.label} className="pm-field">
          <label htmlFor={`pm-${i}`}>{f.label}</label>
          <input id={`pm-${i}`} type="text" value={vals[i]} maxLength={f.max} autoFocus={i === 0} autoComplete="off" spellCheck={false}
            onChange={(e) => { setError(''); setVals((v) => v.map((x, j) => (j === i ? e.target.value : x))); }} />
        </div>
      ))}
      {error && <p className="pm-err" role="alert">{error}</p>}
      <button type="submit" className="pm-go">{submitLabel}</button>
    </Frame>
  );
}

/** 새 졸업 요건 구분(박스)을 만드는 창 */
export function BoxPrompt({ onSubmit, onClose }: { onSubmit: (kind: BoxKind) => void; onClose: () => void }) {
  const [kind, setKind] = useState<BoxKind | null>(null);
  const [error, setError] = useState('');
  return (
    <Frame title="졸업 요건 구분" onClose={onClose} onSubmit={(e) => { e.preventDefault(); if (kind) onSubmit(kind); else setError('구분을 골라 주세요.'); }}>
      <div className="pm-field">
        <p className="pm-lab" id="pm-kind">졸업 요건 구분</p>
        <div className="pm-chips" role="radiogroup" aria-labelledby="pm-kind">
          {BOX_KINDS.map((k) => (
            <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} className="pm-chip"
              onClick={() => { setError(''); setKind(k.kind); }}>{k.label}</button>
          ))}
        </div>
      </div>
      {error && <p className="pm-err" role="alert">{error}</p>}
      <button type="submit" className="pm-go">해당 구분 추가하기</button>
    </Frame>
  );
}
