import { create } from "zustand";
import type { GradeLevelConfig } from "@/types";
import * as db from "@/services/database";

interface GradeLevelStore {
  configs: GradeLevelConfig[];
  loading: boolean;
  fetch: () => Promise<void>;
  upsert: (cfg: GradeLevelConfig) => Promise<void>;
}

export const useGradeLevelStore = create<GradeLevelStore>((set, get) => ({
  configs: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const configs = await db.getGradeLevelConfigs();
      set({ configs });
    } finally {
      set({ loading: false });
    }
  },

  upsert: async (cfg) => {
    await db.upsertGradeLevelConfig(cfg);
    await get().fetch();
  },
}));
