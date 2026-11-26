import {
  InviteValidationError,
  isSupportedUserAction,
  normalizeAndValidateEmail,
  parseAccountPassword,
  parseCreateAccountPayload,
  parseInvitePayload,
  parseVerifiedAccountRecord,
  parseVerificationRecordPayload,
  requiresAdministratorForUserAction,
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
    if (error instanceof InviteValidationError) return;
    throw error;
  }
  throw new Error(message);
}

Deno.test("account creation is supported and restricted to Administrators", () => {
  assertEquals(
    isSupportedUserAction("create_account"),
    true,
    "account creation must pass the action allowlist",
  );
  assertEquals(
    requiresAdministratorForUserAction("create_account"),
    true,
    "account creation must require an active Administrator",
  );
  assertEquals(
    isSupportedUserAction("remove_user"),
    true,
    "account removal must pass the action allowlist",
  );
  assertEquals(
    requiresAdministratorForUserAction("remove_user"),
    true,
    "account removal must require an active Administrator",
  );
  assertEquals(
    requiresAdministratorForUserAction("accept"),
    false,
    "invitation acceptance must remain available to invitees",
  );
  assertEquals(
    isSupportedUserAction("unknown"),
    false,
    "unsupported actions must remain rejected",
  );
});

Deno.test("normalizes valid email and invitation fields", () => {
  const invite = parseInvitePayload({
    email: "  Staff.Member@Example.COM ",
    full_name: "  Staff Member  ",
    role: "Receptionist",
  });

  assertEquals(
    invite.email,
    "staff.member@example.com",
    "email should be normalized",
  );
  assertEquals(invite.full_name, "Staff Member", "full name should be trimmed");
  assertEquals(invite.role, "Receptionist", "staff role should be retained");
});

Deno.test("accepts each non-Administrator invitation role", () => {
  const roles = [
    "Manager",
    "Receptionist",
    "Inventory Clerk",
    "Chef / Kitchen Staff",
  ];

  for (const role of roles) {
    assertEquals(
      parseInvitePayload({
        email: "staff@example.com",
        full_name: "Staff Member",
        role,
      }).role,
      role,
      `role ${role} should be accepted`,
    );
  }
});

Deno.test("accepts Administrator only in the verified account creation workflow", () => {
  const account = parseCreateAccountPayload({
    email: "  admin@example.com ",
    full_name: "  Admin User  ",
    role: "Administrator",
  });

  assertEquals(account.email, "admin@example.com", "account email should be normalized");
  assertEquals(account.full_name, "Admin User", "account name should be trimmed");
  assertEquals(account.role, "Administrator", "verified account creation should allow Administrator");
  assertValidationError(
    () => parseInvitePayload({
      email: "admin@example.com",
      full_name: "Admin User",
      role: "Administrator",
    }),
    "ordinary invitations must continue to reject Administrator",
  );
});

Deno.test("rejects invalid email addresses", () => {
  for (
    const email of [
      "not-an-email",
      "staff@localhost",
      "staff@example..com",
      "x".repeat(65) + "@example.com",
    ]
  ) {
    assertValidationError(
      () => normalizeAndValidateEmail(email),
      `email ${email} should be rejected`,
    );
  }
});

Deno.test("rejects invalid roles, blank names, and caller-supplied fields", () => {
  const valid = {
    email: "staff@example.com",
    full_name: "Staff Member",
    role: "Manager",
  };

  assertValidationError(
    () => parseInvitePayload({ ...valid, role: "Customer" }),
    "Customer should not be an invitation role",
  );
  assertValidationError(
    () => parseInvitePayload({ ...valid, role: "Administrator" }),
    "Administrator invitations should be reserved for a role-change action",
  );
  assertValidationError(
    () => parseInvitePayload({ ...valid, full_name: "  " }),
    "blank names should be rejected",
  );
  assertValidationError(
    () => parseInvitePayload({ ...valid, invited_by: "attacker-id" }),
    "caller-supplied inviter identity should be rejected",
  );
});

Deno.test("accepts only masked ID data and Administrator-owned evidence paths", () => {
  const actorId = "9a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const folderId = "8a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const record = parseVerificationRecordPayload({
    applicant_name: "Staff Member",
    id_type: "National ID",
    id_number_masked: "****5678",
    ocr_summary: {
      full_name: "Staff Member",
      dob: "1990-01-02",
      address: "Test Address",
      ocr_passed: true,
    },
    face_match_score: 97,
    face_match_result: "match",
    override_used: false,
    override_reason: null,
    id_image_path: `${actorId}/${folderId}/id.jpg`,
    selfie_path: `${actorId}/${folderId}/selfie.jpg`,
    consent_given: true,
  }, actorId);

  assertEquals(record.id_number_masked, "****5678", "masked ID should be retained");
  assertEquals(record.ocr_summary.ocr_passed, true, "OCR status should be retained");
  assertEquals(record.consent_given, true, "applicant consent should be retained");
});

