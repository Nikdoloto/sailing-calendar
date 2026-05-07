const crypto = require('node:crypto');

const SCRYPT_KEY_LENGTH = 64;

function createPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .scryptSync(String(password), salt, SCRYPT_KEY_LENGTH)
    .toString('hex');

  return {
    hash,
    salt
  };
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = crypto.scryptSync(
    String(password),
    salt,
    SCRYPT_KEY_LENGTH
  );
  const expected = Buffer.from(expectedHash, 'hex');

  if (actualHash.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualHash, expected);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index === -1) {
        return cookies;
      }

      const name = part.slice(0, index);
      const value = part.slice(index + 1);
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  parts.push(`Path=${options.path ?? '/'}`);

  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }

  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);

  if (options.secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

module.exports = {
  createPasswordHash,
  verifyPassword,
  createSessionToken,
  hashToken,
  parseCookies,
  serializeCookie
};
