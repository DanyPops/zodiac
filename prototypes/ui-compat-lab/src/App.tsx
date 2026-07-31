import { useCallback, useMemo, useState } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "./ai-elements/Conversation";
import { Message, MessageContent } from "./ai-elements/Message";
import { assessCompatibility } from "./compatibility";
import { PersesTimeSeries } from "./PersesTimeSeries";
import { SurfaceBoundary } from "./SurfaceBoundary";

type RuntimeState = "mounting" | "rendered" | "failed";

const assessment = assessCompatibility({
  hostReact: "19.2.3",
  aiElementsReact: "^19.0.0",
  persesReact: "^17.0.2 || ^18.0.0",
});

function Status({ pass }: { pass: boolean }) {
  return <strong className={pass ? "status-pass" : "status-fail"}>{pass ? "PASS" : "FAIL"}</strong>;
}

export function App() {
  const [runtime, setRuntime] = useState<RuntimeState>("mounting");
  const runtimeLabel = useMemo(
    () => ({ mounting: "Mounting chart…", rendered: "Both surfaces rendered", failed: "Perses runtime failed" })[runtime],
    [runtime],
  );
  const markFailed = useCallback(() => setRuntime("failed"), []);
  const markRendered = useCallback(() => setRuntime("rendered"), []);

  return (
    <main>
      <header className="lab-header">
        <div>
          <p className="eyebrow">WorkspaceSurface integration spike</p>
          <h1>Perses + AI Elements</h1>
          <p className="summary">
            React 19 host with the real Perses time-series plugin and AI Elements conversation/message source.
          </p>
        </div>
        <div className="verdict" data-verdict={assessment.verdict}>
          <span>Package contract</span>
          <strong>Unsupported peer range</strong>
          <small>Runtime is forced only inside this disposable lab.</small>
        </div>
      </header>

      <section aria-label="Compatibility checks" className="checks">
        <div><span>AI Elements on React 19</span><Status pass={assessment.aiElementsSupported} /></div>
        <div><span>Perses on React 19</span><Status pass={assessment.persesSupported} /></div>
        <div><span>Browser runtime</span><strong data-runtime={runtime}>{runtimeLabel}</strong></div>
      </section>

      <section className="surface-grid">
        <article className="surface conversation-surface">
          <header className="surface-header">
            <div><span>Conversation Surface</span><small>AI Elements source</small></div>
            <span className="surface-state">React 19</span>
          </header>
          <SurfaceBoundary name="Conversation Surface">
            <Conversation aria-label="AI conversation">
              <ConversationContent>
                <Message from="user">
                  <MessageContent>Compare path delay with clock offset over the selected six-hour window.</MessageContent>
                </Message>
                <Message from="assistant">
                  <MessageContent>
                    The two series are synchronized through one bounded fixture. The chart is rendered by Perses; this transcript uses AI Elements primitives.
                  </MessageContent>
                </Message>
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </SurfaceBoundary>
          <form className="composer" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="prompt">Prompt</label>
            <input id="prompt" placeholder="Ask about this surface…" />
            <button type="submit">Send</button>
          </form>
        </article>

        <article className="surface telemetry-surface">
          <header className="surface-header">
            <div><span>Metric Chart Surface</span><small>Perses TimeSeriesChart</small></div>
            <span className="surface-state">25 points / series</span>
          </header>
          <SurfaceBoundary name="Perses Surface" onError={markFailed}>
            <PersesTimeSeries onCanvasReady={markRendered} />
          </SurfaceBoundary>
          <footer className="surface-footer">UTC · fixture · 6 hours · 50 rendered points</footer>
        </article>
      </section>
    </main>
  );
}
