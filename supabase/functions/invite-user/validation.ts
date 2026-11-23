export const STAFF_ROLES = [
  "Administrator",
  "Manager",
  "Receptionist",
  "Inventory Clerk",
  "Chef / Kitchen Staff",
] as const;

export type StaffRole = typeof STAFF_ROLES[number];
export const INVITABLE_ROLES = STAFF_ROLES.filter(
  (role): role is Exclude<StaffRole, "Administrator"> =>
    role !== "Administrator",
);
export type InvitableRole = typeof INVITABLE_ROLES[number];

export class InviteValidationError extends Error {}

const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_FIELDS = new Set(["email", "full_name", "role"]);
const VERIFICATION_RECORD_FIELDS = new Set([
  "applicant_name",
  "id_type",
  "id_number_masked",
  "ocr_summary",
  "face_match_score",
  "face_match_result",
  "override_used",
  "override_reason",
  "id_image_path",
  "selfie_path",
]);
const OCR_SUMMARY_FIELDS = new Set([
  "full_name",
  "dob",
  "address",
  "ocr_passed",
]);
const EVIDENCE_FOLDER_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export interface InvitePayload {
  email: string;
  full_name: string;
  role: InvitableRole;
}

export interface VerificationRecordPayload {
  applicant_name: string;
  id_type: string;
  id_number_masked: string | null;
  ocr_summary: {
    full_name: string;
    dob: string;
    address: string;
    ocr_passed: boolean;
  };
  face_match_score: number | null;
  face_match_result: "match" | "no_match" | "unable";
  override_used: boolean;
  override_reason: string | null;
  id_image_path: string;
  selfie_path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === "string" &&
    INVITABLE_ROLES.some((role) => role === value);
}

export function normalizeAndValidateEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new InviteValidationError("A valid email address is required.");
  }

  const email = value.trim().toLowerCase();
  const [localPart] = email.split("@");
  if (
    email.length < 3 ||
    email.length > 254 ||
    !localPart ||
    localPart.length > 64 ||
    !EMAIL_PATTERN.test(email)
  ) {
    throw new InviteValidationError("A valid email address is required.");
  }

  return email;
}

export function parseInvitePayload(value: unknown): InvitePayload {
  if (!isRecord(value)) {
    throw new InviteValidationError("A JSON invitation object is required.");
  }

  if (Object.keys(value).some((key) => !INVITE_FIELDS.has(key))) {
    throw new InviteValidationError(
      "The invitation contains unsupported fields.",
    );
  }

  const email = normalizeAndValidateEmail(value.email);
  if (typeof value.full_name !== "string") {
    throw new InviteValidationError("A full name is required.");
  }

  const fullName = value.full_name.trim();
  const fullNameLength = Array.from(fullName).length;
  if (fullNameLength < 1 || fullNameLength > 160) {
    throw new InviteValidationError(
      "Full name must be between 1 and 160 characters.",
    );
  }

  if (!isInvitableRole(value.role)) {
    throw new InviteValidationError("A valid staff role is required.");
  }

  return { email, full_name: fullName, role: value.role };
}

