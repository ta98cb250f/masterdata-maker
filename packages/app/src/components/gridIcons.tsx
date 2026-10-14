// グリッドの操作（並べ替え・フィルタ・セル色・メモ）で使うアイコン（線で描いた SVG）
import type { ReactElement } from 'react';

function Svg({ children, size = 18 }: { children: ReactElement | ReactElement[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** フィルタ（じょうご） */
export const FilterIcon = ({ size = 18 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
  </Svg>
);

/** 塗りつぶしの色（バケツ） */
export const FillColorIcon = () => (
  <Svg>
    <path d="m5 11 7-7 7 7-7 7z" />
    <path d="M5 11h14" />
    <path d="M20 15s2 2.5 2 3.5a2 2 0 0 1-4 0c0-1 2-3.5 2-3.5z" />
  </Svg>
);

/** なし（斜線） */
export const NoColorIcon = () => (
  <Svg size={16}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="m5 19 14-14" />
  </Svg>
);
