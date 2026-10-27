// 종정시 붙여넣기 경고 모달 (Figma 170:1191, 어둡게 170:1144 = #000 50%).
// 붙여넣은 내용이 분석 규격에 맞지 않거나 빠진 부분이 있을 때 확실히 보이게 띄운다.
// '입력된 내용 삭제'는 입력창에 붙여넣은 내용을 비워서 종정시에서 다시 복사해 붙여넣게 한다.
import { useEffect, useId, useRef } from 'react';
import warningIcon from '../../icons/circle-warning.svg';

export function WarningModal({ title, onDelete, onClose }: { title: [string, string]; onDelete: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    document.body.classList.add('sheet-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key === 'Tab') e.preventDefault(); // 버튼이 하나뿐이라 포커스는 그대로 둔다 (뒤 화면으로 새지 않게)
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
      prev?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <div className="wm-layer">
      <div className="wm-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="wm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <img className="wm-icon" src={warningIcon} alt="" />
        <h2 id={titleId} className="wm-title">{title[0]}<br />{title[1]}</h2>
        <p className="wm-sub">현재 입력된 내용을 삭제하고<br />종정시 정보를 다시 불러오세요.</p>
        <button type="button" className="wm-del" onClick={onDelete}>입력된 내용 삭제</button>
      </div>
    </div>
  );
}
