// Card spending limits are independent of the small-payment verification threshold.
export const DEFAULT_CARD_LIMIT=500000000; // ¥5,000,000, integer cents
export const MAX_CARD_LIMIT=1000000000; // ¥10,000,000
export const MAX_TRANSFER_AMOUNT=MAX_CARD_LIMIT;
export const LEGACY_CARD_LIMIT=100000;
