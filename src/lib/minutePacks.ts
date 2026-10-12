/** Keep in sync with backend/src/billing/minutePacks.js */

export type MinutePackId = "300" | "500" | "1000" | "2000";

export type MinutePack = {
  id: MinutePackId;
  minutes: number;
  amountCents: number;
  label: string;
  priceLabel: string;
};

export const MINUTE_PACKS: MinutePack[] = [
  { id: "300", minutes: 300, amountCents: 6000, label: "300 minutes", priceLabel: "$60" },
  { id: "500", minutes: 500, amountCents: 10000, label: "500 minutes", priceLabel: "$100" },
  { id: "1000", minutes: 1000, amountCents: 17000, label: "1,000 minutes", priceLabel: "$170" },
  { id: "2000", minutes: 2000, amountCents: 30000, label: "2,000 minutes", priceLabel: "$300" },
];

export const PLAN_INCLUDED_MINUTES: Record<string, number> = {
  starter: 1000,
  growth: 2500,
  pilot: 2500,
};

export type MinutesBalance = {
  plan: string | null;
  included_minutes: number;
  purchased_minutes: number;
  used_minutes: number;
  remaining_minutes: number;
  allowance_minutes: number;
  period_start: string;
  period_end: string;
  period_source?: string;
  packs?: MinutePack[];
};
