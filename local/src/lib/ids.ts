// ULID_ALPHABET 使用 Crockford Base32 字符集，去掉了易混淆字符。
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
// ULID_REGEX 用来校验邀请码和业务主键是否满足 ULID 规范。
const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

// randomChar 负责从 Crockford Base32 字符表里随机取一个字符。
function randomChar() {
  return ULID_ALPHABET[Math.floor(Math.random() * ULID_ALPHABET.length)];
}

// encodeTime 把毫秒时间戳前缀编码成 Crockford Base32。
// value 是原始时间戳，len 表示最终输出长度。
function encodeTime(value: number, len: number) {
  let out = "";
  let v = Math.floor(value);
  for (let i = len - 1; i >= 0; i -= 1) {
    out = ULID_ALPHABET[v % 32] + out;
    v = Math.floor(v / 32);
  }
  return out;
}

// createUlid 为本地业务记录生成可排序的 ULID。
export function createUlid() {
  const timePart = encodeTime(Date.now(), 10);
  let randomPart = "";
  for (let i = 0; i < 16; i += 1) {
    randomPart += randomChar();
  }
  return `${timePart}${randomPart}`;
}

// isUlid 用来校验应用里生成的邀请码和业务主键是否符合 ULID 格式。
export function isUlid(value: string) {
  return ULID_REGEX.test(value);
}

// nowTimestamp 统一提供毫秒时间戳，保证各模块时间来源一致。
export function nowTimestamp() {
  return Date.now();
}
