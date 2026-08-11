// function LiveTest() {
//   return (
//     <div className="live-test-page">

//       <header className="live-test-header">
//         <p>EDGEAUDIO-QC</p>

//         <h1>Live Speech Quality Test</h1>

//         <span>
//           Privacy-Preserving Browser Analysis
//         </span>
//       </header>


//       <main className="live-test-content">

//         {/* TEST CONTROL */}

//         <section className="test-control">

//           <p className="section-label">
//             LIVE ANALYSIS
//           </p>

//           <h2>
//             Test Your Speech Quality
//           </h2>

//           <p className="test-description">
//             Start the test to capture speech and analyse
//             audio locally in your browser.
//           </p>

//           <button className="start-test-button">
//             🎙 Start Test
//           </button>

//         </section>


//         {/* STATUS */}

//         <section className="status-card">

//           <div className="status-header">

//             <h3>
//               Test Status
//             </h3>

//             <span className="status-badge">
//               Waiting
//             </span>

//           </div>


//           <div className="status-row">
//             <span>Microphone</span>
//             <strong>Not started</strong>
//           </div>


//           <div className="status-row">
//             <span>Audio Processing</span>
//             <strong>Local browser</strong>
//           </div>


//           <div className="status-row">
//             <span>Quality Estimate</span>
//             <strong>--</strong>
//           </div>

//         </section>


//         {/* QUALITY SCORE */}

//         <section className="quality-card">

//           <p className="section-label">
//             CURRENT ESTIMATE
//           </p>

//           <div className="quality-score">
//             --
//           </div>

//           <h3>
//             Perceived Speech Quality
//           </h3>

//           <p>
//             The quality estimate will appear here when
//             the live analysis is running.
//           </p>

//         </section>


//         {/* PRIVACY */}

//         <section className="privacy-card">

//           <div className="privacy-icon">
//             🔒
//           </div>

//           <div>

//             <h3>
//               Your Audio Stays on Your Device
//             </h3>

//             <p>
//               EdgeAudio-QC is designed to process raw
//               audio locally inside the browser. Raw audio
//               is not sent to a remote server for quality
//               analysis.
//             </p>

//           </div>

//         </section>

//       </main>

//     </div>
//   );
// }

// export default LiveTest;
function LiveTest() {
  return (
    <div>
      <h1>LIVE TEST PAGE</h1>
      <p>EdgeAudio-QC is working.</p>
    </div>
  );
}

export default LiveTest;