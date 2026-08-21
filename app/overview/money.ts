export function makeMoneyFormatter(currency: string) {
  return (cents: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      cents / 100,
    );
}

export function productHref(title: string) {
  return `/app/products?q=${encodeURIComponent(title)}`;
}
