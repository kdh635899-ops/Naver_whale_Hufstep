// 종정시 '?' 도움말 모달 (Figma 179:1572, 사진 2장 ①~②). 뒤는 #000 50%로 어둡게, 아래에서 올라오는 패널.
// 사진 위 빨간 박스·번호·'드래그' 화살표와 글씨는 모두 폭 346px 기준 값을 --u(= 폭/346)로 곱해 쓴다 → 사이드바 폭이 달라져도 사진·글씨가 같이 커지고 줄어 어긋나지 않는다.
import step1 from '../../assets/help/step1.png';
import step2 from '../../assets/help/step2.png';
import arrow1 from '../../assets/help/drag-arrow-1.svg';
import arrow2 from '../../assets/help/drag-arrow-2.svg';
import { Sheet } from '../common';

const W = 346; // Figma 사진 폭(px). 아래 좌표는 모두 이 폭 기준 값을 비율로 바꿔 쓴다.
type Mark = { n: string; left: number; top: number; w: number; tx: number; bw: number; by: number };
type Fig = {
  src: string; alt: string; ratio: [number, number]; box: [number, number]; marks: Mark[]; crop?: boolean;
  drag: { left: number; top: number; w: number; textTop: number; textW: number; arrow: string; arrowH: number };
};

const FIGS: Fig[] = [
  {
    src: step1, alt: '종합정보시스템 성적취득현황 화면: ① 년도/학기별 취득성적 영역을 드래그', ratio: [1698, 926], box: [16.94, 18],
    marks: [
      { n: '①', left: 19.65, top: 113, w: 13.89, tx: 76, bw: 74, by: 10 },
    ],
    drag: { left: 81.21, top: 118, w: 12.72, textTop: 23, textW: 79.55, arrow: arrow1, arrowH: 61.5 }, // Figma 179:1838 (화살표가 짧아졌다)
  },
  {
    src: step2, alt: '같은 화면을 맨 아래까지 내린 모습: ② 이수구분별 취득학점 계 영역까지 드래그', ratio: [360, 195], box: [16.94, 17], crop: true,
    marks: [{ n: '②', left: 19.94, top: 142, w: 14.45, tx: 76.92, bw: 76.92, by: 10 }],
    drag: { left: 80.92, top: 48, w: 13.25, textTop: 38, textW: 76.39, arrow: arrow2, arrowH: 115.5 },
  },
];

const BOX_H = 178; // 빨간 박스 높이(px)
const pct = (px: number, base: number) => `${(px / base) * 100}%`;

function Figure({ f }: { f: Fig }) {
  const h = (W * f.ratio[1]) / f.ratio[0]; // 사진 높이(px, 폭 346 기준)
  return (
    <div className="gd-fig" style={{ aspectRatio: `${f.ratio[0]} / ${f.ratio[1]}` }}>
      {f.crop
        ? <div className="gd-crop"><img src={f.src} alt={f.alt} /></div>
        : <img className="gd-img" src={f.src} alt={f.alt} />}
      <i className="gd-box" aria-hidden="true" style={{ left: `${f.box[0]}%`, top: pct(f.box[1], h), width: `${100 - f.box[0]}%`, height: pct(BOX_H, h) }} />
      {f.marks.map((m) => (
        <span key={m.n} className="gd-mk" aria-hidden="true" style={{ left: `${m.left}%`, top: pct(m.top, h), width: `${m.w}%` }}>
          <i style={{ top: `calc(${m.by} * var(--u))`, width: `${m.bw}%` }} />
          <b style={{ left: `${m.tx}%` }}>{m.n}</b>
        </span>
      ))}
      <span className="gd-drag" aria-hidden="true" style={{ left: `${f.drag.left}%`, top: pct(f.drag.top, h), width: `${f.drag.w}%` }}>
        <img src={f.drag.arrow} alt="" style={{ height: `calc(${f.drag.arrowH} * var(--u))` }} />
        <b style={{ top: `calc(${f.drag.textTop} * var(--u))`, width: `${f.drag.textW}%` }}>드래그</b>
      </span>
    </div>
  );
}

export function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <Sheet variant="howto" title="종정시 정보 붙여넣기 가이드" onClose={onClose}>
      <div className="gd">
        <div className="gd-in">
        {FIGS.map((f) => <Figure key={f.src} f={f} />)}
        <div className="gd-text">
          <p><b>Step 1. </b><br />빨간 박스 안의 영역을 끝까지 드래그하며, 그림 속 ①~②번의 내용들을 모두 선택해주세요.</p>
          <p><b>Step 2. </b><br />선택한 모든 정보를 Ctrl + C로 복사해주세요.</p>
          <p><b>Step 3. </b><br />복사한 정보를 Ctrl + V로 아래 상자에 붙여넣어주세요.</p>
          <p><b>Step4.</b> <br />상자 하단의 글씨가 검정색으로 바뀌었다면, 모든 정보가 정상적으로 입력된 거예요.<br /><br />
            <span className="gd-note">빨간색 글씨가 뜬다면 누락된 정보가 있는 거예요. 저장 버튼 클릭 후 입력한 내용 삭제하고, 종정시에서 다시 정보를 복사해서 넣어주세요.</span></p>
        </div>
        </div>
      </div>
    </Sheet>
  );
}
