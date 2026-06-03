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
    if (groupId != null) {
      // Carrega grupo + globais em paralelo e mescla (sem duplicatas por id)
      void Promise.all([
        apiGetOptional<{ categories: CatRow[] }>(`/api/memo-context/structure?groupId=${groupId}`),
        apiGetOptional<{ categories: CatRow[] }>("/api/memo-context/structure"),
      ]).then(([groupResult, globalResult]) => {
        const groupCats = groupResult.ok ? extractActive(groupResult.data) : [];
        const globalCats = globalResult.ok ? extractActive(globalResult.data) : [];
        const seen = new Set(groupCats.map((c) => c.id));
        setOptions([...groupCats, ...globalCats.filter((c) => !seen.has(c.id))]);
      });
    } else {
      void apiGetOptional<{ categories: CatRow[] }>("/api/memo-context/structure").then((r) => {
        if (r.ok) setOptions(extractActive(r.data));
      });
    }
  }, [groupId]);

  return options;
}
