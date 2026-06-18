export function assertMinorUnitAmount(value: unknown, fieldName = "amount"): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer minor-unit amount`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a safe integer`);
  }
  if (value < 0) {
    throw new Error(`${fieldName} must be zero or greater`);
  }
  return value;
}

export function assertMaxAmount(amount: number, maxAmountMinor: number): number {
  assertMinorUnitAmount(amount, "amount");
  assertMinorUnitAmount(maxAmountMinor, "maxAmountMinor");
  if (amount > maxAmountMinor) {
    throw new Error(`amount ${amount} exceeds configured maximum ${maxAmountMinor}`);
  }
  return amount;
}

export function validateRequestedAmount(amount: unknown, maxAmountMinor: number): number {
  return assertMaxAmount(assertMinorUnitAmount(amount, "requested_amount"), maxAmountMinor);
}
