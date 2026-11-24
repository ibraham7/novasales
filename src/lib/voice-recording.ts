/** Pure helpers of the voice-note recorder (the recorder itself is the hook in components/chat/use-voice-recorder.ts). */

/** Recordings longer than this stop and are sent by themselves (a voice note, not a meeting). */
export const MAX_RECORD_SECONDS = 10 * 60;
/** Anything smaller than this many bytes is an accidental tap, not a message. */
export const MIN_RECORDING_BYTES = 500;

/** The first recording format the browser supports (Chrome and Firefox: webm/opus; Safari: mp4). */
export function pickRecordingMime(isSupported: (mime: string) => boolean): string {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(isSupported) ?? "audio/webm";
}

/** m:ss for the recording timer. */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The file name a recording is sent under. */
export const recordingFileName = (mime: string, at: number) => `voice-${at}${mime.includes("mp4") ? ".m4a" : ".webm"}`;
