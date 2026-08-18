import "./planning.css";

const slides = [
  "Title",
  "Contents",
  "Introduction",
  "Project Scope",
  "Proposed Functions",
  "Target Users",
  "System Features",
  "Interfaces",
  "Performance Goals",
  "Evaluation Baselines",
  "Security Measures",
  "Quality Attributes",
  "Feasibility",
  "Risks & Challenges",
  "17-Week Roadmap",
  "Milestones",
  "Conclusion",
  "References",
];

const ganttTasks = [
  { label: "Weeks 1–2", title: "Browser feasibility experiment", start: 1, end: 2 },
  { label: "Weeks 3–5", title: "Dataset preparation & preprocessing", start: 3, end: 5 },
  { label: "Weeks 6–8", title: "No-reference model development & evaluation", start: 6, end: 8 },
  { label: "Weeks 9–11", title: "Model compression & browser inference", start: 9, end: 11 },
  { label: "Weeks 12–14", title: "JS/WASM SDK & WebRTC integration", start: 12, end: 14 },
  { label: "Weeks 15–16", title: "Full evaluation & comparison", start: 15, end: 16 },
  { label: "Week 17", title: "Final integration, deployment & demo", start: 17, end: 17 },
];

function Slide({ number, eyebrow, title, children, className = "" }) {
  return (
    <section id={`slide-${number}`} className={`planning-slide ${className}`}>
      <div className="slide-inner">
        {eyebrow && <p className="slide-eyebrow">{eyebrow}</p>}
        {title && <h2 className="slide-title">{title}</h2>}
        {children}
      </div>
    </section>
  );
}

