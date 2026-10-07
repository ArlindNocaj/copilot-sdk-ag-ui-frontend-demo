import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const docs = new URL("../docs/", import.meta.url);
const html = readFileSync(new URL("index.html", docs), "utf8");
const manifestSource = readFileSync(new URL("manifest.js", docs), "utf8");
const context = { window: {} };
vm.runInNewContext(manifestSource, context);
vm.runInNewContext(html.match(/<script id="gallery-logic">([\s\S]*?)<\/script>/)[1], context);
const manifest = context.window.DOJO_MEDIA;
const gallery = context.window.DojoGallery;

test("public gallery focuses on demos rather than audit history", () => {
  assert.doesNotMatch(html, /id="(?:known-limitations|review-notes|recording-notes|current-status|program-totals|technical-provenance)"/);
  assert.doesNotMatch(manifestSource, /"statusLabel"|"recordingNotes"|"notes"|malformed tool arguments|five-second initial trim|Fully disconnected operation/);
  assert.equal(manifest.demos.length, 12);
  for (const demo of manifest.demos) {
    assert.ok(demo.summary && demo.insight && demo.prompts.length);
    assert.ok(demo.chapters.length);
  }
});

test("all referenced media exist and asset paths remain restricted", () => {
  const library = gallery.collection(manifest);
  assert.equal(library.counts.clips, 12);
  for (const item of [...library.demos, library.mix]) {
    for (const path of [item.src, item.poster, item.silentSrc, item.inputImage?.src].filter(Boolean)) {
      assert.equal(gallery.localAsset(path), path);
      assert.ok(existsSync(new URL(path, docs)), path);
    }
  }
  for (const unsafe of ["https://example.com/clip.mp4", "../clip.mp4", "clips/../clip.mp4", "clips/%2e%2e/clip.mp4"]) {
    assert.equal(gallery.localAsset(unsafe), "");
  }
});

test("controls stay wired and genuine playback errors stay visible", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const match of html.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.has(match[1]), match[1]);
  const ui = html.match(/<script id="gallery-ui">([\s\S]*?)<\/script>/)[1];
  new vm.Script(ui);
  assert.match(ui, /video\.addEventListener\("error"/);
  assert.match(ui, /Recording could not be opened/);
  assert.match(ui, /\$\("retry-media"\)\.addEventListener/);
});

test("README preview opens the live Pages gallery", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /\[!\[[^\]]+\]\(docs\/posters\/highlights-v10\.jpg\)\]\(https:\/\/arlindnocaj\.github\.io\/copilot-sdk-ag-ui-frontend-demo\/\)/);
});
