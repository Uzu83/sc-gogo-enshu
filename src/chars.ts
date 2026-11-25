/** IPA の「字」は改行を除く1文字。全角・半角ともに1字。 */
export function countChars(text: string): number {
  return [...text.replaceAll(/\r?\n/g, "")].length;
}

export function remainingChars(text: string, maxChars: number): number {
  return maxChars - countChars(text);
}
