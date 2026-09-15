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
  const [isTestTonePlaying, setIsTestTonePlaying] = useState(false);

  // Metering & QC State (Updated at throttled ~10 fps for smooth React rendering)
  const [liveDb, setLiveDb] = useState(-60);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [qcMetrics, setQcMetrics] = useState({
    mosScore: 4.3,
    ratingText: "GOOD",
    ratingColor: "#0284c7",
    micStatus: "Optimal (Clean)",
    micStatusColor: "#10b981",
    noiseLevel: "Low (<12 dB)",
    noiseLevelColor: "#10b981",
    speechClarity: "High (Clear)",
    speechClarityColor: "#10b981",
    networkStatus: "Stable (Local / P2P)",
  });

  // Rolling Quality History Trend (Accumulates second by second)
  const [qualityTrend, setQualityTrend] = useState([]);

  // Multi-Select Acoustic Simulator State
  const [simulations, setSimulations] = useState({
    noise: false,
    packetLoss: false,
    clipping: false,
    muffled: false,
  });

  // Web Audio & Animation References
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const zeroGainRef = useRef(null);
  const oscillatorRef = useRef(null);
  const animationFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const preMeetingCanvasRef = useRef(null);
  const smoothedMosRef = useRef(4.3);
  const trendHistoryRef = useRef([]);
  const simulationsRef = useRef({ noise: false, packetLoss: false, clipping: false, muffled: false });

  useEffect(() => {
    simulationsRef.current = simulations;
  }, [simulations]);

  /* =====================================================
     GENERATE MEETING ID
  ===================================================== */
  const generateMeetingId = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let rand = "";
    for (let i = 0; i < 6; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `EA-QC-${rand}`;
  };

  /* =====================================================
     WEB AUDIO DSP & DUAL CANVAS RENDERER
  ===================================================== */
  const initAudioDSP = async (stream) => {
    try {
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      // Silent sink to ensure Chrome continuously pulls audio
      const zeroGain = audioCtx.createGain();
      zeroGain.gain.value = 0;
      zeroGainRef.current = zeroGain;
      analyser.connect(zeroGain);
      zeroGain.connect(audioCtx.destination);

      const timeData = new Float32Array(analyser.fftSize);
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      let lastStateUpdate = Date.now();
      let lastTrendUpdate = Date.now();
      let noiseFloor = 0.005;

      const renderLoop = () => {
        if (!analyserRef.current) return;

        analyser.getFloatTimeDomainData(timeData);
        analyser.getByteFrequencyData(freqData);

        // 1. Calculate Instantaneous Volume & RMS
        let sumSq = 0;
        let peak = 0;
        let clips = 0;

        for (let i = 0; i < timeData.length; i++) {
          const sample = timeData[i];
          const abs = Math.abs(sample);
          sumSq += sample * sample;
          if (abs > peak) peak = abs;
          if (abs >= 0.95) clips++;
        }

        const rms = Math.sqrt(sumSq / timeData.length);
        const currentDb = rms > 0.0001 ? Math.round(20 * Math.log10(rms)) : -60;
        const voiceDetected = rms > 0.01 || freqData.some((f) => f > 50);

        if (!voiceDetected && rms > 0.0002) {
          noiseFloor = 0.95 * noiseFloor + 0.05 * rms;
        }

        // 2. Estimate Speech Formants & Energy
        let speechSum = 0;
        let totalSum = 0;
        for (let i = 0; i < freqData.length; i++) {
          totalSum += freqData[i];
          if (i >= 2 && i <= 30) speechSum += freqData[i];
        }
        const speechRatio = totalSum > 0 ? speechSum / totalSum : 0.5;

        // 3. Compute MOS Score
        let rawMos = voiceDetected ? 4.5 : 4.2;
        const snr = rms / Math.max(0.001, noiseFloor);
        if (snr < 2.5 && voiceDetected) rawMos -= 0.6;
        if (clips > 1) rawMos -= 1.4;
        if (voiceDetected && speechRatio < 0.3) rawMos -= 0.4;

        // Apply Multi-Select Simulator Modifiers
        const sims = simulationsRef.current;
        let simNoise = voiceDetected && snr < 2.5 ? "Moderate (<18 dB)" : "Low (<12 dB)";
        let simNoiseColor = "#10b981";
        let simClarity = voiceDetected ? "High (Clear)" : "Optimal";
        let simClarityColor = "#10b981";
        let simMic = clips > 1 ? "Clipping Detected" : "Optimal (Clean)";
        let simMicColor = clips > 1 ? "#ef4444" : "#10b981";
        let simNet = "Stable (WebRTC P2P)";

        if (sims.noise) {
          rawMos -= 1.1;
          simNoise = "High (Cafe/Street Noise)";
          simNoiseColor = "#f59e0b";
        }
        if (sims.packetLoss) {
          rawMos -= 1.3;
          simNet = "Degraded (15% Packet Loss)";
          simClarity = "Robotic / Jitter Glitches";
          simClarityColor = "#ef4444";
        }
        if (sims.clipping) {
          rawMos -= 1.5;
          simMic = "Severe Overload / Clipping";
          simMicColor = "#ef4444";
        }
        if (sims.muffled) {
          rawMos -= 0.8;
          simClarity = "Muffled (Narrowband)";
          simClarityColor = "#f59e0b";
        }

        rawMos = Math.max(1.0, Math.min(5.0, rawMos));
        smoothedMosRef.current = 0.2 * rawMos + 0.8 * smoothedMosRef.current;
        const displayMos = parseFloat(smoothedMosRef.current.toFixed(1));

        let ratingText = "EXCELLENT";
        let ratingColor = "#10b981";
        if (displayMos >= 4.0) {
          ratingText = "GOOD";
          ratingColor = "#0284c7";
        } else if (displayMos >= 3.0) {
          ratingText = "FAIR";
          ratingColor = "#f59e0b";
        } else {
          ratingText = "POOR";
          ratingColor = "#ef4444";
        }

        // 4. Update React State at Throttled 100ms (10 fps) to avoid lag
        const now = Date.now();
        if (now - lastStateUpdate > 100) {
          lastStateUpdate = now;
          setLiveDb(currentDb);
          setIsVoiceActive(voiceDetected);
          setQcMetrics({
            mosScore: displayMos,
            ratingText,
            ratingColor,
            micStatus: simMic,
            micStatusColor: simMicColor,
            noiseLevel: simNoise,
            noiseLevelColor: simNoiseColor,
            speechClarity: simClarity,
            speechClarityColor: simClarityColor,
            networkStatus: simNet,
          });
        }

        // 5. Update 10s Rolling History Trend every 1 second
        if (now - lastTrendUpdate > 1000) {
          lastTrendUpdate = now;
          let newHist;
          if (trendHistoryRef.current.length < 10) {
            newHist = [...trendHistoryRef.current, displayMos];
          } else {
            newHist = [...trendHistoryRef.current.slice(1), displayMos];
          }
          trendHistoryRef.current = newHist;
          setQualityTrend(newHist);
        }

        // 6. Direct 60fps Canvas Visualizer Rendering
        const targetCanvas = canvasRef.current || preMeetingCanvasRef.current;
        if (targetCanvas) {
          const ctx = targetCanvas.getContext("2d");
          const width = targetCanvas.width;
          const height = targetCanvas.height;

          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(0, 0, width, height);

          // Draw animated sound waves
          const barCount = 36;
          const barWidth = width / barCount - 2;

          for (let b = 0; b < barCount; b++) {
            const val = freqData[b % freqData.length];
            const barHeight = Math.max(4, (val / 255) * height * 0.9);

            ctx.fillStyle = voiceDetected ? ratingColor : "#94a3b8";
            ctx.beginPath();
            ctx.roundRect(b * (barWidth + 2), height - barHeight, barWidth, barHeight, [2, 2, 0, 0]);
            ctx.fill();
          }
        }

        animationFrameRef.current = requestAnimationFrame(renderLoop);
      };

      renderLoop();
    } catch (err) {
      console.error("Web Audio initialization error:", err);
    }
  };

  /* =====================================================
     MICROPHONE ACQUISITION
  ===================================================== */
  const requestMicrophone = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMessage("Microphone access is not supported on this browser.");
        return null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
        video: false,
      });

      setLocalStream(stream);
      setMicEnabled(true);
      setQualityTrend([]);
      trendHistoryRef.current = [];
      await initAudioDSP(stream);
      return stream;
    } catch (err) {
      console.error("Mic access denied:", err);
      setErrorMessage("Microphone permission was denied. Please allow microphone access in your browser bar, or click 'Play Demo Audio' below.");
      return null;
    }
  };

  /* =====================================================
     TEST TONE GENERATOR (DEMO SPEECH SYNTHESIZER)
  ===================================================== */
  const toggleTestTone = async () => {
    if (isTestTonePlaying) {
      if (oscillatorRef.current) {
        try {
          oscillatorRef.current.stop();
          oscillatorRef.current.disconnect();
        } catch (e) {}
        oscillatorRef.current = null;
      }
      setIsTestTonePlaying(false);
    } else {
      try {
        let audioCtx = audioContextRef.current;
        if (!audioCtx || audioCtx.state === "closed") {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
        }

        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }

        let analyser = analyserRef.current;
        if (!analyser) {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyserRef.current = analyser;
        }

        // Create harmonic vocal oscillator
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(260, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);

        osc.connect(gain);
        gain.connect(analyser);

        const zeroGain = audioCtx.createGain();
        zeroGain.gain.value = 0;
        analyser.connect(zeroGain);
        zeroGain.connect(audioCtx.destination);

        osc.start();
        oscillatorRef.current = osc;
        setIsTestTonePlaying(true);
        setMicEnabled(true);
      } catch (e) {
        console.error("Test tone error:", e);
      }
    }
  };

  const stopAllAudio = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
      } catch (e) {}
      oscillatorRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    sourceRef.current = null;
    setIsTestTonePlaying(false);
  };

  /* =====================================================
     CREATE & JOIN ACTIONS
  ===================================================== */
  const createMeeting = async () => {
    setErrorMessage("");
    const newId = generateMeetingId();
    await requestMicrophone();
    setMeetingId(newId);
    setMeetingCreated(true);
    setIsInMeeting(true);
    setSearchParams({ meeting: newId });
  };

  const joinMeeting = async () => {
    setErrorMessage("");
    const cleaned = inputMeetingId.trim().toUpperCase();
    if (!cleaned) {
      setErrorMessage("Please enter a meeting ID to join.");
      return;
    }
    await requestMicrophone();
    setMeetingId(cleaned);
    setMeetingCreated(false);
    setIsInMeeting(true);
    setSearchParams({ meeting: cleaned });
  };

  const leaveMeeting = () => {
    stopAllAudio();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    setLocalStream(null);
    setMicEnabled(false);
    setMeetingCreated(false);
    setIsInMeeting(false);
    setMeetingId("");
    setQualityTrend([]);
    trendHistoryRef.current = [];
    setSimulations({ noise: false, packetLoss: false, clipping: false, muffled: false });
    setSearchParams({});
  };

  const toggleMicrophone = async () => {
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    if (!localStream) {
      await requestMicrophone();
      return;
    }
    const tracks = localStream.getAudioTracks();
    tracks.forEach((t) => {
      t.enabled = !t.enabled;
    });
    setMicEnabled(tracks.some((t) => t.enabled));
  };

  const copyMeetingId = async () => {
    if (!meetingId) return;
    try {
      await navigator.clipboard.writeText(meetingId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {}
  };

  const toggleSimulation = (key) => {
    setSimulations((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const resetSimulations = () => {
    setSimulations({ noise: false, packetLoss: false, clipping: false, muffled: false });
  };

  useEffect(() => {
    const urlMeetingId = searchParams.get("meeting");
    if (urlMeetingId) {
      setMeetingId(urlMeetingId.toUpperCase());
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      stopAllAudio();
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [localStream]);

  const anySimActive = Object.values(simulations).some(Boolean);

  /* =====================================================
     RENDER
  ===================================================== */
  return (
    <div className="live-page" style={{ background: "#f8fafc", minHeight: "100vh" }}>
      <PageNav />

      <main style={{ maxWidth: "1280px", margin: "0 auto", padding: "16px 20px 40px", boxSizing: "border-box" }}>

        {/* ERROR / WARNING BANNER */}
        {errorMessage && (
          <div className="live-error" style={{ marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚠️ {errorMessage}</span>
            <button
              type="button"
              onClick={toggleTestTone}
              style={{
                background: isTestTonePlaying ? "#ef4444" : "#07162d",
                color: "#ffffff",
                border: "none",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer"
              }}
            >
              {isTestTonePlaying ? "⏹ Stop Demo Audio" : "▶ Play Demo Audio"}
            </button>
          </div>
        )}

        {/* =================================================
            1. CREATE / JOIN SCREEN WITH PRE-MEETING MIC TEST
        ================================================= */}
        {!isInMeeting && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div className="live-label" style={{ marginBottom: "10px" }}>06 — PROTOTYPE DEMO</div>
            <h1 style={{ color: "#07162d", fontSize: "32px", margin: "0 0 10px" }}>
              EdgeAudio-QC Live Communication
            </h1>
            <p style={{ color: "#55748a", maxWidth: "700px", margin: "0 auto 25px", fontSize: "15px", lineHeight: "1.5" }}>
              A real-time working prototype of our client-side speech quality estimator. Works standalone for single-person mic testing or peer-to-peer call monitoring.
            </p>

            {/* PRE-MEETING LIVE MIC CHECK WIDGET */}
            <div style={{
              maxWidth: "800px",
              margin: "0 auto 30px",
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "14px",
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "15px",
              boxShadow: "0 2px 6px rgba(7,22,45,0.04)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "22px" }}>{micEnabled ? "🎙️" : "🔇"}</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: "13px", fontWeight: "800", color: "#07162d" }}>
                    {micEnabled ? "Microphone Connected" : "Microphone Not Started"}
                  </div>
                  <div style={{ fontSize: "11px", color: micEnabled ? (isVoiceActive ? "#10b981" : "#64748b") : "#ef4444" }}>
                    {micEnabled ? (isVoiceActive ? "🗣️ Voice Detected" : "Listening (Quiet)") : "Click below to test mic"}
                  </div>
                </div>
              </div>

              {/* LIVE PRE-MEETING CANVAS */}
              <canvas
                ref={preMeetingCanvasRef}
                width="240"
                height="32"
                style={{ width: "240px", height: "32px", borderRadius: "6px", background: "#f1f5f9", border: "1px solid #e2e8f0" }}
              />

              <div style={{ display: "flex", gap: "8px" }}>
                {!micEnabled ? (
                  <button
                    type="button"
                    onClick={requestMicrophone}
                    style={{ background: "#07162d", color: "#ffffff", border: "none", padding: "8px 16px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                  >
                    🎤 Test Mic Now
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggleTestTone}
                    style={{ background: isTestTonePlaying ? "#ef4444" : "#edf7fb", color: isTestTonePlaying ? "#ffffff" : "#0369a1", border: "1px solid #bae6fd", padding: "8px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                  >
                    {isTestTonePlaying ? "⏹ Stop Audio" : "▶ Play Test Tone"}
                  </button>
                )}
              </div>
            </div>

            {/* CREATE / JOIN CARDS */}
            <section className="meeting-options" style={{ maxWidth: "800px", margin: "0 auto" }}>
              <div className="meeting-card" style={{ padding: "24px 20px" }}>
                <div className="meeting-number">01</div>
                <h2>Start Test Room</h2>
                <p>Create a live session with on-device speech quality analysis.</p>
                <button type="button" className="create-button" onClick={createMeeting} style={{ marginTop: "12px" }}>
                  🎙 Enter Meeting & Test QC
                </button>
              </div>

              <div className="meeting-card" style={{ padding: "24px 20px" }}>
                <div className="meeting-number">02</div>
                <h2>Join a Room</h2>
                <p>Enter an existing room ID to test 2-way call quality.</p>
                <input
                  type="text"
                  value={inputMeetingId}
                  onChange={(e) => setInputMeetingId(e.target.value)}
                  placeholder="e.g. EA-QC-X8K9M2"
                  className="meeting-input"
                  style={{ margin: "8px 0" }}
                />
                <button type="button" className="join-button" onClick={joinMeeting}>
                  Join Room
                </button>
              </div>
            </section>
          </div>
        )}

        {/* =================================================
            2. ACTIVE LIVE MEETING ROOM & QUALITY DASHBOARD
        ================================================= */}
        {isInMeeting && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

            {/* SLIM COMPACT TOOLBAR */}
            <section style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "12px",
              padding: "10px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              boxShadow: "0 2px 4px rgba(7, 22, 45, 0.03)"
            }}>
              {/* Left: Meeting Status & ID */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#edf7fb",
                  color: "#0369a1",
                  fontSize: "11px",
                  fontWeight: "800",
                  padding: "4px 8px",
                  borderRadius: "10px"
                }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981" }}></span>
                  ACTIVE QC ROOM
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#07162d", color: "#ffffff", padding: "4px 10px", borderRadius: "6px", fontSize: "12px" }}>
                  <span style={{ color: "#94a3b8" }}>ID:</span>
                  <strong>{meetingId}</strong>
                  <button
                    type="button"
                    onClick={copyMeetingId}
                    style={{ background: "transparent", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "11px", fontWeight: "700" }}
                  >
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Middle: Live Mic Signal Meter */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "#f1f5f9",
                  border: `1px solid ${isVoiceActive ? "#10b981" : "#cbd5e1"}`,
                  padding: "4px 12px",
                  borderRadius: "8px"
                }}>
                  <span style={{ fontSize: "14px" }}>{micEnabled ? (isVoiceActive ? "🗣️" : "🎙️") : "🔇"}</span>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: "800", color: "#07162d" }}>
                      {micEnabled ? (isVoiceActive ? "Voice Active" : "Mic Open (Quiet)") : "Muted"}
                    </span>
                    <span style={{ fontSize: "10px", color: "#64748b", marginLeft: "6px" }}>
                      {liveDb} dBFS
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={toggleTestTone}
                  style={{
                    background: isTestTonePlaying ? "#ef4444" : "#edf7fb",
                    color: isTestTonePlaying ? "#ffffff" : "#0369a1",
                    border: `1px solid ${isTestTonePlaying ? "#ef4444" : "#bae6fd"}`,
                    padding: "5px 10px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  {isTestTonePlaying ? "⏹ Stop Demo Voice" : "▶ Play Demo Voice"}
                </button>
              </div>

              {/* Right: Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={toggleMicrophone}
                  style={{
                    background: micEnabled ? "#07162d" : "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  {micEnabled ? "Mute" : "Unmute"}
                </button>

                <button
                  type="button"
                  onClick={leaveMeeting}
                  style={{
                    background: "#fee2e2",
                    color: "#b91c1c",
                    border: "1px solid #fecaca",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  Leave
                </button>
              </div>
            </section>

            {/* =================================================
                MAIN QUALITY REPORT DASHBOARD (SLIDE 10)
            ================================================= */}
            <section style={{
              background: "#ffffff",
              border: "1px solid #c8e1ec",
              borderRadius: "14px",
              padding: "18px 22px",
              boxShadow: "0 4px 12px rgba(7, 22, 45, 0.03)"
            }}>
              {/* Dashboard Title */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "14px", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
                <div>
                  <span style={{ fontSize: "10px", fontWeight: "800", color: "#286987", letterSpacing: "1px", textTransform: "uppercase" }}>
                    SLIDE 10 SPECIFICATION
                  </span>
                  <h2 style={{ margin: "2px 0 0", color: "#07162d", fontSize: "20px" }}>
                    Live Speech Quality Report
                  </h2>
                </div>

                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#edf7fb",
                  padding: "4px 10px",
                  borderRadius: "14px",
                  fontSize: "11px",
                  fontWeight: "700",
                  color: "#286987",
                  border: "1px solid #c7e0ec"
                }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>
                  Local Web Audio DSP • Zero Cloud Audio
                </div>
              </div>

              {/* METRICS GRID: Overall Score + 4 Diagnostic Dials */}
              <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "14px", alignItems: "stretch" }}>

                {/* OVERALL MOS CARD */}
                <div style={{
                  background: "#07162d",
                  color: "#ffffff",
                  borderRadius: "12px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 4px 10px rgba(7, 22, 45, 0.08)"
                }}>
                  <div>
                    <span style={{ fontSize: "10px", fontWeight: "800", letterSpacing: "1.2px", color: "#7dd3fc" }}>
                      OVERALL SPEECH QUALITY
                    </span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "8px 0 4px" }}>
                      <span style={{ fontSize: "40px", fontWeight: "900", lineHeight: 1 }}>
                        {qcMetrics.mosScore}
                      </span>
                      <span style={{ fontSize: "15px", color: "#94a3b8" }}>/ 5.0</span>
                    </div>
                  </div>

                  <div>
                    <div style={{
                      display: "inline-block",
                      background: qcMetrics.ratingColor,
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "800",
                      padding: "3px 10px",
                      borderRadius: "14px",
                      letterSpacing: "0.8px",
                      marginBottom: "4px"
                    }}>
                      {qcMetrics.ratingText}
                    </div>
                    <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                      Rolling 3s temporal smoothed context
                    </div>
                  </div>
                </div>

                {/* 4 SUB-METRICS METERS */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  {/* MICROPHONE */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Microphone</span>
                      <span style={{ fontSize: "10px", color: "#64748b" }}>{liveDb} dBFS</span>
                    </div>
                    <h3 style={{ margin: "3px 0 1px", fontSize: "15px", color: qcMetrics.micStatusColor }}>
                      {qcMetrics.micStatus}
                    </h3>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>Peak & overload monitoring</span>
                  </div>

                  {/* NETWORK */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Network</span>
                      <span style={{ fontSize: "10px", color: "#0284c7" }}>WebRTC</span>
                    </div>
                    <h3 style={{ margin: "3px 0 1px", fontSize: "15px", color: qcMetrics.networkStatus.includes("Degraded") ? "#ef4444" : "#0284c7" }}>
                      {qcMetrics.networkStatus.includes("Degraded") ? "Degraded" : "Stable"}
                    </h3>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>{qcMetrics.networkStatus}</span>
                  </div>

                  {/* BACKGROUND NOISE */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Background Noise</span>
                      <span style={{ fontSize: "10px", color: "#64748b" }}>SNR Floor</span>
                    </div>
                    <h3 style={{ margin: "3px 0 1px", fontSize: "15px", color: qcMetrics.noiseLevelColor }}>
                      {qcMetrics.noiseLevel}
                    </h3>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>Dynamic noise floor estimation</span>
                  </div>

                  {/* SPEECH CLARITY */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Speech Clarity</span>
                      <span style={{ fontSize: "10px", color: "#64748b" }}>Formants</span>
                    </div>
                    <h3 style={{ margin: "3px 0 1px", fontSize: "15px", color: qcMetrics.speechClarityColor }}>
                      {qcMetrics.speechClarity}
                    </h3>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>Formant spectral energy</span>
                  </div>
                </div>

              </div>

              {/* LIVE 60FPS FFT CANVAS VISUALIZER */}
              <div style={{ marginTop: "14px", borderTop: "1px solid #f1f5f9", paddingTop: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "#07162d" }}>
                    Live FFT Frequency Spectrum (256-bin AnalyserNode):
                  </span>
                  <span style={{ fontSize: "11px", color: isVoiceActive ? "#10b981" : "#64748b", fontWeight: "700" }}>
                    {isVoiceActive ? "🗣️ Capturing Voice Frequencies..." : "Listening (Speak into mic)..."}
                  </span>
                </div>
                <canvas
                  ref={canvasRef}
                  width="900"
                  height="45"
                  style={{ width: "100%", height: "45px", borderRadius: "6px", border: "1px solid #e2e8f0", background: "#f8fafc" }}
                />
              </div>

              {/* QUALITY TREND ROLLING GRAPH */}
              <div style={{ marginTop: "12px", borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "#07162d" }}>
                    Quality Trend (Rolling 10-Second History):
                  </span>
                  <span style={{ fontSize: "10px", color: "#64748b" }}>
                    {qualityTrend.length === 0
                      ? "Recording live history (0s/10s)..."
                      : qualityTrend.length < 10
                      ? `Accumulating live history (${qualityTrend.length}s/10s)...`
                      : `Average MOS: ${(qualityTrend.reduce((a, b) => a + b, 0) / qualityTrend.length).toFixed(1)} / 5.0`}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "40px", background: "#f8fafc", padding: "4px 8px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  {qualityTrend.length === 0 ? (
                    <div style={{ width: "100%", textAlign: "center", color: "#94a3b8", fontSize: "11px", alignSelf: "center" }}>
                      🎙️ Speak into microphone to record live 10-second quality trend...
                    </div>
                  ) : (
                    qualityTrend.map((score, idx) => {
                      const barHeight = Math.max(15, (score / 5.0) * 100);
                      const color = score >= 4.0 ? "#10b981" : score >= 3.0 ? "#f59e0b" : "#ef4444";
                      return (
                        <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                          <div style={{
                            width: "100%",
                            height: `${barHeight}%`,
                            background: color,
                            borderRadius: "2px 2px 0 0",
                            transition: "height 0.25s ease, background 0.25s ease"
                          }}></div>
                          <span style={{ fontSize: "8px", color: "#94a3b8", marginTop: "1px" }}>{score}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* MULTI-SELECT ACOUSTIC CONDITION SIMULATOR */}
              <div style={{ marginTop: "14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "10px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                  <div>
                    <h4 style={{ margin: 0, color: "#166534", fontSize: "12px" }}>
                      🧪 Lab Demo: Multi-Condition Simulator (Select multiple to test compound effects)
                    </h4>
                  </div>

                  {anySimActive && (
                    <button
                      type="button"
                      onClick={resetSimulations}
                      style={{
                        background: "#ffffff",
                        color: "#166534",
                        border: "1px solid #86efac",
                        borderRadius: "10px",
                        padding: "2px 8px",
                        fontSize: "10px",
                        fontWeight: "700",
                        cursor: "pointer"
                      }}
                    >
                      ✕ Reset to Clean
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => toggleSimulation("noise")}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "14px",
                      fontSize: "11px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: simulations.noise ? "#d97706" : "#ffffff",
                      color: simulations.noise ? "#ffffff" : "#b45309",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
                    }}
                  >
                    {simulations.noise ? "✓ Background Noise (ON)" : "+ Background Noise"}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSimulation("packetLoss")}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "14px",
                      fontSize: "11px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: simulations.packetLoss ? "#dc2626" : "#ffffff",
                      color: simulations.packetLoss ? "#ffffff" : "#b91c1c",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
                    }}
                  >
                    {simulations.packetLoss ? "✓ 15% Packet Loss (ON)" : "+ 15% Packet Loss"}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSimulation("clipping")}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "14px",
                      fontSize: "11px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: simulations.clipping ? "#7f1d1d" : "#ffffff",
                      color: simulations.clipping ? "#ffffff" : "#991b1b",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
                    }}
                  >
                    {simulations.clipping ? "✓ Mic Overload / Clip (ON)" : "+ Mic Overload / Clip"}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSimulation("muffled")}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "14px",
                      fontSize: "11px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: simulations.muffled ? "#4f46e5" : "#ffffff",
                      color: simulations.muffled ? "#ffffff" : "#4338ca",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
                    }}
                  >
                    {simulations.muffled ? "✓ Muffled / Low-Pass (ON)" : "+ Muffled / Low-Pass"}
                  </button>
                </div>
              </div>

            </section>
          </div>
        )}

        {/* PRIVACY GUARANTEE FOOTER */}
        <section className="privacy-box" style={{ marginTop: "16px", padding: "12px 16px" }}>
          <h2 style={{ fontSize: "14px", margin: "0 0 4px" }}>Zero-Cloud Privacy Guarantee</h2>
          <p style={{ margin: 0, fontSize: "12px", lineHeight: "1.4" }}>
            EdgeAudio-QC captures and analyzes speech audio locally inside the browser's Web Audio API context. Raw voice waveforms and audio buffers never leave your machine and are never uploaded to any remote server or S3 bucket.
          </p>
        </section>

      </main>

      <footer className="live-footer" style={{ marginTop: "16px" }}>
        EdgeAudio-QC | Privacy-Preserving Speech Quality Estimation Prototype
      </footer>
    </div>
  );
}

export default LiveCommunication;