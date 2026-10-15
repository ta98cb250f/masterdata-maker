// @tanstack/virtual-core の Virtualizer を React から使う（C-1: 仮想スクロールだけをライブラリに任せる）。
// 使うのは「どの範囲を描くか」だけで、座標の計算は layout.ts で行う（NFR-21）
import type { VirtualItem } from '@tanstack/virtual-core';
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core';
import type { RefObject } from 'react';
import { useLayoutEffect, useReducer, useState } from 'react';
import { flushSync } from 'react-dom';

export interface VirtualOptions {
  scrollerRef: RefObject<HTMLDivElement | null>;
  horizontal: boolean;
  count: number;
  estimateSize: (index: number) => number;
  /** 大きさが変わったら別の関数を渡す（測り直しの合図になる） */
  getItemKey: (index: number) => number | string;
  /** 列ヘッダー・行番号の列の大きさ */
  paddingStart: number;
  overscan: number;
  initialOffset: number;
}

export function useVirtual(options: VirtualOptions): Virtualizer<HTMLDivElement, Element> {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const resolved = {
    count: options.count,
    horizontal: options.horizontal,
    estimateSize: options.estimateSize,
    getItemKey: options.getItemKey,
    paddingStart: options.paddingStart,
    overscan: options.overscan,
    initialOffset: options.initialOffset,
    getScrollElement: () => options.scrollerRef.current,
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    onChange: (_instance: Virtualizer<HTMLDivElement, Element>, sync: boolean) => {
      // スクロール中は同期して描き直す（描画が遅れて白い部分が見えないように）
      if (sync) flushSync(rerender);
      else rerender();
    },
  };
  const [virtualizer] = useState(() => new Virtualizer<HTMLDivElement, Element>(resolved));
  virtualizer.setOptions(resolved);
  useLayoutEffect(() => virtualizer._didMount(), [virtualizer]);
  useLayoutEffect(() => {
    virtualizer._willUpdate();
  });
  return virtualizer;
}

/** 描く範囲の項目の番号（start 以上） */
export function visibleIndexes(items: readonly VirtualItem[], start = 0): number[] {
  const result: number[] = [];
  for (const item of items) if (item.index >= start) result.push(item.index);
  return result;
}
