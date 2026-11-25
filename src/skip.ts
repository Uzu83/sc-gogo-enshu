/** 「本文へ」は経路用のハッシュを変えない。 */
export function isContentSkipHash(hash: string): boolean {
  return hash === "#main";
}

/** すでに本文があるとき、スキップ用ハッシュでは描き直さない。 */
export function keepPageOnContentSkip(hash: string, hasContent: boolean): boolean {
  return isContentSkipHash(hash) && hasContent;
}

/** クリックではハッシュを変えず、本文へフォーカスを移す。 */
export function onSkipClick(event: Event, content: HTMLElement): void {
  event.preventDefault();
  content.focus();
}
