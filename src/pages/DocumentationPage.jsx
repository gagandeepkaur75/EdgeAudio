import PageNav from "../components/PageNav";
import "./docs.css";

const REPO = "https://github.com/gagandeepkaur75/EdgeAudio";
const FORK = "https://github.com/prabhleenkaursaini/EdgeAudioP";
const SITE = "https://edgeaudio.gkaur10-be24.workers.dev";
const API = "https://falling-thunder-attitude-indianapolis.trycloudflare.com";
const TESTED = "cec2cb6";
const FINAL = "b188a00";

const SECTIONS = [
  ["overview", "Project at a glance"],
  ["links", "Links and version"],
  ["architecture", "Architecture and modules"],
  ["api", "Frontend, backend and API"],
  ["storage", "Database and storage"],
  ["diagrams", "Design diagrams"],
  ["setup", "Installation and running"],
  ["release", "Build, test and release (CI/CD)"],
  ["testing", "Testing and results"],
  ["defects", "Known defects and unverified claims"],
  ["changes", "Improvements since the prototype"],
  ["limits", "Limitations and scaling"],
  ["contrib", "Member contributions"],
  ["future", "Future work"],
  ["refs", "References"],
];

const DIAGRAMS = [
  ["01_use_case", "Use case diagram", "Four actors (call participant, remote peer, team admin, evaluator) and the external STUN server. Every analysis use case includes viewing results; scoring remote audio extends it during a call; publishing includes admin login."],
  ["02_activity_live_analysis", "Activity diagram: live analysis", "Loads the model (or falls back to the heuristic engine), then loops: capture → resample → skip silence → features → ONNX → smoothed display, until Stop."],
  ["03_swimlane_publish", "Swimlane: publishing a deliverable", "Admin, frontend, backend and storage lanes: login and lockout check, JWT-protected upload, slug validation, and the 409 branch that keeps old versions immutable."],
  ["04_dfd_level0", "DFD Level 0 (context)", "The whole system as one process with five external entities. Raw audio only flows between the browsers, never into a server data store."],
  ["05_dfd_level1", "DFD Level 1", "Six processes: analyse quality and simulate degradations (browser), call signalling (in-memory rooms), admin authentication, upload/publish and serving pages (backend, with object storage and the deliverables table)."],
  ["06_dfd_level2", "DFD Level 2 (process 1.0)", "Analysis split into capture, resample/buffer, voice-activity detection, feature extraction, inference and smoothing/display; balanced with Level 1."],
  ["07_class_frontend", "Class diagram: frontend", "MLAudioAnalyzer owns the ring buffers, mel basis and ONNX session and returns an AnalysisResult; the Live Test page holds a local and a remote analyzer, the simulator settings and one RTCPeerConnection."],
  ["08_class_backend", "Class diagram: backend", "Express app mounting auth and four routers; MeetingRouter composes Rooms, Participants and Signals in memory; upload and publish depend on requireAuth, StorageService and the DB shim."],
  ["09_sequence_live_analysis", "Sequence: live analysis", "Model loads once; each audio callback pushes a frame, and predict() runs only when the window is full and speech is active."],
  ["10_sequence_call_setup", "Sequence: call set-up", "Join, poll, offer, answer and ICE exchange through the signalling API; each message is delivered exactly once. Audio then flows peer-to-peer over SRTP."],
  ["11_collab_publish", "Collaboration: admin publishing", "Numbered messages between AdminPage, AuthModule, UploadRouter, PublishRouter, StorageService and Database."],
  ["12_collab_call", "Collaboration: joining a call", "The peer page, api module, MeetingRouter and Room, plus a separate remote analyzer that scores incoming audio."],
  ["13_state_analyzer", "State chart: analyzer", "Uninitialised → LoadingModel → Ready / HeuristicFallback → Buffering ⇄ Silent / Predicting → ResultUpdated."],
  ["14_state_participant", "State chart: call participant", "Idle → Joining → WaitingForPeer → Negotiating → Connected, with Rejected, TimedOut (45 s without a poll) and Left."],
  ["15_component", "Component diagram", "Browser SPA components, backend components (auth, signalling, upload/publish, storage, DB shim) and the offline Python ML pipeline that produces the model files."],
  ["16_deployment", "Deployment diagram", "Browser ↔ Cloudflare edge (site and model) and Cloudflare Tunnel → Express on EC2 → S3/R2; peers connect directly after STUN; GitHub Actions deploys over SSH."],
  ["17_er_storage", "Storage / ER model", "The persistent deliverables table and its link to stored objects, plus the in-memory room, participant and signal-queue model."],
  ["18_architecture", "System architecture", "Edge analysis in the browser with thin cloud coordination."],
];

