import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const module = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL('../src/lib/validation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
new Function('require', 'module', 'exports', code)(require, module, module.exports);
const { z, arabicError } = module.exports;
test('required, email and numeric validation identify errors in Arabic', () => {
 const schema = z.object({ name: z.string().trim().min(1), email: z.string().email(), price: z.number().min(0) });
 const result = schema.safeParse({ name: '   ', email: 'bad', price: -1 });
 assert.equal(result.success, false);
 const message = arabicError(result.error);
 assert.match(message, /الاسم/); assert.match(message, /البريد الإلكتروني/); assert.match(message, /السعر/);
 assert.equal(schema.safeParse({ name: 'منتج', email: 'test@example.com', price: 0 }).success, true);
 assert.equal(arabicError(JSON.stringify(result.error.issues)), message);
});
test('authentication and server errors show actionable Arabic messages', () => {
 assert.match(arabicError('Invalid login credentials'), /كلمة المرور/);
 assert.match(arabicError('duplicate key value'), /مستخدمة بالفعل/);
 assert.match(arabicError('Failed to fetch'), /الاتصال/);
 assert.equal(arabicError('الكمية غير متاحة'), 'الكمية غير متاحة');
 assert.doesNotMatch(arabicError('unexpected internal error'), /internal/);
});
