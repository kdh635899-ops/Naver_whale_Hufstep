// 종정시 정보 저장 성공 모달 (Figma 202:286, 어둡게 202:285 = #000 50%).
// 저장이 끝나면 띄우고, 'HUFStep 시작하기'를 누르면 학사 현황으로 넘어간다.
import { useEffect, useId, useRef } from 'react';
import checkIcon from '../../icons/check-circle.svg';
import arrowIcon from '../../icons/arrow-right.svg';

export function SuccessModal({ onStart }: { onStart: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const startRef = useRef(onStart);
  startRef.current = onStart;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    document.body.classList.add('sheet-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); startRef.current(); return; }
      if (e.key === 'Tab') e.preventDefault(); // 버튼이 하나뿐이라 포커스는 그대로 둔다
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('sheet-open');
    };
  }, []);
  return (
    <div className="wm-layer">
      <div className="wm-backdrop" onClick={onStart} aria-hidden="true" />
      <div className="wm sm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <img className="wm-icon" src={checkIcon} alt="" />
        <h2 id={titleId} className="wm-title">성공적으로 입력되었습니다.</h2>
        <p className="wm-sub">입력하신 정보를 바탕으로 제공되는<br />맞춤형 HUFStep 서비스를 이용해보세요!</p>
        <button type="button" className="sm-go" onClick={onStart}>
          <span>HUFStep 시작하기</span><img src={arrowIcon} alt="" />
        </button>
      </div>
    </div>
  );
}
