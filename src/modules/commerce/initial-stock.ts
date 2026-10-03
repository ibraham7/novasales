import type { AttributeValue } from './product-attributes';
export type InitialBatchDraft = { key: string; batchCode: string; expiresOn: string; quantity: string };
export type InitialVariantDraft = { key: string; label: string; attributes: Record<string,AttributeValue>; batches: InitialBatchDraft[] };
export function initialStockPayload(rows:InitialVariantDraft[]) {
 const codes=new Set<string>();
 return rows.map((row,index)=>{
  if(!row.label.trim()) throw new Error(`اسم التركيبة ${index+1} إلزامي`);
  return {label:row.label.trim(),attributes:row.attributes,batches:row.batches.map((batch)=>{
   if(!batch.batchCode.trim()) throw new Error(`رقم الدفعة للتركيبة ${index+1} إلزامي`);
   const code=batch.batchCode.trim();if(codes.has(code)) throw new Error('رقم الدفعة مكرر؛ استخدم رقمًا مستقلًا لكل دفعة');codes.add(code);
   const quantity=Number(batch.quantity);
   if(!batch.quantity.trim()||!Number.isFinite(quantity)||quantity<=0||Math.abs(quantity*1000-Math.round(quantity*1000))>0.000001) throw new Error('كمية الدفعة يجب أن تكون أكبر من صفر وبثلاث خانات عشرية كحد أقصى');
   if(batch.expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(batch.expiresOn)||Number.isNaN(Date.parse(batch.expiresOn))||new Date(batch.expiresOn).toISOString().slice(0,10)!==batch.expiresOn)) throw new Error('تاريخ انتهاء الدفعة غير صالح');
   return {batchCode:code,expiresOn:batch.expiresOn||null,quantity};
  })};
 });
}