export function parseVerificationRecordPayload(
  value: unknown,
  actorId: string,
): VerificationRecordPayload {
  if (!isRecord(value)) {
    throw new InviteValidationError("A verification record object is required.");
  }
  if (Object.keys(value).some((key) => !VERIFICATION_RECORD_FIELDS.has(key))) {
    throw new InviteValidationError(
      "The verification record contains unsupported fields.",
    );
  }

  const applicantName = typeof value.applicant_name === "string"
    ? value.applicant_name.trim()
    : "";
  const idType = typeof value.id_type === "string" ? value.id_type.trim() : "";
  if (applicantName.length < 1 || applicantName.length > 160) {
    throw new InviteValidationError(
      "Applicant name must be between 1 and 160 characters.",
    );
  }
  if (idType.length < 1 || idType.length > 100) {
    throw new InviteValidationError("A valid ID type is required.");
  }

  let maskedId: string | null;
  if (value.id_number_masked === null) {
    maskedId = null;
  } else if (
    typeof value.id_number_masked === "string" &&
    /^\*{4}[A-Za-z0-9]{1,4}$/.test(value.id_number_masked)
  ) {
    maskedId = value.id_number_masked;
  } else {
    throw new InviteValidationError(
      "Only a masked ID number ending in at most four characters is allowed.",
    );
  }

  if (!isRecord(value.ocr_summary)) {
    throw new InviteValidationError("A safe OCR summary is required.");
  }
  if (
    Object.keys(value.ocr_summary).some((key) => !OCR_SUMMARY_FIELDS.has(key))
  ) {
    throw new InviteValidationError(
      "The OCR summary contains unsupported or sensitive fields.",
    );
  }
  const ocrSummary = value.ocr_summary;
  if (typeof ocrSummary.ocr_passed !== "boolean") {
    throw new InviteValidationError("OCR completion status is required.");
  }
  const ocrText = (key: "full_name" | "dob" | "address", maxLength: number) => {
    const text = ocrSummary[key] === undefined ? "" : ocrSummary[key];
    if (
      typeof text !== "string" ||
      text.length > maxLength ||
      /^data:image\//i.test(text)
    ) {
      throw new InviteValidationError("OCR summary text is invalid.");
    }
    return text.trim();
  };

  const faceMatchResult = value.face_match_result;
  if (
    faceMatchResult !== "match" &&
    faceMatchResult !== "no_match" &&
    faceMatchResult !== "unable"
  ) {
    throw new InviteValidationError("A valid face-match result is required.");
  }
  let faceMatchScore: number | null;
  if (value.face_match_score === null) {
    faceMatchScore = null;
  } else if (
    typeof value.face_match_score === "number" &&
    Number.isFinite(value.face_match_score) &&
    value.face_match_score >= 0 &&
    value.face_match_score <= 100
  ) {
    faceMatchScore = value.face_match_score;
  } else {
    throw new InviteValidationError("The face-match score is invalid.");
  }
  if (faceMatchResult === "match" && faceMatchScore === null) {
    throw new InviteValidationError("A match result requires its score.");
  }

  if (typeof value.override_used !== "boolean") {
    throw new InviteValidationError("Manual override status is required.");
  }
  const overrideReason = value.override_reason;
  let normalizedOverrideReason: string | null;
  if (value.override_used) {
    if (
      typeof overrideReason !== "string" ||
      overrideReason.trim().length < 1 ||
      overrideReason.trim().length > 500
    ) {
      throw new InviteValidationError("A manual override requires a reason.");
    }
    normalizedOverrideReason = overrideReason.trim();
  } else {
    if (overrideReason !== null) {
      throw new InviteValidationError(
        "An override reason is not allowed when no override is used.",
      );
    }
    normalizedOverrideReason = null;
  }
  if (
    (!ocrSummary.ocr_passed || faceMatchResult !== "match") &&
    !value.override_used
  ) {
    throw new InviteValidationError(
      "Manual review requires an Administrator override reason.",
    );
  }

  const idImagePath = value.id_image_path;
  const selfiePath = value.selfie_path;
  if (
    typeof actorId !== "string" ||
    !UUID_PATTERN.test(actorId) ||
    typeof idImagePath !== "string" ||
    typeof selfiePath !== "string"
  ) {
    throw new InviteValidationError("Private verification image paths are required.");
  }
  const pathPrefix = `${actorId}/`;
  const idMatch = new RegExp(
    `^${pathPrefix}(${EVIDENCE_FOLDER_PATTERN})/id\\.(?:jpg|png)$`,
    "i",
  ).exec(idImagePath);
  const selfieMatch = new RegExp(
    `^${pathPrefix}(${EVIDENCE_FOLDER_PATTERN})/selfie\\.jpg$`,
    "i",
  ).exec(selfiePath);
  if (!idMatch || !selfieMatch || idMatch[1] !== selfieMatch[1]) {
    throw new InviteValidationError(
      "Verification image paths must be in this Administrator's private evidence folder.",
    );
  }

  return {
    applicant_name: applicantName,
    id_type: idType,
    id_number_masked: maskedId,
    ocr_summary: {
      full_name: ocrText("full_name", 160),
      dob: ocrText("dob", 40),
      address: ocrText("address", 1000),
      ocr_passed: ocrSummary.ocr_passed,
    },
    face_match_score: faceMatchScore,
    face_match_result: faceMatchResult,
    override_used: value.override_used,
    override_reason: normalizedOverrideReason,
    id_image_path: idImagePath,
    selfie_path: selfiePath,
  };
}
