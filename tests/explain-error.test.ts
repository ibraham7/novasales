import { test } from "node:test";
import assert from "node:assert/strict";
import { explainError, errorDetailsAllowed, setErrorDetailsAllowed } from "../src/lib/explain-error.ts";

const e = (message: string) => explainError(new Error(message));

test("a disconnected WhatsApp number is named as such", () => {
  const r = e("Evolution API خطأ 500: Connection Closed");
  assert.match(r.friendly, /غير متصل/);
  assert.match(r.technical!, /Connection Closed/);
  assert.match(e("Evolution API خطأ 500").friendly, /Evolution/);
});

test("database errors say what kind of rule was broken, and which one", () => {
  assert.match(e('duplicate key value violates unique constraint "ob_prospects_unique"').friendly, /مكررة.*ob_prospects_unique/);
  assert.match(e('insert or update on table "x" violates foreign key constraint "x_session_fkey"').friendly, /مرتبط بسجل آخر.*x_session_fkey/);
  assert.match(e('new row for relation "t" violates check constraint "t_status_check"').friendly, /غير مسموحة.*t_status_check/);
  assert.match(e('null value in column "name" of relation "t" violates not-null constraint').friendly, /الحقل: name/);
  assert.match(e('new row violates row-level security policy for table "t"').friendly, /الصلاحيات/);
  assert.match(e("Could not find the table 'public.x' in the schema cache").friendly, /ينقص تحديث/);
  assert.match(e('column "reply_jid" does not exist').friendly, /ينقص تحديث/);
  assert.match(e("canceling statement due to statement timeout").friendly, /وقتاً طويلاً/);
});

test("permission, session and network problems are explained", () => {
  assert.match(e('Forbidden: missing permission "crm.leads.assign"').friendly, /الصلاحية: crm\.leads\.assign/);
  assert.match(e("Unauthorized: invalid session").friendly, /انتهت الجلسة/);
  assert.match(e("fetch failed").friendly, /الشبكة/);
  assert.match(e("connect ECONNREFUSED 127.0.0.1:5432").friendly, /الشبكة/);
});

test("our own Arabic messages pass through untouched; anything unknown keeps its reason for the manager", () => {
  assert.deepEqual(e("لا تملك صلاحية إرسال رسالة في هذه المحادثة"), { friendly: "لا تملك صلاحية إرسال رسالة في هذه المحادثة", technical: null });
  const unknown = e("Cannot read properties of undefined (reading 'id')");
  assert.equal(unknown.friendly, "حدث خطأ غير متوقع");
  assert.match(unknown.technical!, /reading 'id'/);
  assert.equal(explainError("").friendly, "حدث خطأ غير متوقع");
  assert.ok(explainError(new Error("x".repeat(1000))).technical!.length <= 401);
});

test("the technical reason is for managers only", () => {
  assert.equal(errorDetailsAllowed(), false);
  setErrorDetailsAllowed(true);
  assert.equal(errorDetailsAllowed(), true);
  setErrorDetailsAllowed(false);
});
