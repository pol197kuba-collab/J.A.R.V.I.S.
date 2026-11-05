// Polish plural for the status list (1 węzeł, 2-4 węzły, 5+ węzłów).
export function pluralPl(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  const t = a % 10;
  const h = a % 100;
  return t >= 2 && t <= 4 && !(h >= 12 && h <= 14) ? few : many;
}
