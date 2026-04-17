// @vitest-environment node
// @vitest-environment node
import { test, expect, vi, beforeEach } from "vitest";
import { jwtVerify, SignJWT } from "jose";

vi.mock("server-only", () => ({}));

const mockCookieSet = vi.fn();
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({ set: mockCookieSet, get: mockCookieGet })),
}));

import { createSession, getSession } from "@/lib/auth";

const DEFAULT_SECRET = new TextEncoder().encode("development-secret-key");

beforeEach(() => {
  vi.clearAllMocks();
});

test("createSession sets an auth-token cookie", async () => {
  await createSession("user-123", "test@example.com");

  expect(mockCookieSet).toHaveBeenCalledOnce();
  expect(mockCookieSet.mock.calls[0][0]).toBe("auth-token");
});

test("createSession cookie has correct options", async () => {
  await createSession("user-123", "test@example.com");

  const options = mockCookieSet.mock.calls[0][2];
  expect(options.httpOnly).toBe(true);
  expect(options.sameSite).toBe("lax");
  expect(options.path).toBe("/");
  expect(options.secure).toBe(false); // NODE_ENV is 'test', not 'production'
});

test("createSession cookie expires in 7 days", async () => {
  const before = Date.now();
  await createSession("user-123", "test@example.com");
  const after = Date.now();

  const options = mockCookieSet.mock.calls[0][2];
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  expect(options.expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
  expect(options.expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
});

test("createSession JWT contains correct userId and email", async () => {
  await createSession("user-123", "test@example.com");

  const token = mockCookieSet.mock.calls[0][1];
  const { payload } = await jwtVerify(token, DEFAULT_SECRET);

  expect(payload.userId).toBe("user-123");
  expect(payload.email).toBe("test@example.com");
});

test("createSession JWT uses HS256 algorithm", async () => {
  await createSession("user-123", "test@example.com");

  const token = mockCookieSet.mock.calls[0][1];
  const { protectedHeader } = await jwtVerify(token, DEFAULT_SECRET);

  expect(protectedHeader.alg).toBe("HS256");
});

test("createSession JWT expires in 7 days", async () => {
  const before = Math.floor(Date.now() / 1000);
  await createSession("user-123", "test@example.com");
  const after = Math.floor(Date.now() / 1000);

  const token = mockCookieSet.mock.calls[0][1];
  const { payload } = await jwtVerify(token, DEFAULT_SECRET);

  const sevenDaysSeconds = 7 * 24 * 60 * 60;
  expect(payload.exp).toBeGreaterThanOrEqual(before + sevenDaysSeconds - 5);
  expect(payload.exp).toBeLessThanOrEqual(after + sevenDaysSeconds + 5);
});

test("createSession JWT is invalid with wrong secret", async () => {
  await createSession("user-123", "test@example.com");

  const token = mockCookieSet.mock.calls[0][1];
  const wrongSecret = new TextEncoder().encode("wrong-secret");

  await expect(jwtVerify(token, wrongSecret)).rejects.toThrow();
});

// --- getSession ---

async function makeToken(
  payload: object,
  secret = DEFAULT_SECRET,
  expiresIn = "7d"
) {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(secret);
}

test("getSession returns null when no cookie is present", async () => {
  mockCookieGet.mockReturnValue(undefined);

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns the session payload for a valid token", async () => {
  const token = await makeToken({ userId: "user-123", email: "test@example.com" });
  mockCookieGet.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session?.userId).toBe("user-123");
  expect(session?.email).toBe("test@example.com");
});

test("getSession returns null for a malformed token", async () => {
  mockCookieGet.mockReturnValue({ value: "not.a.valid.jwt" });

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for an expired token", async () => {
  const token = await makeToken(
    { userId: "user-123", email: "test@example.com" },
    DEFAULT_SECRET,
    "-1s"
  );
  mockCookieGet.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).toBeNull();
});

test("getSession returns null for a token signed with the wrong secret", async () => {
  const wrongSecret = new TextEncoder().encode("wrong-secret");
  const token = await makeToken(
    { userId: "user-123", email: "test@example.com" },
    wrongSecret
  );
  mockCookieGet.mockReturnValue({ value: token });

  const session = await getSession();
  expect(session).toBeNull();
});
