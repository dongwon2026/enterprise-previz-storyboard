// Design Ref: DESIGN.md §2 데이터 흐름 ⑤ — PIN 인증 세션 쿠키를 서명하고 검증하는 유틸
// Node.js 런타임(API 라우트)과 proxy.ts 양쪽에서 모두 동작해야 하므로
// Node 전용 API(Buffer 등) 대신 표준 Web Crypto(crypto.subtle, btoa)만 사용한다.

export const SESSION_COOKIE_NAME = "ena_previz_session";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12시간 (DESIGN.md 결정)

function getSecret(): string {
  const pin = process.env.APP_ACCESS_PIN;
  if (!pin) {
    throw new Error("APP_ACCESS_PIN 환경변수가 설정되어 있지 않습니다.");
  }
  return pin;
}

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bufferToBase64Url(signature);
}

// 타이밍 공격을 피하기 위해 길이·문자를 한 번에 비교하지 않고 끝까지 훑는다
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** PIN 인증 성공 시 발급할 쿠키 값과 유효기간(초)을 만든다 */
export async function createSessionCookieValue(): Promise<{
  value: string;
  maxAgeSeconds: number;
}> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = await hmac(String(expiresAt));
  return { value: `${expiresAt}.${signature}`, maxAgeSeconds: SESSION_TTL_MS / 1000 };
}

/** 쿠키 값이 만료되지 않았고 서버가 발급한 것이 맞는지 확인한다 */
export async function isValidSessionCookie(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [expiresAtRaw, signature] = value.split(".");
  if (!expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = await hmac(expiresAtRaw);
  return timingSafeEqual(expected, signature);
}
