(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OffersSeedCodec = factory();
})(globalThis, () => {
  const prefix = 'window.__OFFERS_SEED_ENCRYPTED__ = ';
  const encodeBase64 = (bytes) => {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    return btoa(chunks.join(''));
  };
  const decodeBase64 = (text) => Uint8Array.from(atob(text.replace(/\s/g, '')), (char) => char.charCodeAt(0));
  const sha256 = async (value) => {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  };
  const collectionsHash = (payload) => sha256(JSON.stringify(canonical(payload.collections || payload)));
  const parseScript = (source) => {
    const text = source.trim();
    if (!text.startsWith(prefix) || !text.endsWith(';')) throw new Error('Неизвестный формат seed-data.js');
    const seed = JSON.parse(text.slice(prefix.length, -1));
    if (seed.version !== 1 || seed.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(seed.iterations)
      || seed.iterations < 100000 || seed.iterations > 2000000 || decodeBase64(seed.salt || '').length !== 16
      || decodeBase64(seed.iv || '').length !== 12 || decodeBase64(seed.data || '').length < 16) throw new Error('Неверные параметры шифрования бекапа');
    return seed;
  };
  const deriveKey = async (password, salt, iterations, usages) => {
    if (!password) throw new Error('Введите пароль сайта');
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, raw, { name: 'AES-GCM', length: 256 }, false, usages);
  };
  const decrypt = async (seed, password) => {
    try {
      const key = await deriveKey(password, decodeBase64(seed.salt), seed.iterations, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(seed.iv) }, key, decodeBase64(seed.data));
      const payload = JSON.parse(new TextDecoder().decode(plain));
      if (!payload.collections || !Array.isArray(payload.collections.works)) throw new Error('Invalid backup');
      return payload;
    } catch { throw new Error('Не удалось расшифровать опубликованную базу. Проверьте пароль сайта.'); }
  };
  const encrypt = async (payload, password, iterations = 250000) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, iterations, ['encrypt']);
    const json = JSON.stringify(payload);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json)));
    return { version: 1, kdf: 'PBKDF2-SHA256', iterations, salt: encodeBase64(salt), iv: encodeBase64(iv), data: encodeBase64(data), revision: await sha256(json) };
  };
  const revision = (seed) => seed.revision || sha256(JSON.stringify(seed));
  return { sha256, collectionsHash, canonical, parseScript, encrypt, decrypt, revision, decodeBase64,
    serialize: (seed) => `${prefix}${JSON.stringify(seed)};\n`, decodeText: (text) => new TextDecoder().decode(decodeBase64(text)) };
});
