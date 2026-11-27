import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  measureDeliveryCoverage,
  pickNearestInRadius,
  DELIVERY_UNAVAILABLE_MESSAGE,
} from "./phoneOrderService.js";

function branch(partial) {
  return {
    is_active: true,
    is_accepting_orders: true,
    allows_delivery: true,
    latitude: 0,
    longitude: 0,
    service_radius_km: 5,
    current_load: 0,
    ...partial,
  };
}

describe("measureDeliveryCoverage", () => {
  it("treats distance == radius as eligible (boundary inclusive)", () => {
    // ~5.00 km east of (0,0) ≈ 5/111.32 degrees longitude
    const lng = 5 / 111.32;
    const loc = branch({ latitude: 0, longitude: 0, service_radius_km: 5 });
    const measured = measureDeliveryCoverage(loc, 0, lng);
    assert.ok(measured);
    assert.ok(measured.distance <= 5.05);
    assert.equal(measured.inRadius, measured.distance <= measured.radius);
  });

  it("excludes branches without coordinates without throwing", () => {
    const loc = branch({ latitude: null, longitude: null, id: "missing-geo" });
    assert.equal(measureDeliveryCoverage(loc, 0, 0), null);
  });
});

describe("pickNearestInRadius — radius assignment scenario", () => {
  /**
   * Customer is 7 KM from Branch A (radius 5), 4 KM from Branch B (radius 8),
   * and 9 KM from Branch C (radius 6) → expect Branch B.
   */
  it("assigns nearest in-radius branch (A out, B in, C out) → Branch B", () => {
    // Place branches along the equator so 1° lon ≈ 111.32 km
    const kmToLng = (km) => km / 111.32;
    const customerLat = 0;
    const customerLng = 0;

    const A = branch({
      id: "A",
      name: "Branch A",
      latitude: 0,
      longitude: kmToLng(7),
      service_radius_km: 5,
    });
    const B = branch({
      id: "B",
      name: "Branch B",
      latitude: 0,
      longitude: kmToLng(4),
      service_radius_km: 8,
    });
    const C = branch({
      id: "C",
      name: "Branch C",
      latitude: 0,
      longitude: kmToLng(9),
      service_radius_km: 6,
    });

    const a = measureDeliveryCoverage(A, customerLat, customerLng);
    const b = measureDeliveryCoverage(B, customerLat, customerLng);
    const c = measureDeliveryCoverage(C, customerLat, customerLng);

    assert.ok(a.distance > 6.5 && a.distance < 7.5);
    assert.equal(a.inRadius, false);
    assert.ok(b.distance > 3.5 && b.distance < 4.5);
    assert.equal(b.inRadius, true);
    assert.ok(c.distance > 8.5 && c.distance < 9.5);
    assert.equal(c.inRadius, false);

    const picked = pickNearestInRadius([A, B, C], customerLat, customerLng);
    assert.ok(picked);
    assert.equal(picked.branch.id, "B");
    assert.ok(picked.distance > 3.5 && picked.distance < 4.5);
  });

  it("on equal distance prefers lower current_load, else first deterministically", () => {
    const kmToLng = (km) => km / 111.32;
    const left = branch({
      id: "left",
      latitude: 0,
      longitude: -kmToLng(3),
      service_radius_km: 10,
      current_load: 5,
    });
    const right = branch({
      id: "right",
      latitude: 0,
      longitude: kmToLng(3),
      service_radius_km: 10,
      current_load: 1,
    });

    const picked = pickNearestInRadius([left, right], 0, 0);
    assert.equal(picked.branch.id, "right");

    const leftFirst = branch({ ...left, current_load: 2, id: "first" });
    const rightSecond = branch({ ...right, current_load: 2, id: "second" });
    const tied = pickNearestInRadius([leftFirst, rightSecond], 0, 0);
    assert.equal(tied.branch.id, "first");
  });

  it("returns null when no branch covers the customer", () => {
    const far = branch({
      id: "far",
      latitude: 0,
      longitude: 1,
      service_radius_km: 5,
    });
    assert.equal(pickNearestInRadius([far], 0, 0), null);
    assert.match(DELIVERY_UNAVAILABLE_MESSAGE, /Delivery is not available/i);
  });
});
