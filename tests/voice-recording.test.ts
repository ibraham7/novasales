import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RECORD_SECONDS, clock, pickRecordingMime, recordingFileName } from "../src/lib/voice-recording.ts";

test("the recording format is the first one the browser supports; webm when it says nothing", () => {
  assert.equal(pickRecordingMime(() => true), "audio/webm;codecs=opus");
  assert.equal(pickRecordingMime((m) => m === "audio/webm"), "audio/webm");
  assert.equal(pickRecordingMime((m) => m === "audio/mp4"), "audio/mp4", "Safari");
  assert.equal(pickRecordingMime(() => false), "audio/webm");
});

test("the timer reads m:ss", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(9), "0:09");
  assert.equal(clock(75), "1:15");
  assert.equal(clock(MAX_RECORD_SECONDS), "10:00");
});

test("the file name carries the right extension", () => {
  assert.equal(recordingFileName("audio/webm;codecs=opus", 5), "voice-5.webm");
  assert.equal(recordingFileName("audio/mp4", 5), "voice-5.m4a");
});