Deno.test("direct account creation requires a confirmed face match and strong password", () => {
  const actorId = "9a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const folderId = "8a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const valid = {
    applicant_name: "Staff Member",
    id_type: "National ID",
    id_number_masked: "****5678",
    ocr_summary: {
      full_name: "Staff Member",
      dob: "1990-01-02",
      address: "Test Address",
      ocr_passed: true,
    },
    face_scan_passed: true,
    face_match_score: 97,
    face_match_result: "match",
    override_used: false,
    override_reason: null,
    id_image_path: `${actorId}/${folderId}/id.jpg`,
    selfie_path: `${actorId}/${folderId}/selfie.jpg`,
    consent_given: true,
    face_descriptor: Array(128).fill(0.01),
  };

  assertEquals(
    parseVerifiedAccountRecord(valid, actorId).face_match_result,
    "match",
    "a verified face match should be accepted",
  );
  const manualReview = parseVerifiedAccountRecord({
    ...valid,
    ocr_summary: { ...valid.ocr_summary, ocr_passed: false },
    override_used: true,
    override_reason: "ID details were manually checked.",
  }, actorId);
  assertEquals(manualReview.override_used, true, "Administrator review may accept low-confidence ID details");
  assertEquals(manualReview.face_descriptor?.length, 128, "manual review must retain the enrolled face template");
  const faceManualReview = parseVerifiedAccountRecord({
    ...valid,
    face_match_score: 84,
    face_match_result: "manual_review",
    override_used: true,
    override_reason: "Administrator approved the manual review by selecting Add User.",
  }, actorId);
  assertEquals(faceManualReview.face_match_result, "manual_review", "scores from 70 through 84 require manual review");
  assertEquals(faceManualReview.override_reason, "Administrator approved the manual review by selecting Add User.", "Add User approval must be recorded for manual review");
  assertEquals(faceManualReview.face_descriptor?.length, 128, "manual face review must retain the enrolled face template");
  assertEquals(parseVerifiedAccountRecord({
    ...valid,
    face_match_score: 84.5,
    face_match_result: "manual_review",
    override_used: true,
    override_reason: "The face similarity score needs a manual check.",
  }, actorId).face_match_result, "manual_review", "decimal scores below 85 remain in manual review");
  assertValidationError(
    () => parseVerifiedAccountRecord({
      ...valid,
      override_used: true,
      override_reason: "The face scan did not produce a valid descriptor.",
      face_descriptor: null,
    }, actorId),
    "account creation must require a valid face template even when an override was used",
  );
  assertEquals(parseAccountPassword("Password123").length, 11, "valid password should pass");
  assertValidationError(
    () => parseVerifiedAccountRecord({
      ...valid,
      face_match_result: "unable",
      face_match_score: null,
    }, actorId),
    "liveness alone must not create an account",
  );
  assertValidationError(
    () => parseVerifiedAccountRecord({
      ...valid,
      face_match_result: "no_match",
      face_match_score: 20,
    }, actorId),
    "an ID-photo mismatch must block account creation",
  );
  assertValidationError(
    () => parseVerifiedAccountRecord({
      ...valid,
      face_match_result: "no_match",
      face_match_score: 20,
      override_used: true,
      override_reason: "Tried to bypass a face mismatch.",
      face_descriptor: null,
    }, actorId),
    "Administrator review must not bypass an ID-photo mismatch",
  );
  assertValidationError(
    () => parseVerifiedAccountRecord({
      ...valid,
      face_match_result: "manual_review",
      face_match_score: 84,
      override_used: false,
      override_reason: null,
      face_descriptor: Array(128).fill(0.01),
    }, actorId),
    "a medium similarity score requires Administrator review",
  );
  assertValidationError(
    () => parseVerificationRecordPayload({
      ...valid,
      face_match_result: "no_match",
      face_match_score: 69,
      override_used: true,
      override_reason: "Attempt to override a failed face check.",
      face_descriptor: null,
    }, actorId),
    "scores below 70 must fail even with an override",
  );
  assertValidationError(
    () => parseAccountPassword("short"),
    "short passwords must be rejected",
  );
});

