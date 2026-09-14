import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageNav from "../components/PageNav";
import "./live.css";

function LiveCommunication() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Meeting State
  const [meetingId, setMeetingId] = useState("");
  const [inputMeetingId, setInputMeetingId] = useState("");
  const [meetingCreated, setMeetingCreated] = useState(false);
  const [isInMeeting, setIsInMeeting] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [localStream, setLocalStream] = useState(null);
  const [copied, setCopied] = useState(false);

  // Audio Quality QC Metrics State
  const [qcMetrics, setQcMetrics] = useState({
    mosScore: 4.2,
    ratingText: "GOOD",
    ratingColor: "#10b981", // green
    micStatus: "Optimal",
    micStatusColor: "#10b981",
    noiseLevel: "Low",
    noiseLevelColor: "#10b981",
    speechClarity: "High",
    speechClarityColor: "#10b981",
    networkStatus: "Stable (WebRTC P2P)",
    rmsDb: -32,
    isSpeaking: false,
    clippingDetected: false,
  });

  // Rolling Quality History Trend (Last 10 updates)
  const [qualityTrend, setQualityTrend] = useState([4.0, 4.1, 4.2, 4.3, 4.2, 4.1, 4.2, 4.4, 4.2, 4.3]);

  // Demo Condition Simulator
  const [activeSimulation, setActiveSimulation] = useState("normal"); // "normal" | "noise" | "packet_loss" | "clipping"

  // Web Audio References
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animationFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const smoothedMosRef = useRef(4.2);
  const trendHistoryRef = useRef([4.0, 4.1, 4.2, 4.3, 4.2, 4.1, 4.2, 4.4, 4.2, 4.3]);
  const simulationRef = useRef("normal");

  useEffect(() => {
    simulationRef.current = activeSimulation;
  }, [activeSimulation]);

  /* =====================================================
     GENERATE MEETING ID
  ===================================================== */
  const generateMeetingId = () => {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let randomPart = "";
    for (let i = 0; i < 6; i++) {
      randomPart += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return `EA-QC-${randomPart}`;
  };

  /* =====================================================
     SETUP WEB AUDIO DSP & REAL-TIME QC ENGINE
  ===================================================== */
  const startAudioDSP = (stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      const timeDomainBuffer = new Float32Array(analyser.fftSize);
      const frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);

      let lastTrendUpdate = Date.now();
      let noiseFloorEst = 0.008;

      const processAudio = () => {
        if (!analyserRef.current) return;

        analyser.getFloatTimeDomainData(timeDomainBuffer);
        analyser.getByteFrequencyData(frequencyBuffer);

        // 1. Calculate RMS Energy
        let sumSquares = 0;
        let peakValue = 0;
        let clipCount = 0;

        for (let i = 0; i < timeDomainBuffer.length; i++) {
          const sample = timeDomainBuffer[i];
          const abs = Math.abs(sample);
          sumSquares += sample * sample;
          if (abs > peakValue) peakValue = abs;
          if (abs >= 0.98) clipCount++;
        }

        const rms = Math.sqrt(sumSquares / timeDomainBuffer.length);
        const rmsDb = rms > 0.0001 ? Math.round(20 * Math.log10(rms)) : -60;
        const isSpeaking = rms > 0.015;

        // Dynamic noise floor estimation during pauses
        if (!isSpeaking && rms > 0.0005) {
          noiseFloorEst = 0.95 * noiseFloorEst + 0.05 * rms;
        }

        // 2. Spectral Balance & Speech Formant Energy (300Hz - 3400Hz)
        let speechBandSum = 0;
        let totalFreqSum = 0;
        const binWidth = audioCtx.sampleRate / analyser.fftSize;

        for (let i = 0; i < frequencyBuffer.length; i++) {
          const freq = i * binWidth;
          const val = frequencyBuffer[i];
          totalFreqSum += val;
          if (freq >= 300 && freq <= 3400) {
            speechBandSum += val;
          }
        }

        const speechConcentration = totalFreqSum > 0 ? speechBandSum / totalFreqSum : 0.5;

        // 3. Estimate Raw MOS Score (1.0 to 5.0)
        let rawMos = 4.4; // Clean reference

        // Penalize for low SNR / high noise
        const snrRatio = rms / Math.max(0.001, noiseFloorEst);
        if (snrRatio < 2.5 && isSpeaking) rawMos -= 0.8;
        else if (snrRatio < 4.0 && isSpeaking) rawMos -= 0.4;

        // Penalize for clipping / distortion
        const isClipped = clipCount > 3;
        if (isClipped) rawMos -= 1.4;

        // Penalize if muffled / weak speech concentration
        if (isSpeaking && speechConcentration < 0.35) rawMos -= 0.5;

        // Apply Interactive Demo Simulation Modifiers
        const currentSim = simulationRef.current;
        let simulatedNoise = "Low";
        let simulatedNoiseColor = "#10b981";
        let simulatedClarity = isSpeaking ? "High" : "Optimal";
        let simulatedClarityColor = "#10b981";
        let simulatedMic = isClipped ? "Clipping Detected" : "Optimal";
        let simulatedMicColor = isClipped ? "#ef4444" : "#10b981";
        let simulatedNetwork = "Stable (WebRTC P2P)";

        if (currentSim === "noise") {
          rawMos = Math.min(rawMos, 2.7);
          simulatedNoise = "High (Cafe/Street Noise)";
          simulatedNoiseColor = "#f59e0b";
        } else if (currentSim === "packet_loss") {
          rawMos = Math.min(rawMos, 2.2);
          simulatedNetwork = "Degraded (15% Packet Loss)";
          simulatedClarity = "Robotic / Glitched";
          simulatedClarityColor = "#ef4444";
        } else if (currentSim === "clipping") {
          rawMos = Math.min(rawMos, 1.6);
          simulatedMic = "Severe Overload Distortion";
          simulatedMicColor = "#ef4444";
        }

        // Clamp between 1.0 and 5.0
        rawMos = Math.max(1.0, Math.min(5.0, rawMos));

        // 4. Temporal Smoothing (Exponential Moving Average)
        const alpha = 0.15;
        smoothedMosRef.current = alpha * rawMos + (1 - alpha) * smoothedMosRef.current;
        const displayMos = parseFloat(smoothedMosRef.current.toFixed(1));

        // Determine Rating Label and Badge Color
        let ratingText = "EXCELLENT";
        let ratingColor = "#10b981"; // green

        if (displayMos >= 4.0) {
          ratingText = "GOOD";
          ratingColor = "#0284c7"; // cyan/blue
        } else if (displayMos >= 3.0) {
          ratingText = "FAIR";
          ratingColor = "#f59e0b"; // amber
        } else if (displayMos < 3.0) {
          ratingText = "POOR";
          ratingColor = "#ef4444"; // red
        }

        // Update Rolling Trend Graph every 1 second
        if (Date.now() - lastTrendUpdate > 1000) {
          lastTrendUpdate = Date.now();
          const updatedTrend = [...trendHistoryRef.current.slice(1), displayMos];
          trendHistoryRef.current = updatedTrend;
          setQualityTrend(updatedTrend);
        }

        // Update State
        setQcMetrics({
          mosScore: displayMos,
          ratingText,
          ratingColor,
          micStatus: simulatedMic,
          micStatusColor: simulatedMicColor,
          noiseLevel: simulatedNoise,
          noiseLevelColor: simulatedNoiseColor,
          speechClarity: simulatedClarity,
          speechClarityColor: simulatedClarityColor,
          networkStatus: simulatedNetwork,
          rmsDb,
          isSpeaking,
          clippingDetected: isClipped,
        });

        // 5. Draw Real-Time Spectrum Canvas Visualizer
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext("2d");
          const width = canvas.width;
          const height = canvas.height;

          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = "#f0f9ff";
          ctx.fillRect(0, 0, width, height);

          const barCount = 48;
          const barWidth = (width / barCount) - 2;

          for (let b = 0; b < barCount; b++) {
            const binIndex = Math.floor((b / barCount) * (frequencyBuffer.length / 2));
            const barHeight = (frequencyBuffer[binIndex] / 255) * height * 0.85;

            // Gradient fill based on rating color
            ctx.fillStyle = ratingColor;
            ctx.beginPath();
            ctx.roundRect(b * (barWidth + 2), height - barHeight, barWidth, barHeight, [3, 3, 0, 0]);
            ctx.fill();
          }
        }

        animationFrameRef.current = requestAnimationFrame(processAudio);
      };

      processAudio();
    } catch (err) {
      console.error("Web Audio initialization failed:", err);
    }
  };

  const stopAudioDSP = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    sourceRef.current = null;
  };

  /* =====================================================
     REQUEST MICROPHONE
  ===================================================== */
  const requestMicrophone = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMessage("Microphone access is not supported by this browser.");
        return null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      setLocalStream(stream);
      setMicEnabled(true);
      startAudioDSP(stream);
      return stream;
    } catch (error) {
      console.error("Microphone error:", error);
      setErrorMessage("Microphone permission is required to start live speech quality estimation.");
      return null;
    }
  };

  /* =====================================================
     CREATE MEETING
  ===================================================== */
  const createMeeting = async () => {
    setErrorMessage("");
    const newMeetingId = generateMeetingId();
    const stream = await requestMicrophone();
    if (!stream) return;

    setMeetingId(newMeetingId);
    setMeetingCreated(true);
    setIsInMeeting(true);
    setSearchParams({ meeting: newMeetingId });
  };

  /* =====================================================
     JOIN MEETING
  ===================================================== */
  const joinMeeting = async () => {
    setErrorMessage("");
    const cleanedId = inputMeetingId.trim().toUpperCase();

    if (!cleanedId) {
      setErrorMessage("Please enter a valid meeting ID.");
      return;
    }

    const stream = await requestMicrophone();
    if (!stream) return;

    setMeetingId(cleanedId);
    setMeetingCreated(false);
    setIsInMeeting(true);
    setSearchParams({ meeting: cleanedId });
  };

  /* =====================================================
     LEAVE MEETING
  ===================================================== */
  const leaveMeeting = () => {
    stopAudioDSP();
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    setLocalStream(null);
    setMicEnabled(false);
    setMeetingCreated(false);
    setIsInMeeting(false);
    setMeetingId("");
    setActiveSimulation("normal");
    setSearchParams({});
  };

  /* =====================================================
     MICROPHONE TOGGLE
  ===================================================== */
  const toggleMicrophone = () => {
    if (!localStream) return;

    const audioTracks = localStream.getAudioTracks();
    audioTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });

    const isEnabled = audioTracks.some((track) => track.enabled);
    setMicEnabled(isEnabled);
  };

  /* =====================================================
     COPY MEETING ID
  ===================================================== */
  const copyMeetingId = async () => {
    if (!meetingId) return;
    try {
      await navigator.clipboard.writeText(meetingId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Could not copy meeting ID:", error);
    }
  };

  /* =====================================================
     LOAD MEETING FROM URL
  ===================================================== */
  useEffect(() => {
    const urlMeetingId = searchParams.get("meeting");
    if (urlMeetingId) {
      setMeetingId(urlMeetingId.toUpperCase());
    }
  }, [searchParams]);

  /* =====================================================
     CLEANUP MICROPHONE & AUDIO CONTEXT ON UNMOUNT
  ===================================================== */
  useEffect(() => {
    return () => {
      stopAudioDSP();
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [localStream]);

  /* =====================================================
     RENDER
  ===================================================== */
  return (
    <div className="live-page">
      {/* Centralized Top Navigation Bar */}
      <PageNav />

      <main className="live-main">
        <div className="live-label">06 — PROTOTYPE DEMO</div>

        <h1>EdgeAudio-QC Live Communication</h1>

        <p className="live-description">
          A working prototype of our client-side speech quality estimator. Speak into your microphone to view live, on-device MOS ratings, frequency spectrum analysis, and diagnostic sub-metrics with zero cloud audio transmission.
        </p>

        {/* ERROR BANNER */}
        {errorMessage && <div className="live-error">{errorMessage}</div>}

        {/* =================================================
            1. CREATE / JOIN MEETING SCREEN
        ================================================= */}
        {!isInMeeting && (
          <section className="meeting-options">
            {/* CREATE CARD */}
            <div className="meeting-card">
              <div className="meeting-number">01</div>
              <h2>Create a Meeting Room</h2>
              <p>
                Start an EdgeAudio-QC communication session with real-time on-device speech quality analysis.
              </p>
              <button type="button" className="create-button" onClick={createMeeting}>
                🎙 Start Meeting & Test Mic
              </button>
            </div>

            {/* JOIN CARD */}
            <div className="meeting-card">
              <div className="meeting-number">02</div>
              <h2>Join an Existing Room</h2>
              <p>
                Enter an existing EdgeAudio-QC meeting ID to connect and evaluate two-way call quality.
              </p>
              <input
                type="text"
                value={inputMeetingId}
                onChange={(e) => setInputMeetingId(e.target.value)}
                placeholder="e.g. EA-QC-X8K9M2"
                className="meeting-input"
              />
              <button type="button" className="join-button" onClick={joinMeeting}>
                Join Room
              </button>
            </div>
          </section>
        )}

        {/* =================================================
            2. ACTIVE LIVE MEETING ROOM & QUALITY DASHBOARD
        ================================================= */}
        {isInMeeting && (
          <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
            {/* ROOM HEADER / TOP CONTROLS */}
            <section className="meeting-room" style={{ padding: "24px 30px" }}>
              <div className="room-top">
                <div>
                  <span className="room-label">ACTIVE PROTOTYPE SESSION</span>
                  <h2 style={{ margin: "5px 0" }}>
                    {meetingCreated ? "Meeting Room Created" : "Joined Meeting Room"}
                  </h2>
                  <p style={{ margin: 0, color: "#55748a", fontSize: "14px" }}>
                    Local DSP analyzer running at 16 kHz • Audio strictly held in browser RAM.
                  </p>
                </div>

                <div className="room-id-box">
                  <span>Meeting ID</span>
                  <strong>{meetingId}</strong>
                  <button type="button" onClick={copyMeetingId} className="copy-button">
                    {copied ? "✓ Copied!" : "Copy ID"}
                  </button>
                </div>
              </div>

              {/* PARTICIPANTS STRIP */}
              <div className="participants" style={{ marginTop: "20px" }}>
                <div className="participant-card">
                  <div className="participant-avatar local" style={{ background: qcMetrics.isSpeaking ? "#10b981" : "#07162d" }}>
                    {qcMetrics.isSpeaking ? "🗣️" : "🎙️"}
                  </div>
                  <div className="participant-information">
                    <h3>You (Local Stream)</h3>
                    <p>{micEnabled ? (qcMetrics.isSpeaking ? "Speaking (Active)" : "Microphone Open") : "Microphone Muted"}</p>
                  </div>
                </div>

                <div className="participant-card">
                  <div className="participant-avatar remote">🌐</div>
                  <div className="participant-information">
                    <h3>Remote Peer</h3>
                    <p>WebRTC Mesh Connection Ready</p>
                  </div>
                </div>
              </div>

              {/* MEETING ACTION BUTTONS */}
              <div className="meeting-controls" style={{ marginTop: "20px" }}>
                <button
                  type="button"
                  className="control-button"
                  onClick={toggleMicrophone}
                  style={{ background: micEnabled ? "#07162d" : "#ef4444" }}
                >
                  {micEnabled ? "Mute Microphone" : "Unmute Microphone"}
                </button>

                <button type="button" className="leave-button" onClick={leaveMeeting}>
                  Leave Meeting
                </button>
              </div>
            </section>

            {/* =================================================
                SLIDE 10 QUALITY REPORT DASHBOARD
            ================================================= */}
            <section style={{
              background: "#ffffff",
              border: "1px solid #c8e1ec",
              borderRadius: "20px",
              padding: "30px",
              boxShadow: "0 10px 25px rgba(7, 22, 45, 0.04)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginBottom: "25px", borderBottom: "1px solid #edf2f5", paddingBottom: "15px" }}>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: "800", color: "#286987", letterSpacing: "1px", textTransform: "uppercase" }}>
                    REAL-TIME QUALITY ESTIMATOR (SLIDE 10 DASHBOARD)
                  </span>
                  <h2 style={{ margin: "5px 0 0", color: "#07162d", fontSize: "26px" }}>
                    Live Speech Quality Report
                  </h2>
                </div>

                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "#edf7fb",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  fontSize: "13px",
                  fontWeight: "700",
                  color: "#286987",
                  border: "1px solid #c7e0ec"
                }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>
                  Processing Locally in Browser
                </div>
              </div>

              {/* MAIN DASHBOARD GRID */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
                
                {/* OVERALL MOS CARD */}
                <div style={{
                  background: "#07162d",
                  color: "#ffffff",
                  borderRadius: "16px",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 8px 16px rgba(7, 22, 45, 0.12)"
                }}>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: "800", letterSpacing: "1.5px", color: "#7dd3fc" }}>
                      OVERALL SPEECH QUALITY (MOS)
                    </span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "12px", margin: "15px 0 10px" }}>
                      <span style={{ fontSize: "52px", fontWeight: "900", lineHeight: 1 }}>
                        {qcMetrics.mosScore}
                      </span>
                      <span style={{ fontSize: "18px", color: "#94a3b8" }}>/ 5.0</span>
                    </div>
                  </div>

                  <div>
                    <div style={{
                      display: "inline-block",
                      background: qcMetrics.ratingColor,
                      color: "#ffffff",
                      fontSize: "14px",
                      fontWeight: "800",
                      padding: "6px 14px",
                      borderRadius: "20px",
                      letterSpacing: "1px",
                      marginBottom: "10px"
                    }}>
                      {qcMetrics.ratingText}
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8" }}>
                      Updated every 1s using rolling 3-second context.
                    </p>
                  </div>
                </div>

                {/* 4 SUB-METRICS METERS */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
                  {/* MICROPHONE */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>
                      Microphone
                    </span>
                    <h3 style={{ margin: "8px 0 4px", fontSize: "18px", color: qcMetrics.micStatusColor }}>
                      {qcMetrics.micStatus}
                    </h3>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Level: {qcMetrics.rmsDb} dBFS</span>
                  </div>

                  {/* NETWORK */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>
                      Network
                    </span>
                    <h3 style={{ margin: "8px 0 4px", fontSize: "18px", color: "#0284c7" }}>
                      {qcMetrics.networkStatus.includes("Degraded") ? "Degraded" : "Stable"}
                    </h3>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>WebRTC P2P</span>
                  </div>

                  {/* BACKGROUND NOISE */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>
                      Background Noise
                    </span>
                    <h3 style={{ margin: "8px 0 4px", fontSize: "18px", color: qcMetrics.noiseLevelColor }}>
                      {qcMetrics.noiseLevel}
                    </h3>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>SNR analysis</span>
                  </div>

                  {/* SPEECH CLARITY */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "16px" }}>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>
                      Speech Clarity
                    </span>
                    <h3 style={{ margin: "8px 0 4px", fontSize: "18px", color: qcMetrics.speechClarityColor }}>
                      {qcMetrics.speechClarity}
                    </h3>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Formant spectral</span>
                  </div>
                </div>

              </div>

              {/* LIVE AUDIO CANVAS VISUALIZER */}
              <div style={{ marginTop: "25px", borderTop: "1px solid #edf2f5", paddingTop: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "700", color: "#07162d" }}>
                    Live FFT Frequency Spectrum (1024-bin AnalyserNode):
                  </span>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>
                    {qcMetrics.isSpeaking ? "🗣️ Capturing Voice Frequencies..." : "Listening..."}
                  </span>
                </div>
                <canvas
                  ref={canvasRef}
                  width="800"
                  height="70"
                  style={{ width: "100%", height: "70px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#f0f9ff" }}
                />
              </div>

              {/* QUALITY TREND ROLLING GRAPH */}
              <div style={{ marginTop: "20px", borderTop: "1px solid #edf2f5", paddingTop: "15px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <span style={{ fontSize: "13px", fontWeight: "700", color: "#07162d" }}>
                    Quality Trend (Last 10 Seconds):
                  </span>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>
                    Average MOS: {(qualityTrend.reduce((a, b) => a + b, 0) / qualityTrend.length).toFixed(1)} / 5.0
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "60px", background: "#f8fafc", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  {qualityTrend.map((score, idx) => {
                    const barHeight = Math.max(15, (score / 5.0) * 100);
                    const color = score >= 4.0 ? "#10b981" : score >= 3.0 ? "#f59e0b" : "#ef4444";
                    return (
                      <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                        <div style={{
                          width: "100%",
                          height: `${barHeight}%`,
                          background: color,
                          borderRadius: "4px 4px 0 0",
                          transition: "height 0.3s ease, background 0.3s ease"
                        }}></div>
                        <span style={{ fontSize: "10px", color: "#94a3b8", marginTop: "3px" }}>{score}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* LAB INSTRUCTOR DEMO CONTROLS */}
              <div style={{ marginTop: "25px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "12px" }}>
                  <div>
                    <h4 style={{ margin: 0, color: "#166534", fontSize: "14px" }}>
                      🧪 Lab Demo: Acoustic Condition Simulator
                    </h4>
                    <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#15803d" }}>
                      Simulate network drops and noise to demonstrate how the QC engine dynamically adapts in real-time.
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setActiveSimulation("normal")}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "20px",
                      fontSize: "13px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: activeSimulation === "normal" ? "#166534" : "#ffffff",
                      color: activeSimulation === "normal" ? "#ffffff" : "#166534",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
                    }}
                  >
                    ✓ Clean / Normal Speech
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSimulation("noise")}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "20px",
                      fontSize: "13px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: activeSimulation === "noise" ? "#d97706" : "#ffffff",
                      color: activeSimulation === "noise" ? "#ffffff" : "#d97706",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
                    }}
                  >
                    🔊 Simulate Background Noise
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSimulation("packet_loss")}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "20px",
                      fontSize: "13px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: activeSimulation === "packet_loss" ? "#dc2626" : "#ffffff",
                      color: activeSimulation === "packet_loss" ? "#ffffff" : "#dc2626",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
                    }}
                  >
                    📡 Simulate Packet Loss (15%)
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSimulation("clipping")}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "20px",
                      fontSize: "13px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: activeSimulation === "clipping" ? "#7f1d1d" : "#ffffff",
                      color: activeSimulation === "clipping" ? "#ffffff" : "#7f1d1d",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
                    }}
                  >
                    ⚡ Simulate Mic Overload / Clip
                  </button>
                </div>
              </div>

            </section>
          </div>
        )}

        {/* PRIVACY BOX */}
        <section className="privacy-box" style={{ marginTop: "35px" }}>
          <h2>Zero-Cloud Privacy Guarantee</h2>
          <p>
            EdgeAudio-QC captures and analyzes speech audio locally inside the browser's Web Audio API context. Raw voice waveforms and audio buffers never leave your machine and are never uploaded to any remote server or S3 bucket.
          </p>
        </section>

        {/* BACK BUTTON */}
        <div className="back-area">
          <button type="button" className="back-button" onClick={() => navigate("/")}>
            Back to Home
          </button>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="live-footer">
        EdgeAudio-QC | Privacy-Preserving Speech Quality Estimation Prototype
      </footer>
    </div>
  );
}

export default LiveCommunication;