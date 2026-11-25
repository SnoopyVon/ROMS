import { createClient } from "npm:@supabase/supabase-js@2";
import {
  InviteValidationError,
  normalizeAndValidateEmail,
  parseAccountPassword,
  parseCreateAccountPayload,
  parseInvitePayload,
  parseVerifiedAccountRecord,
  parseVerificationRecordPayload,
  isSupportedUserAction,
  requiresAdministratorForUserAction,
} from "./validation.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};
const MAX_BODY_BYTES = 16_384;
const INVITE_VALIDITY_DAYS = 7;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = status >= 500
      ? "server_error"
      : status === 401
      ? "not_authenticated"
      : status === 403
      ? "not_authorized"
      : status === 409
      ? "conflict"
      : status === 429
      ? "rate_limited"
      : "invalid_request",
  ) {
    super(message);
  }
}

function jsonResponse(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function readErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && /^[a-z0-9_-]{1,64}$/i.test(code)) {
      return code;
    }
  }
  return error instanceof Error ? error.name : "unknown_error";
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new HttpError(500, `Server configuration is missing ${name}.`);
  }
  return value;
}

function getRedirectUrl(): string {
  const value = requiredEnv("INVITE_REDIRECT_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(500, "Server invitation redirect URL is invalid.");
  }
  const isLocalHttp = url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new HttpError(500, "Server invitation redirect URL must use HTTPS.");
  }
  return url.toString();
}

function getBearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match) {
    throw new HttpError(401, "A valid signed-in session is required.");
  }
  return match[1];
}

function getObject(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "A JSON request object is required.");
  }
  return value as JsonRecord;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, `${label} must be a valid identifier.`);
  }
  return value;
}

function requireReason(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 500) {
    throw new HttpError(400, "The reason must be 500 characters or fewer.");
  }
  return value.trim();
}

function createServiceClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function cancelPendingInvitation(
  serviceClient: ReturnType<typeof createServiceClient>,
  invitationId: string,
  actorId: string,
): Promise<{ succeeded: boolean; error?: unknown }> {
  const { error } = await serviceClient.rpc("costtrack_cancel_user_invitation", {
    p_invitation_id: invitationId,
    p_actor_id: actorId,
  });
  if (error) return { succeeded: false, error };
  return { succeeded: true };
}

function logFailure(
  requestId: string,
  operation: string,
  error: unknown,
): void {
  console.error(JSON.stringify({
    event: "invite_user_operation_failed",
    request_id: requestId,
    operation,
    error_code: readErrorCode(error),
  }));
}

