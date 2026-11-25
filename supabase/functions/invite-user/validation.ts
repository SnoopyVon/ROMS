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

const SUPPORTED_USER_ACTIONS = new Set([
  "invite",
  "create_account",
  "resend",
  "accept",
  "cancel",
  "deactivate",
  "reactivate",
  "remove_user",
]);
const ADMIN_USER_ACTIONS = new Set([
  "invite",
  "create_account",
  "resend",
  "cancel",
  "deactivate",
  "reactivate",
  "remove_user",
]);

export function isSupportedUserAction(action: unknown): boolean {
  return typeof action === "string" && SUPPORTED_USER_ACTIONS.has(action);
}

export function requiresAdministratorForUserAction(action: unknown): boolean {
  return typeof action === "string" && ADMIN_USER_ACTIONS.has(action);
}

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
  "face_scan_passed",
  "override_used",
  "override_reason",
  "id_image_path",
  "selfie_path",
  "consent_given",
  "face_descriptor",
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

export interface CreateAccountPayload {
  email: string;
  full_name: string;
  role: StaffRole;
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
  face_scan_passed?: boolean;
  face_match_score: number | null;
  face_match_result: "match" | "manual_review" | "no_match" | "unable";
  override_used: boolean;
  override_reason: string | null;
  id_image_path: string;
  selfie_path: string;
  consent_given: true;
  face_descriptor?: number[] | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parseAccountPayload<T extends StaffRole>(
  value: unknown,
  allowedRoles: readonly T[],
  subject: "invitation" | "account",
): { email: string; full_name: string; role: T } {
  if (!isRecord(value)) {
    throw new InviteValidationError(`A JSON ${subject} object is required.`);
  }

  if (Object.keys(value).some((key) => !INVITE_FIELDS.has(key))) {
    throw new InviteValidationError(
      `The ${subject} contains unsupported fields.`,
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

  const role = allowedRoles.find((allowedRole) => allowedRole === value.role);
  if (!role) {
    throw new InviteValidationError("A valid staff role is required.");
  }

  return { email, full_name: fullName, role };
}

export function parseInvitePayload(value: unknown): InvitePayload {
  return parseAccountPayload(value, INVITABLE_ROLES, "invitation");
}

export function parseCreateAccountPayload(value: unknown): CreateAccountPayload {
  return parseAccountPayload(value, STAFF_ROLES, "account");
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
  if (value.consent_given !== true) {
    throw new InviteValidationError(
      "The applicant's consent is required for ID verification.",
    );
  }

  let faceDescriptor: number[] | null | undefined;
  if (value.face_descriptor === undefined) {
    faceDescriptor = undefined;
  } else if (value.face_descriptor === null) {
    faceDescriptor = null;
  } else if (
    Array.isArray(value.face_descriptor) &&
    value.face_descriptor.length === 128 &&
    value.face_descriptor.every((item) =>
      typeof item === "number" &&
      Number.isFinite(item) &&
      item >= -1 &&
      item <= 1
    )
  ) {
    faceDescriptor = value.face_descriptor;
  } else {
    throw new InviteValidationError(
      "A face login template must contain 128 valid descriptor values.",
    );
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
  if (
    value.face_scan_passed !== undefined &&
    typeof value.face_scan_passed !== "boolean"
  ) {
    throw new InviteValidationError("Face-scan completion status is invalid.");
  }
  const faceScanPassed = value.face_scan_passed === true;
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
    faceMatchResult !== "manual_review" &&
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
  if (
    (faceMatchResult === "match" &&
      (faceMatchScore === null || faceMatchScore < 85)) ||
    (faceMatchResult === "manual_review" &&
      (faceMatchScore === null || faceMatchScore < 70 || faceMatchScore >= 85)) ||
    (faceMatchResult === "no_match" &&
      (faceMatchScore === null || faceMatchScore >= 70)) ||
    (faceMatchResult === "unable" && faceMatchScore !== null)
  ) {
    throw new InviteValidationError(
      "The face result does not match its similarity score.",
    );
  }
  if (faceMatchResult === "no_match") {
    throw new InviteValidationError(
      "The face similarity is below the required verification range.",
    );
  }
  const faceCheckPassed = faceMatchResult === "match" ||
    (faceMatchResult === "unable" && faceScanPassed);

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
    (!ocrSummary.ocr_passed || !faceCheckPassed) &&
    !value.override_used
  ) {
    throw new InviteValidationError(
      "Manual review requires an Administrator override reason.",
    );
  }
  if (
    faceDescriptor &&
    (!ocrSummary.ocr_passed || !faceCheckPassed || value.override_used)
  ) {
    throw new InviteValidationError(
      "A face login template requires successful identity checks without an override.",
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
    ...(value.face_scan_passed === undefined
      ? {}
      : { face_scan_passed: faceScanPassed }),
    face_match_score: faceMatchScore,
    face_match_result: faceMatchResult,
    override_used: value.override_used,
    override_reason: normalizedOverrideReason,
    id_image_path: idImagePath,
    selfie_path: selfiePath,
    consent_given: true,
    ...(faceDescriptor === undefined ? {} : { face_descriptor: faceDescriptor }),
  };
}

export function parseAccountPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 72) {
    throw new InviteValidationError(
      "Password must be between 8 and 72 characters.",
    );
  }
  return value;
}

export function parseVerifiedAccountRecord(
  value: unknown,
  actorId: string,
): VerificationRecordPayload {
  const record = parseVerificationRecordPayload(value, actorId);
  const facePassed = record.face_match_result === "match" &&
    record.face_match_score !== null &&
    record.face_match_score >= 85;
  const faceNeedsReview = record.face_match_result === "manual_review" &&
    record.face_match_score !== null &&
    record.face_match_score >= 70 &&
    record.face_match_score < 85 &&
    record.override_used;
  if (record.face_scan_passed !== true || (!facePassed && !faceNeedsReview)) {
    throw new InviteValidationError(
      "The face scan must pass or be approved for manual review before creating this account.",
    );
  }
  if (
    record.override_used
      ? (record.ocr_summary.ocr_passed &&
        record.face_match_result !== "manual_review") ||
        record.face_descriptor != null
      : !record.ocr_summary.ocr_passed || !record.face_descriptor
  ) {
    throw new InviteValidationError(
      "Manual review requires a reason and cannot approve a failed face comparison.",
    );
  }
  return record;
}
