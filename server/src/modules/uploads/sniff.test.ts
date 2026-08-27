import assert from "node:assert/strict";
import { test } from "node:test";
import { sniffImage } from "./sniff.ts";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const GIF = Buffer.from("GIF89a............", "latin1");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WEBP", "latin1"),
]);

test("recognises the four formats a browser can produce", () => {
  assert.deepEqual(sniffImage(PNG), { ext: "png" });
  assert.deepEqual(sniffImage(JPEG), { ext: "jpg" });
  assert.deepEqual(sniffImage(GIF), { ext: "gif" });
  assert.deepEqual(sniffImage(WEBP), { ext: "webp" });
});

test("a script is not an image, whatever it is named", () => {
  assert.equal(sniffImage(Buffer.from("<?php system($_GET[0]); ?>", "utf8")), null);
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>", "utf8")), null);
  assert.equal(sniffImage(Buffer.from("#!/bin/sh\\nrm -rf /", "utf8")), null);
});

test("an HTML file that merely mentions PNG is refused", () => {
  assert.equal(sniffImage(Buffer.from("<html>PNG</html>", "utf8")), null);
});

test("RIFF alone is not WebP — the container has to say so", () => {
  // A .wav file also starts with RIFF.
  const wav = Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.from([0x1a, 0, 0, 0]),
    Buffer.from("WAVE", "latin1"),
  ]);
  assert.equal(sniffImage(wav), null);
});

test("truncated and empty input is refused rather than throwing", () => {
  assert.equal(sniffImage(Buffer.alloc(0)), null);
  assert.equal(sniffImage(Buffer.from([137, 80])), null);
  assert.equal(sniffImage(Buffer.from([0xff])), null);
});

test("a PNG signature in the middle of a file does not count", () => {
  const trailing = Buffer.concat([Buffer.from("junk", "utf8"), PNG]);
  assert.equal(sniffImage(trailing), null);
});
