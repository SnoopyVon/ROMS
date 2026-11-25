export class FaceLoginValidationError extends Error {}

export interface FaceLoginPayload {
  descriptor: number[];
}

export type FaceLoginMatchStatus = "match" | "partial_match" | "no_match";

export function faceSimilarityScore(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new FaceLoginValidationError("The face distance is invalid.");
  }
  return Math.max(0, Math.min(100, Math.round((1 - distance / 2) * 100)));
}

export function classifyFaceSimilarity(distance: number): FaceLoginMatchStatus {
  const score = faceSimilarityScore(distance);
  if (score >= 85) return "match";
  if (score >= 70) return "partial_match";
  return "no_match";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFaceLoginPayload(value: unknown): FaceLoginPayload {
  if (
    !isRecord(value) || Object.keys(value).some((key) => key !== "descriptor")
  ) {
    throw new FaceLoginValidationError("A face descriptor is required.");
  }
  const descriptor = value.descriptor;
  if (
    !Array.isArray(descriptor) ||
    descriptor.length !== 128 ||
    !descriptor.every((item) =>
      typeof item === "number" &&
      Number.isFinite(item) &&
      item >= -1 &&
      item <= 1
    )
  ) {
    throw new FaceLoginValidationError("The face descriptor is invalid.");
  }
  return { descriptor };
}

export function faceDescriptorDistance(
  first: number[],
  second: unknown,
): number {
  if (
    !Array.isArray(second) ||
    first.length !== 128 ||
    !first.every((item) =>
      Number.isFinite(item) &&
      item >= -1 &&
      item <= 1
    ) ||
    second.length !== 128 ||
    !second.every((item) =>
      typeof item === "number" &&
      Number.isFinite(item) &&
      item >= -1 &&
      item <= 1
    )
  ) {
    throw new Error("A stored face descriptor is invalid.");
  }
  let squaredDistance = 0;
  for (let index = 0; index < first.length; index += 1) {
    squaredDistance += (first[index] - second[index]) ** 2;
  }
  return Math.sqrt(squaredDistance);
}
