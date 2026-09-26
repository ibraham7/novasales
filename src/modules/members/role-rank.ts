export const ROLE_RANK: Record<string, number> = {
  owner: 4,
  supervisor: 3,
  department_supervisor: 2,
  sales: 1,
};

export const ROLE_LABELS: Record<string, { name: string; description: string }> = {
  owner: {
    name: "مالك المؤسسة",
    description: "صلاحية كاملة على كل الصفحات والإعدادات والفوترة والأدوار.",
  },
  supervisor: {
    name: "مشرف عام",
    description:
      "قمع المبيعات مع الإسناد وحذف التذاكر، جهات الاتصال، الأتمتة، الحملات، الأقسام والفرق، جلسات واتساب، الفوترة، وإعدادات (المؤسسة، الملف الشخصي، الأعضاء).",
  },
  department_supervisor: {
    name: "مشرف قسم",
    description:
      "قمع المبيعات ضمن قسمه مع الإسناد وحذف التذاكر، جهات الاتصال، الحملات، جلسات واتساب، وإعدادات (المؤسسة، الملف الشخصي، الأعضاء).",
  },
  sales: {
    name: "مندوب مبيعات",
    description:
      "قمع المبيعات لتذاكره فقط مع تحريك المراحل، بدون إسناد أو حذف. من الإعدادات: الملف الشخصي فقط.",
  },
};
