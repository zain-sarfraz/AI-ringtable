import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateDistance,
  clampDeliveryRadiusKm,
  haversineDistanceKm,
  isValidLatLng,
  parseCoordinate,
} from "./geocoding.js";

describe("haversineDistanceKm / calculateDistance", () => {
  it("same point returns 0", () => {
    assert.equal(haversineDistanceKm(31.5204, 74.3587, 31.5204, 74.3587), 0);
    assert.equal(calculateDistance(40.7128, -74.006, 40.7128, -74.006), 0);
  });

  it("known city-to-city distance is approximately correct (Lahore → Islamabad ~270 km)", () => {
    // Lahore ~31.5204, 74.3587; Islamabad ~33.6844, 73.0479
    const d = calculateDistance(31.5204, 74.3587, 33.6844, 73.0479);
    assert.ok(Number.isFinite(d));
    assert.ok(d > 250 && d < 300, `expected ~270 km, got ${d}`);
  });

  it("result is symmetric", () => {
    const a = calculateDistance(31.52, 74.35, 33.68, 73.04);
    const b = calculateDistance(33.68, 73.04, 31.52, 74.35);
    assert.equal(a, b);
  });

  it("invalid inputs return Infinity", () => {
    assert.equal(haversineDistanceKm("x", 1, 2, 3), Infinity);
  });
});

describe("isValidLatLng / parseCoordinate / clampDeliveryRadiusKm", () => {
  it("validates latitude and longitude ranges", () => {
    assert.equal(isValidLatLng(0, 0), true);
    assert.equal(isValidLatLng(90, 180), true);
    assert.equal(isValidLatLng(-90, -180), true);
    assert.equal(isValidLatLng(91, 0), false);
    assert.equal(isValidLatLng(0, 181), false);
    assert.equal(isValidLatLng(NaN, 0), false);
  });

  it("never treats null / undefined / empty string / NaN coords as 0", () => {
    for (const bad of [null, undefined, "", NaN, "NaN", "abc"]) {
      assert.equal(parseCoordinate(bad), null);
      assert.equal(isValidLatLng(bad, 0), false);
      assert.equal(isValidLatLng(0, bad), false);
    }
    // Classic footgun: Number(null) === 0 — parseCoordinate must not follow that
    assert.notEqual(parseCoordinate(null), 0);
    assert.notEqual(parseCoordinate(""), 0);
  });

  it("clamps delivery radius to 1–20; null/undefined/\"\"/NaN → default 5 (not 1)", () => {
    assert.equal(clampDeliveryRadiusKm(5), 5);
    assert.equal(clampDeliveryRadiusKm(0), 1);
    assert.equal(clampDeliveryRadiusKm(25), 20);
    assert.equal(clampDeliveryRadiusKm(8.5), 8.5);
    assert.equal(clampDeliveryRadiusKm(null), 5);
    assert.equal(clampDeliveryRadiusKm(undefined), 5);
    assert.equal(clampDeliveryRadiusKm(""), 5);
    assert.equal(clampDeliveryRadiusKm(NaN), 5);
    assert.equal(clampDeliveryRadiusKm("NaN"), 5);
  });
});
