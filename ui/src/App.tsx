import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { currentProduct } from "./config/product";
import type { Section } from "./console/ConsoleShell";
import { ErrorBoundary } from "./components/ErrorBoundary";

// one chunk per route: the story's scenes never load for the console, and vice versa
const Story = lazy(() => import("./story/Story").then((m) => ({ default: m.Story })));
const Presenter = lazy(() => import("./story/Presenter").then((m) => ({ default: m.Presenter })));
const GuidedDemo = lazy(() => import("./story/GuidedDemo").then((m) => ({ default: m.GuidedDemo })));
const ConsoleShell = lazy(() => import("./console/ConsoleShell").then((m) => ({ default: m.ConsoleShell })));
// EXPERIMENT (exp/world): the pixel companion + isometric company. Its own chunk; nothing else imports it.
const World = lazy(() => import("./world/World").then((m) => ({ default: m.World })));
// EXPERIMENT (exp/bootstrap): the Bootstrap illustration in front of the same world. #/world itself is unchanged.
const Bootstrap = lazy(() => import("./world/Bootstrap").then((m) => ({ default: m.Bootstrap })));
// EXPERIMENT (exp/bootstrap-lite): functional, read-only onboarding over the real manifest, same world below.
const BootstrapLite = lazy(() => import("./world/BootstrapLite").then((m) => ({ default: m.BootstrapLite })));
const WorldLab = lazy(() => import("./world/Lab").then((m) => ({ default: m.Lab })));
// Ember Living System: read-only projection, its own chunk; nothing in the core imports it.
const LivingSystem = lazy(() => import("./moonshot/LivingSystem").then((m) => ({ default: m.LivingSystem })));
const Dashboard = lazy(() => import("./dashboard/Dashboard"));

