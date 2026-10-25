import { useEffect, useRef } from "react";
import { motion, motionValue, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { PRODUCTS, type ProductConfig } from "../config/product";
import { SceneCompile, SceneInvestigate, SceneProblem, SceneProduct, SceneReuse } from "./scenes";
import { DUR, EASE } from "../lib/motion";
import { HeroPreview } from "./HeroPreview";

type Act = { id: string; n: number; title: string; body: string; tall?: boolean; Scene: (props: { p: MotionValue<number>; product: ProductConfig }) => React.ReactNode };

const acts = (product: ProductConfig): Act[] => [
  { id: "problem", n: 1, title: "Something is wrong", body: `${product.story.problem} ${product.story.problemDetail}`, Scene: SceneProblem },
  { id: "investigate", n: 2, title: "The local agent investigates", body: product.story.investigate, Scene: SceneInvestigate },
  { id: "compile", n: 3, title: "Experience becomes a skill", body: product.story.compile, tall: true, Scene: SceneCompile },
  { id: "reuse", n: 4, title: "The next one is faster", body: product.story.reuse, Scene: SceneReuse },
  { id: "product", n: 5, title: "Run it yourself", body: product.story.product, Scene: SceneProduct },
];

const FULL = motionValue(1); // end state for static rendering (mobile, reduced motion)

/** Desktop: one sticky stage on the right. Each stage layer follows ITS OWN copy section's progress through the
 * viewport centre, so exactly one scene is shown and it is always the one whose copy you are reading. */
function ScrubbedActs({ list, product }: { list: Act[]; product: ProductConfig }) {
  return (
    <div className="relative hidden lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
      <div>
        {list.map((a) => (
          <section key={a.id} id={`act-${a.n}`} aria-labelledby={`act-${a.n}-h`} className={a.tall ? "relative h-[280vh]" : "flex min-h-[100dvh] items-center py-24"}>
            {a.tall ? (
              /* the centrepiece pins its copy while the five compile stages play on the stage */
              <div className="sticky top-14 flex h-[calc(100dvh-3.5rem)] items-center"><ActCopy act={a} /></div>
            ) : <ActCopy act={a} />}
          </section>
        ))}
      </div>
      <div className="sticky top-14 flex h-[calc(100dvh-3.5rem)] items-center self-start">
        <div className="hairline-grid relative grid aspect-[5/4] w-full place-items-center overflow-hidden rounded-[var(--radius-stage)] border border-line bg-canvas">
          {list.map((a, i) => <StageLayer key={a.id} act={a} i={i} count={list.length} product={product} />)}
        </div>
      </div>
    </div>
  );
}

function StageLayer({ act, i, count, product }: { act: Act; i: number; count: number; product: ProductConfig }) {
  const section = useRef<HTMLElement | null>(null);
  // the copy section lives in the other column; resolve it before useScroll subscribes (effects run in order)
  useEffect(() => { section.current = document.getElementById(`act-${act.n}`); }, [act.n]);
  // 0 when the section's top reaches the viewport centre, 1 when its bottom does
  const { scrollYProgress: local } = useScroll({ target: section, offset: ["start center", "end center"] });
  // short fades at the hand-off; the first scene is visible before act 1, the last stays after act 5
  const [input, output] = i === 0 ? [[0.9, 1], [1, 0]] : i === count - 1 ? [[0, 0.1], [0, 1]] : [[0, 0.1, 0.9, 1], [0, 1, 1, 0]];
  const opacity = useTransform(local, input, output);
  // the scene's own transition completes while the copy scrolls in, so the reader sees the end state
  const scene = useTransform(local, act.tall ? [0.08, 0.85] : [0, 0.45], [0, 1], { clamp: true });
  return (
    <motion.div style={{ opacity }} className="absolute inset-0 grid place-items-center p-10">
      <act.Scene p={scene} product={product} />
    </motion.div>
  );
}

function ActCopy({ act, suffix = "" }: { act: Act; suffix?: string }) {
  return (
    <div className="max-w-[34rem]">
      <p className="tnum mb-4 text-meta text-text-3">{act.n} of 5</p>
      <h2 id={`act-${act.n}-h${suffix}`} className="text-h1 leading-[1.05] font-semibold tracking-[-0.03em] text-balance">{act.title}</h2>
      <p className="mt-5 text-lead leading-relaxed text-text-2">{act.body}</p>
      {act.n === 5 ? (
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#/console" className="btn btn-primary">Open the console</a>
          <a href="#/world/onboard" className="btn btn-quiet">Set up a workspace (read-only)</a>
          <a href="#/world" className="btn btn-quiet">Visit the office</a>
        </div>
      ) : null}
    </div>
  );
}

/** Mobile and reduced motion: each act is copy followed by its scene at its end state. */
function StaticActs({ list, product, always }: { list: Act[]; product: ProductConfig; always: boolean }) {
  return (
    <div className={always ? "" : "lg:hidden"}>
      {list.map((a) => (
        <section key={a.id} id={always ? `act-${a.n}` : `act-${a.n}-s`} aria-labelledby={`act-${a.n}-h${always ? "" : "-s"}`} className="space-y-8 py-16">
          <ActCopy act={a} suffix={always ? "" : "-s"} />
          <div className="hairline-grid grid place-items-center rounded-[var(--radius-stage)] border border-line p-6">
            <a.Scene p={FULL} product={product} />
          </div>
        </section>
      ))}
    </div>
  );
}

export function Story({ product }: { product: ProductConfig }) {
  const reduce = useReducedMotion();
  const list = acts(product);
  return (
    <main id="main" tabIndex={-1}>
      <section className="mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-[88rem] items-center gap-14 overflow-x-clip px-5 py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:px-10">
        <div>
        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.major * 1.3, ease: EASE.emphasis }}
          className="text-display leading-[0.95] font-semibold tracking-[-0.045em]"
        >
          {product.tagline.map((line) => <span key={line} className="block lg:whitespace-nowrap">{line}</span>)}
        </motion.h1>
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DUR.major, delay: reduce ? 0 : 0.35, ease: EASE.standard }}
        >
          <p className="mt-8 max-w-[38rem] text-lead leading-relaxed text-text-2">
            SkillForge is a local AI appliance that learns how your company works. It solves new problems with a person approving every change, proves each fix with code the AI doesn&apos;t control, and turns repeated work into verified skills that run without the model.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a href="#/demo" className="btn btn-primary h-12 px-6 text-[1rem]">Launch demo</a>
            <a href="#/world/bootstrap" className="btn btn-quiet h-12 px-6 text-[1rem]">See it learn a company</a>
            <a href="#/world" className="btn btn-quiet h-12 px-6 text-[1rem]">Visit the office</a>
          </div>
          <p className="mt-4 text-meta text-text-3">
            <a href="#/console" className="underline-offset-4 hover:text-text hover:underline">Open the console</a>
            <span aria-hidden>, or </span>
            <a href="#acts" className="underline-offset-4 hover:text-text hover:underline">scroll: one problem, from first fix to reuse</a>
          </p>
        </motion.div>
        </div>
        <HeroPreview />
      </section>

      <div id="acts" className="mx-auto max-w-[88rem] scroll-mt-14 px-5 lg:px-10">
        {reduce ? <StaticActs list={list} product={product} always /> : <><ScrubbedActs list={list} product={product} /><StaticActs list={list} product={product} always={false} /></>}
      </div>

      <footer className="mx-auto max-w-[88rem] border-t border-line px-5 py-10 text-meta text-text-3 lg:px-10">
        <p>Runs entirely on local hardware. Story visuals are illustrations; measured results appear only in the console.</p>
        <nav aria-label="Product variant" className="mt-4 flex flex-wrap items-center gap-2">
          <span>View as</span>
          {Object.values(PRODUCTS).map((p) => (
            <a key={p.key} href={`?product=${p.key}#/`} aria-current={p.key === product.key ? "true" : undefined}
              className={`rounded-md border px-2.5 py-1 ${p.key === product.key ? "border-line-strong text-text" : "border-line text-text-2 hover:text-text"}`}>{p.name}</a>
          ))}
        </nav>
      </footer>
    </main>
  );
}
