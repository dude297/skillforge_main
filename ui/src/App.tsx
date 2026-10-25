import { lazy, Suspense, useEffect, useState } from "react";
import { currentProduct } from "./config/product";
import type { Section } from "./console/ConsoleShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PREVIEW } from "./lib/preview";

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

type Route = "story" | "console" | "demo" | "pitch" | "world" | "lab" | "bootstrap" | "onboard";
const NAV: { href: string; label: string; routes: Route[] }[] = [
  { href: "#/", label: "How it works", routes: ["story"] },
  { href: "#/world/onboard", label: "Set up", routes: ["onboard", "bootstrap"] },
  { href: "#/world", label: "Office", routes: ["world"] },
  { href: "#/console", label: "Console", routes: ["console"] },
  { href: "#/demo", label: "Guided demo", routes: ["demo", "pitch"] },
];
const SECTIONS: Section[] = ["overview", "investigations", "skills", "history", "benchmarks", "system"];
const routeFromHash = (): Route => {
  const h = window.location.hash;
  return h.startsWith("#/console") ? "console" : h.startsWith("#/demo/pitch") ? "pitch" : h.startsWith("#/demo") ? "demo" : h.startsWith("#/world/lab") ? "lab" : h.startsWith("#/world/bootstrap") ? "bootstrap" : h.startsWith("#/world/onboard") ? "onboard" : h.startsWith("#/world") ? "world" : "story";
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
    document.title = route === "console" ? `${product.name} console` : route === "demo" || route === "pitch" ? `${product.name}: guided demo` : product.name;
  }, [route, product.name]);

  const Logo = product.icon;
  return (
    <>
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-text focus:px-3 focus:py-2 focus:text-canvas">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur-sm">
        <nav aria-label="Primary" className="mx-auto flex h-14 max-w-[88rem] items-center gap-6 px-5 lg:px-10">
          <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo aria-hidden size={18} className="text-signal" />
            {product.name}
          </a>
          {/* the product in story order; on phones the same links scroll sideways instead of disappearing */}
          <div className="-mr-5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-5 text-text-2 sm:mr-0 sm:flex-none sm:pr-0">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                aria-current={n.routes.includes(route) ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center rounded-md px-3 whitespace-nowrap transition-colors duration-150 sm:min-h-0 sm:py-1.5 ${n.routes.includes(route) ? "text-text" : "hover:text-text"}`}
              >
                {n.label}
              </a>
            ))}
          </div>
          {route === "story" ? <a href="#/demo" className="btn btn-primary ml-auto hidden h-9 px-4 lg:inline-flex">Launch demo</a> : null}
        </nav>
        {PREVIEW ? <p role="note" className="border-t border-warn/40 bg-surface px-5 py-1.5 text-center text-meta text-warn lg:px-10">Read-only preview · recorded/synthetic data</p> : null}
      </header>
      <ErrorBoundary>
      <Suspense fallback={<div className="min-h-[100dvh]" aria-busy="true" />}>
        {route === "console" ? <ConsoleShell product={product} section={section} view={view} /> : route === "demo" ? <GuidedDemo /> : route === "pitch" ? <Presenter product={product} />
          : route === "world" ? <World /> : route === "bootstrap" ? <World prelude={(theme, desktop) => <Bootstrap theme={theme} desktop={desktop} />} />
          : route === "onboard" ? <World prelude={(theme, desktop) => <BootstrapLite theme={theme} desktop={desktop} />} />
          : route === "lab" ? <WorldLab /> : <Story product={product} />}
      </Suspense>
      </ErrorBoundary>
    </>
  );
}
