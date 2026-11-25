import {
  classifyFaceSimilarity,
  faceDescriptorDistance,
  faceSimilarityScore,
  FaceLoginValidationError,
  parseFaceLoginPayload,
} from "./validation.ts";

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}; expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

function assertValidationError(action: () => unknown, message: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof FaceLoginValidationError) return;
    throw error;
  }
  throw new Error(message);
}

Deno.test("accepts a finite 128-value face descriptor", () => {
  const descriptor = Array(128).fill(0.01);
  const parsed = parseFaceLoginPayload({ descriptor });
  assertEquals(
    parsed.descriptor.length,
    128,
    "the descriptor length should be preserved",
  );
  assertEquals(
    faceDescriptorDistance(descriptor, descriptor),
    0,
    "matching descriptors should have zero distance",
  );
});

Deno.test("classifies login face scores using the requested thresholds", () => {
  assertEquals(faceSimilarityScore(0.3), 85, "85 percent should pass");
  assertEquals(classifyFaceSimilarity(0.3), "match", "scores of 85 and higher should match");
  assertEquals(faceSimilarityScore(0.32), 84, "84 percent should remain partial");
  assertEquals(classifyFaceSimilarity(0.32), "partial_match", "scores from 70 through 84 should ask for a retry");
  assertEquals(faceSimilarityScore(0.6), 70, "70 percent should remain partial");
  assertEquals(classifyFaceSimilarity(0.6), "partial_match", "70 percent should not sign in");
  assertEquals(faceSimilarityScore(0.62), 69, "scores below 70 should fail");
  assertEquals(classifyFaceSimilarity(0.62), "no_match", "scores below 70 should be rejected");
});

Deno.test("rejects malformed or out-of-range face descriptors", () => {
  for (
    const payload of [
      null,
      {},
      { descriptor: Array(127).fill(0) },
      { descriptor: [...Array(127).fill(0), Infinity] },
      { descriptor: [...Array(127).fill(0), 1.1] },
      { descriptor: Array(128).fill(0), liveness_passed: true },
    ]
  ) {
    assertValidationError(
      () => parseFaceLoginPayload(payload),
      "invalid descriptors and unsupported fields should be rejected",
    );
  }
});

Deno.test("rejects malformed stored face descriptors", () => {
  const descriptor = Array(128).fill(0);
  try {
    faceDescriptorDistance(descriptor, Array(127).fill(0));
  } catch (error) {
    if (
      error instanceof Error &&
      /stored face descriptor is invalid/.test(error.message)
    ) return;
    throw error;
  }
  throw new Error("malformed stored descriptors should be rejected");
});
