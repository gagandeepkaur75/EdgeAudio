import LiveCommunication from "./pages/LiveCommunication";
import "./App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);
  return null;
}

import Home from "./Home";
import AdminPage from "./pages/AdminPage";
import DeliverablePage from "./pages/DeliverablePage";
import DeliverablesHistoryPage from "./pages/DeliverablesHistoryPage";
import FinalPresentationPage from "./pages/FinalPresentationPage";
import DocumentationPage from "./pages/DocumentationPage";
import PageNav from "./components/PageNav";
import "./pages/docs.css";

function Page({ children }) {
  return (
    <div className="site-page">
      <PageNav />
      <main className="page-container">{children}</main>
    </div>
  );
}

function Project() {
  useEffect(() => {
    document.documentElement.classList.add("use-snap");
    return () => document.documentElement.classList.remove("use-snap");
  }, []);

  return (
    <Page>
      <div className="page-title">
        <h1>Project Overview</h1>
        <p>
          EdgeAudio-QC is a privacy-preserving browser-based system for
          estimating perceived speech quality during live web communication.
        </p>
      </div>

      <section className="project-section">
        <h2>Problem Statement</h2>
        <div className="blue-box">
          <p>
            Current web communication systems rely mainly on network
            statistics and server-side analysis, but they do not provide a
            privacy-preserving, client-side estimate of perceived speech
            quality while a call is in progress.
          </p>
        </div>
      </section>

      <section className="project-section">
        <h2>Our Solution</h2>
        <div className="blue-box">
          <p>
            EdgeAudio-QC processes speech locally inside the browser. A small
            neural network (about 584 k parameters, ONNX Runtime Web) estimates a
            1–5 quality score and five diagnostics (noise, clipping, muffling,
            dropouts and wind) from rolling 2-second windows, while raw audio
            stays on the user's device. A two-person WebRTC call lets each side
            score the audio it receives.
          </p>
        </div>
      </section>

      <section className="project-section">
        <h2>Objectives</h2>
        <div className="blue-box">
          <ul>
            <li><b>O1</b> Estimate a MOS-style quality score (1 to 5) for live speech in the browser, updated at least once per second during speech.</li>
            <li><b>O2</b> Explain the score with five diagnostics: noise, clipping, muffling, dropouts and wind.</li>
            <li><b>O3</b> Never transmit raw audio to the backend; the server only handles signalling and deliverable metadata.</li>
            <li><b>O4</b> Let users reproduce typical impairments with a condition simulator.</li>
            <li><b>O5</b> Provide a two-person WebRTC test call in which each side can score the audio it receives.</li>
            <li><b>O6</b> Publish each course deliverable as a permanent, versioned page that is never overwritten.</li>
          </ul>
        </div>
      </section>

      <section className="project-section">
        <h2>Delivered Scope</h2>
        <div className="card-grid">
          <div className="project-card">
            <h3>Included</h3>
            <p>Project website; Live Test page (microphone, demo voices, PC audio, condition simulator, score, diagnostics, oscilloscope and quality trend); two-person call with remote-audio scoring; admin login, upload and versioned publishing; public deliverables history; offline Python training and ONNX export pipeline.</p>
          </div>
          <div className="project-card">
            <h3>Excluded</h3>
            <p>Calls with more than two media participants; user accounts other than one administrator; storing any audio or analysis history; native mobile apps; calibration against human listening panels or ITU-T reference algorithms.</p>
          </div>
          <div className="project-card">
            <h3>System boundary</h3>
            <p>Everything that touches audio runs in the browser. The backend only relays WebRTC connection messages, authenticates the administrator and stores deliverable files and metadata.</p>
          </div>
        </div>
      </section>

      <section className="project-section">
        <h2>Delivered Functions</h2>
        <div className="card-grid">
          <div className="project-card"><h3>01</h3><p>Audio capture: microphone, demo voice, PC (tab) audio or remote call audio</p></div>
          <div className="project-card"><h3>02</h3><p>Anti-aliased resampling to 16 kHz and voice-activity detection</p></div>
          <div className="project-card"><h3>03</h3><p>Feature extraction: 80 log-mel bands + 5 spectral features</p></div>
          <div className="project-card"><h3>04</h3><p>On-device ONNX model: score, voice probability, 5 diagnostics</p></div>
          <div className="project-card"><h3>05</h3><p>Temporal smoothing and live display</p></div>
          <div className="project-card"><h3>06</h3><p>Condition simulator, two-person call and versioned publishing</p></div>
        </div>
      </section>

      <section className="project-section">
        <h2>Intended Users</h2>
        <div className="card-grid">
          <div className="project-card">
            <h3>Call participant / tester</h3>
            <p>Checks microphone and room quality before or during a call; needs a clear score and plain-language reasons. No login.</p>
          </div>
          <div className="project-card">
            <h3>Remote peer</h3>
            <p>Joins a test call by room code and can see the quality of the audio received.</p>
          </div>
          <div className="project-card">
            <h3>Team administrator</h3>
            <p>Logs in at /admin to upload and publish each deliverable as a new permanent version.</p>
          </div>
          <div className="project-card">
            <h3>Evaluator / visitor</h3>
            <p>Reads the project website, opens each deliverable version and downloads files. Read-only.</p>
          </div>
          <div className="project-card">
            <h3>Developer / maintainer</h3>
            <p>Rebuilds, retrains or redeploys the system from the repository (see Documentation).</p>
          </div>
        </div>
      </section>

      <section className="project-section">
        <h2>External Interfaces</h2>
        <div className="card-grid">
          <div className="project-card">
            <h3>Web Audio API</h3>
            <p>Microphone and tab-audio capture (getUserMedia, getDisplayMedia) and audio processing.</p>
          </div>
          <div className="project-card">
            <h3>WebRTC</h3>
            <p>Peer-to-peer SRTP/Opus audio; ICE via stun.l.google.com:19302.</p>
          </div>
          <div className="project-card">
            <h3>ONNX Runtime Web 1.30.0</h3>
            <p>Runs the speech-quality model in WebAssembly on a [1, 201, 85] feature tensor.</p>
          </div>
          <div className="project-card">
            <h3>REST API</h3>
            <p>HTTPS + JSON to the Express backend for call signalling, admin login and publishing.</p>
          </div>
        </div>
      </section>
    </Page>
  );
}

