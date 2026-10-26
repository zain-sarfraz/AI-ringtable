import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  replaceSpokenDigits,
  canonicalOrderNumber,
  expandOrderNumberCandidates,
  orderNumberDigits,
  orderDateStamp,
} from "./orderNumbers.js";

describe("orderNumbers spoken digit normalization and candidate expansion", () => {
  it("normalizes English compound words to digits", () => {
    assert.equal(canonicalOrderNumber("ORD twenty-six ten twenty-six zero one"), "ORD-261026-01");
    assert.equal(canonicalOrderNumber("twenty six ten twenty six zero two"), "ORD-261026-02");
    assert.equal(canonicalOrderNumber("ORD two six one zero two six zero three"), "ORD-261026-03");
  });

  it("normalizes Urdu/Hindi digit and compound words", () => {
    assert.equal(canonicalOrderNumber("ORD chhabees das chhabees zero ek"), "ORD-261026-01");
    assert.equal(canonicalOrderNumber("do chhe ek zero do chhe sifar do"), "ORD-261026-02");
    assert.equal(canonicalOrderNumber("ORD chhabees das chhabees do"), "ORD-261026-02");
  });

  it("normalizes STT misheard prefixes like audi, audit, all day", () => {
    assert.equal(canonicalOrderNumber("audi 26102601"), "ORD-261026-01");
    assert.equal(canonicalOrderNumber("audit 26102602"), "ORD-261026-02");
    assert.equal(canonicalOrderNumber("all day 26 10 26 03"), "ORD-261026-03");
  });

  it("expands short sequences like '5' or '02' into full candidates", () => {
    const today = orderDateStamp();
    const cand5 = expandOrderNumberCandidates("order number 5");
    assert.ok(cand5.includes(`ORD-${today}-05`));

    const cand02 = expandOrderNumberCandidates("02");
    assert.ok(cand02.includes(`ORD-${today}-02`));
  });

  it("extracts orderNumberDigits correctly", () => {
    assert.equal(orderNumberDigits("chhabees das 02"), "261002");
    assert.equal(orderNumberDigits("order number 5"), "5");
    assert.equal(orderNumberDigits("ORD-261026-01"), "26102601");
  });
});