Deno.test("accepts a passed liveness scan without inventing a face-match result", () => {
  const actorId = "9a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const folderId = "8a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const record = parseVerificationRecordPayload({
    applicant_name: "Staff Member",
    id_type: "National ID",
    id_number_masked: "****5678",
    ocr_summary: {
      full_name: "Staff Member",
      dob: "1990-01-02",
      address: "Test Address",
      ocr_passed: true,
    },
    face_scan_passed: true,
    face_match_score: null,
    face_match_result: "unable",
    override_used: false,
    override_reason: null,
    id_image_path: `${actorId}/${folderId}/id.jpg`,
    selfie_path: `${actorId}/${folderId}/selfie.jpg`,
    consent_given: true,
    face_descriptor: Array(128).fill(0.01),
  }, actorId);

  assertEquals(record.face_scan_passed, true, "scan completion should be retained");
  assertEquals(record.face_match_result, "unable", "liveness must not be stored as a match");
  assertEquals(record.face_match_score, null, "liveness must not fabricate a match score");
  assertValidationError(
    () => parseVerificationRecordPayload({
      ...record,
      face_scan_passed: false,
    }, actorId),
    "a missing liveness pass must require an override",
  );
  assertValidationError(
    () => parseVerificationRecordPayload({
      ...record,
      face_match_result: "no_match",
      face_match_score: 20,
    }, actorId),
    "an explicit face mismatch must not be bypassed by liveness",
  );
});

Deno.test("rejects raw ID, non-match without override, and foreign evidence paths", () => {
  const actorId = "9a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const folderId = "8a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const valid = {
    applicant_name: "Staff Member",
    id_type: "National ID",
    id_number_masked: "****5678",
    ocr_summary: {
      full_name: "Staff Member",
      dob: "1990-01-02",
      address: "Test Address",
      ocr_passed: true,
    },
    face_match_score: 20,
    face_match_result: "no_match",
    override_used: false,
    override_reason: null,
    id_image_path: `${actorId}/${folderId}/id.jpg`,
    selfie_path: `${actorId}/${folderId}/selfie.jpg`,
    consent_given: true,
  };

  assertValidationError(
    () => parseVerificationRecordPayload({
      ...valid,
      ocr_summary: { ...valid.ocr_summary, id_number: "123456789" },
    }, actorId),
    "raw ID values should not be accepted in the OCR summary",
  );
  assertValidationError(
    () => parseVerificationRecordPayload(valid, actorId),
    "a non-match should require an explicit override reason",
  );
  assertValidationError(
    () => parseVerificationRecordPayload({ ...valid, consent_given: false }, actorId),
    "verification evidence should require applicant consent",
  );
  assertValidationError(
    () => parseVerificationRecordPayload({
      ...valid,
      override_used: true,
      override_reason: "Reviewed original documents",
      id_image_path: `00000000-0000-4000-8000-000000000000/${folderId}/id.jpg`,
    }, actorId),
    "evidence paths must belong to the acting Administrator",
  );
});

Deno.test("accepts face login templates only for fully verified applicants", () => {
  const actorId = "9a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const folderId = "8a7fbe8e-ec7e-41f2-9fb5-b7d77fca347c";
  const valid = {
    applicant_name: "Staff Member",
    id_type: "National ID",
    id_number_masked: "****5678",
    ocr_summary: {
      full_name: "Staff Member",
      dob: "1990-01-02",
      address: "Test Address",
      ocr_passed: true,
    },
    face_match_score: 97,
    face_match_result: "match",
    override_used: false,
    override_reason: null,
    id_image_path: `${actorId}/${folderId}/id.jpg`,
    selfie_path: `${actorId}/${folderId}/selfie.jpg`,
    consent_given: true,
    face_descriptor: Array(128).fill(0.01),
  };

  assertEquals(
    parseVerificationRecordPayload(valid, actorId).face_descriptor?.length,
    128,
    "a verified applicant's face descriptor should be retained",
  );
  assertValidationError(
    () => parseVerificationRecordPayload({ ...valid, face_descriptor: Array(127).fill(0) }, actorId),
    "short face descriptors should be rejected",
  );
  assertValidationError(
    () => parseVerificationRecordPayload({
      ...valid,
      face_descriptor: [...Array(127).fill(0), 2],
    }, actorId),
    "out-of-range face descriptors should be rejected",
  );
  assertValidationError(
    () => parseVerificationRecordPayload({
      ...valid,
      face_match_result: "no_match",
      face_match_score: 20,
      override_used: true,
      override_reason: "Manual review",
    }, actorId),
    "manual overrides must not enroll a face for sign-in",
  );
});
