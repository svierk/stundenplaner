import { create } from "zustand";
import type { Teacher, TeacherFormData } from "@/types";
import * as db from "@/services/database";

interface TeacherStore {
  teachers: Teacher[];
  loading: boolean;
  fetch: () => Promise<void>;
  create: (data: TeacherFormData) => Promise<void>;
  update: (id: number, data: TeacherFormData) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useTeacherStore = create<TeacherStore>((set, get) => ({
  teachers: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const teachers = await db.getTeachers();
      set({ teachers });
    } finally {
      set({ loading: false });
    }
  },

  create: async (data) => {
    await db.createTeacher(data);
    await get().fetch();
  },

  update: async (id, data) => {
    await db.updateTeacher(id, data);
    await get().fetch();
  },

  remove: async (id) => {
    await db.deleteTeacher(id);
    await get().fetch();
  },
}));
