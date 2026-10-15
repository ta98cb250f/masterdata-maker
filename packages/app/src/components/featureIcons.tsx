// 検索欄・パネル・ダイアログで使うアイコン（線で描いた SVG）
import type { ReactElement } from 'react';

function Svg({ children, size = 18 }: { children: ReactElement | ReactElement[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const ChevronUpIcon = () => (
  <Svg>
    <path d="m6 15 6-6 6 6" />
  </Svg>
);

export const ChevronDownIcon = () => (
  <Svg>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const MoreIcon = () => (
  <Svg>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Svg>
);

export const SearchIcon = () => (
  <Svg size={16}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const WarningIcon = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

export const ErrorCircleIcon = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </Svg>
);
