/** Stub of items/itemgen.js for the UI harness. */
export function priceOf(item) {
  return (item.price && item.price.buy) || 10;
}
export function identify(item) {
  item.identified = true;
}
