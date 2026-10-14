// 画面で使うアイコン（線で描いた SVG）。ツールバーの操作は、ここの名前でアイコンを指せる
import type { ComponentType, ReactElement } from 'react';

function Svg({ children, size = 18 }: { children: ReactElement | ReactElement[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const UndoIcon = () => (
  <Svg>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const RedoIcon = () => (
  <Svg>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);

export const SaveIcon = () => (
  <Svg>
    <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M7 3v5h8V3" />
    <rect x="7" y="13" width="10" height="6" />
  </Svg>
);

export const ListIcon = () => (
  <Svg>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </Svg>
);

export const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg size={16}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Svg>
);

export const LockIcon = () => (
  <Svg size={11}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
);

export const KeyIcon = () => (
  <Svg size={11}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9" />
    <path d="m17 6 3 3" />
  </Svg>
);

/** 出力対象外（export: false）の列 */
export const NoExportIcon = () => (
  <Svg size={11}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </Svg>
);

export const CheckIcon = () => (
  <Svg size={14}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
);

export const ErrorIcon = () => (
  <Svg size={14}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6" />
    <path d="M12 16.5v.5" />
  </Svg>
);

/** ツールバーの操作から名前で引くアイコン */
export const ICONS: Readonly<Record<string, ComponentType>> = {
  undo: UndoIcon,
  redo: RedoIcon,
  save: SaveIcon,
  list: ListIcon,
  plus: PlusIcon,
};
