/** Make ignored PostgREST errors impossible in health reads/writes. */
export function checkedDb(client: any): any {
  function wrap(query: any): any {
    return new Proxy(query, { get(target, key) {
      if (key === 'then') return (resolve: any, reject: any) => Promise.resolve(target).then((result: any) => {
        if (result.error) {
          console.error('[Number health database]', result.error);
          throw new Error('تعذر قراءة أو حفظ بيانات صحة الأرقام؛ حاول مجددًا أو تواصل مع إدارة النظام');
        }
        return result;
      }).then(resolve, reject);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? (...args: any[]) => wrap(value.apply(target, args)) : value;
    } });
  }
  return new Proxy(client, { get(target, key) {
    if (key === 'from' || key === 'rpc') return (...args: any[]) => wrap(target[key](...args));
    return Reflect.get(target, key);
  } });
}
/** Advance by actual returned length, even if the API caps pages below our request. */
export async function readAllRows(makeQuery: () => any, pageSize = 500): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; ) {
    const result = await makeQuery().range(offset, offset + pageSize - 1);
    if (result.error) throw new Error('تعذر تحميل إحصاءات الأرقام كاملة؛ حاول مجددًا');
    const page = result.data ?? [];
    if (!page.length) break;
    rows.push(...page); offset += page.length;
  }
  return rows;
}
