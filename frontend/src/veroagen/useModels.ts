import { useEffect, useState } from "react";
import { veroagenApi } from "./api";
import type { ModelCatalog } from "./types";

const EMPTY: ModelCatalog = { image_models: [], video_models: [], camera_presets: [] };

export function useModels(): ModelCatalog {
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY);
  useEffect(() => {
    veroagenApi.getModels().then(setCatalog).catch(() => setCatalog(EMPTY));
  }, []);
  return catalog;
}
