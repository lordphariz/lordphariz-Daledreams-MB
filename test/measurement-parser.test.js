import test from "node:test";
import assert from "node:assert/strict";
import { extractMeasurements } from "../public/measurement-parser.js";

test("extracts label-first and number-first measurements", () => {
  assert.deepEqual(extractMeasurements("Bust 36\nwaist: 28\n40 hips\nShoulder - 15"), {
    Chest: "36",
    Waist: "28",
    Hips: "40",
    Shoulder: "15",
  });
});

test("normalizes decimal commas and mixed fractions", () => {
  assert.deepEqual(extractMeasurements("Sleeve 23,5\nWaist 28 1/2"), {
    Sleeve: "23.5",
    Waist: "28.5",
  });
});

test("ignores text without a recognized measurement and value", () => {
  assert.deepEqual(extractMeasurements("Customer: Amara\nFitting on Friday\nChest: unknown"), {});
});
