import { toast } from "@/lib/toast";

export function validateControls(scope: ParentNode): boolean {
  const controls = Array.from(scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | HTMLSelectElement>('input, textarea, select, [data-required-select]'));
  for (const control of controls) {
    if (scope instanceof Element && control.closest('[data-validation-scope]') && control.closest('[data-validation-scope]') !== scope) continue;
    if (control.disabled || control.closest('[hidden], [aria-hidden="true"]')) continue;
    if (control instanceof HTMLButtonElement) {
      if (!control.hasAttribute('data-placeholder')) continue;
      toast.error(`${control.getAttribute('aria-label') ?? 'الاختيار'}: هذا الحقل إلزامي`);
      control.focus(); return false;
    }
    control.setCustomValidity('');
    const name = control.getAttribute('aria-label') ?? control.labels?.[0]?.textContent ?? 'الحقل';
    let error = '';
    if (control.required && !control.value.trim()) error = `${name}: هذا الحقل إلزامي`;
    else if (control.value && 'minLength' in control && control.minLength > 0 && control.value.length < control.minLength) error = `${name}: أدخل ${control.minLength} حرفًا على الأقل`;
    else if (control.value && 'maxLength' in control && control.maxLength > 0 && control.value.length > control.maxLength) error = `${name}: الحد الأقصى ${control.maxLength} حرفًا`;
    else if (!control.validity.valid) error = `${name}: ${control.validity.typeMismatch ? 'الصيغة غير صحيحة' : control.validity.rangeUnderflow ? `يجب ألا تقل القيمة عن ${(control as HTMLInputElement).min}` : control.validity.rangeOverflow ? `يجب ألا تتجاوز القيمة ${(control as HTMLInputElement).max}` : 'أدخل قيمة صحيحة'}`;
    if (error) { control.setCustomValidity(error); control.setAttribute('aria-invalid','true'); toast.error(error); control.focus(); control.reportValidity(); return false; }
    control.removeAttribute('aria-invalid');
  }
  for (const group of Array.from(scope.querySelectorAll<HTMLElement>('[data-required-group]'))) {
    if (group.querySelector('[data-state="checked"], input:checked')) continue;
    toast.error(`${group.getAttribute('aria-label') ?? 'الاختيارات'}: اختر عنصرًا واحدًا على الأقل`);
    group.querySelector<HTMLElement>('button, input')?.focus(); return false;
  }
  return true;
}
export function validateAction(button: HTMLElement): boolean {
  const scope = button.closest('[data-validation-scope], [role="dialog"], form') ?? button.closest('[data-slot="card"]') ?? button.parentElement?.parentElement;
  return scope ? validateControls(scope) : true;
}