function Team() {
  const members = [
    ["01", "Prabhleen Kaur Saini", "1024170047", "ML, Backend & Speech Processing", "Datasets • MOS • Model • Express • Deployment",
      "Heuristic DSP scoring engine; dataset generation, teacher labels and model training in PyTorch; Express backend (auth, upload, publishing, signalling) and its hardening; EC2 hosting, systemd service, Cloudflare Tunnel and GitHub Actions deployment."],
    ["02", "Gagandeep Kaur", "1024170063", "Frontend & Browser", "React • Web Audio • WebRTC",
      "React SPA structure and routing; Web Audio capture and analyser graph; live oscilloscope, quality trend and level meter; WebRTC peer-connection integration in the Live Test page; project website pages; frontend deployment on Cloudflare."],
    ["03", "Dishita Sharma", "1024170081", "Browser ML & Optimization", "ONNX • WebAssembly • Performance",
      "ONNX export and INT8 quantisation; ONNX Runtime Web integration; JavaScript feature extraction and resampling with the parity test; ring-buffer and VAD logic; performance profiling."],
  ];

  return (
    <Page>
      <div className="page-title">
        <h1>Our Team</h1>
        <p>Team VoxEdge · Team ID 6 · Subgroup 3Q13 · B.E. Computer Science and Engineering, Semester 5</p>
        <p>UCS503 Software Engineering Lab · Submitted to Sukhpal Singh · Thapar Institute of Engineering and Technology</p>
      </div>

      <div className="team-grid-new">
        {members.map(([num, name, roll, role, skills, work]) => (
          <div className="team-card-new" key={num}>
            <span>{num}</span>
            <h2>{name}</h2>
            <p className="team-roll">Roll no. {roll}</p>
            <h3>{role}</h3>
            <p>{skills}</p>
            <p className="team-work">{work}</p>
          </div>
        ))}
      </div>

      <section className="project-section" style={{ marginTop: 50 }}>
        <h2>Shared Responsibilities</h2>
        <div className="blue-box">
          <p>Requirements and design models, testing, report, presentation and viva preparation.</p>
        </div>
      </section>
    </Page>
  );
}

