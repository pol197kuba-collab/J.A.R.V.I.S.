import { useCallback, useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CornerDownLeft } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { audio } from "@/lib/audio/AudioEngine";
import { speak } from "@/lib/audio/speak";
import { MODULE_GROUPS, type ModuleEntry } from "./modules";
import { useHudNavigate } from "./TransitionContext";
import { useArkReboot } from "./ArkRebootContext";
import { useShowcase } from "./ShowcaseContext";
import { onOpenCommandPalette } from "./commandPaletteBus";

/**
 * ⌘K / Ctrl+K module switcher.
 *
 * With sixteen modules, typing three letters beats scanning the rail — and
 * it's the only navigation available when the sidebar is icon-collapsed.
 * ⌘B stays bound to the sidebar toggle (SidebarProvider), so the two don't
 * collide.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { go, isTransitioning } = useHudNavigate();
  const { isDiagnosticRunning } = useArkReboot();
  const { isRunning: isShowcaseRunning } = useShowcase();

  // While a HUD transition, diagnostic or showcase is running the rail
  // disables navigation; the palette has to honour the same lock, or ⌘K
  // becomes a way to route straight through a running overlay.
  const navLocked = isTransitioning || isDiagnosticRunning || isShowcaseRunning;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => onOpenCommandPalette(() => setOpen(true)), []);

  // A route change always closes the palette — including one triggered from
  // elsewhere (voice, bottom rail) while it happens to be open.
  useEffect(() => setOpen(false), [pathname]);

  const select = useCallback(
    (item: ModuleEntry) => {
      if (navLocked) return;
      setOpen(false);
      audio.playClick();
      if (item.url === "/situation-room") {
        speak("Uruchamiam telemetrię satelitarną.");
      }
      go(item.url);
    },
    [go, navLocked],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="hud-chrome max-w-xl gap-0 overflow-hidden border-primary/25 p-0 shadow-[0_32px_80px_-28px_color-mix(in_oklab,var(--primary)_60%,transparent)] [&>button]:hidden">
        <DialogTitle className="sr-only">Wyszukiwarka modułów</DialogTitle>
        <DialogDescription className="sr-only">
          Wpisz nazwę modułu, aby do niego przejść.
        </DialogDescription>
        <Command
          className="bg-transparent [&_[cmdk-group-heading]]:font-display [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.35em] [&_[cmdk-group-heading]]:text-primary/55"
          // cmdk's default filter only sees the visible label; folding the
          // keywords in makes "cennik", "giełda" or "logi" find their module.
          filter={(value, search, keywords) => {
            const haystack = `${value} ${keywords?.join(" ") ?? ""}`.toLowerCase();
            return haystack.includes(search.toLowerCase().trim()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder="Przejdź do modułu…"
            className="font-display h-12 text-[12px] uppercase tracking-[0.2em] placeholder:tracking-[0.2em] placeholder:text-muted-foreground/70"
          />
          <CommandList className="no-scrollbar max-h-[min(60vh,420px)] overflow-y-auto overflow-x-hidden p-1">
            <CommandEmpty className="font-display py-8 text-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Brak modułu
            </CommandEmpty>
            {MODULE_GROUPS.map((group) => (
              <CommandGroup key={group.id} heading={group.label}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.url}
                    value={item.title}
                    keywords={item.keywords ? [item.keywords] : undefined}
                    onSelect={() => select(item)}
                    className="hud-slot group cursor-pointer gap-3 px-2.5 py-2 data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
                  >
                    <item.icon className="icon-neon h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="font-display min-w-0 truncate text-[11px] uppercase tracking-[0.2em]">
                      {item.title}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {pathname === item.url && (
                        <span className="font-display text-[9px] uppercase tracking-[0.3em] text-primary/70">
                          Aktywny
                        </span>
                      )}
                      <CornerDownLeft
                        className="h-3 w-3 text-primary/60 opacity-0 transition-opacity group-data-[selected=true]:opacity-100"
                        strokeWidth={1.75}
                      />
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
