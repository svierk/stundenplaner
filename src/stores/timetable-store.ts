import { create } from "zustand";
import type { Timetable, TimetableEntry } from "@/types";
import * as db from "@/services/database";

interface TimetableStore {
  timetables: Timetable[];
  activeTimetable: Timetable | null;
  loading: boolean;
  fetch: () => Promise<void>;
  save: (name: string, schoolYear: string, entries: Omit<TimetableEntry, "id" | "timetable_id">[]) => Promise<number>;
  remove: (id: number) => Promise<void>;
  setActive: (timetable: Timetable | null) => void;
  swapEntries: (idA: number, idB: number) => Promise<void>;
}

export const useTimetableStore = create<TimetableStore>((set, get) => ({
  timetables: [],
  activeTimetable: null,
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const timetables = await db.getTimetables();
      set({ timetables });
    } finally {
      set({ loading: false });
    }
  },

  save: async (name, schoolYear, entries) => {
    const id = await db.saveTimetable(name, schoolYear, entries);
    await get().fetch();
    return id;
  },

  remove: async (id) => {
    await db.deleteTimetable(id);
    const { activeTimetable } = get();
    if (activeTimetable?.id === id) set({ activeTimetable: null });
    await get().fetch();
  },

  setActive: (timetable) => set({ activeTimetable: timetable }),

  swapEntries: async (idA, idB) => {
    await db.swapTimetableEntries(idA, idB);
    const { activeTimetable } = get();
    if (!activeTimetable) return;
    const fresh = await db.getTimetableEntries(activeTimetable.id);
    set({ activeTimetable: { ...activeTimetable, entries: fresh } });
  },
}));