function Timeline() {
  useEffect(() => {
    document.documentElement.classList.add("use-snap");
    return () => document.documentElement.classList.remove("use-snap");
  }, []);

  const tasks = [
    ["Weeks 1–2", "Browser Feasibility", "Browser execution and baseline measurements", 1, 2],
    ["Weeks 3–5", "Dataset & Model", "Dataset preparation and model development", 3, 5],
    ["Weeks 6–8", "Optimization", "Quantization and browser optimization", 6, 8],
    ["Weeks 9–11", "Streaming Inference", "Rolling-window browser inference", 9, 11],
    ["Weeks 12–14", "SDK & WebRTC", "JS/WASM SDK and WebRTC integration", 12, 14],
    ["Weeks 15–16", "Evaluation", "Full evaluation and comparison", 15, 16],
    ["Week 17", "Final Integration", "Deployment, documentation and demonstration", 17, 17],
  ];

  const milestones = [
    ["M1", "Feasibility Baseline", "Week 2"],
    ["M2", "Baseline Model", "Week 5"],
    ["M3", "Optimized Model", "Week 8"],
    ["M4", "Live Inference", "Week 11"],
    ["M5", "Browser Integration", "Week 14"],
    ["M6", "Final Evaluation", "Week 16"],
    ["M7", "Final Deployment", "Week 17"],
  ];

  return (
    <Page>
      <div className="page-title">
        <h1>17-Week Development Roadmap</h1>
        <p>Tasks, dependencies, milestones and deadlines for the complete EdgeAudio-QC project.</p>
      </div>

      <section className="project-section">
        <h2>17-Week Development Gantt Chart</h2>
        <p className="timeline-description">
          The development plan made at the start of the project. Planned versus delivered: the model,
          browser inference, rolling-window streaming and WebRTC integration were delivered; an INT8
          quantised model was exported but the FP32 model is used by default; packaging the analyser as a
          separate JS/WASM SDK was not delivered and is listed as future work.
        </p>

        <div className="visual-gantt">
          <div className="visual-gantt-header">
            <div className="visual-task-heading">Task</div>
            <div className="week-numbers">
              {Array.from({ length: 17 }, (_, i) => <span key={i}>{i + 1}</span>)}
            </div>
          </div>

          {tasks.map(([weeks, name, description, start, end]) => (
            <div className="visual-gantt-row" key={name}>
              <div className="visual-task">
                <strong>{weeks}</strong>
                <span>{name}</span>
                <small>{description}</small>
              </div>
              <div className="week-grid">
                {Array.from({ length: 17 }, (_, i) => {
                  const week = i + 1;
                  return (
                    <div
                      key={week}
                      className={week >= start && week <= end ? "week-cell active" : "week-cell"}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="project-section">
        <h2>Task Dependencies</h2>
        <div className="dependency-grid">
          <div className="dependency-card"><span>01</span><h3>Feasibility → Dataset</h3><p>Browser feasibility testing is completed before finalizing the dataset and model pipeline.</p></div>
          <div className="dependency-card"><span>02</span><h3>Dataset → Model</h3><p>Dataset preparation and preprocessing are required before model development.</p></div>
          <div className="dependency-card"><span>03</span><h3>Model → Optimization</h3><p>The baseline model is required before compression and browser optimization.</p></div>
          <div className="dependency-card"><span>04</span><h3>Optimization → Streaming</h3><p>Optimized browser inference is required before rolling-window streaming inference.</p></div>
          <div className="dependency-card"><span>05</span><h3>Streaming → Evaluation</h3><p>The complete streaming pipeline is integrated before final evaluation.</p></div>
          <div className="dependency-card"><span>06</span><h3>Evaluation → Deployment</h3><p>Evaluation is completed before final deployment and demonstration.</p></div>
        </div>
      </section>

      <section className="project-section">
        <h2>Major Milestones</h2>
        <div className="milestone-grid">
          {milestones.map(([id, title, week]) => (
            <div className="milestone-card" key={id}>
              <span>{id}</span>
              <h3>{title}</h3>
              <p>{week}</p>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}

function Architecture() {
  useEffect(() => {
    document.documentElement.classList.add("use-snap");
    return () => document.documentElement.classList.remove("use-snap");
  }, []);

  const parts = [
    ["01", "Frontend (React 19 + Vite)", "Single-page app: project pages, Live Test page, admin and deliverable pages. Hosted on Cloudflare Workers/Pages."],
    ["02", "Browser Processing", "Web Audio capture → anti-aliased resampling to 16 kHz → VAD → 85 features × 201 frames → ONNX Runtime Web (WASM) → smoothed score. No audio leaves the device."],
    ["03", "Backend (Node.js 22 + Express)", "JWT admin login with bcrypt and lockout, file upload, immutable versioned publishing, and in-memory WebRTC signalling. Runs on AWS EC2 behind a Cloudflare Tunnel."],
    ["04", "Storage", "Deliverable files in AWS S3 / Cloudflare R2 (local disk fallback); deliverable metadata in a JSON-file database behind a SQLite-compatible shim."],
    ["05", "Deployment & CI/CD", "Frontend build deployed to Cloudflare; GitHub Actions deploys the backend to EC2 over SSH on every push to main."],
  ];

  return (
    <Page>
      <div className="page-title">
        <h1>Technical Architecture</h1>
        <p>The delivered system: edge analysis in the browser with thin cloud coordination.</p>
      </div>

      <section className="project-section">
        <h2>Architecture Overview</h2>
        <img className="doc-figure" src="/diagrams/18_architecture.png" alt="System architecture diagram" />
        <p className="doc-caption">Everything that touches audio runs inside the browser; the cloud only serves the site and model, relays call set-up messages and stores deliverables.</p>
      </section>

      <div className="architecture-flow">
        {parts.map(([num, title, text], index) => (
          <div key={num}>
            <div className="architecture-card">
              <span>{num}</span>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
            {index < parts.length - 1 && <div className="architecture-arrow">↓</div>}
          </div>
        ))}
      </div>

      <section className="project-section">
        <h2>Key Design Decisions</h2>
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead><tr><th>Decision</th><th>Alternatives rejected</th><th>Reason and trade-off</th></tr></thead>
            <tbody>
              <tr><td>In-browser inference with ONNX Runtime Web (WASM)</td><td>Server inference API; TensorFlow.js</td><td>Keeps audio local and avoids network delay. Trade-off: the model must stay small; first load downloads about 2.5 MB.</td></tr>
              <tr><td>Small CNN + 2-layer GRU (≈584 k parameters)</td><td>Large NISQA-style model; DSP heuristics only</td><td>Fits the size and latency budget; the heuristic engine is kept as a fallback if the model fails to load.</td></tr>
              <tr><td>Synthetic training data with heuristic teacher labels</td><td>Human listening tests; licensed PESQ labels</td><td>Feasible within the semester and licences. Trade-off: scores are only as good as the teacher.</td></tr>
              <tr><td>Feature extraction re-implemented in JavaScript</td><td>Raw audio into the model; Python in WASM</td><td>Keeps the model small; a parity test checks browser and Python features agree within 1e-3.</td></tr>
              <tr><td>HTTP polling signalling, rooms in memory</td><td>WebSockets; third-party signalling</td><td>Simple to host behind a tunnel and easy to test. Trade-off: about 1 s signalling delay; state lost on restart.</td></tr>
              <tr><td>Immutable slug-per-version publishing</td><td>Overwriting a "current" file</td><td>Meets the course rule that every version stays available.</td></tr>
              <tr><td>JSON-file DB behind a SQLite-compatible shim</td><td>better-sqlite3 native module; hosted DB</td><td>No native build on EC2; tiny data volume. Trade-off: no SQL engine or concurrent writers.</td></tr>
              <tr><td>Cloudflare Pages + EC2 behind Cloudflare Tunnel</td><td>One VM for everything</td><td>Global static delivery and no open inbound ports. Trade-off: the quick-tunnel URL changes on restart.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="project-section">
        <h2>Quality Targets</h2>
        <div className="card-grid">
          <div className="project-card"><h3>Performance</h3><p>Target: under 25 ms inference per window on a laptop CPU in WASM; score refresh at least once per second during speech.</p></div>
          <div className="project-card"><h3>Size</h3><p>Model under 3 MB: FP32 2.45 MB (used by default), INT8 variant 0.41 MB.</p></div>
          <div className="project-card"><h3>Accuracy</h3><p>Target: held-out PLCC ≥ 0.70 against teacher labels (measured 0.713); VAD accuracy ≥ 95% (measured 99.8%).</p></div>
          <div className="project-card"><h3>Capacity</h3><p>Signalling limits: 500 rooms, 8 users per room, 200 queued signals per user, 16 kB per signal.</p></div>
        </div>
      </section>

      <section className="project-section">
        <h2>Implemented Security Measures</h2>
        <div className="blue-box">
          <ul>
            <li>Admin login with bcrypt-hashed password and 8-hour JWT; lockout after 5 failed attempts per IP in 15 minutes.</li>
            <li>Upload and publish endpoints require a valid Bearer token.</li>
            <li>CORS allow-list (ALLOWED_ORIGINS) and a 100 kB JSON body limit.</li>
            <li>Validated, size-limited call messages; only room members can send signals.</li>
            <li>Published versions can never be overwritten or deleted; reserved page names cannot be used as slugs.</li>
            <li>Backend exposed only through a Cloudflare Tunnel (no open inbound ports); secrets kept in environment variables, never in Git.</li>
            <li>Raw speech never leaves the browser; no API accepts audio.</li>
          </ul>
        </div>
      </section>

      <section className="project-section">
        <h2>Known Limitations</h2>
        <div className="blue-box">
          <ul>
            <li>Scores come from a heuristic teacher, not human ratings, and are not validated against PESQ/POLQA.</li>
            <li>No TURN relay: calls between peers behind strict (symmetric) NATs can fail.</li>
            <li>Call rooms live in one server's memory and are lost on restart.</li>
            <li>The quick-tunnel backend URL changes if the tunnel restarts.</li>
          </ul>
        </div>
        <p className="doc-caption">Full details, diagrams, API, setup and test results are on the <a href="/documentation">Documentation</a> page.</p>
      </section>
    </Page>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/project" element={<Project />} />
        <Route path="/team" element={<Team />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/architecture" element={<Architecture />} />
        <Route path="/documentation" element={<DocumentationPage />} />
        <Route path="/live-communication" element={<LiveCommunication />} />
        <Route path="/live" element={<LiveCommunication />} />
        <Route path="/live-test" element={<LiveCommunication />} />
        <Route path="/planning" element={<DeliverablePage slug="planning-v1" />} />
        <Route path="/planning-v1" element={<DeliverablePage slug="planning-v1" />} />
        <Route path="/final-presentation" element={<FinalPresentationPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/deliverables" element={<DeliverablesHistoryPage />} />
        <Route path="/:slug" element={<DeliverablePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;