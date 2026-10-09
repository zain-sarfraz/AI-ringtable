const SUCCESS_PAN = "4242424242424242";
const DECLINE_PAN = "4000000000000002";

export function normalizePan(raw) {
  return String(raw || "").replace(/\D/g, "");
}

export function evaluateDummyCard({ number, exp_month, exp_year, cvc }) {
  const pan = normalizePan(number);
  if (pan.length < 13 || pan.length > 19) {
    return { ok: false, code: "invalid_number", message: "Enter a card number." };
  }

  const month = Number(exp_month);
  const yearRaw = String(exp_year || "").trim();
  const year = yearRaw.length === 2 ? Number(`20${yearRaw}`) : Number(yearRaw);
  if (!month || month < 1 || month > 12 || !year) {
    return { ok: false, code: "invalid_expiry", message: "Enter a valid expiry." };
  }
  const expires = new Date(year, month, 1);
  if (expires <= new Date()) {
    return { ok: false, code: "expired_card", message: "This card is expired." };
  }

  const code = String(cvc || "").replace(/\D/g, "");
  if (code.length < 3 || code.length > 4) {
    return { ok: false, code: "invalid_cvc", message: "Enter the card security code." };
  }

  if (pan === DECLINE_PAN) {
    return { ok: false, code: "card_declined", message: "Your card was declined." };
  }
  if (pan !== SUCCESS_PAN) {
    return {
      ok: false,
      code: "card_declined",
      message: "Test mode only accepts the Stripe test card 4242 4242 4242 4242.",
    };
  }

  return { ok: true, last4: pan.slice(-4), brand: "visa" };
}
