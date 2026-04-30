import { useEffect, useState } from "react";
import { apiGetOptional } from "../api";

export interface CategoryOption {
  id: number;
  name: string;
}

type CatRow = { id: number; name: string; isActive: number };

function extractActive(data: { categories: CatRow[] }): CategoryOption[] {
  return data.categories.filter((c) => c.isActive === 1).map((c) => ({ id: c.id, name: c.name }));
}

export function useCategoryOptions(groupId: number | null): CategoryOption[] {
  const [options, setOptions] = useState<CategoryOption[]>([]);

  useEffect(() => {
    const qs = groupId != null ? `?groupId=${groupId}` : "";
    void apiGetOptional<{ categories: CatRow[] }>(`/api/memo-context/structure${qs}`).then((r) => {
      if (!r.ok) return;
      const cats = extractActive(r.data);
      // Mirror the processor fallback: if the group has no categories, use globals (groupId=null).
      if (cats.length === 0 && groupId != null) {
        void apiGetOptional<{ categories: CatRow[] }>("/api/memo-context/structure").then((r2) => {
          if (r2.ok) setOptions(extractActive(r2.data));
        });
      } else {
        setOptions(cats);
      }
    });
  }, [groupId]);

  return options;
}
