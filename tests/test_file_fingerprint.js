const assert = require("assert");
const { webcrypto } = require("crypto");
const { quickFileFingerprint } = require("../app/file-fingerprint.js");

function fakeFile(bytes, name = "video.mp4") {
  return {
    name,
    size: bytes.length,
    lastModified: 123456,
    slice(start, end) {
      return new Blob([bytes.subarray(start, end)]);
    }
  };
}

(async () => {
  const bytes = Buffer.alloc(200000, 7);
  const first = await quickFileFingerprint(fakeFile(bytes), webcrypto);
  const second = await quickFileFingerprint(fakeFile(bytes), webcrypto);
  assert.strictEqual(first, second);
  assert.strictEqual(first.length, 64);
  const renamed = await quickFileFingerprint(fakeFile(bytes, "renamed.mov"), webcrypto);
  assert.strictEqual(first, renamed);

  const changedTail = Buffer.from(bytes);
  changedTail[changedTail.length - 1] = 8;
  const tailHash = await quickFileFingerprint(fakeFile(changedTail), webcrypto);
  assert.notStrictEqual(first, tailHash);

  const changedMiddle = Buffer.from(bytes);
  changedMiddle[100000] = 8;
  const middleHash = await quickFileFingerprint(fakeFile(changedMiddle), webcrypto);
  assert.strictEqual(first, middleHash);

  console.log("Quick file fingerprint tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
