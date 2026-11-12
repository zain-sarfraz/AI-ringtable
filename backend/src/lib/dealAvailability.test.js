import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDealAvailableAt,
  filterAvailableDeals,
  formatDealScheduleLabel,
  restaurantLocalNowLabel,
} from "./dealAvailability.js";

describe("isDealAvailableAt", () => {
  it("allows deals with no weekly schedule", () => {
    assert.equal(isDealAvailableAt({ is_active: true }, new Date("2026-11-11T12:00:00+05:00"), { timeZone: "Asia/Karachi" }), true);
  });

  it("blocks inactive deals", () => {
    assert.equal(isDealAvailableAt({ is_active: false }, new Date(), { timeZone: "Asia/Karachi" }), false);
  });

  it("respects selected weekdays in Asia/Karachi", () => {
    // 2026-11-11 is Wednesday (3) in Karachi
    const wedNoon = new Date("2026-11-11T12:00:00+05:00");
    assert.equal(
      isDealAvailableAt(
        { is_active: true, available_days: [3], available_start_time: "11:00", available_end_time: "15:00" },
        wedNoon,
        { timeZone: "Asia/Karachi" },
      ),
      true,
    );
    assert.equal(
      isDealAvailableAt(
        { is_active: true, available_days: [1, 2], available_start_time: "11:00", available_end_time: "15:00" },
        wedNoon,
        { timeZone: "Asia/Karachi" },
      ),
      false,
    );
  });

  it("respects daily time window", () => {
    const wedMorning = new Date("2026-11-11T10:00:00+05:00");
    assert.equal(
      isDealAvailableAt(
        { is_active: true, available_days: [], available_start_time: "11:00", available_end_time: "15:00" },
        wedMorning,
        { timeZone: "Asia/Karachi" },
      ),
      false,
    );
  });

  it("filters lists", () => {
    const at = new Date("2026-11-11T12:00:00+05:00");
    const out = filterAvailableDeals(
      [
        { id: "a", is_active: true, available_days: [3], available_start_time: "11:00", available_end_time: "15:00" },
        { id: "b", is_active: true, available_days: [1], available_start_time: "11:00", available_end_time: "15:00" },
      ],
      at,
      { timeZone: "Asia/Karachi" },
    );
    assert.deepEqual(out.map((d) => d.id), ["a"]);
  });

  it("formats schedule labels for voice", () => {
    assert.match(formatDealScheduleLabel({ available_days: [], available_start_time: null, available_end_time: null }), /every day/i);
    assert.match(
      formatDealScheduleLabel({ available_days: [3], available_start_time: "11:00", available_end_time: "15:00" }),
      /Wed.*11:00–15:00/,
    );
    assert.match(restaurantLocalNowLabel(new Date("2026-11-11T12:00:00+05:00"), { timeZone: "Asia/Karachi" }), /Wed 12:00/);
  });

  it("parses available_days JSON strings", async () => {
    const { normalizeDealDays } = await import("./dealAvailability.js");
    assert.deepEqual(normalizeDealDays("[3,1]"), [1, 3]);
    assert.equal(normalizeDealDays("[]"), null);
  });
});
