import { createClient } from "npm:@supabase/supabase-js@2";
import {
  classifyFaceSimilarity,
  faceDescriptorDistance,
  FaceLoginValidationError,
  parseFaceLoginPayload,
} from "./validation.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};
const MAX_BODY_BYTES = 4096;
const MAX_ATTEMPTS = 10;
const RATE_WINDOW_SECONDS = 600;
const PROFILE_BATCH_SIZE = 200;

type JsonRecord = Record<string, unknown>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = status >= 500
      ? "server_error"
      : status === 401
      ? "face_not_recognized"
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

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new HttpError(500, "Face sign-in is not configured.");
  }
  return value;
}

function redirectUrl(): string {
  const value = requiredEnv("INVITE_REDIRECT_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(500, "Face sign-in redirect URL is invalid.");
  }
  const isLocalHttp = url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new HttpError(500, "Face sign-in redirect URL must use HTTPS.");
  }
  return url.toString();
}

function createServiceClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function requestIp(request: Request): string {
  const forwardedIp = request.headers.get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwardedIp ||
    "unknown";
}

async function hashIp(ip: string, serviceRoleKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${serviceRoleKey}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    throw new HttpError(415, "A JSON face scan is required.");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "The face scan request is too large.");
  }
  if (!request.body) throw new HttpError(400, "A face scan is required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "The face scan request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "A valid JSON face scan is required.");
  }
}

function logFailure(
  requestId: string,
  operation: string,
  error: unknown,
): void {
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : error instanceof Error
      ? error.name
      : "unknown_error";
  console.error(JSON.stringify({
    event: "roms_face_login_failed",
    request_id: requestId,
    operation,
    error_code: /^[a-z0-9_-]{1,64}$/i.test(errorCode)
      ? errorCode
      : "unknown_error",
  }));
}

async function checkRateLimit(
  request: Request,
  serviceClient: ReturnType<typeof createServiceClient>,
  serviceRoleKey: string,
  requestId: string,
): Promise<void> {
  const ipHash = await hashIp(requestIp(request), serviceRoleKey);
  const { data: allowed, error } = await serviceClient.rpc(
    "costtrack_check_face_login_rate_limit",
    {
      p_ip_hash: ipHash,
      p_limit: MAX_ATTEMPTS,
      p_window_seconds: RATE_WINDOW_SECONDS,
    },
  );
  if (error) {
    logFailure(requestId, "rate_limit_check", error);
    throw new HttpError(500, "Face sign-in is temporarily unavailable.");
  }
  if (allowed !== true) {
    throw new HttpError(
      429,
      "Too many face sign-in attempts. Wait a few minutes or use your password.",
      "rate_limited",
    );
  }
}

async function findMatchingProfile(
  serviceClient: ReturnType<typeof createServiceClient>,
  descriptor: number[],
  requestId: string,
): Promise<{ status: "match"; email: string } | { status: "partial_match" } | null> {
  const matches: Array<{ email: string }> = [];
  let partialMatches = 0;
  for (let offset = 0;; offset += PROFILE_BATCH_SIZE) {
    const { data: profileBatch, error: profileError } = await serviceClient
      .from("profiles")
      .select("id,email")
      .eq("account_status", "Active")
      .range(offset, offset + PROFILE_BATCH_SIZE - 1);
    if (profileError) {
      logFailure(requestId, "active_profile_lookup", profileError);
      throw new HttpError(500, "Face sign-in is temporarily unavailable.");
    }
    if (!profileBatch?.length) break;

    const profileById = new Map(
      profileBatch.map((profile) => [profile.id, profile]),
    );
    const { data: templates, error: templateError } = await serviceClient
      .from("user_face_templates")
      .select("user_id,descriptor")
      .in("user_id", profileBatch.map((profile) => profile.id));
    if (templateError) {
      logFailure(requestId, "face_template_lookup", templateError);
      throw new HttpError(500, "Face sign-in is temporarily unavailable.");
    }

    for (const template of templates ?? []) {
      const profile = profileById.get(template.user_id);
      if (!profile || typeof profile.email !== "string") continue;
      let distance: number;
      try {
        distance = faceDescriptorDistance(descriptor, template.descriptor);
      } catch (error) {
        logFailure(requestId, "stored_template_validation", error);
        throw new HttpError(500, "Face sign-in is temporarily unavailable.");
      }
      const matchStatus = classifyFaceSimilarity(distance);
      if (matchStatus === "match") {
        matches.push({ email: profile.email });
      } else if (matchStatus === "partial_match") {
        partialMatches += 1;
      }
    }
    if (profileBatch.length < PROFILE_BATCH_SIZE) break;
  }

  if (matches.length === 1) return { status: "match", email: matches[0].email };
  if (matches.length > 1 || partialMatches === 0) return null;
  return { status: "partial_match" };
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { message: "Only POST is supported." });
  }

  const requestId = crypto.randomUUID();
  try {
    const url = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const body = await readJsonBody(request);
    let payload;
    try {
      payload = parseFaceLoginPayload(body);
    } catch (error) {
      if (error instanceof FaceLoginValidationError) {
        throw new HttpError(400, error.message);
      }
      throw error;
    }

    const serviceClient = createServiceClient(url, serviceRoleKey);
    await checkRateLimit(request, serviceClient, serviceRoleKey, requestId);
    const profileMatch = await findMatchingProfile(
      serviceClient,
      payload.descriptor,
      requestId,
    );
    if (profileMatch?.status === "partial_match") {
      throw new HttpError(
        401,
        "Face partially matches. Please retake the scan.",
        "face_partial_match",
      );
    }
    if (!profileMatch) {
      throw new HttpError(
        401,
        "Face does not match the registered user.",
        "face_not_recognized",
      );
    }

    const { data, error } = await serviceClient.auth.admin.generateLink({
      type: "magiclink",
      email: profileMatch.email,
      options: { redirectTo: redirectUrl() },
    });
    const tokenHash = data?.properties?.hashed_token;
    if (error || typeof tokenHash !== "string" || tokenHash.length < 20) {
      logFailure(
        requestId,
        "magic_link_generation",
        error ?? new Error("Missing token hash."),
      );
      throw new HttpError(500, "Face sign-in could not create a ROMS session.");
    }
    return jsonResponse(200, { token_hash: tokenHash, request_id: requestId });
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
      error: "Face sign-in could not be completed.",
      message: "Face sign-in could not be completed.",
      code: "server_error",
      request_id: requestId,
    });
  }
}

Deno.serve(handleRequest);
