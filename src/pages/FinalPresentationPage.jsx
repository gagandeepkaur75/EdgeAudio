import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../utils/api";
import PageNav from "../components/PageNav";
import "./final-presentation.css";

/* =====================================================================
   FINAL PRESENTATION (web version)
   Every number on these slides was measured on this project:
   - model facts: ml/model.py + public/models/model.onnx
   - validation/test metrics: training checkpoint + ml/test_metrics.json
   - degradation sweep: public/models/model.onnx on 83 two-second windows of
     CMU ARCTIC speech (speakers bdl + slt), degradations from ml/degradations.py
   - live simulator + latency: measured on the Live Test page (Voice 1, Chrome)
   ===================================================================== */

// Offline sweep: mean predicted score per condition
const SWEEP = [
  { label: "Clean studio speech", mos: 3.44, kind: "clean" },
  { label: "Noise, SNR 20 dB", mos: 3.01, kind: "noise" },
  { label: "Noise, SNR 10 dB", mos: 2.57, kind: "noise" },
  { label: "Noise, SNR 0 dB", mos: 2.15, kind: "noise" },
  { label: "Clipping +12 dB", mos: 2.86, kind: "other" },
  { label: "Muffled (2.5 kHz)", mos: 3.07, kind: "other" },
  { label: "Packet loss 15%", mos: 3.05, kind: "other" },
  { label: "Packet loss 30%", mos: 2.92, kind: "other" },
];

// Mean diagnostic probability: clean vs the matching degradation
const DIAGNOSTICS = [
  { head: "Noise", clean: 0.10, degraded: 0.77, when: "SNR 0 dB" },
  { head: "Clipping", clean: 0.19, degraded: 0.30, when: "+12 dB overdrive" },
  { head: "Muffled", clean: 0.03, degraded: 0.21, when: "2.5 kHz low-pass" },
  { head: "Dropouts", clean: 0.07, degraded: 0.22, when: "30% packet loss" },
];

// Live Test page simulator (median displayed score, Voice 1)
const LIVE_SIM = [
  { label: "Clean", mos: 3.4 },
  { label: "Packet loss", mos: 3.2 },
  { label: "Muffled", mos: 2.9 },
  { label: "Background noise", mos: 2.6 },
  { label: "Mic overload", mos: 2.5 },
  { label: "All four", mos: 1.9 },
];

const SLIDES = [
  "Title", "The Problem", "Our Answer", "What We Built", "The Website", "The Pipeline", "The Model",
  "Training & Accuracy", "Results", "Diagnostics", "Live Test", "Live Calls", "Captured Live",
  "Performance", "Privacy & Security", "Journey", "Limitations & Next Steps", "Thank You",
];

/* Deterministic speech-like waveform for the title slide */
function useWaveformPath(width = 1200, height = 220, points = 420) {
  return useMemo(() => {
    const mid = height / 2;
    let d = "";
    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * width;
      const t = i / points;
      // syllable envelope x carrier with a few harmonics
      const env = Math.pow(Math.abs(Math.sin(t * Math.PI * 7.3)), 1.6) * (0.55 + 0.45 * Math.sin(t * Math.PI * 2.1 + 0.7));
      const carrier = Math.sin(i * 0.9) * 0.6 + Math.sin(i * 2.3 + 1) * 0.3 + Math.sin(i * 4.1 + 2) * 0.1;
      const y = mid - env * carrier * (mid - 8);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
    }
    return d;
  }, [width, height, points]);
}

function Slide({ index, dark = false, eyebrow, title, children, className = "" }) {
  return (
    <section className={`fp-slide ${dark ? "fp-dark" : ""} ${className}`} data-index={index} id={`fp-slide-${index + 1}`}>
      <div className="fp-inner">
        {eyebrow && <p className="fp-eyebrow">{eyebrow}</p>}
        {title && <h2 className="fp-title">{title}</h2>}
        {children}
      </div>
    </section>
  );
}

