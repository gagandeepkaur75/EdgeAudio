import LiveCommunication from "./pages/LiveCommunication";
import "./App.css";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { useState, useEffect } from "react";

import Home from "./Home";
import Planning from "./pages/planning";
import LiveTest from "./pages/LiveTest";
import AdminPage from "./pages/AdminPage";
import DeliverablePage from "./pages/DeliverablePage";
import { api } from "./utils/api";

function PageNav() {
  const [deliverables, setDeliverables] = useState([]);

  useEffect(() => {
    let active = true;
    api.getDeliverables()
      .then((data) => {
        if (active) setDeliverables(data);
      })
      .catch((err) => {
        console.error("Failed to load deliverables in navbar:", err);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <nav className="inner-nav">
      <Link to="/" className="inner-logo">
        EdgeAudio<span>-QC</span>
      </Link>

      <div className="inner-nav-links">
        <Link to="/">Home</Link>
        <Link to="/project">Project</Link>
        <Link to="/team">Team</Link>
        <Link to="/live-communication">Live Test</Link>
        
        {/* Render dynamic deliverables */}
        {deliverables.map((d) => (
          <Link key={d.slug} to={`/${d.slug}`}>
            {d.title}
          </Link>
        ))}
        
        {/* Fallback to Planning V1 link if no deliverables are published */}
        {deliverables.length === 0 && (
          <Link to="/planning-v1">Planning V1</Link>
        )}

        <Link to="/timeline">Timeline</Link>
        <Link to="/architecture">Architecture</Link>
        <Link to="/admin">Admin</Link>
      </div>
    </nav>
  );
}

function Page({ children }) {
  return (
    <div className="site-page">
      <PageNav />
      <main className="page-container">{children}</main>
    </div>
  );
}

function Project() {
  return (
    <Page>
      <div className="page-title">
        <span>01 — PROJECT</span>
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
        <h2>Proposed Solution</h2>
        <div className="blue-box">
          <p>
            EdgeAudio-QC processes speech locally inside the browser and
            provides a live estimate of perceived speech quality while keeping
            raw audio on the user's device.
          </p>
        </div>
      </section>

      <section className="project-section">
        <h2>Project Scope</h2>
        <div className="card-grid">
          <div className="project-card">
            <h3>Browser Processing</h3>
            <p>Speech processing and model inference run directly inside the browser.</p>
          </div>
          <div className="project-card">
            <h3>Privacy Preservation</h3>
            <p>Raw audio remains on the user's device during quality analysis.</p>
          </div>
          <div className="project-card">
            <h3>Live Estimation</h3>
            <p>Rolling audio windows provide a stable quality estimate.</p>
          </div>
        </div>
      </section>

      <section className="project-section">
        <h2>Project Objectives</h2>
        <div className="blue-box">
          <ul>
            <li>Estimate perceived speech quality during communication.</li>
            <li>Process raw audio locally in the browser.</li>
            <li>Run preprocessing and inference on the client side.</li>
            <li>Maintain low processing time and memory usage.</li>
            <li>Evaluate the system using suitable quality metrics.</li>
          </ul>
        </div>
      </section>

      <section className="project-section">
        <h2>Proposed Functions</h2>
        <div className="card-grid">
          <div className="project-card"><h3>01</h3><p>Microphone capture</p></div>
          <div className="project-card"><h3>02</h3><p>Audio preprocessing</p></div>
          <div className="project-card"><h3>03</h3><p>Feature extraction</p></div>
          <div className="project-card"><h3>04</h3><p>Browser model inference</p></div>
          <div className="project-card"><h3>05</h3><p>Temporal smoothing</p></div>
          <div className="project-card"><h3>06</h3><p>Live quality estimation</p></div>
        </div>
      </section>

      <section className="project-section">
        <h2>Intended Users</h2>
        <div className="card-grid">
          <div className="project-card">
            <h3>Web Communication Users</h3>
            <p>Users who need information about speech quality during browser communication.</p>
          </div>
          <div className="project-card">
            <h3>Researchers</h3>
            <p>Researchers evaluating speech processing and browser-based inference.</p>
          </div>
          <div className="project-card">
            <h3>Developers</h3>
            <p>Developers working on privacy-preserving communication systems.</p>
          </div>
        </div>
      </section>

      <section className="project-section">
        <h2>System Features</h2>
        <div className="blue-box">
          <ul>
            <li>Browser microphone capture</li>
            <li>Local audio processing</li>
            <li>Rolling-window analysis</li>
            <li>Speech-quality estimation</li>
            <li>Temporal smoothing</li>
            <li>Browser ML inference</li>
            <li>WebRTC integration</li>
            <li>Live quality display</li>
          </ul>
        </div>
      </section>

      <section className="project-section">
        <h2>External Interfaces</h2>
        <div className="card-grid">
          <div className="project-card">
            <h3>Web Audio API</h3>
            <p>Browser audio capture and processing.</p>
          </div>
          <div className="project-card">
            <h3>WebRTC</h3>
            <p>Real-time communication and audio integration.</p>
          </div>
          <div className="project-card">
            <h3>Browser ML Runtime</h3>
            <p>Local execution of the speech-quality model.</p>
          </div>
        </div>
      </section>
    </Page>
  );
}

function Team() {
  const members = [
    ["01", "Gagandeep Kaur", "Frontend & Browser", "React • Web Audio • WebRTC"],
    ["02", "Prabhleen Kaur", "ML, Backend & Speech Processing", "Datasets • MOS • Model • Express • Deployment"],
    ["03", "Dishita ", "Browser ML & Optimization", "ONNX • WebAssembly • Performance"],
  ];

  return (
    <Page>
      <div className="page-title">
        <span>02 — TEAM</span>
        <h1>Our Team</h1>
        <p>Three members working across frontend, machine learning, browser inference, backend and deployment.</p>
      </div>

      <div className="team-grid-new">
        {members.map(([num, name, role, skills]) => (
          <div className="team-card-new" key={num}>
            <span>{num}</span>
            <h2>{name}</h2>
            <h3>{role}</h3>
            <p>{skills}</p>
          </div>
        ))}
      </div>
    </Page>
  );
}

function PlanningV2() {
  return (
    <Page>
      <div className="page-title">
        <span>PLANNING PRESENTATION</span>
        <h1>Planning Presentation V2</h1>
        <p>A separate version of the project plan will be maintained here if the plan changes after V1.</p>
      </div>

      <div className="version-banner">
        <div><strong>Version:</strong> V2</div>
        <div><strong>Date:</strong> To be updated</div>
        <div><strong>Authors:</strong> EdgeAudio-QC Team</div>
      </div>

      <section className="project-section">
        <h2>Change Summary</h2>
        <div className="blue-box">
          <p>
            Changes made from Planning V1 will be recorded here.
            Previous versions will remain accessible and will not be overwritten.
          </p>
        </div>
      </section>

      <section className="project-section">
        <h2>Version History</h2>
        <div className="version-list">
          <Link to="/planning-v1" className="version-item">
            <strong>Planning V1</strong>
            <span>Initial planning presentation</span>
          </Link>
          <div className="version-item current">
            <strong>Planning V2</strong>
            <span>Current version</span>
          </div>
        </div>
      </section>
    </Page>
  );
}

function Timeline() {
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
        <span>10 — INITIAL PLANNING</span>
        <h1>17-Week Development Roadmap</h1>
        <p>Tasks, dependencies, milestones and deadlines for the complete EdgeAudio-QC project.</p>
      </div>

      <section className="project-section">
        <h2>17-Week Development Gantt Chart</h2>
        <p className="timeline-description">
          The planned development activities across the complete 17-week project schedule.
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
  const parts = [
    ["01", "Frontend", "React-based interface, navigation and live quality display."],
    ["02", "Browser Processing", "Web Audio API, preprocessing and browser-based inference."],
    ["03", "Backend", "Authentication, file management, publishing and version control."],
    ["04", "Object Storage", "Presentations, PDFs, images and project files."],
    ["05", "Deployment", "Public website and server infrastructure configured by the team."],
  ];

  return (
    <Page>
      <div className="page-title">
        <span>04 — SYSTEM ARCHITECTURE</span>
        <h1>Technical Architecture</h1>
        <p>Proposed frontend, backend, storage and deployment architecture.</p>
      </div>

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
        <h2>Performance Goals</h2>
        <div className="card-grid">
          <div className="project-card"><h3>Processing</h3><p>Low-latency browser processing.</p></div>
          <div className="project-card"><h3>Memory</h3><p>Controlled browser memory usage.</p></div>
          <div className="project-card"><h3>Model Size</h3><p>Compact browser-deployable model.</p></div>
        </div>
      </section>

      <section className="project-section">
        <h2>Security Measures</h2>
        <div className="blue-box">
          <ul>
            <li>Authentication for admin access.</li>
            <li>Secure backend communication.</li>
            <li>Controlled upload permissions.</li>
            <li>Secure object-storage access.</li>
            <li>Previous versions must not be overwritten.</li>
            <li>Raw speech remains on the client during analysis.</li>
          </ul>
        </div>
      </section>

      <section className="project-section">
        <h2>Reliability, Usability & Maintainability</h2>
        <div className="card-grid">
          <div className="project-card"><h3>Reliability</h3><p>Stable operation and preservation of published versions.</p></div>
          <div className="project-card"><h3>Usability</h3><p>Clear navigation and simple upload and publishing workflow.</p></div>
          <div className="project-card"><h3>Maintainability</h3><p>Modular frontend, backend and storage components.</p></div>
        </div>
      </section>

      <section className="project-section">
        <h2>Technical Risks</h2>
        <div className="blue-box">
          <ul>
            <li>Browser performance limitations.</li>
            <li>Model size and inference-time constraints.</li>
            <li>Memory consumption during long calls.</li>
            <li>Browser compatibility.</li>
            <li>Secure file-upload configuration.</li>
            <li>Deployment and storage configuration.</li>
          </ul>
        </div>
      </section>
    </Page>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/project" element={<Project />} />
        <Route path="/team" element={<Team />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/architecture" element={<Architecture />} />
        <Route path="/live-communication" element={<LiveCommunication />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/live-test" element={<LiveTest />} />
        <Route path="/:slug" element={<DeliverablePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;