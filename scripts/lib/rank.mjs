/** Sorteervolgorde van aanbiedingen: goedkoopste per stuk eerst. */
export function compareOffers(a, b) {
  if (a.inStock === false && b.inStock !== false) return 1;
  if (b.inStock === false && a.inStock !== false) return -1;
  if (a.unitPrice != null && b.unitPrice != null && a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
  return (a.price ?? Infinity) - (b.price ?? Infinity);
}
