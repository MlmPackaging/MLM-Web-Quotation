const crypto = require("crypto");

const secret = process.env.ADMIN_AUTH_SECRET || crypto.randomBytes(32);
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

function signature(payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function createAdminToken(user) {
  const payload = Buffer.from(JSON.stringify({
    user_id: user.user_id,
    email: user.user_email,
    expires_at: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function verifyAdminToken(token) {
  if (typeof token !== "string") return null;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;

  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!claims.user_id || !claims.email || claims.expires_at <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch (error) {
    return null;
  }
}

module.exports = { createAdminToken, verifyAdminToken };