type Route = "dashboard" | "story" | "console" | "demo" | "pitch" | "world" | "lab" | "bootstrap" | "onboard" | "moonshot";
const NAV: { href: string; label: string; routes: Route[] }[] = [
  { href: "#/dashboard", label: "Workspace", routes: ["dashboard"] },
  { href: "#/story", label: "How it works", routes: ["story"] },
  { href: "#/world/onboard", label: "Set up", routes: ["onboard", "bootstrap"] },
  { href: "#/world", label: "Office", routes: ["world"] },
  { href: "#/world/moonshot", label: "Living map", routes: ["moonshot"] },
  { href: "#/console", label: "Console", routes: ["console"] },
  { href: "#/demo", label: "Guided demo", routes: ["demo", "pitch"] },
];
const SECTIONS: Section[] = ["overview", "investigations", "skills", "history", "benchmarks", "system"];
const routeFromHash = (): Route => {
  const h = window.location.hash;
  if (!h || h === "#/" || h.startsWith("#/dashboard")) return "dashboard";
  return h.startsWith("#/console") ? "console" : h.startsWith("#/demo/pitch") ? "pitch" : h.startsWith("#/demo") ? "demo" : h.startsWith("#/world/moonshot") ? "moonshot" : h.startsWith("#/world/lab") ? "lab" : h.startsWith("#/world/bootstrap") ? "bootstrap" : h.startsWith("#/world/onboard") ? "onboard" : h.startsWith("#/world") ? "world" : "story";
};
const sectionFromHash = (): Section => {
  const s = window.location.hash.split("/")[2] as Section | undefined;
  return s && SECTIONS.includes(s) ? s : "investigations";
};

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [section, setSection] = useState<Section>(sectionFromHash);
  const [view, setView] = useState(() => window.location.hash.split("/")[3] ?? "");
  const product = currentProduct();

  useEffect(() => {
    const on = () => {
      const next = routeFromHash();
      setSection(sectionFromHash());
      setView(window.location.hash.split("/")[3] ?? "");
      setRoute((prev) => {
        if (prev !== next) window.scrollTo({ top: 0 });
        return next;
      });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    document.title = route === "dashboard" ? `${product.name} workspace` : route === "console" ? `${product.name} console` : route === "demo" || route === "pitch" ? `${product.name}: guided demo` : product.name;
  }, [route, product.name]);

  const Logo = product.icon;
  // the Daylight World routes (office, set up, bootstrap, lab) are a deliberate pale scene: the bar follows them
  const day = route === "world" || route === "onboard" || route === "bootstrap" || route === "lab";
  const here = NAV.find((n) => n.routes.includes(route));
  const [menuFor, setMenuFor] = useState<Route | null>(null); // open for THIS route only: navigating closes it
  const menu = menuFor === route;
  const menuBtn = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLElement>(null); // the whole header (bar + preview strip + phone menu)

  // sticky stages below the bar (story, office) start where the bar ends, whatever its height (the preview strip adds a line)
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.surface = day ? "day" : "night";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", day ? "#DCEBF5" : "#080C12");
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", day ? "light" : "dark");
  }, [day]);
  useEffect(() => {
    if (!menu) return;
    const out = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) setMenuFor(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenuFor(null); menuBtn.current?.focus(); } };
    document.addEventListener("pointerdown", out);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [menu, route]);

  return (
    <>
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-text focus:px-3 focus:py-2 focus:text-canvas">
        Skip to content
      </a>
      <header hidden={route === "dashboard"} ref={bar} className="site-header" data-surface={day ? "day" : "night"}>
        <nav aria-label="Primary" className="mx-auto flex h-14 max-w-[88rem] items-center gap-6 px-5 lg:px-10">
          <a href="#/" className="flex min-h-11 items-center gap-2 font-semibold tracking-tight text-[var(--h-text-on)]">
            <Logo aria-hidden size={18} className={day ? "text-day-signal" : "text-signal"} />
            {product.name}
          </a>
          {/* from tablet up the product is five links in story order */}
          <div className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} aria-current={n.routes.includes(route) ? "page" : undefined} className="site-link">{n.label}</a>
            ))}
          </div>
          {route === "story" ? <a href="#/demo" className="btn btn-primary ml-auto hidden h-9 px-4 lg:inline-flex">Launch demo</a> : null}
          {/* phones: one menu button that names where you are; the five links open below the bar at full 48px height */}
          <div className="ml-auto flex items-center gap-1 md:hidden">
            {here ? <span className="text-meta" aria-hidden>{here.label}</span> : null}
            <button ref={menuBtn} type="button" onClick={() => setMenuFor(menu ? null : route)} aria-expanded={menu} aria-controls="site-menu"
              className="site-link gap-1.5 font-semibold text-[var(--h-text-on)]">
              Menu{menu ? <X aria-hidden size={16} /> : <ChevronDown aria-hidden size={16} />}
            </button>
          </div>
        </nav>
        <div id="site-menu" hidden={!menu} className="absolute inset-x-0 top-full border-b border-[var(--h-line)] bg-[var(--h-solid)] shadow-[0_16px_24px_-16px_rgb(0_0_0/0.35)] md:hidden">
          <ul className="mx-auto max-w-[88rem] px-3 py-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} aria-current={n.routes.includes(route) ? "page" : undefined} onClick={() => setMenuFor(null)} className="site-link w-full justify-between !min-h-12 px-3 text-[1rem]">
                  {n.label}
                  {n.routes.includes(route) ? <span aria-hidden className="size-1.5 rounded-full bg-[var(--h-focus)]" /> : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </header>
      <ErrorBoundary>
      <Suspense fallback={<div className="min-h-[100dvh]" aria-busy="true" />}>
        {route === "dashboard" ? <Dashboard /> : route === "console" ? <ConsoleShell product={product} section={section} view={view} /> : route === "demo" ? <GuidedDemo /> : route === "pitch" ? <Presenter product={product} />
          : route === "world" ? <World /> : route === "bootstrap" ? <World prelude={(theme, desktop) => <Bootstrap theme={theme} desktop={desktop} />} />
          : route === "onboard" ? <World prelude={(theme, desktop) => <BootstrapLite theme={theme} desktop={desktop} />} />
          : route === "moonshot" ? <LivingSystem />
          : route === "lab" ? <WorldLab /> : <Story product={product} />}
      </Suspense>
      </ErrorBoundary>
    </>
  );
}
