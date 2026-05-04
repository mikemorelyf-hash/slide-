export interface SetPriceCommand {
  routeId: string;
  amount: number;
  currency: string;
}

export function parseSetPriceCommand(text: string): SetPriceCommand | null {
  const [, routeId, amountValue, currencyValue] = text.trim().split(/\s+/);
  if (!routeId || !amountValue) {
    return null;
  }

  const amount = Number(amountValue);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const currency = (currencyValue ?? 'ETB').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return null;
  }

  return {
    routeId,
    amount,
    currency
  };
}
