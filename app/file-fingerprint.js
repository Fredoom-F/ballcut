(function attachFileFingerprint(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuFileFingerprint = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createFileFingerprint() {
  function toHex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function quickFileFingerprint(file, cryptoApi = globalThis.crypto) {
    if (!file || typeof file.slice !== "function" || !cryptoApi?.subtle) return "";
    const sampleBytes = 64 * 1024;
    const first = new Uint8Array(await file.slice(0, sampleBytes).arrayBuffer());
    const lastStart = Math.max(0, Number(file.size) - sampleBytes);
    const last = new Uint8Array(await file.slice(lastStart, Number(file.size)).arrayBuffer());
    const metadata = new TextEncoder().encode(`${Number(file.size) || 0}|`);
    const combined = new Uint8Array(metadata.length + first.length + last.length);
    combined.set(metadata, 0);
    combined.set(first, metadata.length);
    combined.set(last, metadata.length + first.length);
    const digest = await cryptoApi.subtle.digest("SHA-256", combined);
    return toHex(new Uint8Array(digest));
  }

  return { quickFileFingerprint };
}));