export default function FinalPresentationPage() {
  const scrollerRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const [deck, setDeck] = useState(null);
  const wave = useWaveformPath();

  // Published .pptx (Admin -> type "Final Presentation"), if any
  useEffect(() => {
    let active = true;
    api
      .getDeliverables()
      .then((list) => {
        if (!active) return;
        const finals = (list || []).filter((d) => d.deliverable_type === "final-presentation");
        setDeck(finals.length ? finals[finals.length - 1] : null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Track which slide is on screen
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setCurrent(Number(e.target.dataset.index));
        });
      },
      { root, threshold: 0.55 }
    );
    root.querySelectorAll(".fp-slide").forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const goTo = useCallback((i) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, i));
    document.getElementById(`fp-slide-${clamped + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Keyboard navigation (arrows, Page Up/Down, Space, Home/End)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        goTo(current + 1);
      } else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        goTo(current - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(SLIDES.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, goTo]);

  const maxMos = 4;

  return (
    <div className="fp-page">
      <PageNav />

      {/* Progress + controls */}
      <div className="fp-progress" aria-hidden="true">
        <span style={{ width: `${((current + 1) / SLIDES.length) * 100}%` }} />
      </div>
      <nav className="fp-dots" aria-label="Slides">
        {SLIDES.map((name, i) => (
          <button
            key={name}
            className={i === current ? "active" : ""}
            onClick={() => goTo(i)}
            aria-label={`Slide ${i + 1}: ${name}`}
            title={`${i + 1}. ${name}`}
          />
        ))}
      </nav>
      <div className="fp-controls">
        <button onClick={() => goTo(current - 1)} disabled={current === 0} aria-label="Previous slide">↑</button>
        <span>{String(current + 1).padStart(2, "0")} / {SLIDES.length}</span>
        <button onClick={() => goTo(current + 1)} disabled={current === SLIDES.length - 1} aria-label="Next slide">↓</button>
      </div>

      <main className="fp-scroller" ref={scrollerRef}>
        {/* 1 — TITLE */}
        <Slide index={0} dark className="fp-title-slide">
          <p className="fp-kicker">SOFTWARE ENGINEERING PROJECT · FINAL PRESENTATION</p>
          <h1 className="fp-hero">EdgeAudio<span>-QC</span></h1>
          <p className="fp-hero-sub">Speech quality, scored on your device.</p>
          <svg className="fp-wave" viewBox="0 0 1200 220" preserveAspectRatio="none" aria-hidden="true">
            <path d={wave} />
          </svg>
          <p className="fp-names">Team VoxEdge (Team 6, 3Q13) · Prabhleen Kaur Saini · Gagandeep Kaur · Dishita Sharma</p>
          <p className="fp-hint">Use ↑ ↓ or the arrow keys to move between slides</p>
        </Slide>

        {/* 2 — PROBLEM */}
        <Slide index={1} eyebrow="01 — THE PROBLEM" title="Calls are judged by the network, not by what people hear">
          <div className="fp-grid-3">
            <article className="fp-card">
              <span className="fp-icon">📶</span>
              <h3>Network stats miss the real problem</h3>
              <p>Low packet loss does not mean clear speech. A noisy room, a clipping microphone or a hand over the mic all ruin a call that “looks fine”.</p>
            </article>
            <article className="fp-card">
              <span className="fp-icon">☁️</span>
              <h3>Cloud analysis means sending your voice</h3>
              <p>Server-side quality checks need the raw audio, which raises privacy concerns about recording and storing people's speech.</p>
            </article>
            <article className="fp-card">
              <span className="fp-icon">⏱️</span>
              <h3>Feedback arrives too late</h3>
              <p>A round trip to a server adds delay, so the speaker cannot fix the problem while it is happening.</p>
            </article>
          </div>
        </Slide>

        {/* 3 — ANSWER */}
        <Slide index={2} dark eyebrow="02 — OUR ANSWER" title="Score speech quality inside the browser">
          <div className="fp-grid-3">
            <div className="fp-stat">
              <strong>0</strong>
              <span>bytes of audio sent to our server for scoring</span>
            </div>
            <div className="fp-stat">
              <strong>2<small> s</small></strong>
              <span>windows of speech scored continuously while you talk</span>
            </div>
            <div className="fp-stat">
              <strong>5</strong>
              <span>problems diagnosed: noise, clipping, muffling, dropouts, wind</span>
            </div>
          </div>
          <p className="fp-lead">A small neural network runs in WebAssembly next to the call, so the score and the reason for it appear in real time — and the audio never leaves the device.</p>
        </Slide>

        {/* 4 — WHAT WE BUILT */}
        <Slide index={3} eyebrow="03 — WHAT WE BUILT" title="Four parts working together">
          <div className="fp-grid-2x2">
            <article className="fp-card fp-tint">
              <span className="fp-num">1</span>
              <h3>Live Test web app</h3>
              <p>React + Web Audio. Microphone, studio demo voices or PC audio, a live oscilloscope and a condition simulator.</p>
            </article>
            <article className="fp-card fp-tint">
              <span className="fp-num">2</span>
              <h3>On-device quality model</h3>
              <p>SpeechQualityModel in ONNX Runtime Web: a score from 1 to 5, a voice-activity check and five diagnostics.</p>
            </article>
            <article className="fp-card fp-tint">
              <span className="fp-num">3</span>
              <h3>Two-person calls</h3>
              <p>WebRTC peer-to-peer audio. Each side sees the quality of its own mic and of the audio it receives.</p>
            </article>
            <article className="fp-card fp-tint">
              <span className="fp-num">4</span>
              <h3>Backend & website</h3>
              <p>Express API on AWS EC2 for call signalling and versioned deliverables, frontend on Cloudflare.</p>
            </article>
          </div>
        </Slide>

        {/* 5 — THE WEBSITE */}
        <Slide index={4} eyebrow="03 — WHAT WE BUILT" title="The website the team built">
          <div className="fp-shots fp-shots-3">
            {[
              ["home.jpg", "Home", "Side menu with every page and quick links to both presentations."],
              ["architecture.jpg", "Architecture", "How audio moves from the microphone to the score."],
              ["deliverables.jpg", "Deliverables", "Versioned archive of every published presentation."],
            ].map(([file, name, text]) => (
              <figure className="fp-shot" key={file}>
                <div className="fp-shot-frame"><img src={`/screenshots/${file}`} alt={`${name} page`} loading="lazy" /></div>
                <figcaption><strong>{name}</strong>{text}</figcaption>
              </figure>
            ))}
          </div>
        </Slide>

        {/* 6 — PIPELINE */}
        <Slide index={5} eyebrow="04 — THE PIPELINE" title="From microphone to score in six steps">
          <ol className="fp-flow">
            {[
              ["Capture", "Microphone, demo voice or PC audio at 44.1/48 kHz"],
              ["Resample", "Anti-aliased filter, then 16 kHz"],
              ["Window", "Last 2 seconds of speech, scored about every 0.35 s"],
              ["Features", "80 log-mel bands + 5 signal features × 201 frames"],
              ["Model", "ONNX Runtime Web (WebAssembly)"],
              ["Display", "Smoothed score, rating and the main problem"],
            ].map(([h, p], i) => (
              <li key={h}>
                <span className="fp-flow-num">{i + 1}</span>
                <h3>{h}</h3>
                <p>{p}</p>
              </li>
            ))}
          </ol>
          <p className="fp-note">The JavaScript feature code matches the Python training code, so the browser sees the same input the model was trained on.</p>
        </Slide>

        {/* 7 — MODEL */}
        <Slide index={6} eyebrow="05 — THE MODEL" title="One small network, three answers">
          <div className="fp-split">
            <div className="fp-arch">
              <div className="fp-arch-box">Input · 201 frames × 85 features</div>
              <div className="fp-arch-arrow">↓</div>
              <div className="fp-arch-box">Residual 1-D convolution blocks</div>
              <div className="fp-arch-arrow">↓</div>
              <div className="fp-arch-box">2-layer GRU (time patterns)</div>
              <div className="fp-arch-arrow">↓</div>
              <div className="fp-arch-box">Statistics pooling (mean · std · min · max)</div>
              <div className="fp-arch-arrow">↓</div>
              <div className="fp-arch-heads">
                <span>Quality score</span>
                <span>Voice present?</span>
                <span>5 diagnostics</span>
              </div>
            </div>
            <div className="fp-stack">
              <div className="fp-stat light"><strong>584,391</strong><span>parameters</span></div>
              <div className="fp-stat light"><strong>2.45<small> MB</small></strong><span>ONNX model file</span></div>
              <div className="fp-stat light"><strong>2<small> s</small></strong><span>of audio per prediction</span></div>
            </div>
          </div>
        </Slide>

        {/* 8 — TRAINING */}
        <Slide index={7} eyebrow="06 — TRAINING & ACCURACY" title="Trained on real speech with known damage">
          <div className="fp-split">
            <div>
              <ul className="fp-list">
                <li>Clean human speech is degraded on purpose: noise, clipping, muffling, packet loss, wind and reverb.</li>
                <li>Because the damage is known, a <b>teacher</b> function turns it into a target quality score.</li>
                <li>The model learns the score, whether speech is present, and which problems are present — all at once.</li>
              </ul>
              <p className="fp-note">Targets come from the teacher, not from human listening tests — see Limitations.</p>
            </div>
            <table className="fp-table">
              <thead>
                <tr><th>Metric (held-out test set)</th><th>Value</th></tr>
              </thead>
              <tbody>
                <tr><td>Score correlation (PLCC)</td><td>0.71</td></tr>
                <tr><td>Rank correlation (SRCC)</td><td>0.63</td></tr>
                <tr><td>Score RMSE (1–5 scale)</td><td>1.28</td></tr>
                <tr><td>Voice detection accuracy / F1</td><td>0.998 / 0.999</td></tr>
                <tr><td>Test windows</td><td>397</td></tr>
              </tbody>
            </table>
          </div>
        </Slide>

        {/* 9 — RESULTS */}
        <Slide index={8} eyebrow="07 — RESULTS" title="Every kind of damage lowers the score">
          <div className="fp-bars">
            {SWEEP.map((r) => (
              <div className="fp-bar-row" key={r.label}>
                <span className="fp-bar-label">{r.label}</span>
                <div className="fp-bar-track">
                  <div className={`fp-bar fp-bar-${r.kind}`} style={{ width: `${(r.mos / maxMos) * 100}%` }}>
                    <b>{r.mos.toFixed(2)}</b>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="fp-note">Mean predicted score on 83 two-second windows of CMU ARCTIC studio speech. Louder noise gives a steadily lower score: 3.44 → 3.01 → 2.57 → 2.15.</p>
        </Slide>

        {/* 10 — DIAGNOSTICS */}
        <Slide index={9} dark eyebrow="08 — DIAGNOSTICS" title="It also says what is wrong">
          <div className="fp-diag">
            {DIAGNOSTICS.map((d) => (
              <article key={d.head}>
                <h3>{d.head}</h3>
                <div className="fp-diag-bars">
                  <div><span style={{ height: `${d.clean * 100}%` }} /><em>clean {d.clean.toFixed(2)}</em></div>
                  <div><span className="hot" style={{ height: `${d.degraded * 100}%` }} /><em>{d.when} {d.degraded.toFixed(2)}</em></div>
                </div>
              </article>
            ))}
          </div>
          <p className="fp-lead">Each diagnostic rises for its own problem. Noise is detected most strongly; the others react clearly but with smaller probabilities, so the app uses per-problem thresholds.</p>
        </Slide>

        {/* 11 — LIVE TEST */}
        <Slide index={10} eyebrow="09 — LIVE TEST PAGE" title="Try it: speak, play a voice, or break the audio">
          <div className="fp-split">
            <ul className="fp-list">
              <li><b>Inputs:</b> microphone, three studio demo voices (CMU ARCTIC), an uploaded file, or audio from the PC.</li>
              <li><b>Oscilloscope:</b> live waveform with a stable trigger and automatic gain.</li>
              <li><b>Simulator:</b> really changes the audio — noise, packet loss, mic overload, muffling — before the model hears it.</li>
              <li><b>Report:</b> score, rating, mic, network, noise and clarity tiles and a 10-second trend.</li>
            </ul>
            <div className="fp-mini-chart">
              <h3>Score shown on the page (Voice 1)</h3>
              {LIVE_SIM.map((r) => (
                <div className="fp-mini-row" key={r.label}>
                  <span>{r.label}</span>
                  <div><i style={{ width: `${(r.mos / maxMos) * 100}%` }} /></div>
                  <b>{r.mos.toFixed(1)}</b>
                </div>
              ))}
            </div>
          </div>
        </Slide>

        {/* 12 — CALLS */}
        <Slide index={11} eyebrow="10 — LIVE CALLS" title="In a call, score what you actually hear">
          <div className="fp-call">
            <div className="fp-peer">
              <h3>You</h3>
              <span className="fp-chip blue">🎙️ Your mic score</span>
              <span className="fp-chip violet">🎧 What you hear</span>
            </div>
            <div className="fp-link">
              <span>WebRTC · encrypted peer-to-peer audio</span>
              <div className="fp-link-line" />
              <span className="fp-link-sub">Server only relays connection messages</span>
            </div>
            <div className="fp-peer">
              <h3>Friend</h3>
              <span className="fp-chip blue">🎙️ Their mic score</span>
              <span className="fp-chip violet">🎧 What they hear</span>
            </div>
          </div>
          <p className="fp-lead">A second on-device analyser scores the incoming audio, so network dropouts show up where they matter. The “What you hear” card appears only while the call is connected.</p>
        </Slide>

        {/* 13 — CAPTURED LIVE */}
        <Slide index={12} eyebrow="10 — LIVE CALLS" title="Captured live from the running app">
          <div className="fp-shots fp-shots-2">
            <figure className="fp-shot">
              <div className="fp-shot-frame"><img src="/screenshots/live-test.jpg" alt="Live Test page scoring Voice 1" loading="lazy" /></div>
              <figcaption><strong>Live Test, on its own</strong>Voice 1 playing: the score, problem cards and oscilloscope update about three times a second.</figcaption>
            </figure>
            <figure className="fp-shot">
              <div className="fp-shot-frame"><img src="/screenshots/live-call.jpg" alt="Two-way call showing Your mic and What you hear scores" loading="lazy" /></div>
              <figcaption><strong>In a two-way call</strong>“Your mic” and “What you hear” are scored side by side; the incoming audio has passed through WebRTC.</figcaption>
            </figure>
          </div>
        </Slide>

        {/* 14 — PERFORMANCE */}
        <Slide index={13} dark eyebrow="11 — PERFORMANCE" title="Small enough to run beside a call">
          <div className="fp-grid-4">
            <div className="fp-stat"><strong>2.45<small> MB</small></strong><span>FP32 model download, cached by the browser</span></div>
            <div className="fp-stat"><strong>0.41<small> MB</small></strong><span>INT8 quantised variant, also exported</span></div>
            <div className="fp-stat"><strong>584<small> k</small></strong><span>parameters: depthwise CNN + 2-layer GRU</span></div>
            <div className="fp-stat"><strong>&lt; 25<small> ms</small></strong><span>design target per window (NFR-01); browser latency still to be measured across devices</span></div>
          </div>
        </Slide>

        {/* 15 — PRIVACY & SECURITY */}
        <Slide index={14} eyebrow="12 — PRIVACY & SECURITY" title="Private by design, safe by default">
          <div className="fp-grid-3">
            <article className="fp-card">
              <span className="fp-icon">🔒</span>
              <h3>Audio stays local</h3>
              <p>Scoring happens in the browser. The server never receives audio — only call setup messages.</p>
            </article>
            <article className="fp-card">
              <span className="fp-icon">🛡️</span>
              <h3>Hardened backend</h3>
              <p>Admin login with bcrypt + JWT and lockout after 5 failed tries, allowed-sites list (CORS), and validated, size-limited call messages.</p>
            </article>
            <article className="fp-card">
              <span className="fp-icon">🗂️</span>
              <h3>History you can trust</h3>
              <p>Every deliverable gets a permanent address. Publishing never overwrites or deletes an earlier version.</p>
            </article>
          </div>
        </Slide>

        {/* 16 — JOURNEY */}
        <Slide index={15} eyebrow="13 — THE JOURNEY" title="17 weeks from idea to working system">
          <div className="fp-timeline">
            {[
              ["Weeks 1–2", "Browser feasibility"],
              ["Weeks 3–5", "Dataset & preprocessing"],
              ["Weeks 6–8", "Model development"],
              ["Weeks 9–11", "Browser inference"],
              ["Weeks 12–14", "WebRTC integration"],
              ["Weeks 15–16", "Evaluation"],
              ["Week 17", "Integration & demo"],
            ].map(([w, t], i) => (
              <div className="fp-tl-item" key={w}>
                <span className="fp-tl-dot">M{i + 1}</span>
                <strong>{t}</strong>
                <em>{w}</em>
              </div>
            ))}
          </div>
        </Slide>

        {/* 17 — LIMITATIONS */}
        <Slide index={16} eyebrow="14 — LIMITATIONS & NEXT STEPS" title="What we learned and what comes next">
          <div className="fp-two-col">
            <div className="fp-panel">
              <h3>Honest limitations</h3>
              <ul className="fp-list">
                <li>Scores are compressed: clean studio speech rates about 3.4, not 4.5.</li>
                <li>Training targets come from a teacher function, not human ratings.</li>
                <li>Clipping, muffling and dropout diagnostics react, but weakly.</li>
                <li>No TURN relay yet, so calls between strict networks can fail.</li>
              </ul>
            </div>
            <div className="fp-panel fp-panel-accent">
              <h3>Next steps</h3>
              <ul className="fp-list">
                <li>Recalibrate the score on a human-rated speech dataset.</li>
                <li>Move audio processing to an AudioWorklet thread.</li>
                <li>Add a TURN server for reliable calls everywhere.</li>
                <li>Package the analyser as a small SDK for other web apps.</li>
              </ul>
            </div>
          </div>
        </Slide>

        {/* 18 — THANK YOU */}
        <Slide index={17} dark className="fp-end">
          <h2 className="fp-hero small">Thank you</h2>
          <p className="fp-hero-sub">Questions & live demo</p>
          <div className="fp-end-actions">
            <Link to="/live-communication" className="fp-btn primary">Open the Live Test</Link>
            {deck && (
              <a href={deck.file_url} download={deck.original_filename || "final-presentation.pptx"} className="fp-btn">
                Download slides (.{(deck.original_filename || "pptx").split(".").pop()})
              </a>
            )}
            <Link to="/deliverables" className="fp-btn">All deliverables</Link>
          </div>
          <p className="fp-credit">Demo voices: CMU ARCTIC speech databases, Carnegie Mellon University.</p>
        </Slide>
      </main>
    </div>
  );
}
