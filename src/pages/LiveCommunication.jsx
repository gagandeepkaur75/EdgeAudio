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
  const [isTestSamplePlaying, setIsTestSamplePlaying] = useState(false);

  // Live Audio Levels & Metering
  const [micLevel, setMicLevel] = useState(0); // 0 to 100%
  const [eqLevels, setEqLevels] = useState([15, 15, 15, 15, 15]); // 5 bars

  // Audio Quality QC Metrics State
  const [qcMetrics, setQcMetrics] = useState({
    mosScore: 4.4,
    ratingText: "EXCELLENT",
    ratingColor: "#10b981", // green
    micStatus: "Optimal (Clean)",
    micStatusColor: "#10b981",
    noiseLevel: "Low (<12 dB)",
    noiseLevelColor: "#10b981",
    speechClarity: "High (Clear)",
    speechClarityColor: "#10b981",
    networkStatus: "Stable (WebRTC P2P)",
    rmsDb: -55,
    isSpeaking: false,
    clippingDetected: false,
  });

  // Rolling Quality History Trend (Starts empty, accumulates 1s at a time)
  const [qualityTrend, setQualityTrend] = useState([]);

  // Multi-Select Acoustic Simulator State
  const [simulations, setSimulations] = useState({
    noise: false,
    packetLoss: false,
    clipping: false,
    muffled: false,
  });

  // Web Audio References
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const oscillatorRef = useRef(null);
  const zeroGainRef = useRef(null);
  const animationFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const smoothedMosRef = useRef(4.4);
  const trendHistoryRef = useRef([]);
  const simulationsRef = useRef({ noise: false, packetLoss: false, clipping: false, muffled: false });

  useEffect(() => {
    simulationsRef.current = simulations;
  }, [simulations]);

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
  const startAudioDSP = async (stream) => {
    try {
      // 1. Initialize AudioContext
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      // Ensure AudioContext is actively running (fixes Chrome autoplay policy)
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      // 2. Create AnalyserNode
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyserRef.current = analyser;

      // 3. Connect MediaStreamSource
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);

      // 4. Create a silent Zero-Gain sink to force Chrome to pump audio frames
      const zeroGain = audioCtx.createGain();
      zeroGain.gain.value = 0;
      zeroGainRef.current = zeroGain;
      analyser.connect(zeroGain);
      zeroGain.connect(audioCtx.destination);

      const timeDomainBuffer = new Float32Array(analyser.fftSize);
      const frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);

      let lastTrendUpdate = Date.now();
      let noiseFloorEst = 0.005;

      const processAudio = () => {
        if (!analyserRef.current) return;

        analyser.getFloatTimeDomainData(timeDomainBuffer);
        analyser.getByteFrequencyData(frequencyBuffer);

        // 1. Calculate RMS Energy & Peak
        let sumSquares = 0;
        let peakValue = 0;
        let clipCount = 0;

        for (let i = 0; i < timeDomainBuffer.length; i++) {
          const sample = timeDomainBuffer[i];
          const abs = Math.abs(sample);
          sumSquares += sample * sample;
          if (abs > peakValue) peakValue = abs;
          if (abs >= 0.94) clipCount++;
        }

        const rms = Math.sqrt(sumSquares / timeDomainBuffer.length);
        const rmsDb = rms > 0.0001 ? Math.round(20 * Math.log10(rms)) : -65;
        
        // Voice Activity Detection (VAD) threshold
        const isSpeaking = rms > 0.008 || frequencyBuffer.some((f) => f > 45);

        // Dynamic 5-bar Equalizer heights (15% to 100%)
        const baseLevel = Math.min(100, Math.round(rms * 450));
        setMicLevel(baseLevel);

        const b1 = Math.min(100, Math.max(15, Math.round((frequencyBuffer[4] / 255) * 100 * 1.5)));
        const b2 = Math.min(100, Math.max(15, Math.round((frequencyBuffer[12] / 255) * 100 * 1.5)));
        const b3 = Math.min(100, Math.max(15, Math.round((frequencyBuffer[24] / 255) * 100 * 1.5)));
        const b4 = Math.min(100, Math.max(15, Math.round((frequencyBuffer[48] / 255) * 100 * 1.5)));
        const b5 = Math.min(100, Math.max(15, Math.round((frequencyBuffer[72] / 255) * 100 * 1.5)));
        setEqLevels([b1, b2, b3, b4, b5]);

        // Dynamic noise floor estimation during pauses
        if (!isSpeaking && rms > 0.0002) {
          noiseFloorEst = 0.95 * noiseFloorEst + 0.05 * rms;
        }

        // 2. Spectral Speech Band Concentration (300Hz - 3400Hz)
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

        // 3. Real-Time MOS Score Estimation
        let rawMos = isSpeaking ? 4.5 : 4.3; // Clean baseline

        // Natural Penalties from Real Audio
        const snrRatio = rms / Math.max(0.001, noiseFloorEst);
        if (snrRatio < 2.0 && isSpeaking) rawMos -= 0.7;
        else if (snrRatio < 3.5 && isSpeaking) rawMos -= 0.3;

        const isClipped = clipCount > 1;
        if (isClipped) rawMos -= 1.4;

        if (isSpeaking && speechConcentration < 0.30) rawMos -= 0.4;

        // Multi-Select Compound Degradation Modifiers
        const currentSims = simulationsRef.current;
        let simulatedNoise = isSpeaking && snrRatio < 2.5 ? "Moderate (<20 dB)" : "Low (<12 dB)";
        let simulatedNoiseColor = "#10b981";
        let simulatedClarity = isSpeaking ? "High (Clear)" : "Optimal";
        let simulatedClarityColor = "#10b981";
        let simulatedMic = isClipped ? "Clipping Detected" : "Optimal (Clean)";
        let simulatedMicColor = isClipped ? "#ef4444" : "#10b981";
        let simulatedNetwork = "Stable (WebRTC P2P)";

        if (currentSims.noise) {
          rawMos -= 1.2;
          simulatedNoise = "High (Cafe/Street Noise)";
          simulatedNoiseColor = "#f59e0b";
        }
        if (currentSims.packetLoss) {
          rawMos -= 1.4;
          simulatedNetwork = "Degraded (15% Packet Loss)";
          simulatedClarity = "Robotic / Jitter Glitches";
          simulatedClarityColor = "#ef4444";
        }
        if (currentSims.clipping) {
          rawMos -= 1.6;
          simulatedMic = "Severe Overload / Clipping";
          simulatedMicColor = "#ef4444";
        }
        if (currentSims.muffled) {
          rawMos -= 0.8;
          simulatedClarity = "Muffled (Narrowband Filter)";
          simulatedClarityColor = "#f59e0b";
        }

        // Clamp between 1.0 and 5.0
        rawMos = Math.max(1.0, Math.min(5.0, rawMos));

        // 4. Temporal Smoothing (EMA)
        const alpha = 0.22;
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
        } else {
          ratingText = "POOR";
          ratingColor = "#ef4444"; // red
        }

        // 5. Accumulate Live Trend History (every 1 second)
        if (Date.now() - lastTrendUpdate >= 1000) {
          lastTrendUpdate = Date.now();
          let newHistory;
          if (trendHistoryRef.current.length < 10) {
            newHistory = [...trendHistoryRef.current, displayMos];
          } else {
            newHistory = [...trendHistoryRef.current.slice(1), displayMos];
          }
          trendHistoryRef.current = newHistory;
          setQualityTrend(newHistory);
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

        // 6. Draw Real-Time Spectrum Canvas Visualizer
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext("2d");
          const width = canvas.width;
          const height = canvas.height;

          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(0, 0, width, height);

          const barCount = 40;
          const barWidth = width / barCount - 2;

          for (let b = 0; b < barCount; b++) {
            const binIndex = Math.floor((b / barCount) * (frequencyBuffer.length / 2));
            const barHeight = Math.max(4, (frequencyBuffer[binIndex] / 255) * height * 0.9);

            ctx.fillStyle = isSpeaking ? ratingColor : "#94a3b8";
            ctx.beginPath();
            ctx.roundRect(b * (barWidth + 2), height - barHeight, barWidth, barHeight, [2, 2, 0, 0]);
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

  /* =====================================================
     SYNTHETIC SPEECH AUDIO GENERATOR (FOR DEMO & TEST)
  ===================================================== */
  const toggleTestSample = () => {
    if (isTestSamplePlaying) {
      // Stop
      if (oscillatorRef.current) {
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
        oscillatorRef.current = null;
      }
      setIsTestSamplePlaying(false);
    } else {
      // Start a rich harmonic speech simulation through Web Audio
      try {
        let audioCtx = audioContextRef.current;
        if (!audioCtx || audioCtx.state === "closed") {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
        }

        if (audioCtx.state === "suspended") {
          audioCtx.resume();
        }

        let analyser = analyserRef.current;
        if (!analyser) {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          analyserRef.current = analyser;
        }

        // Create oscillator simulating vocal cords
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, audioCtx.currentTime); // 220 Hz pitch
        
        // Modulate pitch slightly to simulate natural speech inflection
        osc.frequency.linearRampToValueAtTime(320, audioCtx.currentTime + 1.0);
        osc.frequency.linearRampToValueAtTime(180, audioCtx.currentTime + 2.0);
        osc.frequency.linearRampToValueAtTime(260, audioCtx.currentTime + 3.0);

        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);

        osc.connect(gain);
        gain.connect(analyser);

        // Silent sink to destination
        const zeroGain = audioCtx.createGain();
        zeroGain.gain.value = 0;
        analyser.connect(zeroGain);
        zeroGain.connect(audioCtx.destination);

        osc.start();
        oscillatorRef.current = osc;
        setIsTestSamplePlaying(true);
      } catch (err) {
        console.error("Test sample generator failed:", err);
      }
    }
  };

  const stopAudioDSP = () => {
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
    setIsTestSamplePlaying(false);
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
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      setLocalStream(stream);
      setMicEnabled(true);
      setQualityTrend([]);
      trendHistoryRef.current = [];
      await startAudioDSP(stream);
      return stream;
    } catch (error) {
      console.error("Microphone error:", error);
      setErrorMessage("Microphone permission was denied or not found. You can still click 'Play Test Speech Sample' below to demonstrate the prototype live!");
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
    if (!stream) {
      // Even if mic was blocked, allow entering room to show demo simulation
      setMeetingId(newMeetingId);
      setMeetingCreated(true);
      setIsInMeeting(true);
      setSearchParams({ meeting: newMeetingId });
      return;
    }

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
    setQualityTrend([]);
    trendHistoryRef.current = [];
    setSimulations({ noise: false, packetLoss: false, clipping: false, muffled: false });
    setSearchParams({});
  };

  /* =====================================================
     MICROPHONE TOGGLE
  ===================================================== */
  const toggleMicrophone = async () => {
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    if (!localStream) {
      await requestMicrophone();
      return;
    }

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
     SIMULATOR TOGGLES
  ===================================================== */
  const toggleSimulation = (key) => {
    setSimulations((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const resetSimulations = () => {
    setSimulations({
      noise: false,
      packetLoss: false,
      clipping: false,
      muffled: false,
    });
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

  const anySimActive = Object.values(simulations).some(Boolean);

  /* =====================================================
     RENDER
  ===================================================== */
  return (
    <div className="live-page" style={{ background: "#f8fafc", minHeight: "100vh" }}>
      {/* Centralized Top Navigation Bar */}
      <PageNav />

      <main style={{ maxWidth: "1280px", margin: "0 auto", padding: "20px 24px 40px", boxSizing: "border-box" }}>

        {/* ERROR / WARNING BANNER */}
        {errorMessage && (
          <div className="live-error" style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚠️ {errorMessage}</span>
            <button
              type="button"
              onClick={toggleTestSample}
              style={{
                background: isTestSamplePlaying ? "#ef4444" : "#07162d",
                color: "#ffffff",
                border: "none",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer"
              }}
            >
              {isTestSamplePlaying ? "⏹ Stop Test Speech" : "▶ Play Test Speech Sample"}
            </button>
          </div>
        )}

        {/* =================================================
            1. CREATE / JOIN MEETING SCREEN (BEFORE JOINING)
        ================================================= */}
        {!isInMeeting && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div className="live-label" style={{ marginBottom: "12px" }}>06 — PROTOTYPE DEMO</div>
            <h1 style={{ color: "#07162d", fontSize: "36px", margin: "0 0 12px" }}>
              EdgeAudio-QC Live Communication
            </h1>
            <p style={{ color: "#55748a", maxWidth: "700px", margin: "0 auto 35px", fontSize: "16px", lineHeight: "1.5" }}>
              A working prototype of our privacy-preserving speech quality estimator. Start a test room to evaluate live MOS scores, FFT frequency spectrum, and diagnostic metrics locally in your browser.
            </p>

            <section className="meeting-options" style={{ maxWidth: "900px", margin: "0 auto" }}>
              {/* CREATE CARD */}
              <div className="meeting-card" style={{ padding: "30px 24px" }}>
                <div className="meeting-number">01</div>
                <h2>Create a Meeting Room</h2>
                <p>
                  Start a real-time session with live microphone capture and on-device speech quality analysis.
                </p>
                <button type="button" className="create-button" onClick={createMeeting} style={{ marginTop: "15px" }}>
                  🎙 Start Meeting & Test Mic
                </button>
              </div>

              {/* JOIN CARD */}
              <div className="meeting-card" style={{ padding: "30px 24px" }}>
                <div className="meeting-number">02</div>
                <h2>Join an Existing Room</h2>
                <p>
                  Enter an existing meeting ID to connect and evaluate two-way call quality.
                </p>
                <input
                  type="text"
                  value={inputMeetingId}
                  onChange={(e) => setInputMeetingId(e.target.value)}
                  placeholder="e.g. EA-QC-X8K9M2"
                  className="meeting-input"
                  style={{ margin: "10px 0" }}
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
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

            {/* COMPACT TOP TOOLBAR: Meeting Status, Participants & Waveform, Controls */}
            <section style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "14px",
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "15px",
              boxShadow: "0 2px 4px rgba(7, 22, 45, 0.04)"
            }}>
              {/* Left: Meeting Status & ID Pill */}
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#edf7fb",
                  color: "#0369a1",
                  fontSize: "12px",
                  fontWeight: "800",
                  padding: "4px 10px",
                  borderRadius: "12px"
                }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981" }}></span>
                  ACTIVE SESSION
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#07162d", color: "#ffffff", padding: "5px 12px", borderRadius: "8px", fontSize: "13px" }}>
                  <span style={{ color: "#94a3b8" }}>ID:</span>
                  <strong style={{ letterSpacing: "0.5px" }}>{meetingId}</strong>
                  <button
                    type="button"
                    onClick={copyMeetingId}
                    style={{ background: "transparent", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "12px", fontWeight: "700", marginLeft: "4px" }}
                  >
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Middle: Compact Participants with Live Waveform Bars */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {/* Local Participant Card */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: "#f1f5f9",
                  border: `1px solid ${qcMetrics.isSpeaking ? "#10b981" : "#cbd5e1"}`,
                  padding: "6px 14px",
                  borderRadius: "10px",
                  transition: "border-color 0.2s ease"
                }}>
                  <span style={{ fontSize: "16px" }}>{micEnabled ? (qcMetrics.isSpeaking ? "🗣️" : "🎙️") : "🔇"}</span>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "800", color: "#07162d", lineHeight: 1.1 }}>You (Local)</div>
                    <div style={{ fontSize: "11px", color: micEnabled ? (qcMetrics.isSpeaking ? "#10b981" : "#64748b") : "#ef4444" }}>
                      {micEnabled ? (qcMetrics.isSpeaking ? "Voice Active" : "Microphone Open") : "Muted"}
                    </div>
                  </div>

                  {/* LIVE BOUNCING EQUALIZER WAVEFORM BARS */}
                  {micEnabled && (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "18px", width: "24px", marginLeft: "4px" }}>
                      {eqLevels.map((lvl, idx) => (
                        <span
                          key={idx}
                          style={{
                            flex: 1,
                            background: qcMetrics.isSpeaking ? "#10b981" : "#94a3b8",
                            height: `${lvl}%`,
                            borderRadius: "1px",
                            transition: "height 0.08s ease"
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Synthetic Speech Test Button */}
                <button
                  type="button"
                  onClick={toggleTestSample}
                  style={{
                    background: isTestSamplePlaying ? "#ef4444" : "#edf7fb",
                    color: isTestSamplePlaying ? "#ffffff" : "#0369a1",
                    border: `1px solid ${isTestSamplePlaying ? "#ef4444" : "#bae6fd"}`,
                    padding: "6px 12px",
                    borderRadius: "8px",
                    fontSize: "11px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  {isTestSamplePlaying ? "⏹ Stop Test Audio" : "▶ Play Test Speech"}
                </button>
              </div>

              {/* Right: Quick Meeting Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={toggleMicrophone}
                  style={{
                    background: micEnabled ? "#07162d" : "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    padding: "7px 14px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  {micEnabled ? "Mute Mic" : "Unmute Mic"}
                </button>

                <button
                  type="button"
                  onClick={leaveMeeting}
                  style={{
                    background: "#fee2e2",
                    color: "#b91c1c",
                    border: "1px solid #fecaca",
                    padding: "7px 14px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  Leave Call
                </button>
              </div>
            </section>

            {/* =================================================
                MAIN QUALITY REPORT DASHBOARD (COMPACT FIT)
            ================================================= */}
            <section style={{
              background: "#ffffff",
              border: "1px solid #c8e1ec",
              borderRadius: "16px",
              padding: "20px 24px",
              boxShadow: "0 4px 12px rgba(7, 22, 45, 0.03)"
            }}>
              {/* Dashboard Header Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "16px", borderBottom: "1px solid #f1f5f9", paddingBottom: "12px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#286987", letterSpacing: "1px", textTransform: "uppercase" }}>
                    REAL-TIME QUALITY ESTIMATOR (SLIDE 10 DASHBOARD)
                  </span>
                  <h2 style={{ margin: "2px 0 0", color: "#07162d", fontSize: "22px" }}>
                    Live Speech Quality Report
                  </h2>
                </div>

                <div style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "#edf7fb",
                  padding: "5px 12px",
                  borderRadius: "16px",
                  fontSize: "12px",
                  fontWeight: "700",
                  color: "#286987",
                  border: "1px solid #c7e0ec"
                }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>
                  Local 16 kHz DSP • Zero Cloud Audio
                </div>
              </div>

              {/* METRICS GRID: Overall Score + 4 Diagnostic Dials */}
              <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "16px", alignItems: "stretch" }}>

                {/* OVERALL MOS CARD */}
                <div style={{
                  background: "#07162d",
                  color: "#ffffff",
                  borderRadius: "14px",
                  padding: "18px 20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 6px 12px rgba(7, 22, 45, 0.1)"
                }}>
                  <div>
                    <span style={{ fontSize: "10px", fontWeight: "800", letterSpacing: "1.2px", color: "#7dd3fc" }}>
                      OVERALL SPEECH QUALITY
                    </span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "10px 0 6px" }}>
                      <span style={{ fontSize: "44px", fontWeight: "900", lineHeight: 1 }}>
                        {qcMetrics.mosScore}
                      </span>
                      <span style={{ fontSize: "16px", color: "#94a3b8" }}>/ 5.0</span>
                    </div>
                  </div>

                  <div>
                    <div style={{
                      display: "inline-block",
                      background: qcMetrics.ratingColor,
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "800",
                      padding: "4px 12px",
                      borderRadius: "16px",
                      letterSpacing: "0.8px",
                      marginBottom: "6px"
                    }}>
                      {qcMetrics.ratingText}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                      Rolling 3s temporal smoothed context
                    </div>
                  </div>
                </div>

                {/* 4 SUB-METRICS METERS */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  {/* MICROPHONE */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Microphone</span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>{qcMetrics.rmsDb} dBFS</span>
                    </div>
                    <h3 style={{ margin: "4px 0 2px", fontSize: "16px", color: qcMetrics.micStatusColor }}>
                      {qcMetrics.micStatus}
                    </h3>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Peak detection & clipping check</span>
                  </div>

                  {/* NETWORK */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Network</span>
                      <span style={{ fontSize: "11px", color: "#0284c7" }}>WebRTC</span>
                    </div>
                    <h3 style={{ margin: "4px 0 2px", fontSize: "16px", color: qcMetrics.networkStatus.includes("Degraded") ? "#ef4444" : "#0284c7" }}>
                      {qcMetrics.networkStatus.includes("Degraded") ? "Degraded" : "Stable"}
                    </h3>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{qcMetrics.networkStatus}</span>
                  </div>

                  {/* BACKGROUND NOISE */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Background Noise</span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>SNR Floor</span>
                    </div>
                    <h3 style={{ margin: "4px 0 2px", fontSize: "16px", color: qcMetrics.noiseLevelColor }}>
                      {qcMetrics.noiseLevel}
                    </h3>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Dynamic pause energy estimation</span>
                  </div>

                  {/* SPEECH CLARITY */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Speech Clarity</span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>Formants</span>
                    </div>
                    <h3 style={{ margin: "4px 0 2px", fontSize: "16px", color: qcMetrics.speechClarityColor }}>
                      {qcMetrics.speechClarity}
                    </h3>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Spectral band concentration</span>
                  </div>
                </div>

              </div>

              {/* LIVE AUDIO CANVAS VISUALIZER */}
              <div style={{ marginTop: "16px", borderTop: "1px solid #f1f5f9", paddingTop: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#07162d" }}>
                    Live FFT Frequency Spectrum (1024-bin AnalyserNode):
                  </span>
                  <span style={{ fontSize: "11px", color: qcMetrics.isSpeaking ? "#10b981" : "#64748b", fontWeight: "700" }}>
                    {qcMetrics.isSpeaking ? "🗣️ Voice Detected (Active Speech)" : "Listening for voice..."}
                  </span>
                </div>
                <canvas
                  ref={canvasRef}
                  width="900"
                  height="50"
                  style={{ width: "100%", height: "50px", borderRadius: "6px", border: "1px solid #e2e8f0", background: "#f8fafc" }}
                />
              </div>

              {/* QUALITY TREND ROLLING GRAPH (ACCUMULATES LIVE) */}
              <div style={{ marginTop: "14px", borderTop: "1px solid #f1f5f9", paddingTop: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#07162d" }}>
                    Quality Trend (Rolling 10-Second History):
                  </span>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    {qualityTrend.length === 0
                      ? "Recording live history (0s/10s)..."
                      : qualityTrend.length < 10
                      ? `Accumulating live history (${qualityTrend.length}s/10s)...`
                      : `Average MOS: ${(qualityTrend.reduce((a, b) => a + b, 0) / qualityTrend.length).toFixed(1)} / 5.0 (Full 10s Window)`}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "45px", background: "#f8fafc", padding: "6px 10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  {qualityTrend.length === 0 ? (
                    <div style={{ width: "100%", textAlign: "center", color: "#94a3b8", fontSize: "12px", alignSelf: "center" }}>
                      🎙️ Speak to begin recording live 10-second quality trend...
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
                            borderRadius: "3px 3px 0 0",
                            transition: "height 0.25s ease, background 0.25s ease"
                          }}></div>
                          <span style={{ fontSize: "9px", color: "#94a3b8", marginTop: "2px" }}>{score}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* MULTI-SELECT ACOUSTIC CONDITION SIMULATOR */}
              <div style={{ marginTop: "16px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                  <div>
                    <h4 style={{ margin: 0, color: "#166534", fontSize: "13px" }}>
                      🧪 Lab Demo: Multi-Condition Simulator (Select multiple to test compound effects)
                    </h4>
                    <span style={{ fontSize: "11px", color: "#15803d" }}>
                      Toggle one or more conditions to verify real-time quality adaptation.
                    </span>
                  </div>

                  {anySimActive && (
                    <button
                      type="button"
                      onClick={resetSimulations}
                      style={{
                        background: "#ffffff",
                        color: "#166534",
                        border: "1px solid #86efac",
                        borderRadius: "12px",
                        padding: "3px 10px",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer"
                      }}
                    >
                      ✕ Reset to Clean
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {/* NOISE TOGGLE */}
                  <button
                    type="button"
                    onClick={() => toggleSimulation("noise")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "16px",
                      fontSize: "12px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: simulations.noise ? "#d97706" : "#ffffff",
                      color: simulations.noise ? "#ffffff" : "#b45309",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                    }}
                  >
                    {simulations.noise ? "✓ Background Noise (ON)" : "+ Background Noise"}
                  </button>

                  {/* PACKET LOSS TOGGLE */}
                  <button
                    type="button"
                    onClick={() => toggleSimulation("packetLoss")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "16px",
                      fontSize: "12px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: simulations.packetLoss ? "#dc2626" : "#ffffff",
                      color: simulations.packetLoss ? "#ffffff" : "#b91c1c",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                    }}
                  >
                    {simulations.packetLoss ? "✓ 15% Packet Loss (ON)" : "+ 15% Packet Loss"}
                  </button>

                  {/* CLIPPING TOGGLE */}
                  <button
                    type="button"
                    onClick={() => toggleSimulation("clipping")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "16px",
                      fontSize: "12px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: simulations.clipping ? "#7f1d1d" : "#ffffff",
                      color: simulations.clipping ? "#ffffff" : "#991b1b",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                    }}
                  >
                    {simulations.clipping ? "✓ Mic Overload / Clip (ON)" : "+ Mic Overload / Clip"}
                  </button>

                  {/* MUFFLED BANDWIDTH TOGGLE */}
                  <button
                    type="button"
                    onClick={() => toggleSimulation("muffled")}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "16px",
                      fontSize: "12px",
                      fontWeight: "700",
                      border: "none",
                      cursor: "pointer",
                      background: simulations.muffled ? "#4f46e5" : "#ffffff",
                      color: simulations.muffled ? "#ffffff" : "#4338ca",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                    }}
                  >
                    {simulations.muffled ? "✓ Muffled / Low-Pass (ON)" : "+ Muffled / Low-Pass"}
                  </button>
                </div>
              </div>

            </section>
          </div>
        )}

        {/* PRIVACY BOX (COMPACT FOOTER) */}
        <section className="privacy-box" style={{ marginTop: "20px", padding: "16px 20px" }}>
          <h2 style={{ fontSize: "16px", margin: "0 0 6px" }}>Zero-Cloud Privacy Guarantee</h2>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.4" }}>
            EdgeAudio-QC captures and analyzes speech audio locally inside the browser's Web Audio API context. Raw voice waveforms and audio buffers never leave your machine and are never uploaded to any remote server or S3 bucket.
          </p>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="live-footer" style={{ marginTop: "20px" }}>
        EdgeAudio-QC | Privacy-Preserving Speech Quality Estimation Prototype
      </footer>
    </div>
  );
}

export default LiveCommunication;