function Planning() {

  return (
    <div className="planning-page">

      <main className="planning-content">
        {/* 01 TITLE */}
        <Slide number={1} className="title-slide">
          <div className="title-content">
            <p className="project-kicker">UCS503 SOFTWARE PROJECT</p>
            <h1>EdgeAudio<span>-QC</span></h1>
            <p className="title-subtitle">Privacy-Preserving Speech Quality Estimation</p>
          </div>
        </Slide>

        {/* 02 CONTENTS */}
        <Slide number={2} eyebrow="PLANNING PRESENTATION V1" title="Table of Contents">
          <div className="toc-grid">
            {slides.slice(2).map((name, index) => (
              <button key={name} onClick={() => document.getElementById(`slide-${index + 3}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {name}
              </button>
            ))}
          </div>
        </Slide>

        {/* 03 INTRODUCTION */}
        <Slide number={3} eyebrow="01 — INTRODUCTION" title="Introduction">
          <div className="three-card-grid">
            <article>
              <span className="card-label">Overview</span>
              <h3>Privacy-preserving browser analysis</h3>
              <p>
                EdgeAudio-QC is a privacy-preserving, browser-based system that
                estimates perceived speech quality during a live web
                communication session.
              </p>
            </article>
            <article>
              <span className="card-label">Importance</span>
              <h3>Why this approach?</h3>
              <p>
                Current systems rely heavily on network statistics and
                server-side analysis. EdgeAudio-QC explores a client-side
                approach that keeps raw audio on the user's device.
              </p>
            </article>
            <article>
              <span className="card-label">Presentation Objectives</span>
              <h3>What this plan establishes</h3>
              <p>
                Define project scope and functions; identify target users;
                describe system features and interfaces; establish performance
                and security goals; and present feasibility and initial
                planning.
              </p>
            </article>
          </div>
        </Slide>

        {/* 04 SCOPE */}
        <Slide number={4} eyebrow="02 — PROJECT SCOPE" title="Project Scope">
          <div className="scope-grid">
            <article className="feature-card">
              <span className="card-label">Project Aims</span>
              <p>
                Estimate perceived speech quality during live web communication
                while processing speech locally inside the browser.
              </p>
            </article>
            <article className="feature-card">
              <span className="card-label">Deliverables</span>
              <p>
                Browser application; speech-quality model; browser inference
                pipeline; frontend; backend/deployment infrastructure;
                evaluation and documentation.
              </p>
            </article>
            <article className="feature-card wide">
              <span className="card-label">Broad Functionality</span>
              <p>
                Capture speech, preprocess audio, extract features, run local
                inference, smooth the estimate and display a live quality
                result.
              </p>
            </article>
          </div>

          <div className="constraints">
            <h3>Initial scope constraints</h3>
            <ul>
              <li>16 kHz mono speech for the first version.</li>
              <li>One named desktop browser for the first version.</li>
              <li>Browser execution is a core feasibility requirement.</li>
              <li>Raw audio remains on the user's device.</li>
            </ul>
          </div>
        </Slide>

        {/* 05 FUNCTIONS */}
        <Slide number={5} eyebrow="03 — PROPOSED FUNCTIONS" title="Proposed Functions">
          <div className="function-grid">
            {[
              ["Microphone Capture", "Capture speech through browser microphone permissions."],
              ["Audio Preprocessing", "Prepare incoming audio for feature extraction."],
              ["Feature Extraction", "Extract information required by the model."],
              ["Browser Inference", "Run the model and preprocessing inside the browser."],
              ["Temporal Smoothing", "Reduce fluctuations and stabilize the estimate."],
              ["Live Quality Estimate", "Display the current perceived quality estimate."],
            ].map(([name, text]) => (
              <article className="function-card" key={name}>
                <div className="function-number">✓</div>
                <div>
                  <h3>{name}</h3>
                  <p>{text}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="pipeline">
            <span>Microphone</span><b>→</b><span>Browser Audio</span><b>→</b>
            <span>Features</span><b>→</b><span>ML Model</span><b>→</b>
            <span>Live Estimate</span>
          </div>
        </Slide>

        {/* 06 USERS */}
        <Slide number={6} eyebrow="04 — TARGET USERS" title="Target Users">
          <div className="user-grid">
            <article>
              <span className="user-icon">01</span>
              <h3>Web Communication Users</h3>
              <p>
                People participating in browser-based voice communication who
                need speech-quality feedback.
              </p>
            </article>
            <article>
              <span className="user-icon">02</span>
              <h3>Developers & Researchers</h3>
              <p>
                Users evaluating browser-based communication, speech processing
                and client-side inference.
              </p>
            </article>
            <article>
              <span className="user-icon">03</span>
              <h3>Communication Platforms</h3>
              <p>
                Potential integration target for client-side speech-quality
                monitoring without transmitting raw speech.
              </p>
            </article>
          </div>
          <div className="impact-box">
            <strong>User Needs Impact</strong>
            <p>
              The design prioritizes a simple interface, fast feedback, low
              processing overhead, understandable results and privacy-preserving
              local processing.
            </p>
          </div>
        </Slide>

        {/* 07 FEATURES */}
        <Slide number={7} eyebrow="05 — SYSTEM FEATURES" title="System Features">
          <div className="feature-list">
            {[
              ["Microphone Capture", "Browser microphone access."],
              ["Privacy-Preserving Processing", "Raw audio stays on-device."],
              ["Rolling-Window Inference", "Analyze short rolling contexts."],
              ["Speech-Quality Model", "No-reference quality estimation."],
              ["Temporal Smoothing", "Stabilize live estimates."],
              ["Browser ML Runtime", "Run inference locally."],
              ["Reusable JS/WASM SDK", "Package browser inference."],
              ["Hosted WebRTC PWA", "Demonstration/test application."],
            ].map(([name, text]) => (
              <div className="feature-row" key={name}>
                <strong>{name}</strong>
                <span>{text}</span>
              </div>
            ))}
          </div>
          <div className="interaction">
            <strong>Feature interaction</strong>
            <p>
              Microphone → Web Audio/WebRTC → Preprocessing → Features →
              Model → Smoothing → Live Estimate
            </p>
          </div>
        </Slide>

        {/* 08 INTERFACES */}
        <Slide number={8} eyebrow="06 — INTERFACES" title="System Interfaces">
          <div className="interface-grid">
            <article>
              <span className="card-label">User Interface (UI)</span>
              <p>
                Homepage and navigation; Planning Presentation V1; live test
                interface; microphone permission flow; processing status;
                quality result display.
              </p>
            </article>
            <article>
              <span className="card-label">Hardware / Software</span>
              <p>
                User microphone; desktop browser; Web Audio API; WebRTC;
                browser ML runtime; JavaScript/WebAssembly execution.
              </p>
            </article>
            <article className="wide">
              <span className="card-label">Communication Interfaces</span>
              <p>
                Frontend communicates with the backend for protected
                administration, file metadata, publishing and version
                management. Raw speech analysis remains local.
              </p>
            </article>
          </div>
        </Slide>

        {/* 09 PERFORMANCE */}
        <Slide number={9} eyebrow="07 — PERFORMANCE GOALS" title="Initial Technical Targets">
          <div className="metric-grid">
            {[
              ["Browser", "Google Chrome stable, version 151 or later."],
              ["Test Hardware", "AMD Ryzen 7 7840HS, 16 GB RAM, NVIDIA RTX 3050 6 GB laptop GPU."],
              ["Maximum Model Size", "< 2 MB after INT8 quantization."],
              ["Maximum Bundle Size", "< 5 MB browser bundle."],
              ["Processing Target", "< 300 ms per update; 3-second rolling context updated every 1 second."],
              ["Memory Target", "< 150 MB peak memory during a 10-minute call."],
            ].map(([name, value]) => (
              <article key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
        </Slide>

        {/* 10 BASELINES */}
        <Slide number={10} eyebrow="07 — PERFORMANCE GOALS" title="Evaluation Baselines & Metrics">
          <div className="baseline-grid">
            {[
              ["DNSMOS", "No-reference speech-quality estimation baseline."],
              ["NISQA", "Existing speech-quality assessment baseline."],
              ["WebRTC Statistics", "Network baseline using packet loss, jitter and bitrate."],
              ["Human MOS", "Compare model estimates against human perceptual ratings."],
              ["Pearson Correlation", "Measure correlation with human-labelled ratings."],
              ["Spearman Correlation", "Evaluate agreement in quality ranking."],
              ["Unseen Conditions", "Test degradation conditions not represented during training."],
            ].map(([name, text]) => (
              <article key={name}>
                <strong>{name}</strong>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </Slide>

        {/* 11 SECURITY */}
        <Slide number={11} eyebrow="08 — SECURITY MEASURES" title="Security & Privacy">
          <div className="security-grid">
            {[
              ["Security Overview", "Privacy-preserving local speech processing and controlled access to project administration."],
              ["Data Protection", "Raw speech remains on the user's device. Project uploads use controlled backend and object-storage handling."],
              ["Access Control", "Admin/instructor operations such as upload, publish and version management require authentication and authorization."],
              ["Secure Communication", "Use secure transport for deployed frontend/backend communication. Storage access should be mediated by the backend rather than exposing privileged storage credentials."],
            ].map(([name, text]) => (
              <article key={name}>
                <span className="card-label">{name}</span>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </Slide>

        {/* 12 QUALITY */}
        <Slide number={12} eyebrow="09 — QUALITY ATTRIBUTES" title="Reliability, Usability & Maintainability">
          <div className="quality-grid">
            {[
              ["Reliability", "Use rolling-window processing, temporal smoothing, controlled evaluation and performance monitoring to make live estimates stable and repeatable."],
              ["Usability", "Provide a simple browser interface, clear status information, understandable quality feedback and a straightforward microphone-permission flow."],
              ["Maintainability", "Keep frontend, backend, inference and deployment modular; document interfaces; use version control and preserve historical presentation versions."],
            ].map(([name, text]) => (
              <article key={name}>
                <div className="quality-mark">✓</div>
                <h3>{name}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </Slide>

        {/* 13 FEASIBILITY */}
        <Slide number={13} eyebrow="10 — INITIAL PLANNING" title="First Feasibility Experiment • Weeks 1–2">
          <div className="feasibility-hero">
            <span className="card-label">Core Feasibility Requirement</span>
            <h3>
              The model and preprocessing pipeline must run completely inside
              the browser.
            </h3>
            <p>
              A Python-only result or exported model without browser execution
              is not sufficient.
            </p>
          </div>

          <div className="measurement-grid">
            {[
              "Model size",
              "Feature-extraction time",
              "Inference time",
              "Peak memory",
              "CPU usage",
              "Pearson correlation",
              "Spearman correlation",
            ].map((item) => (
              <div key={item}>
                <strong>{item}</strong>
                <span>Measure during feasibility baseline.</span>
              </div>
            ))}
          </div>
        </Slide>

        {/* 14 RISKS */}
        <Slide number={14} eyebrow="10 — INITIAL PLANNING" title="Technical Risks & Expected Challenges">
          <div className="risk-grid">
            {[
              ["Browser Inference", "Inference may be slower than expected."],
              ["Model Size", "Compression or distillation may be required."],
              ["Hardware Variation", "Performance may vary across hardware."],
              ["Unseen Degradations", "Unseen conditions may reduce estimation quality."],
              ["Live Stability", "Estimates may fluctuate without temporal smoothing."],
            ].map(([name, text]) => (
              <article key={name}>
                <span className="risk-number">!</span>
                <div>
                  <h3>{name}</h3>
                  <p>{text}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="risk-management">
            <strong>Risk Management</strong>
            <p>
              Use early feasibility testing, profiling, model compression,
              controlled evaluation and temporal smoothing.
            </p>
          </div>
        </Slide>

        {/* 15 GANTT */}
        <Slide number={15} eyebrow="10 — INITIAL PLANNING" title="17-Week Development Roadmap">
          <div className="gantt-wrap">
            <div className="gantt-header">
              <div className="gantt-task-heading">Task</div>
              <div className="gantt-weeks-heading">
                {Array.from({ length: 17 }, (_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
            </div>

            {ganttTasks.map((task) => (
              <div className="gantt-line" key={task.title}>
                <div className="gantt-task-name">
                  <strong>{task.label}</strong>
                  <span>{task.title}</span>
                </div>

                <div className="gantt-track">
                  {Array.from({ length: 17 }, (_, i) => {
                    const week = i + 1;
                    const active = week >= task.start && week <= task.end;
                    return (
                      <span
                        key={week}
                        className={active ? "gantt-active" : ""}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="dependency-line">
            <strong>Dependencies</strong>
            <span>
              Feasibility → Dataset/Model → Compression → Browser Inference →
              SDK/WebRTC → Evaluation → Final Integration
            </span>
          </div>
        </Slide>

        {/* 16 MILESTONES */}
        <Slide number={16} eyebrow="10 — INITIAL PLANNING" title="Milestones & Phase Outputs">
          <div className="milestone-grid">
            {[
              ["Weeks 1–2", "Feasibility baseline", "Browser execution + performance measurements"],
              ["Weeks 3–5", "Dataset ready", "Splits, preprocessing and controlled degradations"],
              ["Weeks 6–8", "Baseline model", "Model evaluated against baselines and MOS labels"],
              ["Weeks 9–11", "Optimized inference", "Compression + browser inference pipeline"],
              ["Weeks 12–14", "Integrated system", "JS/WASM SDK + WebRTC test application"],
              ["Weeks 15–16", "Evaluation complete", "Stability, delay, unseen conditions and browser performance"],
              ["Week 17", "Final demo", "Integration, documentation, deployment and presentation"],
            ].map(([weeks, title, text]) => (
              <article key={weeks}>
                <span>{weeks}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </Slide>

        {/* 17 CONCLUSION */}
        <Slide number={17} eyebrow="11 — CONCLUSION" title="Conclusion">
          <div className="conclusion-grid">
            <article>
              <span className="card-label">Summary</span>
              <p>
                EdgeAudio-QC proposes privacy-preserving speech-quality
                estimation inside the browser. The plan covers browser
                feasibility, model development, optimization, streaming
                inference, integration and evaluation.
              </p>
            </article>
            <article>
              <span className="card-label">Next Steps</span>
              <p>
                Complete the Weeks 1–2 browser feasibility experiment; prepare
                the dataset and baseline model; establish measured performance;
                then proceed to optimization and browser integration.
              </p>
            </article>
            <article className="wide">
              <span className="card-label">Feedback & Discussion</span>
              <p>
                The team welcomes feedback on scope, technical approach,
                evaluation methodology, security/privacy assumptions and the
                development roadmap.
              </p>
            </article>
          </div>
        </Slide>

        {/* 18 REFERENCES */}
        <Slide number={18} eyebrow="12 — REFERENCES" title="References">
          <div className="references">
            <p>• UCS503 Planning Presentation template provided for the project planning presentation.</p>
            <p>• DNSMOS — Deep Noise Suppression Mean Opinion Score, used as a no-reference speech-quality baseline.</p>
            <p>• NISQA — Non-Intrusive Speech Quality Assessment, used as an evaluation baseline.</p>
            <p>• LibriSpeech — speech dataset referenced for speech-processing experimentation.</p>
            <p>• Web Audio API and WebRTC browser interfaces.</p>
            <p>• ONNX / WebAssembly browser inference technologies planned for model execution.</p>
            <p>• React and Vite for frontend development.</p>
            
          </div>
        </Slide>
      </main>
    </div>
  );
}

export default Planning;