function Sec({ id, title, children }) {
  return (
    <section className="project-section doc-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Code({ children }) {
  return <pre className="doc-code"><code>{children}</code></pre>;
}

export default function DocumentationPage() {
  return (
    <div className="site-page">
      <PageNav />
      <main className="page-container">
        <div className="page-title">
          <h1>Documentation</h1>
          <p>Everything an evaluator needs to understand, run and check the final EdgeAudio-QC system. This page matches the final project report.</p>
        </div>

        <nav className="doc-toc" aria-label="Contents">
          {SECTIONS.map(([id, t], i) => <a key={id} href={`#${id}`}>{String(i + 1).padStart(2, "0")} {t}</a>)}
        </nav>

        <Sec id="overview" title="1. Project at a glance">
          <Table head={["Item", "Details"]} rows={[
            ["Project", "EdgeAudio-QC: Privacy-Preserving In-Browser Speech Quality Estimation"],
            ["Course", "UCS503 Software Engineering Lab, submitted to Sukhpal Singh, Thapar Institute of Engineering and Technology"],
            ["Team", "Team VoxEdge, Team ID 6, Subgroup 3Q13, B.E. Computer Science and Engineering, Semester 5"],
            ["Members", "Prabhleen Kaur Saini (1024170047), Gagandeep Kaur (1024170063), Dishita Sharma (1024170081)"],
            ["Problem", "Call tools report network statistics, not how speech sounds, and audio-based quality checks usually upload the user's voice to a server."],
            ["Solution", "A 1–5 quality score and five diagnostics (noise, clipping, muffling, dropouts, wind) computed entirely in the browser, plus a two-person WebRTC test call and a versioned deliverables portal."],
            ["Intended users", "Call participants and testers, remote peers, the team administrator, evaluators, and developers maintaining the system."],
          ]} />
        </Sec>

        <Sec id="links" title="2. Links and version">
          <Table head={["Resource", "Link"]} rows={[
            ["Live website", <a key="v" href={SITE}>{SITE}</a>],
            ["Live Test (working demo)", <a key="v" href={`${SITE}/live-test`}>{SITE}/live-test</a>],
            ["Final presentation", <a key="v" href={`${SITE}/final-presentation`}>{SITE}/final-presentation</a>],
            ["Deliverables history", <a key="v" href={`${SITE}/deliverables`}>{SITE}/deliverables</a>],
            ["Backend health check", <a key="v" href={`${API}/api/health`}>{API}/api/health</a>],
            ["Source repository", <><a href={REPO}>{REPO}</a> (team fork: <a href={FORK}>{FORK}</a>)</>],
            ["Final version", <>Commit <a href={`${REPO}/commit/${FINAL}`}><code>{FINAL}</code></a> on <code>main</code> (<a href={`${REPO}/commits/main`}>latest commits</a>)</>],
          ]} />
          <p className="doc-note">The backend uses a temporary Cloudflare quick-tunnel address; if the tunnel is restarted the address changes and the site must be rebuilt with the new <code>VITE_API_URL</code>.</p>
        </Sec>

        <Sec id="architecture" title="3. Architecture and connections between modules">
          <img className="doc-figure" src="/diagrams/18_architecture.png" alt="System architecture" />
          <ul className="doc-list">
            <li><b>Browser (React 19 SPA):</b> the Live Test page captures audio, applies the condition simulator, and feeds <code>MLAudioAnalyzer</code>, which resamples to 16 kHz, detects speech, extracts features and runs the ONNX model through ONNX Runtime Web 1.30.0 (WebAssembly). A second analyzer scores the incoming call audio.</li>
            <li><b>Backend (Node.js 22 + Express 4):</b> admin authentication (bcrypt + JWT), file upload, immutable publishing, public deliverables API and in-memory WebRTC signalling. It never receives audio.</li>
            <li><b>Storage:</b> deliverable files in AWS S3 / Cloudflare R2 (local disk fallback); metadata in a JSON-file database.</li>
            <li><b>Hosting:</b> the static build and model files on Cloudflare Workers/Pages; the backend on AWS EC2 (Ubuntu 24.04, systemd) behind a Cloudflare Tunnel; WebRTC media peer-to-peer with Google STUN.</li>
            <li><b>Offline ML pipeline (Python/PyTorch):</b> generates degraded speech, computes teacher labels, trains the model and exports <code>model.onnx</code> into <code>public/models/</code>.</li>
          </ul>
          <div className="doc-two">
            <figure><img className="doc-figure" src="/diagrams/15_component.png" alt="Component diagram" /><figcaption>Component diagram</figcaption></figure>
            <figure><img className="doc-figure" src="/diagrams/16_deployment.png" alt="Deployment diagram" /><figcaption>Deployment diagram</figcaption></figure>
          </div>
        </Sec>

        <Sec id="api" title="4. Frontend, backend and API overview">
          <h3>Frontend routes</h3>
          <p><code>/</code>, <code>/project</code>, <code>/team</code>, <code>/timeline</code>, <code>/architecture</code>, <code>/documentation</code>, <code>/live-communication</code> (aliases <code>/live</code>, <code>/live-test</code>), <code>/planning</code>, <code>/final-presentation</code>, <code>/admin</code>, <code>/deliverables</code> and <code>/:slug</code> for any published deliverable.</p>
          <h3>REST API</h3>
          <Table head={["Method and path", "Auth", "Purpose and main responses"]} rows={[
            ["GET /api/health", "No", "Liveness check; 200"],
            ["POST /api/auth/login", "No", "Returns {token, expiresIn}; 400 missing fields; 401 wrong credentials; 429 locked out"],
            ["POST /api/upload", "JWT", "Multipart file → {fileKey, fileUrl}; 401 without token"],
            ["POST /api/publish", "JWT", "Create a permanent version; 201; 400 validation; 409 slug already exists"],
            ["GET /api/deliverables", "No", "List all versions"],
            ["GET /api/deliverables/:slug", "No", "One version; 404 if unknown"],
            ["POST /api/meeting/join", "No", "Join or create a room; 404 peer joining a missing room; 409 full; 503 too many rooms"],
            ["GET /api/meeting/:id/check", "No", "Does the room exist? 404 otherwise"],
            ["GET /api/meeting/:id/poll?userId=", "No", "Heartbeat; returns participants and queued signals (each delivered once)"],
            ["POST /api/meeting/signal", "No", "Queue SDP/ICE for a peer; 403 sender not in room; 413 over 16 kB"],
            ["POST /api/meeting/leave", "No", "Leave; empty rooms are deleted"],
          ]} />
          <h3>Complete data flow (live analysis)</h3>
          <p className="doc-flow">Microphone PCM (44.1/48 kHz) → anti-aliasing low-pass + linear-interpolation resampling to 16 kHz → 32 000-sample ring buffer → voice-activity detection with hang-over → 2 s window → 512-point FFT frames → 80 log-mel + 5 spectral features → normalisation (<code>norm_stats.json</code>) → tensor [1, 201, 85] → ONNX Runtime Web → score, voice probability, 5 diagnostics → smoothing → score, problem cards, oscilloscope and 10-second trend. No network request is made after the model has loaded.</p>
          <h3>Authentication, validation and errors</h3>
          <p>The frontend stores the admin JWT in <code>sessionStorage</code> and sends it as a Bearer token; any 401 clears it and returns to login. The backend validates every field (slug pattern, reserved slugs, date format, room and user IDs, signal size) and answers with clear HTTP status codes and JSON error messages.</p>
        </Sec>

        <Sec id="storage" title="5. Database and storage design">
          <img className="doc-figure doc-figure-md" src="/diagrams/17_er_storage.png" alt="Storage design" />
          <ul className="doc-list">
            <li><b>deliverables</b> (persistent): <code>id</code> primary key, <code>slug</code> unique and not null, title, deliverable_type, version, presentation_date (YYYY-MM-DD), authors, change_summary, file_key, file_url, original_filename, file_size_bytes, published_at. Rows are never updated or deleted, so every version stays available.</li>
            <li><b>Stored objects</b> in S3/R2: one object per upload, linked one-to-one by <code>file_key</code>.</li>
            <li><b>Rooms, participants and signal queues</b> live only in memory and are removed 45 s after a user stops polling.</li>
            <li><b>Queries:</b> duplicate-slug check, insert on publish, fetch by slug or id, and a full ordered list. They run through <code>better-sqlite3-shim.js</code>, which stores rows in a JSON file at <code>DB_PATH</code>, chosen to avoid a native SQLite build on the server.</li>
          </ul>
        </Sec>

        <Sec id="diagrams" title="6. Design diagrams">
          <p>All diagrams are draw.io files in <a href={`${REPO}/tree/main/docs/diagrams`}><code>docs/diagrams</code></a> in the repository. Click any diagram to open it full size.</p>
          <div className="doc-gallery">
            {DIAGRAMS.map(([file, title, text]) => (
              <figure key={file} className="doc-card">
                <a href={`/diagrams/${file}.png`} target="_blank" rel="noreferrer"><img src={`/diagrams/${file}.png`} alt={title} loading="lazy" /></a>
                <figcaption><b>{title}.</b> {text}</figcaption>
              </figure>
            ))}
          </div>
        </Sec>

        <Sec id="setup" title="7. Installation, configuration and running">
          <h3>Prerequisites and versions</h3>
          <Table head={["Item", "Version"]} rows={[
            ["Node.js", "22.16.0 (pinned in .nvmrc; 22.12+ required)"],
            ["React / React Router / Vite", "^19.2.8 / ^7.18.2 / ^8.2.0"],
            ["onnxruntime-web", "1.30.0 (exact)"],
            ["Express / jsonwebtoken / bcryptjs / multer", "^4.21.0 / ^9.0.2 / ^2.4.3 / ^2.0.1"],
            ["@aws-sdk/client-s3", "^3.658.0"],
            ["Python ML stack", "Python 3, PyTorch, torchaudio, NumPy, SciPy, soundfile, onnx, onnxruntime"],
          ]} />
          <h3>Frontend</h3>
          <Code>{`git clone ${REPO}.git
cd EdgeAudio
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run lint`}</Code>
          <h3>Backend</h3>
          <Code>{`cd backend
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:3000
npm test               # 17 API checks`}</Code>
          <h3>Configuration variable names</h3>
          <p><b>backend/.env</b> (values are never committed): <code>PORT</code>, <code>ADMIN_USERNAME</code>, <code>ADMIN_PASSWORD_HASH</code>, <code>JWT_SECRET</code>, <code>JWT_EXPIRES_IN</code>, <code>DB_PATH</code>, <code>ALLOWED_ORIGINS</code>, <code>S3_ENDPOINT</code>, <code>S3_REGION</code>, <code>S3_ACCESS_KEY_ID</code>, <code>S3_SECRET_ACCESS_KEY</code>, <code>S3_BUCKET</code>, <code>S3_PUBLIC_BASE_URL</code>, <code>LOCAL_UPLOAD_URL</code>.<br />
            <b>Frontend:</b> <code>VITE_API_URL</code> in <code>.env.development</code> and <code>.env.production</code>.</p>
          <h3>Sample data</h3>
          <p>The database file is created automatically at <code>DB_PATH</code> on first start. Add deliverables through <code>/admin</code> or the curl sequence in <code>backend/README.md</code>. Demo voices are bundled in <code>public/audio/</code>.</p>
          <h3>ML pipeline</h3>
          <Code>{`python ml/download_data.py   # speech + noise corpora
python ml/train.py           # writes ml/checkpoints/ and norm stats
python ml/export_onnx.py     # writes public/models/model.onnx
python ml/test_suite.py      # parity, behaviour and held-out tests`}</Code>
        </Sec>

        <Sec id="release" title="8. Build, test and release process (CI/CD)">
          <ul className="doc-list">
            <li><b>Frontend:</b> built with Vite (<code>npm run build</code>) and the <code>dist/</code> folder is deployed to Cloudflare Workers/Pages.</li>
            <li><b>Backend:</b> the GitHub Actions workflow <code>.github/workflows/deploy.yml</code> runs on every push to <code>main</code>. It connects to the EC2 host over SSH (host, user and key are GitHub secrets), pulls <code>main</code>, runs <code>npm install --omit=dev</code> in <code>backend/</code> and restarts the systemd service <code>edgeaudioqc</code>.</li>
            <li><b>Tests:</b> <code>npm test</code> in <code>backend/</code> and <code>python ml/test_suite.py</code> are run locally before release; the workflow does not yet run them automatically (see Future work).</li>
          </ul>
        </Sec>

        <Sec id="testing" title="9. Testing approach and results">
          <p><b>Approach:</b> black-box API tests, Python/JavaScript feature-parity and PyTorch/ONNX parity tests, behavioural model tests (score must fall as noise, packet loss, clipping and muffling get worse), a held-out evaluation, and manual browser tests. <b>Tested version:</b> commit <code>{TESTED}</code> on <code>main</code>, 23 November 2026.</p>
          <Table head={["Category", "Test cases", "Status", "Evidence"]} rows={[
            ["Backend API", "TC-01 to TC-10", "Executed: 17/17 checks passed", <><code>backend/tests/api.test.js</code>, <a href={`${REPO}/blob/main/docs/api-test-results.json`}><code>docs/api-test-results.json</code></a></>],
            ["Model parity and behaviour", "TC-13 to TC-15", "Executed and passed", <code key="v">ml/test_suite.py</code>],
            ["Model held-out evaluation", "NFR-03", "Executed; recorded", <code key="v">ml/test_metrics.json</code>],
            ["Manual browser tests", "TC-11, TC-12, TC-16, TC-17", "Executed and passed", "Screenshots on the Final Presentation page"],
            ["Totals", "17 test cases", "17 executed and passed", ""],
          ]} />
          <h3>Backend API checks (executed)</h3>
          <Table head={["Check", "What it verifies", "Result"]} rows={[
            ["API-01", "Health check", "HTTP 200"],
            ["API-02 / 03", "Login with valid / wrong credentials", "200 + JWT / 401"],
            ["API-04 / 05", "Upload without / with token", "401 / 200 + fileKey"],
            ["API-06 / 07", "Publish new version / re-publish same slug", "201 / 409"],
            ["API-08 / 09", "Reserved slug / bad date format", "400 / 400"],
            ["API-10 / 11", "List and fetch by slug / unknown slug", "200 / 404"],
            ["API-12", "Peer joins a non-existent room", "404"],
            ["API-13", "Host and peer join; offer delivered exactly once", "Pass"],
            ["API-14 / 15", "Oversized signal / sender not in room", "413 / 403"],
            ["API-16", "Ninth user joins a full room", "409"],
            ["API-17", "Login lockout after 5 failures", "429"],
          ]} />
          <h3>Model evaluation (held-out, 397 windows)</h3>
          <Table head={["Metric", "Value", "Target"]} rows={[
            ["Score Pearson correlation (PLCC)", "0.713", "≥ 0.70 — met"],
            ["Score Spearman correlation (SRCC)", "0.631", "—"],
            ["Score RMSE (1–5 scale)", "1.28", "—"],
            ["VAD accuracy / F1", "0.998 / 0.999", "≥ 0.95 — met"],
            ["VAD precision / recall", "0.997 / 1.000", "—"],
          ]} />
          <h3>Objectives versus outcomes</h3>
          <Table head={["Objective", "Outcome"]} rows={[
            ["O1 Live score in the browser", "Delivered"],
            ["O2 Five diagnostics", "Delivered"],
            ["O3 No audio to the server", "Delivered by design: no API accepts audio"],
            ["O4 Condition simulator", "Delivered"],
            ["O5 Two-person call with remote scoring", "Delivered, except behind strict NATs"],
            ["O6 Immutable versioned deliverables", "Delivered"],
          ]} />
        </Sec>

        <Sec id="defects" title="10. Known defects and unverified claims">
          <h3>Defects found and fixed</h3>
          <Table head={["ID", "Defect", "Fix"]} rows={[
            ["D-01", "Polling re-added users who had left (ghost participants)", "Only users who joined via /join are refreshed"],
            ["D-02", "A mistyped code created a new room", "Only a host can create a room; peers get 404"],
            ["D-03", "Unbounded rooms and queues could exhaust memory", "Limits on rooms, users, queued signals and signal size"],
            ["D-04", "A slug equal to a site page hid that page", "Reserved-slug list and slug validation"],
            ["D-05", "Scores dropped during natural pauses", "Speech buffer, VAD hang-over and smoothing"],
            ["D-06", "Native better-sqlite3 failed to build on the server", "JSON-file shim with the same API"],
          ]} />
          <h3>Open issues</h3>
          <ul className="doc-list">
            <li>Calls fail between peers behind symmetric NATs because no TURN relay is configured.</li>
            <li>The quick-tunnel backend URL changes when the tunnel restarts.</li>
            <li>Call rooms are held in memory and lost on server restart.</li>
          </ul>
          <h3>Claims we have not verified</h3>
          <ul className="doc-list">
            <li>The score is trained on heuristic teacher labels and has <b>not</b> been calibrated against human listening tests or validated against PESQ/POLQA; it is a relative indicator, not a true MOS.</li>
            <li>The 25 ms per-window latency is a design target; browser latency has not yet been measured across browsers and devices.</li>
          </ul>
        </Sec>

        <Sec id="changes" title="11. Improvements since the prototype">
          <Table head={["Area", "Prototype (mid-semester)", "Final system"]} rows={[
            ["Scoring engine", "Heuristic DSP formula only", "Trained neural model in ONNX with heuristic fallback"],
            ["Window and VAD", "Fixed 1 s windows; silence was scored", "2 s window, 3 s speech buffer, VAD with hang-over; silence shown as \"_\""],
            ["Features", "Basic SNR, bandwidth, clipping estimates", "85-feature log-mel front end with Python/JS parity test"],
            ["Audio sources", "Microphone only", "Microphone, demo voices, PC/tab audio, remote call audio"],
            ["Call", "Prototype UI", "Working two-person WebRTC call with hardened signalling"],
            ["Backend security", "Basic login", "bcrypt + JWT, lockout, body limits, CORS allow-list, slug validation"],
            ["Deliverables", "Static links", "Immutable versioned publishing with a history page"],
          ]} />
        </Sec>

        <Sec id="limits" title="12. Limitations and scaling">
          <ul className="doc-list">
            <li><b>Label quality:</b> the model reproduces a heuristic teacher, so absolute scores are not calibrated MOS.</li>
            <li><b>Signalling bottleneck:</b> rooms live in one process and clients poll every second. One small instance handles the configured 500 rooms; scaling out needs shared state (e.g. Redis) and WebSockets. A restart drops all rooms; users simply rejoin.</li>
            <li><b>Connectivity:</b> without TURN some peers cannot connect; adding TURN costs bandwidth for relayed minutes.</li>
            <li><b>Client cost:</b> analysis runs on each user's device, so it scales up and down with users at no server cost; very low-power devices may not keep up in real time.</li>
            <li><b>Storage:</b> the JSON database suits one administrator; concurrent writers would need a real database.</li>
          </ul>
        </Sec>

        <Sec id="contrib" title="13. Member contributions">
          <Table head={["Member", "Contributions"]} rows={[
            ["Prabhleen Kaur Saini (1024170047)", "Heuristic DSP scoring engine; dataset generation, teacher labels and model training in PyTorch; Express backend (auth, upload, publishing, signalling) and its hardening; EC2 hosting, systemd service, Cloudflare Tunnel and GitHub Actions deployment."],
            ["Gagandeep Kaur (1024170063)", "React SPA structure and routing; Web Audio capture and analyser graph; live oscilloscope, quality trend and level meter; WebRTC peer-connection integration; project website pages; frontend deployment on Cloudflare."],
            ["Dishita Sharma (1024170081)", "ONNX export and INT8 quantisation; ONNX Runtime Web integration; JavaScript feature extraction and resampling with the parity test; ring-buffer and VAD logic; performance profiling."],
            ["Shared", "Requirements and design models, testing, report, presentation and viva preparation."],
          ]} />
        </Sec>

        <Sec id="future" title="14. Future work">
          <ol className="doc-list">
            <li>Calibrate and evaluate the model on human-rated data and against PESQ/DNSMOS, then retrain with those labels.</li>
            <li>Add a TURN relay, replace polling with WebSockets and move room state to a shared store.</li>
            <li>Use a named Cloudflare tunnel with a fixed hostname.</li>
            <li>Run the API tests and <code>ml/test_suite.py</code> in GitHub Actions before each deployment; add frontend end-to-end tests.</li>
            <li>Load the INT8 model by default once its accuracy matches FP32 (2.45 MB → 0.41 MB).</li>
            <li>Move audio processing to an AudioWorklet and measure real-time latency across browsers and devices.</li>
          </ol>
        </Sec>

        <Sec id="refs" title="15. References">
          <ol className="doc-list doc-refs">
            <li>ITU-T Recommendation P.800, Methods for subjective determination of transmission quality, 1996.</li>
            <li>ITU-T Recommendation P.862, Perceptual evaluation of speech quality (PESQ), 2001.</li>
            <li>G. Mittag, B. Naderi, A. Chehadi and S. Möller, "NISQA: A deep CNN-self-attention model for multidimensional speech quality prediction with crowdsourced datasets," Proc. Interspeech, 2021.</li>
            <li>C. K. A. Reddy, V. Gopal and R. Cutler, "DNSMOS: A non-intrusive perceptual objective speech quality metric to evaluate noise suppressors," Proc. ICASSP, 2021.</li>
            <li>J. Kominek and A. W. Black, "The CMU ARCTIC speech databases," Proc. ISCA Speech Synthesis Workshop, 2004.</li>
            <li>Free Spoken Digit Dataset (FSDD), <a href="https://github.com/Jakobovski/free-spoken-digit-dataset">github.com/Jakobovski/free-spoken-digit-dataset</a>.</li>
            <li>ONNX Runtime Web documentation, <a href="https://onnxruntime.ai/docs/tutorials/web/">onnxruntime.ai/docs/tutorials/web</a>.</li>
            <li>W3C, WebRTC: Real-Time Communication in Browsers; W3C, Web Audio API.</li>
            <li>React (react.dev), Vite (vite.dev) and Express (expressjs.com) documentation.</li>
            <li>I. Sommerville, Software Engineering, 10th ed., Pearson, 2016.</li>
          </ol>
        </Sec>
      </main>
    </div>
  );
}