async function createInvitation(
  requestId: string,
  body: JsonRecord,
  userId: string,
  serviceClient: ReturnType<typeof createServiceClient>,
  redirectUrl: string,
): Promise<Response> {
  if (body.action !== "invite") {
    throw new HttpError(400, "A supported invitation action is required.");
  }

  const allowedFields = new Set([
    "action",
    "email",
    "full_name",
    "role",
    "verification_record",
  ]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new HttpError(400, "The invitation contains unsupported fields.");
  }

  let invite: ReturnType<typeof parseInvitePayload>;
  try {
    invite = parseInvitePayload({
      email: body.email,
      full_name: body.full_name,
      role: body.role,
    });
  } catch (error) {
    if (error instanceof InviteValidationError) {
      throw new HttpError(
        400,
        error.message,
        error.message.includes("email") ? "invalid_email" : "invalid_invitation",
      );
    }
    throw error;
  }

  let verificationRecord: ReturnType<typeof parseVerificationRecordPayload> | null =
    null;
  if (body.verification_record !== undefined) {
    try {
      verificationRecord = parseVerificationRecordPayload(
        body.verification_record,
        userId,
      );
    } catch (error) {
      if (error instanceof InviteValidationError) {
        throw new HttpError(400, error.message, "invalid_verification_record");
      }
      throw error;
    }
    if (verificationRecord.applicant_name !== invite.full_name) {
      throw new HttpError(
        400,
        "The verified applicant name must match the invitation name.",
        "invalid_verification_record",
      );
    }
  }

  const { data: existingInvitation, error: invitationLookupError } =
    await serviceClient
      .from("user_invites")
      .select("id,status")
      .eq("email", invite.email)
      .in("status", ["Pending", "Expired"])
      .order("invited_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  if (invitationLookupError) {
    logFailure(requestId, "invitation_lookup", invitationLookupError);
    throw new HttpError(500, "Could not verify existing invitations.");
  }
  if (existingInvitation) {
    throw new HttpError(
      409,
      "A pending or expired invitation already exists. Resend it from Invitations.",
      "pending_invitation_exists",
    );
  }

  const escapedEmail = invite.email.replace(/[%_\\]/g, "\\$&");
  const { data: existingProfile, error: profileLookupError } =
    await serviceClient
      .from("profiles")
      .select("id,account_status")
      .ilike("email", escapedEmail)
      .limit(1)
      .maybeSingle();
  if (profileLookupError) {
    logFailure(requestId, "profile_lookup", profileLookupError);
    throw new HttpError(
      500,
      "Could not verify whether the email already has a profile.",
    );
  }
  if (existingProfile) {
    throw new HttpError(
      409,
      "An account already exists for this email address.",
      "already_registered",
    );
  }

  const expiresAt = new Date(
    Date.now() + INVITE_VALIDITY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: invitation, error: invitationInsertError } = await serviceClient
    .from("user_invites")
    .insert({
      email: invite.email,
      full_name: invite.full_name,
      role: invite.role,
      invited_by: userId,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single();
  if (invitationInsertError || !invitation) {
    if (invitationInsertError?.code === "23505") {
      throw new HttpError(
        409,
        "A pending or expired invitation already exists. Resend it from Invitations.",
        "pending_invitation_exists",
      );
    }
    logFailure(
      requestId,
      "invitation_insert",
      invitationInsertError ?? new Error("No invitation returned."),
    );
    throw new HttpError(500, "The invitation record could not be created.");
  }

  const { data: authInvitation, error: authInviteError } = await serviceClient
    .auth.admin
    .inviteUserByEmail(invite.email, {
      data: { full_name: invite.full_name, role: invite.role },
      redirectTo: redirectUrl,
    });
  if (authInviteError || !authInvitation.user) {
    const cleanup = await cancelPendingInvitation(
      serviceClient,
      invitation.id,
      userId,
    );
    if (!cleanup.succeeded) {
      logFailure(
        requestId,
        "cancel_failed_auth_invite",
        cleanup.error,
      );
      throw new HttpError(
        500,
        "The email invitation failed and its database record needs administrator review.",
      );
    }
    logFailure(
      requestId,
      "auth_invite",
      authInviteError ?? new Error("No Auth user returned."),
    );
    if (authInviteError?.status === 422) {
      throw new HttpError(
        409,
        "An Auth account already exists for this email address.",
        "already_registered",
      );
    }
    if (authInviteError?.status === 429) {
      throw new HttpError(
        429,
        "Supabase Auth email rate limit reached. Try again later.",
        "rate_limited",
      );
    }
    throw new HttpError(
      502,
      "Supabase Auth could not send the invitation. Check email and redirect configuration.",
    );
  }

  const { error: sentAuditError } = await serviceClient.rpc(
    "costtrack_record_user_invitation_sent",
    {
      p_invitation_id: invitation.id,
      p_actor_id: userId,
    },
  );
  if (sentAuditError) {
    logFailure(requestId, "invitation_sent_audit", sentAuditError);
    const { error: deleteUserError } = await serviceClient.auth.admin
      .deleteUser(authInvitation.user.id);
    if (deleteUserError) {
      logFailure(requestId, "sent_audit_auth_compensation", deleteUserError);
    }
    const cleanup = await cancelPendingInvitation(
      serviceClient,
      invitation.id,
      userId,
    );
    if (!cleanup.succeeded) {
      logFailure(requestId, "sent_audit_invitation_compensation", cleanup.error);
    }
    throw new HttpError(
      500,
      "The invitation email was sent, but its audit record could not be saved. Check the invitation and Auth account before retrying.",
      "server_error",
    );
  }

  if (verificationRecord?.face_descriptor) {
    const { error: faceTemplateError } = await serviceClient
      .from("user_face_templates")
      .insert({
        user_id: authInvitation.user.id,
        descriptor: verificationRecord.face_descriptor,
      });
    if (faceTemplateError) {
      logFailure(requestId, "face_template_insert", faceTemplateError);
      const { error: deleteUserError } = await serviceClient.auth.admin
        .deleteUser(authInvitation.user.id);
      if (deleteUserError) {
        logFailure(requestId, "face_template_auth_compensation", deleteUserError);
      }
      const invitationCleanup = await cancelPendingInvitation(
        serviceClient,
        invitation.id,
        userId,
      );
      if (!invitationCleanup.succeeded) {
        logFailure(
          requestId,
          "face_template_invitation_compensation",
          invitationCleanup.error,
        );
      }
      const { error: evidenceCleanupError } = await serviceClient.storage
        .from("verification-evidence")
        .remove([
          verificationRecord.id_image_path,
          verificationRecord.selfie_path,
        ]);
      if (evidenceCleanupError) {
        logFailure(
          requestId,
          "face_template_evidence_compensation",
          evidenceCleanupError,
        );
      }
      if (deleteUserError || !invitationCleanup.succeeded || evidenceCleanupError) {
        throw new HttpError(
          500,
          "Face enrollment failed and user cleanup needs Administrator review.",
          "face_template_cleanup_failed",
        );
      }
      throw new HttpError(
        500,
        "Face enrollment failed, so profile creation was rolled back and the invitation was cancelled. Please retry.",
        "face_template_failed",
      );
    }
  }

  let verificationRecordId: string | null = null;
  if (verificationRecord) {
    const { data: recordId, error: recordError } = await serviceClient.rpc(
      "costtrack_create_verification_record",
      {
        p_actor_id: userId,
        p_profile_id: authInvitation.user.id,
        p_profile_email: invite.email,
        p_profile_name: invite.full_name,
        p_role_assigned: invite.role,
        p_invitation_id: invitation.id,
        p_applicant_name: verificationRecord.applicant_name,
        p_id_type: verificationRecord.id_type,
        p_id_number_masked: verificationRecord.id_number_masked,
        p_ocr_summary: verificationRecord.face_scan_passed === undefined
          ? verificationRecord.ocr_summary
          : {
            ...verificationRecord.ocr_summary,
            face_scan_passed: verificationRecord.face_scan_passed,
          },
        p_face_match_score: verificationRecord.face_match_score,
        p_face_match_result: verificationRecord.face_match_result,
        p_override_used: verificationRecord.override_used,
        p_override_reason: verificationRecord.override_reason,
        p_id_image_path: verificationRecord.id_image_path,
        p_selfie_path: verificationRecord.selfie_path,
        p_consent_given: verificationRecord.consent_given,
        p_consent_at: new Date().toISOString(),
        p_final_status: "Approved",
        p_supersedes_id: null,
      },
    );
    if (recordError || typeof recordId !== "string") {
      logFailure(
        requestId,
        "verification_record_and_profile_insert",
        recordError ?? new Error("No verification record ID returned."),
      );
      const { error: deleteUserError } = await serviceClient.auth.admin
        .deleteUser(authInvitation.user.id);
      if (deleteUserError) {
        logFailure(requestId, "verification_auth_compensation", deleteUserError);
      }
      const invitationCleanup = await cancelPendingInvitation(
        serviceClient,
        invitation.id,
        userId,
      );
      if (!invitationCleanup.succeeded) {
        logFailure(
          requestId,
          "verification_invitation_compensation",
          invitationCleanup.error,
        );
      }
      const { error: evidenceCleanupError } = await serviceClient.storage
        .from("verification-evidence")
        .remove([
          verificationRecord.id_image_path,
          verificationRecord.selfie_path,
        ]);
      if (evidenceCleanupError) {
        logFailure(
          requestId,
          "verification_evidence_compensation",
          evidenceCleanupError,
        );
      }
      if (deleteUserError || !invitationCleanup.succeeded || evidenceCleanupError) {
        throw new HttpError(
          500,
          "Verification record creation failed and account cleanup needs Administrator review.",
          "verification_record_cleanup_failed",
        );
      }
      throw new HttpError(
        500,
        "The verification record could not be saved, so profile creation was rolled back and the invitation was cancelled. Please retry.",
        "verification_record_failed",
      );
    }
    verificationRecordId = recordId;
  } else {
    const { error: profileInsertError } = await serviceClient
      .from("profiles")
      .insert({
        id: authInvitation.user.id,
        email: invite.email,
        full_name: invite.full_name,
        role: invite.role,
        account_status: "Pending",
      });
    if (profileInsertError) {
      logFailure(requestId, "profile_insert", profileInsertError);
      const { error: deleteUserError } = await serviceClient.auth.admin
        .deleteUser(authInvitation.user.id);
      if (deleteUserError) {
        logFailure(requestId, "auth_user_compensation", deleteUserError);
        throw new HttpError(
          500,
          "Account setup failed after sending the email; administrator reconciliation is required.",
        );
      }

      const cleanup = await cancelPendingInvitation(
        serviceClient,
        invitation.id,
        userId,
      );
      if (!cleanup.succeeded) {
        logFailure(requestId, "cancel_failed_profile_insert", cleanup.error);
        throw new HttpError(
          500,
          "Account setup failed and invitation cleanup needs administrator review.",
        );
      }
      throw new HttpError(
        profileInsertError.code === "23505" ? 409 : 500,
        profileInsertError.code === "23505"
          ? "An account already exists for this email address."
          : "The invitation email was sent, but profile setup failed. The invite was rolled back; please retry.",
      );
    }
  }

  return jsonResponse(201, {
    invitation_id: invitation.id,
    email: invite.email,
    status: "Pending",
    expires_at: invitation.expires_at,
    ...(verificationRecordId ? { verification_record_id: verificationRecordId } : {}),
    request_id: requestId,
  });
}

async function createUserAccount(
  requestId: string,
  body: JsonRecord,
  actorId: string,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<Response> {
  const allowedFields = new Set([
    "action",
    "email",
    "full_name",
    "role",
    "password",
    "verification_record",
  ]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new HttpError(400, "The account request contains unsupported fields.");
  }

  let account: ReturnType<typeof parseCreateAccountPayload>;
  try {
    account = parseCreateAccountPayload({
      email: body.email,
      full_name: body.full_name,
      role: body.role,
    });
  } catch (error) {
    if (error instanceof InviteValidationError) {
      throw new HttpError(400, error.message, "invalid_account");
    }
    throw error;
  }

  let password: string;
  try {
    password = parseAccountPassword(body.password);
  } catch (error) {
    if (error instanceof InviteValidationError) {
      throw new HttpError(400, error.message, "invalid_account");
    }
    throw error;
  }

  let verificationRecord: ReturnType<typeof parseVerificationRecordPayload>;
  try {
    verificationRecord = parseVerifiedAccountRecord(
      body.verification_record,
      actorId,
    );
  } catch (error) {
    if (error instanceof InviteValidationError) {
      throw new HttpError(400, error.message, "invalid_verification_record");
    }
    throw error;
  }
  if (verificationRecord.applicant_name !== account.full_name ||
    verificationRecord.ocr_summary.full_name !== account.full_name) {
    throw new HttpError(
      400,
      "ID details and the face match must pass before creating this account.",
      "verification_required",
    );
  }

  const escapedEmail = account.email.replace(/[%_\\]/g, "\\$&");
  const { data: existingProfile, error: profileLookupError } = await serviceClient
    .from("profiles")
    .select("id")
    .ilike("email", escapedEmail)
    .limit(1)
    .maybeSingle();
  if (profileLookupError) {
    logFailure(requestId, "account_profile_lookup", profileLookupError);
    throw new HttpError(500, "Could not check whether this email already has an account.");
  }
  if (existingProfile) {
    throw new HttpError(409, "An account already exists for this email address.", "already_registered");
  }

  const { data: authData, error: authError } = await serviceClient.auth.admin
    .createUser({
      email: account.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: account.full_name },
    });
  if (authError || !authData.user) {
    logFailure(requestId, "account_auth_create", authError ?? new Error("No Auth user returned."));
    if (authError?.status === 422) {
      throw new HttpError(409, "An account already exists for this email address.", "already_registered");
    }
    if (authError?.status === 429) {
      throw new HttpError(429, "Too many account requests. Try again later.", "rate_limited");
    }
    throw new HttpError(502, "The sign-in account could not be created.");
  }

  const authUserId = authData.user.id;
  const removeAuthUser = async (operation: string): Promise<boolean> => {
    const { error } = await serviceClient.auth.admin.deleteUser(authUserId);
    if (!error) return true;
    logFailure(requestId, operation, error);
    return false;
  };

  if (verificationRecord.face_descriptor) {
    const { error: templateError } = await serviceClient
      .from("user_face_templates")
      .insert({
        user_id: authUserId,
        descriptor: verificationRecord.face_descriptor,
      });
    if (templateError) {
      logFailure(requestId, "account_face_template", templateError);
      if (!await removeAuthUser("account_face_template_auth_compensation")) {
        throw new HttpError(500, "Face sign-in setup failed and the new account needs Administrator review.");
      }
      throw new HttpError(500, "Face sign-in setup failed. The account was not created.");
    }
  }

  const { data: verificationRecordId, error: accountRpcError } =
    await serviceClient.rpc("costtrack_create_verified_user_account", {
      p_actor_id: actorId,
      p_profile_id: authUserId,
      p_email: account.email,
      p_full_name: account.full_name,
      p_role: account.role,
      p_verification_record: verificationRecord,
    });
  if (accountRpcError || typeof verificationRecordId !== "string") {
    logFailure(requestId, "account_profile_verification_create", accountRpcError ?? new Error("No verification record returned."));
    if (!await removeAuthUser("account_create_auth_compensation")) {
      throw new HttpError(500, "Account setup failed and the new sign-in account needs Administrator review.");
    }
    throw new HttpError(
      accountRpcError?.code === "23505" ? 409 : 500,
      accountRpcError?.code === "23505"
        ? "An account already exists for this email address."
        : "The account and verification record could not be saved.",
      accountRpcError?.code === "23505" ? "already_registered" : "account_setup_failed",
    );
  }

  return jsonResponse(201, {
    profile_id: authUserId,
    verification_record_id: verificationRecordId,
    email: account.email,
    status: "Active",
    request_id: requestId,
  });
}

async function resendInvitation(
  requestId: string,
  body: JsonRecord,
  actorId: string,
  serviceClient: ReturnType<typeof createServiceClient>,
  redirectUrl: string,
): Promise<Response> {
  const allowedFields = new Set(["action", "invitation_id"]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new HttpError(400, "The resend request contains unsupported fields.");
  }
  const invitationId = requireUuid(body.invitation_id, "Invitation ID");
  const { data: invitation, error: invitationError } = await serviceClient
    .from("user_invites")
    .select("id,email,full_name,role,status")
    .eq("id", invitationId)
    .maybeSingle();
  if (invitationError) {
    logFailure(requestId, "resend_invitation_lookup", invitationError);
    throw new HttpError(500, "Could not load the invitation to resend.");
  }
  if (!invitation) throw new HttpError(404, "The invitation was not found.");
  if (!["Pending", "Expired"].includes(invitation.status)) {
    throw new HttpError(
      409,
      "Only pending or expired invitations can be resent.",
      "invitation_not_resendable",
    );
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id,account_status")
    .eq("email", invitation.email)
    .maybeSingle();
  if (profileError) {
    logFailure(requestId, "resend_profile_lookup", profileError);
    throw new HttpError(500, "Could not verify the invited account.");
  }
  if (!profile || profile.account_status !== "Pending") {
    throw new HttpError(
      409,
      "The pending invitation account is missing or already registered. Verify the account before sending another invitation.",
      profile ? "already_registered" : "invitation_account_missing",
    );
  }

  const { data: authData, error: authLookupError } = await serviceClient.auth
    .admin.getUserById(profile.id);
  if (authLookupError) {
    if (authLookupError.status === 404) {
      throw new HttpError(
        409,
        "The pending Auth account is missing. Cancel this invitation and create a new one.",
        "invitation_account_missing",
      );
    }
    logFailure(requestId, "resend_auth_user_lookup", authLookupError);
    throw new HttpError(500, "Could not verify the invited Auth account.");
  }
  if (!authData.user || authData.user.email_confirmed_at) {
    throw new HttpError(
      409,
      "This email is already confirmed. Complete the existing invitation or manage the staff account.",
      "already_registered",
    );
  }

  const { error: authInviteError } = await serviceClient.auth.admin
    .inviteUserByEmail(invitation.email, {
      data: { full_name: invitation.full_name, role: invitation.role },
      redirectTo: redirectUrl,
    });
  if (authInviteError) {
    logFailure(requestId, "resend_auth_invite", authInviteError);
    if (authInviteError.status === 422) {
      throw new HttpError(
        409,
        "Supabase Auth reports that this email is already registered.",
        "already_registered",
      );
    }
    if (authInviteError.status === 429) {
      throw new HttpError(
        429,
        "Supabase Auth email rate limit reached. Try again later.",
        "rate_limited",
      );
    }
    throw new HttpError(
      502,
      "Supabase Auth could not resend the invitation. Check email and redirect configuration.",
      "email_delivery_failed",
    );
  }

  const { data: expiresAt, error: resendError } = await serviceClient.rpc(
    "costtrack_resend_user_invitation",
    {
      p_invitation_id: invitation.id,
      p_actor_id: actorId,
    },
  );
  if (resendError || typeof expiresAt !== "string") {
    logFailure(
      requestId,
      "resend_invitation_record",
      resendError ?? new Error("No expiry was returned."),
    );
    throw new HttpError(
      500,
      "The invitation email was resent, but its expiry and audit could not be refreshed. Contact an Administrator before retrying.",
      "invitation_record_failed",
    );
  }

  return jsonResponse(200, {
    invitation_id: invitation.id,
    email: invitation.email,
    status: "Pending",
    expires_at: expiresAt,
    request_id: requestId,
  });
}

async function acceptInvitation(
  requestId: string,
  body: JsonRecord,
  user: { id: string; email?: string; email_confirmed_at?: string },
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<Response> {
  if (
    body.action !== "accept" ||
    Object.keys(body).some((key) => key !== "action")
  ) {
    throw new HttpError(
      400,
      "A valid invitation acceptance action is required.",
    );
  }
  if (!user.email || !user.email_confirmed_at) {
    throw new HttpError(403, "A confirmed invitation email is required.");
  }

  let email: string;
  try {
    email = normalizeAndValidateEmail(user.email);
  } catch {
    throw new HttpError(
      403,
      "The signed-in account does not have a valid confirmed email.",
    );
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("email, account_status")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    logFailure(requestId, "accept_profile_lookup", profileError);
    throw new HttpError(500, "Could not verify the invited account profile.");
  }
  if (
    !profile ||
    profile.email.trim().toLowerCase() !== email ||
    !["Pending", "Active"].includes(profile.account_status)
  ) {
    throw new HttpError(
      403,
      "The signed-in account does not match an invitation profile.",
    );
  }

  const { data: invitation, error: invitationError } = await serviceClient
    .from("user_invites")
    .select("id, status, expires_at")
    .eq("email", email)
    .in("status", ["Pending", "Accepted"])
    .order("invited_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (invitationError) {
    logFailure(requestId, "accept_invitation_lookup", invitationError);
    throw new HttpError(500, "Could not verify the invitation record.");
  }
  if (!invitation) {
    throw new HttpError(
      403,
      "No matching invitation was found for this account.",
    );
  }
  if (invitation.status === "Accepted") {
    return jsonResponse(200, {
      invitation_id: invitation.id,
      status: "Accepted",
      already_accepted: true,
      request_id: requestId,
    });
  }

  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    const { error: expireError } = await serviceClient
      .from("user_invites")
      .update({ status: "Expired" })
      .eq("id", invitation.id)
      .eq("status", "Pending");
    if (expireError) {
      logFailure(requestId, "mark_expired", expireError);
      throw new HttpError(
        500,
        "The expired invitation status could not be recorded.",
      );
    }
    throw new HttpError(
      410,
      "This invitation has expired. Ask an Administrator for a new invitation.",
    );
  }

  const { data: acceptanceRecorded, error: acceptanceError } =
    await serviceClient.rpc("costtrack_accept_user_invitation", {
      p_invitation_id: invitation.id,
      p_user_id: user.id,
    });
  if (acceptanceError) {
    logFailure(requestId, "accept_invitation_update", acceptanceError);
    throw new HttpError(
      acceptanceError.code === "23514" ? 409 : 500,
      acceptanceError.code === "23514"
        ? "The invitation is no longer pending or has expired."
        : "Invitation acceptance could not be recorded.",
    );
  }
  return jsonResponse(200, {
    invitation_id: invitation.id,
    status: "Accepted",
    already_accepted: acceptanceRecorded !== true,
    request_id: requestId,
  });
}

async function setUserAccountStatus(
  requestId: string,
  body: JsonRecord,
  action: "deactivate" | "reactivate",
  actorId: string,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<Response> {
  const allowedFields = new Set(["action", "user_id", "reason"]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new HttpError(400, "The account status request contains unsupported fields.");
  }
  const userId = requireUuid(body.user_id, "User ID");
  const reason = requireReason(body.reason);
  if (action === "deactivate" && !reason) {
    throw new HttpError(
      400,
      "A reason is required to deactivate a user.",
      "reason_required",
    );
  }
  if (userId === actorId) {
    throw new HttpError(403, "Administrators cannot change their own account status.");
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id,role,account_status")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    logFailure(requestId, "account_profile_lookup", profileError);
    throw new HttpError(500, "Could not load the target staff account.");
  }
  if (!profile) throw new HttpError(404, "The staff account was not found.");
  if (!["Active", "Deactivated"].includes(profile.account_status)) {
    throw new HttpError(409, "Only active or deactivated staff accounts can be changed here.");
  }

  if (action === "deactivate") {
    const { error } = await serviceClient.rpc(
      "costtrack_set_profile_account_status",
      {
        p_user_id: userId,
        p_new_status: "Deactivated",
        p_actor_id: actorId,
        p_reason: reason,
      },
    );
    if (error) {
      logFailure(requestId, "deactivate_profile", error);
      throw new HttpError(
        error.code === "23514" || error.code === "55000"
          ? 409
          : error.code === "42501"
          ? 403
          : error.code === "22023"
          ? 400
          : 500,
        error.code === "23514" || error.code === "55000"
          ? "The last active Administrator cannot be deactivated."
          : error.code === "42501"
          ? error.message
          : error.code === "22023"
          ? error.message
          : "The account could not be deactivated.",
        error.code === "42501"
          ? "not_authorized"
          : error.code === "22023"
          ? "reason_required"
          : error.code === "23514" || error.code === "55000"
          ? "protected_account"
          : "server_error",
      );
    }

    const { error: banError } = await serviceClient.auth.admin.updateUserById(
      userId,
      { ban_duration: "876000h" },
    );
    if (banError) {
      logFailure(requestId, "deactivate_auth_user", banError);
      throw new HttpError(
        502,
        "The account is blocked by CostTrack, but Supabase Auth could not be disabled. Retry this action or review the Auth user.",
      );
    }
    return jsonResponse(200, {
      user_id: userId,
      status: "Deactivated",
      request_id: requestId,
    });
  }

  const { error: unbanError } = await serviceClient.auth.admin.updateUserById(
    userId,
    { ban_duration: "none" },
  );
  if (unbanError) {
    logFailure(requestId, "reactivate_auth_user", unbanError);
    throw new HttpError(502, "Supabase Auth could not restore this account.");
  }

  const { error: statusError } = await serviceClient.rpc(
    "costtrack_set_profile_account_status",
    {
      p_user_id: userId,
      p_new_status: "Active",
      p_actor_id: actorId,
      p_reason: reason,
    },
  );
  if (statusError) {
    logFailure(requestId, "reactivate_profile", statusError);
    const { error: rollbackError } = await serviceClient.auth.admin
      .updateUserById(userId, { ban_duration: "876000h" });
    if (rollbackError) {
      logFailure(requestId, "reactivate_auth_compensation", rollbackError);
      throw new HttpError(
        500,
        "Account reactivation failed and Supabase Auth could not be re-disabled. An Administrator must review this account immediately.",
      );
    }
    throw new HttpError(500, "The account could not be reactivated.");
  }

  return jsonResponse(200, {
    user_id: userId,
    status: "Active",
    request_id: requestId,
  });
}

async function removeUserAccount(
  requestId: string,
  body: JsonRecord,
  actorId: string,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<Response> {
  const allowedFields = new Set(["action", "user_id"]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new HttpError(400, "The account removal request contains unsupported fields.");
  }
  const userId = requireUuid(body.user_id, "User ID");
  if (userId === actorId) {
    throw new HttpError(403, "Administrators cannot remove their own account.");
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id,role,account_status")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    logFailure(requestId, "remove_profile_lookup", profileError);
    throw new HttpError(500, "Could not load the target staff account.");
  }
  if (
    profile &&
    !["Active", "Deactivated"].includes(profile.account_status)
  ) {
    throw new HttpError(409, "Only active or deactivated staff accounts can be removed.");
  }

  const { data: authResult, error: authLookupError } = await serviceClient
    .auth.admin.getUserById(userId);
  const authUserMissing = authLookupError?.status === 404;
  if (authLookupError && !authUserMissing) {
    logFailure(requestId, "remove_auth_lookup", authLookupError);
    throw new HttpError(502, "Supabase Auth could not verify this account.");
  }
  if (profile && (authUserMissing || !authResult.user)) {
    logFailure(requestId, "remove_auth_lookup", authLookupError ?? "Auth user missing for existing profile");
    throw new HttpError(502, "The profile exists but its Supabase Auth account could not be verified.");
  }

  if (!profile && (authUserMissing || !authResult.user)) {
    return jsonResponse(200, {
      user_id: userId,
      status: "Removed",
      auth_removed: true,
      request_id: requestId,
    });
  }

  const { error: banError } = await serviceClient.auth.admin.updateUserById(
    userId,
    { ban_duration: "876000h" },
  );
  if (banError) {
    logFailure(requestId, "remove_auth_block", banError);
    throw new HttpError(502, "Supabase Auth could not block this account before removal.");
  }

  if (profile) {
    const { error: authorizationError } = await serviceClient.rpc(
      "costtrack_prepare_user_removal",
      { p_user_id: userId, p_actor_id: actorId },
    );
    if (authorizationError) {
      logFailure(requestId, "authorize_profile_removal", authorizationError);
      if (profile.account_status === "Active") {
        const { error: restoreError } = await serviceClient.auth.admin
          .updateUserById(userId, { ban_duration: "none" });
        if (restoreError) {
          logFailure(requestId, "remove_auth_compensation", restoreError);
          throw new HttpError(
            500,
            "Account removal failed and the active account could not be restored. An Administrator must review it immediately.",
          );
        }
      }
      throw new HttpError(
        authorizationError.code === "23514" || authorizationError.code === "55000"
          ? 409
          : authorizationError.code === "42501"
          ? 403
          : authorizationError.code === "22023"
          ? 400
          : 500,
        authorizationError.code === "23514" || authorizationError.code === "55000"
          ? "The last active Administrator cannot be removed."
          : authorizationError.code === "42501"
          ? authorizationError.message
          : authorizationError.code === "22023"
          ? authorizationError.message
          : "The staff account could not be prepared for removal.",
        authorizationError.code === "42501"
          ? "not_authorized"
          : authorizationError.code === "23514" || authorizationError.code === "55000"
          ? "protected_account"
          : "server_error",
      );
    }
  }

  const { error: authRemovalError } = await serviceClient.auth.admin.deleteUser(userId);
  if (authRemovalError) {
    const { data: remainingAuth, error: verifyError } = await serviceClient.auth.admin
      .getUserById(userId);
    if (verifyError?.status === 404 || (!verifyError && !remainingAuth.user)) {
      return jsonResponse(200, {
        user_id: userId,
        status: "Removed",
        auth_removed: true,
        request_id: requestId,
      });
    }
    let accountRemainsBlocked = true;
    if (!verifyError && remainingAuth.user && profile?.account_status === "Active") {
      const { error: restoreError } = await serviceClient.auth.admin
        .updateUserById(userId, { ban_duration: "none" });
      if (restoreError) {
        logFailure(requestId, "remove_auth_compensation", restoreError);
        throw new HttpError(
          500,
          "Account removal failed and the active account could not be restored. An Administrator must review it immediately.",
        );
      }
      accountRemainsBlocked = false;
    }
    logFailure(requestId, "remove_auth_user", authRemovalError);
    if (verifyError) logFailure(requestId, "verify_auth_removal", verifyError);
    throw new HttpError(
      502,
      accountRemainsBlocked
        ? "Supabase Auth could not complete account removal. The account remains blocked; retry Remove or contact an Administrator."
        : "Supabase Auth could not complete account removal. The account remains in the staff list and sign-in was restored; retry Remove.",
    );
  }

  return jsonResponse(200, {
    user_id: userId,
    status: "Removed",
    auth_removed: true,
    request_id: requestId,
  });
}

async function cancelInvitation(
  requestId: string,
  body: JsonRecord,
  actorId: string,
  serviceClient: ReturnType<typeof createServiceClient>,
): Promise<Response> {
  const allowedFields = new Set(["action", "invitation_id"]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new HttpError(400, "The cancellation request contains unsupported fields.");
  }
  const invitationId = requireUuid(body.invitation_id, "Invitation ID");
  const { data: invitation, error: invitationError } = await serviceClient
    .from("user_invites")
    .select("id,email,status")
    .eq("id", invitationId)
    .maybeSingle();
  if (invitationError) {
    logFailure(requestId, "cancel_invitation_lookup", invitationError);
    throw new HttpError(500, "Could not load the invitation to cancel.");
  }
  if (!invitation) throw new HttpError(404, "The invitation was not found.");
  if (invitation.status === "Accepted") {
    throw new HttpError(
      409,
      "This invitation was accepted. Deactivate the staff account instead.",
    );
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id,account_status")
    .eq("email", invitation.email)
    .maybeSingle();
  if (profileError) {
    logFailure(requestId, "cancel_profile_lookup", profileError);
    throw new HttpError(500, "Could not verify the invited account.");
  }
  if (
    profile &&
    !["Pending", "Cancelled"].includes(profile.account_status)
  ) {
    throw new HttpError(
      409,
      "This invitation is linked to an active or deactivated account; manage the account separately.",
    );
  }

  let authUserConfirmed = false;
  let newlyBanned = false;
  if (profile) {
    const { data: authData, error: authLookupError } = await serviceClient.auth
      .admin.getUserById(profile.id);
    if (authLookupError && authLookupError.status !== 404) {
      logFailure(requestId, "cancel_auth_user_lookup", authLookupError);
      throw new HttpError(500, "Could not verify the invited Auth account.");
    }
    authUserConfirmed = Boolean(authData.user?.email_confirmed_at);
    if (authData.user && !authUserConfirmed) {
      const currentBanExpiry = authData.user.banned_until
        ? new Date(authData.user.banned_until).getTime()
        : 0;
      if (currentBanExpiry <= Date.now()) {
        const { data: banData, error: banError } = await serviceClient.auth.admin
          .updateUserById(profile.id, { ban_duration: "876000h" });
        if (banError) {
          logFailure(requestId, "cancel_ban_unconfirmed_user", banError);
          throw new HttpError(
            502,
            "Supabase Auth could not revoke the pending invite. No invitation data was changed.",
          );
        }
        newlyBanned = true;
        authUserConfirmed = Boolean(banData.user?.email_confirmed_at);
      }
    }
  }

  const { data: targetUserId, error: cancelError } = await serviceClient.rpc(
    "costtrack_cancel_user_invitation",
    {
      p_invitation_id: invitationId,
      p_actor_id: actorId,
    },
  );
  if (cancelError) {
    logFailure(requestId, "cancel_invitation", cancelError);
    if (newlyBanned && profile) {
      const { error: unbanError } = await serviceClient.auth.admin
        .updateUserById(profile.id, { ban_duration: "none" });
      if (unbanError) {
        logFailure(requestId, "cancel_auth_compensation", unbanError);
        throw new HttpError(
          500,
          "Cancellation was rejected and Supabase Auth could not restore the pending account. An Administrator must review it.",
        );
      }
    }
    throw new HttpError(
      cancelError.code === "55000" ? 409 : 500,
      cancelError.code === "55000"
        ? cancelError.message
        : "The invitation could not be cancelled.",
    );
  }

  if (typeof targetUserId === "string") {
    if (authUserConfirmed) {
      const { error: banError } = await serviceClient.auth.admin.updateUserById(
        targetUserId,
        { ban_duration: "876000h" },
      );
      if (banError) {
        logFailure(requestId, "cancel_confirmed_auth_user", banError);
        throw new HttpError(
          502,
          "The invitation is cancelled, but the verified Auth account could not be blocked. Review it in Supabase Auth immediately.",
        );
      }
      return jsonResponse(200, {
        invitation_id: invitationId,
        status: "Cancelled",
        account_removed: false,
        account_blocked: true,
        request_id: requestId,
      });
    }

    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(
      targetUserId,
    );
    if (deleteError && deleteError.status !== 404) {
      logFailure(requestId, "cancel_delete_unconfirmed_user", deleteError);
      throw new HttpError(
        502,
        "The invitation is cancelled and access is blocked, but the unconfirmed Auth account could not be removed. Retry cancellation.",
      );
    }
  }

  return jsonResponse(200, {
    invitation_id: invitationId,
    status: "Cancelled",
    account_removed: typeof targetUserId === "string" && !authUserConfirmed,
    request_id: requestId,
  });
}

async function handleRequest(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, {
      error: "Method not allowed.",
      message: "Method not allowed.",
      code: "method_not_allowed",
      request_id: requestId,
    });
  }
  if (
    !request.headers.get("content-type")?.toLowerCase().includes(
      "application/json",
    )
  ) {
    return jsonResponse(415, {
      error: "Content-Type must be application/json.",
      message: "Content-Type must be application/json.",
      code: "invalid_content_type",
      request_id: requestId,
    });
  }

  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }

    const authorization = request.headers.get("authorization") ?? "";
    const token = getBearerToken(request);
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: authorization } },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(
      token,
    );
    if (userError || !userData.user) {
      throw new HttpError(401, "The signed-in session is invalid or expired.");
    }

    const { data: callerProfile, error: callerProfileError } = await userClient
      .from("profiles")
      .select("role,account_status")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (callerProfileError) {
      logFailure(requestId, "caller_profile_lookup", callerProfileError);
      throw new HttpError(500, "Could not verify the signed-in user role.");
    }

    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      throw new HttpError(400, "Request body must contain valid JSON.");
    }
    const body = getObject(parsedBody);

    if (
      requiresAdministratorForUserAction(body.action) &&
      (
        callerProfile?.role !== "Administrator" ||
        callerProfile.account_status !== "Active"
      )
    ) {
      throw new HttpError(
        403,
        "Only active Administrators can manage staff accounts and invitations.",
        "not_administrator",
      );
    }
    if (!isSupportedUserAction(body.action)) {
      throw new HttpError(400, "A supported invitation or account action is required.");
    }

    const serviceClient = createServiceClient(
      supabaseUrl,
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );

    if (body.action === "invite") {
      return await createInvitation(
        requestId,
        body,
        userData.user.id,
        serviceClient,
        getRedirectUrl(),
      );
    }

    if (body.action === "create_account") {
      return await createUserAccount(
        requestId,
        body,
        userData.user.id,
        serviceClient,
      );
    }

    if (body.action === "resend") {
      return await resendInvitation(
        requestId,
        body,
        userData.user.id,
        serviceClient,
        getRedirectUrl(),
      );
    }

    if (body.action === "accept") {
      return await acceptInvitation(
        requestId,
        body,
        userData.user,
        serviceClient,
      );
    }
    if (body.action === "cancel") {
      return await cancelInvitation(
        requestId,
        body,
        userData.user.id,
        serviceClient,
      );
    }
    if (body.action === "deactivate" || body.action === "reactivate") {
      return await setUserAccountStatus(
        requestId,
        body,
        body.action,
        userData.user.id,
        serviceClient,
      );
    }
    if (body.action === "remove_user") {
      return await removeUserAccount(
        requestId,
        body,
        userData.user.id,
        serviceClient,
      );
    }
    throw new HttpError(400, "A supported invitation or account action is required.");
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(error.status, {
        error: error.message,
        message: error.message,
        code: error.code,
        request_id: requestId,
      });
    }
    logFailure(requestId, "unhandled_request", error);
    return jsonResponse(500, {
      error: "The invitation request could not be completed.",
      message: "The invitation request could not be completed.",
      code: "server_error",
      request_id: requestId,
    });
  }
}

Deno.serve(handleRequest);
