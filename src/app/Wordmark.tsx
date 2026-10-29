// 'HUFStep' 로고 글씨 (Figma 169:763, Y Spotlight). 글꼴이 아니라 그림(SVG)이라서 PC에 어떤 글꼴이 있든 똑같이 보인다.
// 색은 둘러싼 글자색(currentColor)을 따른다: 헤더는 흰색, 스플래시·시작 화면은 남색.
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`.trim()} role="img" aria-label="HUFStep" />;
}
