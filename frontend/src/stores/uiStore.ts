import { create } from "zustand";
type UIStore = {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
};
export const useUIStore = create<UIStore>((set) => ({
  currentTab: "home",
  setCurrentTab: (tab: string) => set({ currentTab: tab }),
}));
