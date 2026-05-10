import { create } from "zustand";
import type { Subject, SubjectFormData } from "@/types";
import * as db from "@/services/database";

interface SubjectStore {
  subjects: Subject[];
  loading: boolean;
  fetch: () => Promise<void>;
  create: (data: SubjectFormData) => Promise<void>;
  update: (id: number, data: SubjectFormData) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useSubjectStore = create<SubjectStore>((set, get) => ({
  subjects: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const subjects = await db.getSubjects();
      set({ subjects, loading: false });
    } catch (err) {
      console.error("getSubjects failed:", err);
      set({ loading: false });
      // Do not reset subjects to [] — preserve previously loaded data
    }
  },

  create: async (data) => {
    await db.createSubject(data);
    await get().fetch();
  },

  update: async (id, data) => {
    await db.updateSubject(id, data);
    await get().fetch();
  },

  remove: async (id) => {
    await db.deleteSubject(id);
    await get().fetch();
  },
}));
