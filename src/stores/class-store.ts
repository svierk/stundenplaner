import { create } from "zustand";
import type { SchoolClass, ClassFormData } from "@/types";
import * as db from "@/services/database";

interface ClassStore {
  classes: SchoolClass[];
  loading: boolean;
  fetch: () => Promise<void>;
  create: (data: ClassFormData) => Promise<void>;
  update: (id: number, data: ClassFormData) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useClassStore = create<ClassStore>((set, get) => ({
  classes: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const classes = await db.getClasses();
      set({ classes });
    } finally {
      set({ loading: false });
    }
  },

  create: async (data) => {
    await db.createClass(data);
    await get().fetch();
  },

  update: async (id, data) => {
    await db.updateClass(id, data);
    await get().fetch();
  },

  remove: async (id) => {
    await db.deleteClass(id);
    await get().fetch();
  },
}));
