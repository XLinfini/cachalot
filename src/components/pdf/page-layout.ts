/** Display geometry only. PDF analysis continues using normalized page boxes. */
export interface PageSize {
  number: number;
  width: number;
  height: number;
}
export interface PagePosition extends PageSize {
  top: number;
}
export const PAGE_GAP = 24; // gap-6 in the page stack
export const PAGE_PADDING = 28; // py-7 in the page stack
export const PDF_SCALE = 0.96;

export function pagePositions(sizes: PageSize[], zoom: number): PagePosition[] {
  let top = PAGE_PADDING;
  return sizes.map((size) => {
    const page = {
      number: size.number,
      width: size.width * zoom * PDF_SCALE,
      height: size.height * zoom * PDF_SCALE,
      top,
    };
    top += page.height + PAGE_GAP;
    return page;
  });
}
// A point near the upper part of the viewport follows where reading begins.
// Capping it also keeps short landscape pages selectable via the thumbnails.
export const readingAnchor = (viewportHeight: number) => Math.min(viewportHeight * 0.35, 240);

export function pageAtOffset(pages: PagePosition[], offset: number): PagePosition | undefined {
  if (!pages.length) return undefined;
  let low = 0,
    high = pages.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (pages[middle].top <= offset) low = middle;
    else high = middle - 1;
  }
  return pages[low];
}

export interface ScrollAnchor {
  page: number;
  fraction: number;
}
export function captureScrollAnchor(
  pages: PagePosition[],
  scrollTop: number,
  viewportHeight: number,
): ScrollAnchor | null {
  const offset = scrollTop + readingAnchor(viewportHeight);
  const page = pageAtOffset(pages, offset);
  return page
    ? { page: page.number, fraction: Math.max(0, Math.min(1, (offset - page.top) / page.height)) }
    : null;
}
export function restoreScrollAnchor(
  pages: PagePosition[],
  anchor: ScrollAnchor,
  viewportHeight: number,
): number {
  const page = pages.find((page) => page.number === anchor.page);
  return page
    ? Math.max(0, page.top + page.height * anchor.fraction - readingAnchor(viewportHeight))
    : 0;
}
