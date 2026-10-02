export async function dashboardRows(makeQuery: () => any) {
  const rows: any[] = [];
  for (let offset = 0; ;) {
    const { data, error } = await makeQuery().range(offset, offset + 499);
    if (error) {
      console.error("[Dashboard database]", error);
      throw new Error("تعذر تحميل بيانات لوحة التحكم؛ أعد المحاولة أو تواصل مع الإدارة");
    }
    if (!data?.length) return rows;
    rows.push(...data);
    offset += data.length;
  }
}
