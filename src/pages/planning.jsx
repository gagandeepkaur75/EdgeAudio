function Planning() {
  return (
    <div className="planning-page">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="presentation-header">

        <p className="project-label">
          UCS503 SOFTWARE PROJECT
        </p>

        <h1>EdgeAudio-QC</h1>

        <h2>Planning Presentation V1</h2>

        <div className="presentation-info">
          <span>Version: V1</span>
          <span>Date: August 2026</span>
          <span>Authors: EdgeAudio-QC Team</span>
        </div>

      </header>





      <main>


        {/* =====================================================
            01 — INTRODUCTION
        ===================================================== */}

        <section
          id="introduction"
          className="presentation-section"
        >

          <p className="section-label">
            01 — INTRODUCTION
          </p>

          <h2>Introduction</h2>


          <div className="content-box">

            <h3>Overview</h3>

            <p>
              EdgeAudio-QC is a privacy-preserving,
              browser-based system designed to estimate
              perceived speech quality during a live web
              communication session.
            </p>

            <p>
              The system is designed to process speech
              locally in the user's browser and provide
              a live quality estimate without requiring
              raw audio to be sent to a remote server
              for analysis.
            </p>

          </div>


          <div className="two-column">

            <div className="content-card">

              <h3>Why Is This Important?</h3>

              <p>
                Speech quality can change during an online
                communication session because of network,
                audio-processing and environmental conditions.
              </p>

              <p>
                A privacy-preserving approach can provide
                useful quality information while reducing
                the need to transmit raw speech audio.
              </p>

            </div>


            <div className="content-card">

              <h3>Presentation Objectives</h3>

              <ul>
                <li>Define the project scope.</li>
                <li>Explain the proposed functions.</li>
                <li>Identify intended users.</li>
                <li>Describe system features and interfaces.</li>
                <li>Define performance and security goals.</li>
                <li>Present the initial development plan.</li>
              </ul>

            </div>

          </div>

        </section>



        {/* =====================================================
            02 — PROJECT SCOPE
        ===================================================== */}

        <section
          id="scope"
          className="presentation-section"
        >

          <p className="section-label">
            02 — PROJECT SCOPE
          </p>

          <h2>Project Scope</h2>


          <div className="content-box">

            <h3>Project Aims</h3>

            <p>
              The main aim of EdgeAudio-QC is to develop
              a browser-based system that estimates
              perceived speech quality during live
              communication while keeping raw audio
              processing on the user's device.
            </p>

          </div>


          <div className="three-column">

            <div className="content-card">
              <span className="card-number">01</span>
              <h3>Speech Capture</h3>
              <p>
                Capture speech from the user's microphone
                through browser audio interfaces.
              </p>
            </div>


            <div className="content-card">
              <span className="card-number">02</span>
              <h3>Local Processing</h3>
              <p>
                Process audio locally in the browser
                instead of sending raw audio for analysis.
              </p>
            </div>


            <div className="content-card">
              <span className="card-number">03</span>
              <h3>Quality Estimation</h3>
              <p>
                Produce a live estimate representing
                perceived speech quality.
              </p>
            </div>

          </div>


          <div className="content-box">

            <h3>Expected Deliverables</h3>

            <ul>
              <li>Browser-based EdgeAudio-QC application.</li>
              <li>Speech-quality estimation model.</li>
              <li>Browser inference pipeline.</li>
              <li>Frontend user interface.</li>
              <li>Backend and deployment infrastructure.</li>
              <li>Evaluation results and documentation.</li>
            </ul>

          </div>


          <div className="content-box">

            <h3>Broad Functionality</h3>

            <p>
              The planned system captures speech, extracts
              relevant information, performs local inference,
              applies quality estimation and presents a
              stable quality result to the user.
            </p>

          </div>

        </section>



        {/* =====================================================
            03 — PROPOSED FUNCTIONS
        ===================================================== */}

        <section
          id="functions"
          className="presentation-section"
        >

          <p className="section-label">
            03 — PROPOSED FUNCTIONS
          </p>

          <h2>Proposed Functions</h2>


          <div className="content-box">

            <h3>Major Functions</h3>

            <div className="feature-list">

              <div>
                <strong>01 — Microphone Capture</strong>
                <p>
                  Capture speech using browser microphone
                  permissions.
                </p>
              </div>

              <div>
                <strong>02 — Audio Preprocessing</strong>
                <p>
                  Prepare incoming audio for feature extraction
                  and inference.
                </p>
              </div>

              <div>
                <strong>03 — Feature Extraction</strong>
                <p>
                  Extract information required by the
                  speech-quality model.
                </p>
              </div>

              <div>
                <strong>04 — Browser Inference</strong>
                <p>
                  Execute the quality-estimation model
                  inside the browser.
                </p>
              </div>

              <div>
                <strong>05 — Quality Estimation</strong>
                <p>
                  Generate a perceived speech-quality estimate.
                </p>
              </div>

              <div>
                <strong>06 — Live Display</strong>
                <p>
                  Present the quality result and processing
                  status to the user.
                </p>
              </div>

            </div>

          </div>


          <div className="content-box">

            <h3>User Needs</h3>

            <ul>
              <li>Simple access through a web browser.</li>
              <li>Clear and understandable quality feedback.</li>
              <li>Low processing delay.</li>
              <li>Privacy of raw speech audio.</li>
              <li>Stable quality estimation during a session.</li>
            </ul>

          </div>


          <div className="flow-diagram">

            <div className="flow-step">
              <span>01</span>
              <strong>Microphone</strong>
              <small>Speech capture</small>
            </div>

            <div className="flow-arrow">→</div>

            <div className="flow-step">
              <span>02</span>
              <strong>Browser</strong>
              <small>Audio processing</small>
            </div>

            <div className="flow-arrow">→</div>

            <div className="flow-step">
              <span>03</span>
              <strong>ML Model</strong>
              <small>Inference</small>
            </div>

            <div className="flow-arrow">→</div>

            <div className="flow-step">
              <span>04</span>
              <strong>Quality Score</strong>
              <small>Live result</small>
            </div>

          </div>

        </section>



        {/* =====================================================
            04 — TARGET USERS
        ===================================================== */}

        <section
          id="users"
          className="presentation-section"
        >

          <p className="section-label">
            04 — TARGET USERS
          </p>

          <h2>Target Users</h2>


          <div className="three-column">

            <div className="content-card">

              <span className="card-number">01</span>

              <h3>Web Communication Users</h3>

              <p>
                Users participating in browser-based
                voice communication who need speech-quality
                feedback.
              </p>

            </div>


            <div className="content-card">

              <span className="card-number">02</span>

              <h3>Developers & Researchers</h3>

              <p>
                People developing or evaluating browser-based
                communication and speech-processing systems.
              </p>

            </div>


            <div className="content-card">

              <span className="card-number">03</span>

              <h3>Communication Platforms</h3>

              <p>
                Systems that may benefit from client-side
                speech-quality monitoring without transmitting
                raw speech.
              </p>

            </div>

          </div>


          <div className="content-box">

            <h3>User Characteristics</h3>

            <ul>
              <li>Users may have different levels of technical knowledge.</li>
              <li>The interface should be simple and understandable.</li>
              <li>Users expect fast feedback during communication.</li>
              <li>Privacy and data protection are important considerations.</li>
            </ul>

          </div>


          <div className="content-box">

            <h3>User Needs Impact</h3>

            <p>
              These user requirements influence the design
              of the system by requiring a simple interface,
              responsive quality feedback, low processing
              overhead and privacy-preserving local processing.
            </p>

          </div>

        </section>



        {/* =====================================================
            05 — SYSTEM FEATURES
        ===================================================== */}

        <section
          id="features"
          className="presentation-section"
        >

          <p className="section-label">
            05 — SYSTEM FEATURES
          </p>

          <h2>System Features</h2>


          <div className="feature-grid">

            <div className="feature-card">
              <h3> Microphone Capture</h3>
              <p>
                Browser-based speech capture with user permission.
              </p>
            </div>

            <div className="feature-card">
              <h3> Privacy-Preserving Processing</h3>
              <p>
                Raw audio is designed to remain on the user's device.
              </p>
            </div>

            <div className="feature-card">
              <h3>Local Feature Extraction</h3>
              <p>
                Audio information required by the model is
                extracted locally.
              </p>
            </div>

            <div className="feature-card">
              <h3>Browser ML Inference</h3>
              <p>
                The planned model inference runs inside
                the browser.
              </p>
            </div>

            <div className="feature-card">
              <h3>Live Quality Estimate</h3>
              <p>
                Display a continuously updated speech-quality estimate.
              </p>
            </div>

            <div className="feature-card">
              <h3>Rolling-Window Analysis</h3>
              <p>
                Use rolling audio windows to provide more stable
                quality estimation.
              </p>
            </div>

          </div>


          <div className="content-box">

            <h3>Feature Interaction</h3>

            <p>
              The system combines microphone capture,
              browser audio processing, feature extraction,
              machine-learning inference and result
              visualization into one processing pipeline.
            </p>

          </div>


          <div className="architecture-diagram">

            <div>Microphone</div>
            <span>↓</span>
            <div>Web Audio / WebRTC</div>
            <span>↓</span>
            <div>Feature Extraction</div>
            <span>↓</span>
            <div>Browser ML Inference</div>
            <span>↓</span>
            <div>Quality Estimate</div>

          </div>

        </section>



        {/* =====================================================
            06 — INTERFACES
        ===================================================== */}

        <section
          id="interfaces"
          className="presentation-section"
        >

          <p className="section-label">
            06 — INTERFACES
          </p>

          <h2>Interfaces</h2>


          <div className="three-column">

            <div className="content-card">

              <h3>User Interface</h3>

              <p>
                The frontend provides navigation,
                project information, live testing controls,
                processing status and quality results.
              </p>

              <ul>
                <li>Homepage</li>
                <li>Planning Presentation</li>
                <li>Live Test interface</li>
                <li>Quality result display</li>
              </ul>

            </div>


            <div className="content-card">

              <h3>Hardware / Software</h3>

              <p>
                The planned system interacts with:
              </p>

              <ul>
                <li>User microphone</li>
                <li>Desktop browser</li>
                <li>Web Audio APIs</li>
                <li>WebRTC interfaces</li>
                <li>Browser ML runtime</li>
              </ul>

            </div>


            <div className="content-card">

              <h3>Communication Interfaces</h3>

              <p>
                The project website will communicate with
                its backend for administrative operations,
                publishing and file management.
              </p>

              <p>
                Raw speech processing is intended to remain
                local to the user's device.
              </p>

            </div>

          </div>

        </section>



        {/* =====================================================
            07 — PERFORMANCE GOALS
        ===================================================== */}

        <section
          id="performance"
          className="presentation-section"
        >

          <p className="section-label">
            07 — PERFORMANCE GOALS
          </p>

          <h2>Performance Goals</h2>


          <div className="target-grid">

            <div className="target-card">
              <h3>Browser</h3>
              <strong>Chrome Stable</strong>
              <p>
                Target browser environment for initial testing.
              </p>
            </div>


            <div className="target-card">
              <h3>Model Size</h3>
              <strong>&lt; 2 MB</strong>
              <p>
                Initial target after model quantization.
              </p>
            </div>


            <div className="target-card">
              <h3>Bundle Size</h3>
              <strong>&lt; 5 MB</strong>
              <p>
                Initial target for the browser bundle.
              </p>
            </div>


            <div className="target-card">
              <h3>Processing</h3>
              <strong>&lt; 300 ms</strong>
              <p>
                Target processing time per update cycle.
              </p>
            </div>


            <div className="target-card">
              <h3>Memory</h3>
              <strong>&lt; 150 MB</strong>
              <p>
                Target peak memory during a 10-minute call.
              </p>
            </div>


            <div className="target-card">
              <h3>Live Updates</h3>
              <strong>1 second</strong>
              <p>
                Target update interval using a rolling context.
              </p>
            </div>

          </div>


          <div className="content-box">

            <h3>Why Performance Matters</h3>

            <p>
              Speech-quality estimation is intended to operate
              during a live communication session. Excessive
              processing time, memory usage or model size could
              affect responsiveness and usability.
            </p>

          </div>


          <div className="content-box">

            <h3>Achievement Strategy</h3>

            <ul>
              <li>Model quantization and optimization.</li>
              <li>Efficient browser-side feature extraction.</li>
              <li>Rolling-window processing.</li>
              <li>Performance profiling.</li>
              <li>Memory and CPU monitoring.</li>
              <li>Browser inference optimization.</li>
            </ul>

          </div>

        </section>



        {/* =====================================================
            08 — SECURITY MEASURES
        ===================================================== */}

        <section
          id="security"
          className="presentation-section"
        >

          <p className="section-label">
            08 — SECURITY MEASURES
          </p>

          <h2>Security Measures</h2>


          <div className="security-grid">

            <div className="security-card">

              <span></span>

              <h3>Privacy</h3>

              <p>
                Raw audio is intended to remain on the
                user's device during speech-quality analysis.
              </p>

            </div>


            <div className="security-card">

              <span></span>

              <h3>Data Protection</h3>

              <p>
                Administrative files and project data will
                be handled through controlled backend and
                object-storage services.
              </p>

            </div>


            <div className="security-card">

              <span></span>

              <h3>Authentication</h3>

              <p>
                The instructor/admin interface will require
                authentication before protected operations
                can be performed.
              </p>

            </div>


            <div className="security-card">

              <span></span>

              <h3>Access Control</h3>

              <p>
                Administrative operations such as uploading,
                publishing and version management will be
                restricted to authorized users.
              </p>

            </div>

          </div>


          <div className="content-box">

            <h3>Secure Communication and Storage</h3>

            <p>
              The deployed system will use secure communication
              between the frontend and backend. Uploaded
              presentation materials will be stored in approved
              object storage rather than being treated as
              frontend-hosting files.
            </p>

          </div>

        </section>



        {/* =====================================================
            09 — QUALITY ATTRIBUTES
        ===================================================== */}

        <section
          id="quality"
          className="presentation-section"
        >

          <p className="section-label">
            09 — QUALITY ATTRIBUTES
          </p>

          <h2>Quality Attributes</h2>


          <div className="three-column">

            <div className="quality-card">

              <div className="quality-icon">
                01
              </div>

              <h3>Reliability</h3>

              <p>
                The system should provide stable quality
                estimates and continue operating reliably
                during a communication session.
              </p>

            </div>


            <div className="quality-card">

              <div className="quality-icon">
                02
              </div>

              <h3>Usability</h3>

              <p>
                Users should be able to start a test,
                understand the processing status and
                interpret the quality result easily.
              </p>

            </div>


            <div className="quality-card">

              <div className="quality-icon">
                03
              </div>

              <h3>Maintainability</h3>

              <p>
                The system should use modular frontend,
                backend and inference components with
                clear documentation and version control.
              </p>

            </div>

          </div>

        </section>



        {/* =====================================================
            10 — INITIAL PLANNING
        ===================================================== */}

        <section
          id="planning"
          className="presentation-section"
        >

          <p className="section-label">
            10 — INITIAL PLANNING
          </p>

          <h2>Initial Planning</h2>


          {/* FEASIBILITY */}

          <div className="content-box">

            <h3>Feasibility Report — Initial Findings</h3>

            <p>
              The initial feasibility work focuses on determining
              whether speech-quality preprocessing and model
              inference can operate inside a desktop browser
              while meeting practical model-size, processing-time
              and memory constraints.
            </p>

            <div className="check-list">

              <div>✓ Browser-based execution</div>
              <div>✓ Local audio processing</div>
              <div>✓ Model-size evaluation</div>
              <div>✓ Feature-extraction measurement</div>
              <div>✓ Inference-time measurement</div>
              <div>✓ Memory and CPU evaluation</div>
              <div>✓ Correlation with quality labels</div>

            </div>

          </div>
          {/* =====================================================
    GANTT CHART
===================================================== */}

<div className="gantt-section">

  <div className="gantt-title-row">
    <div>
      <p className="gantt-label">INITIAL DEVELOPMENT SCHEDULE</p>
      <h3>17-Week Development Gantt Plan</h3>
      <p className="gantt-subtitle">
        Development tasks, dependencies and milestones planned across the
        17-week project schedule.
      </p>
    </div>
  </div>

  <div className="gantt-chart">

    {/* HEADER */}

    <div className="gantt-header">

      <div className="gantt-task-header">
        Task
      </div>

      <div className="gantt-week-header">

        {Array.from({ length: 17 }, (_, i) => (
          <div className="week-number" key={i}>
            {i + 1}
          </div>
        ))}

      </div>

      <div className="gantt-milestone-header">
        Milestone
      </div>

    </div>


    {/* BROWSER FEASIBILITY */}

    <div className="gantt-row">

      <div className="gantt-task">

        <strong>Browser Feasibility</strong>

        <span>
          Browser execution and baseline measurements
        </span>

      </div>

      <div className="gantt-weeks">

        {Array.from({ length: 17 }, (_, i) => (
          <div
            key={i}
            className={`gantt-cell ${
              i >= 0 && i <= 1 ? "gantt-active" : ""
            }`}
          ></div>
        ))}

      </div>

      <div className="gantt-milestone">
        Feasibility baseline
      </div>

    </div>


    {/* DATASET */}

    <div className="gantt-row">

      <div className="gantt-task">

        <strong>Dataset Preparation</strong>

        <span>
          Dataset collection, cleaning and preprocessing
        </span>

      </div>

      <div className="gantt-weeks">

        {Array.from({ length: 17 }, (_, i) => (
          <div
            key={i}
            className={`gantt-cell ${
              i >= 2 && i <= 4 ? "gantt-active" : ""
            }`}
          ></div>
        ))}

      </div>

      <div className="gantt-milestone">
        Prepared dataset
      </div>

    </div>


    {/* MODEL DEVELOPMENT */}

    <div className="gantt-row">

      <div className="gantt-task">

        <strong>Model Development</strong>

        <span>
          No-reference model development and evaluation
        </span>

      </div>

      <div className="gantt-weeks">

        {Array.from({ length: 17 }, (_, i) => (
          <div
            key={i}
            className={`gantt-cell ${
              i >= 5 && i <= 7 ? "gantt-active" : ""
            }`}
          ></div>
        ))}

      </div>

      <div className="gantt-milestone">
        Baseline model
      </div>

    </div>


    {/* MODEL OPTIMIZATION */}

    <div className="gantt-row">

      <div className="gantt-task">

        <strong>Model Optimization</strong>

        <span>
          Model compression and browser optimization
        </span>

      </div>

      <div className="gantt-weeks">

        {Array.from({ length: 17 }, (_, i) => (
          <div
            key={i}
            className={`gantt-cell ${
              i >= 8 && i <= 10 ? "gantt-active" : ""
            }`}
          ></div>
        ))}

      </div>

      <div className="gantt-milestone">
        Optimized model
      </div>

    </div>


    {/* WEBRTC */}

    <div className="gantt-row">

      <div className="gantt-task">

        <strong>WebRTC &amp; Browser Integration</strong>

        <span>
          JavaScript/WASM SDK and WebRTC integration
        </span>

      </div>

      <div className="gantt-weeks">

        {Array.from({ length: 17 }, (_, i) => (
          <div
            key={i}
            className={`gantt-cell ${
              i >= 11 && i <= 13 ? "gantt-active" : ""
            }`}
          ></div>
        ))}

      </div>

      <div className="gantt-milestone">
        Integrated system
      </div>

    </div>


    {/* EVALUATION */}

    <div className="gantt-row">

      <div className="gantt-task">

        <strong>Evaluation &amp; Comparison</strong>

        <span>
          Full evaluation, testing and comparison
        </span>

      </div>

      <div className="gantt-weeks">

        {Array.from({ length: 17 }, (_, i) => (
          <div
            key={i}
            className={`gantt-cell ${
              i >= 14 && i <= 15 ? "gantt-active" : ""
            }`}
          ></div>
        ))}

      </div>

      <div className="gantt-milestone">
        Final evaluation
      </div>

    </div>


    {/* FINAL DEMO */}

    <div className="gantt-row">

      <div className="gantt-task">

        <strong>Final Integration &amp; Demo</strong>

        <span>
          Final integration, deployment and demonstration
        </span>

      </div>

      <div className="gantt-weeks">

        {Array.from({ length: 17 }, (_, i) => (
          <div
            key={i}
            className={`gantt-cell ${
              i === 16 ? "gantt-active" : ""
            }`}
          ></div>
        ))}

      </div>

      <div className="gantt-milestone">
        Final demo
      </div>

    </div>

  </div>


  {/* DEPENDENCIES */}

  <div className="gantt-dependencies">

    <strong>Dependencies</strong>

    <span>
      Feasibility
    </span>

    <b>→</b>

    <span>
      Dataset / Model
    </span>

    <b>→</b>

    <span>
      Optimization
    </span>

    <b>→</b>

    <span>
      Browser Inference
    </span>

    <b>→</b>

    <span>
      SDK / WebRTC
    </span>

    <b>→</b>

    <span>
      Evaluation
    </span>

    <b>→</b>

    <span>
      Final Integration
    </span>

  </div>

</div>

        </section>

      </main>
    </div>
  );
}

export default Planning;