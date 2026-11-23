import {
  InviteValidationError,
  normalizeAndValidateEmail,
  parseInvitePayload,
  parseVerificationRecordPayload,
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
  }, actorId);

  assertEquals(record.id_number_masked, "****5678", "masked ID should be retained");
  assertEquals(record.ocr_summary.ocr_passed, true, "OCR status should be retained");
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
    () => parseVerificationRecordPayload({
      ...valid,
      override_used: true,
      override_reason: "Reviewed original documents",
      id_image_path: `00000000-0000-4000-8000-000000000000/${folderId}/id.jpg`,
    }, actorId),
    "evidence paths must belong to the acting Administrator",
  );
});
