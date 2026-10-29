// 화면 표시(View) 부품: 수정 화면에서는 브라우저 대신 아래쪽 목록을 직접 그린다.
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

type Props = SelectHTMLAttributes<HTMLSelectElement> & { downward: boolean; compact?: boolean };
type Option = { value: string; label: ReactNode; group?: string };

function collectOptions(children: ReactNode, group?: string): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; label?: string }>(child)) return [];
    if (child.type === 'option') return [{ value: String(child.props.value ?? ''), label: child.props.children, group }];
    return collectOptions(child.props.children, child.type === 'optgroup' ? child.props.label : group);
  });
}

export function ProfileSelect({ downward, compact = false, children, value, onChange, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const select = useRef<HTMLSelectElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 240 });
  const id = useId();
  const options = collectOptions(children);
  const selected = options.findIndex((o) => o.value === String(value));

  function reveal(index = Math.max(0, selected)) {
    if (!open && button.current) {
      // 입력칸이 화면 끝에 붙어 있으면 기존 시트를 조금 스크롤해 목록 공간을 확보한다.
      // 새 여백을 만들거나 다른 입력칸을 밀어내지는 않는다.
      const rect = button.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const scroller = button.current.closest('.sheet-body');
      if (scroller && bottom - rect.bottom < 160) scroller.scrollTop += 160 - (bottom - rect.bottom);
    }
    setActive(index);
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    // 목록은 화면 위에 겹쳐 띄우고 입력칸의 위치만 따라간다. 폼의 높이는 바뀌지 않는다.
    const update = (event?: Event) => {
      // 목록 내부 스크롤은 위치 재계산에서 제외한다.
      // 그렇지 않으면 아래 효과가 현재 선택 항목으로 되돌려 맨 위 항목을 가린다.
      if (event?.target instanceof Node && list.current?.contains(event.target)) return;
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const bottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
      const next = { top: rect.bottom + 6, left: rect.left, width: rect.width,
        maxHeight: Math.max(0, Math.min(compact ? 180 : 240, bottom - rect.bottom - 14)) };
      setPosition((previous) => previous.top === next.top && previous.left === next.left
        && previous.width === next.width && previous.maxHeight === next.maxHeight ? previous : next);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [open, compact]);

  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const option = document.getElementById(`${id}-${active}`);
    if (!option) return;
    // 키보드 이동은 목록 내부만 스크롤한다. 시트 전체를 움직이지 않는다.
    const panel = list.current;
    const item = option.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const visibleTop = bounds.top + panel.clientTop;
    const visibleBottom = visibleTop + panel.clientHeight;
    if (item.top < visibleTop) panel.scrollTop -= visibleTop - item.top;
    else if (item.bottom > visibleBottom) panel.scrollTop += item.bottom - visibleBottom;
  }, [open, active, id, position]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function choose(index: number) {
    // 기존 select의 change 이벤트를 사용해 학과 초기화·입학유형 검증을 그대로 유지한다.
    if (select.current) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select.current, options[index].value);
      select.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
    button.current?.focus();
  }

  if (!downward) return <select {...props} value={value} onChange={onChange}>{children}</select>;

  return (
    <span className={`profile-select${compact ? ' compact' : ''}`} onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
    }}>
      <select ref={select} hidden aria-hidden="true" tabIndex={-1} value={value} onChange={onChange}>{children}</select>
      <button ref={button} type="button" className="profile-select-trigger" role="combobox"
        aria-label={props['aria-label']} aria-expanded={open} aria-controls={id} aria-haspopup="listbox"
        aria-describedby={props['aria-describedby']}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => open ? setOpen(false) : reveal()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1
              : Math.max(0, Math.min(options.length - 1, (open ? active : Math.max(0, selected)) + (e.key === 'ArrowDown' ? 1 : -1)));
            reveal(next);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (open) choose(active); else reveal();
          } else if (e.key.length === 1) {
            const next = options.findIndex((o, i) => i > active && String(o.label).startsWith(e.key));
            const fallback = options.findIndex((o) => String(o.label).startsWith(e.key));
            if (next >= 0 || fallback >= 0) { e.preventDefault(); reveal(next >= 0 ? next : fallback); }
          }
        }}>
        {options[selected]?.label ?? options[0]?.label}
      </button>
      {open && createPortal(<span ref={list} style={position} className={`profile-select-list${compact ? ' compact' : ''}`} id={id} role="listbox" aria-label={props['aria-label']}>
        {options.map((option, index) => <span key={option.value} className="profile-select-item">
          {option.group && options[index - 1]?.group !== option.group && <span className="profile-select-group" role="presentation">{option.group}</span>}
          <span id={`${id}-${index}`} role="option" aria-selected={index === selected}
            className={index === active ? 'active' : ''}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); choose(index); }}>{option.label}</span>
        </span>)}
      </span>, button.current?.closest('[role="dialog"]') ?? document.body)}
    </span>
  );
}
