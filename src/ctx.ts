import { createContext, useContext } from "react";
import type { Character } from "./catseye";
import type { Live } from "./live";

export type Page =
  | { name: "character" } | { name: "search"; q?: string } | { name: "mob"; mob: string } | { name: "mobs" }
  | { name: "item"; id: number } | { name: "blu" } | { name: "gear" } | { name: "progress" } | { name: "friends" } | { name: "map" } | { name: "storage" } | { name: "settings" };

export type Friend = { id: string; char?: Character; checked?: number; err?: string };

export type AppCtx = {
  charId?: string;
  char?: Character;
  owned: Set<number>;                  // catseyexi.com inventory ∪ every bag the addon sees
  where: Map<number, string[]>;        // itemId -> bags (addon only)
  live: Live | null;                   // fresh addon data for this character, else null
  liveLearned: Set<string> | null;     // learned Blue Magic names from the game (null without the addon)
  fetchedAt?: number;
  stale?: string;
  go: (p: Page) => void;
  loadChar: (id: string, refresh?: boolean) => Promise<void>;
  friends: Friend[];
  addFriend: (id: string) => Promise<void>;
  removeFriend: (id: string) => Promise<void>;
  refreshFriends: () => Promise<void>;
  zoneName: (id: number) => string | undefined;
  toasts: boolean;
  setToasts: (on: boolean) => void;
  toast: (title: string, body: string, to?: Page) => void;
};

export const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);
