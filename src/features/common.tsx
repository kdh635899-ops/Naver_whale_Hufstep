// 여러 화면이 함께 쓰는 작은 UI 부품과 표시용 라벨.
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { CONSENT_VERSION } from '../domain/state';
import type { CampusId, CourseStatus, CreditArea, EntryType, ProgramType } from '../domain/types';
import { useStore } from '../app/store';

export const AREA_LABEL: Record<CreditArea, string> = {
  primary: '주전공', double: '이중전공', second: '2전공', minor: '부전공', practicalLanguage: '실용외국어',
  liberalArts: '교양', teaching: '교직', freeChoice: '자유선택', foundation: '기초', unknown: '미분류',
};
export const STATUS_LABEL: Record<CourseStatus, string> = {
  planned: '수강 예정', inProgress: '수강 중', completed: '이수 완료', notEarned: '미이수',
};
export const CAMPUS_LABEL: Record<CampusId, string> = { seoul: '서울캠퍼스', global: '글로벌캠퍼스' };
export const ENTRY_LABEL: Record<EntryType, string> = { freshman: '신입학', transferGeneral: '일반편입', transferBachelor: '학사편입' };
export const PROGRAM_LABEL: Record<ProgramType, string> = { single: '단일전공', double: '이중전공', minor: '부전공', intensive: '전공심화' };

/** 진행 막대: 최대 100%, 숫자는 실제 값 */
export function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * 화면 하단에서 올라오는 패널(모달). 열리면 패널로 포커스 이동, Esc·닫기·배경 클릭으로 닫힘,
 * 배경 조작 차단(포커스 가두기), 닫히면 원래 위치로 포커스를 돌려준다.
 */
export function Sheet({ title, onClose, children, footer, variant, className }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode;
  /** 'fg' = Figma 시간표 시트, 'howto' = ? 도움말 (둘 다 남색 머리줄, 화면 전체를 #000 50%로 어둡게) */
  variant?: 'fg' | 'howto';
  /** 시트마다 다른 모양(머리줄 높이 등)을 위한 추가 클래스 */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    document.body.classList.add('sheet-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled'));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      prev?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <div className={`sheet-layer${variant ? ` ${variant}` : ''}${className ? ` ${className}` : ''}`}>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            {variant ? <i className="icon ic-sheet-x" aria-hidden="true" /> : '✕'}
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** 한 번만 묻는 삭제 확인 (모달 대신 그 자리에서) */
export function ConfirmButton({ label, confirmText, onConfirm, className = 'btn danger' }: {
  label: string; confirmText: string; onConfirm: () => void | Promise<unknown>; className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className={className} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="confirm" role="group" aria-label={label}>
      <p>{confirmText}</p>
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => setAsking(false)}>취소</button>
        <button type="button" className="btn danger" autoFocus onClick={async () => { await onConfirm(); setAsking(false); }}>{label}</button>
      </div>
    </div>
  );
}

/** 학업정보(성적·과목·평가) 처리 동의. 동의 전에는 children 대신 안내를 보여준다. */
export function ConsentGate({ children }: { children: ReactNode }) {
  const { state, save, now } = useStore();
  const [checked, setChecked] = useState(false);
  if (state.consent.academicData) return <>{children}</>;
  return (
    <section className="card consent" aria-labelledby="consent-title">
      <h3 id="consent-title">학업정보 처리 안내</h3>
      <PrivacySummary />
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        위 내용을 확인했고, 학업정보를 이 브라우저에 저장하는 데 동의해요.
      </label>
      <button type="button" className="btn primary" disabled={!checked}
        onClick={() => save((s) => ({ ...s, consent: { ...s.consent, academicData: { version: CONSENT_VERSION, at: now.toISOString() } } }))}>
        동의하고 계속
      </button>
      <p className="muted small">동의하지 않아도 졸업요건 안내와 가상 데이터 둘러보기는 할 수 있어요.</p>
    </section>
  );
}

export function PrivacySummary() {
  return (
    <ul className="plain small">
      <li><b>목적</b> 이수학점·졸업요건 확인, 평점 계산, 시간표 관리</li>
      <li><b>항목</b> 직접 붙여넣거나 입력한 과목·학점·성적, 시험 날짜·메모, 입력한 이름(닉네임) (전체 학번·연락처·비밀번호는 받지 않아요)</li>
      <li><b>저장</b> 이 PC의 이 브라우저 프로필 안(IndexedDB)에만 저장돼요. 다른 기기와 동기화되지 않아요.</li>
      <li><b>전송</b> 서버·AI·분석 도구로 보내지 않아요. 붙여넣은 원문은 분석 후 저장하지 않아요.</li>
      <li><b>보관·삭제</b> 종정시 입력의 ‘초기화’로 가져온 성적 정보를 지울 수 있고, 브라우저에서 이 확장앱의 데이터를 지우면 모두 사라져요.</li>
      <li><b>한계</b> 저장 데이터는 암호화되지 않아요. 같은 PC·브라우저 프로필을 쓰는 사람은 볼 수 있어요.</li>
      <li><b>거부 시</b> 성적 분석·과목 관리·시간표 저장을 쓸 수 없어요.</li>
    </ul>
  );
}

/** 공개 출처 링크: http/https만 링크로 만든다 */
export function SafeLink({ href, children }: { href?: string; children: ReactNode }) {
  if (!href || !/^https?:\/\//.test(href)) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

/** Figma 확인 창 (화면 가운데 카드, 뒤는 #000 50%): 취소 + 시간표 추가/삭제. 삭제는 빨간 버튼이고 기본 포커스가 '취소'에 있다 */
export function Confirm({ title, sub, yes, no, danger, onYes, onNo }: {
  title: string; sub?: string; yes: string; no: string; danger?: boolean; onYes: () => void; onNo: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    document.body.classList.add('sheet-open');
    return () => { document.body.classList.remove('sheet-open'); prev?.focus?.({ preventScroll: true }); };
  }, []);
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>('button')];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="wm-layer">
      <div className="wm-backdrop" onClick={onNo} aria-hidden="true" />
      <div className="cm" role="alertdialog" aria-modal="true" aria-labelledby={id} ref={ref} onKeyDown={trap}>
        <div className="cm-txt">
          <p id={id} className="cm-title">{title}</p>
          {sub && <p className="cm-sub">{sub}</p>}
        </div>
        <div className="cm-acts">
          <button type="button" className="cm-no" autoFocus={danger} onClick={onNo}>{no}</button>
          <button type="button" className={`cm-yes${danger ? ' danger' : ''}`} autoFocus={!danger} onClick={onYes}>{yes}</button>
        </div>
      </div>
    </div>
  );
}
