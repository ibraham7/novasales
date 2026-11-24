import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { MAX_RECORD_SECONDS, MIN_RECORDING_BYTES, pickRecordingMime } from "@/lib/voice-recording";

/**
 * Records a voice note from the microphone. `stop(true)` hands the recording to `onRecorded`; `stop(false)` throws it away.
 * The microphone is always released, also when the page is left in the middle of a recording.
 */
export function useVoiceRecorder(onRecorded: (blob: Blob, mime: string) => void | Promise<void>) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const sendRef = useRef(true);
  const callback = useRef(onRecorded);
  callback.current = onRecorded;

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setSeconds(0);
  }, []);

  const stop = useCallback((send: boolean) => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") return;
    sendRef.current = send;
    rec.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current?.state === "recording") return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("المتصفح لا يدعم تسجيل الصوت، أو الصفحة ليست على رابط آمن (https)");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickRecordingMime((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      sendRef.current = true;
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        release();
        if (sendRef.current && blob.size >= MIN_RECORDING_BYTES) void callback.current(blob, mime);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      release();
      toast.error("تعذّر الوصول للميكروفون. اسمح للموقع باستعماله من إعدادات المتصفح.");
    }
  }, [release]);

  // A long recording sends itself.
  useEffect(() => {
    if (recording && seconds >= MAX_RECORD_SECONDS) stop(true);
  }, [recording, seconds, stop]);

  // Leaving the page drops the recording and frees the microphone.
  useEffect(
    () => () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        sendRef.current = false;
        rec.stop();
      }
      release();
    },
    [release],
  );

  return { recording, seconds, start, stop };
}
