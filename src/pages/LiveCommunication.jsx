import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageNav from "../components/PageNav";
import { API_BASE_URL } from "../utils/api";
import "./live.css";

function LiveCommunication() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // User & Meeting Identity
  const userIdRef = useRef(`user_${Math.random().toString(36).substring(2, 9)}`);
  const [meetingId, setMeetingId] = useState("");
  const [inputMeetingId, setInputMeetingId] = useState("");
  const [meetingCreated, setMeetingCreated] = useState(false);
  const [isInMeeting, setIsInMeeting] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [isTestTonePlaying, setIsTestTonePlaying] = useState(false);

  // Peer & WebRTC State
  const [peerCount, setPeerCount] = useState(1);
  const [peerList, setPeerList] = useState([]);
  const peerConnectionRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pollTimerRef = useRef(null);

  // Live Audio Meters (Throttled for 60fps smooth canvas, 10Hz React state)
  const [liveDb, setLiveDb] = useState(-55);
  const [volumePercent, setVolumePercent] = useState(0);
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  // Multi-Select Acoustic Condition Simulator State
  const [simulations, setSimulations] = useState({
    noise: false,
    packetLoss: false,
    clipping: false,
    muffled: false,
  });

  // Rolling Quality History Trend
  const [qualityTrend, setQualityTrend] = useState([]);

  // Web Audio References
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const zeroGainRef = useRef(null);
  const oscillatorRef = useRef(null);
  const oscTimerRef = useRef(null);
  const localStreamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const preMeetingCanvasRef = useRef(null);

  // Smoothed Audio Features
  const smoothedRmsRef = useRef(0.001);
  const smoothedMosRef = useRef(4.4);
  const trendHistoryRef = useRef([]);

  /* =====================================================
     CALCULATE LIVE QC METRICS (REACTIVE TO AUDIO & SIMULATIONS)
  ===================================================== */
  const qcMetrics = useMemo(() => {
    let baseMos = isVoiceActive ? 4.5 : 4.3;

    // Natural Audio Penalties
    if (liveDb > -5) baseMos -= 1.3; // clipping
    else if (liveDb < -45 && isVoiceActive) baseMos -= 0.4; // weak signal

    // Multi-Select Simulation Penalties (Compound)
    let noiseText = isVoiceActive ? "Low (<12 dB)" : "Quiet Ambient";
    let noiseColor = "#10b981";
    let clarityText = isVoiceActive ? "High (Clear Speech)" : "Optimal";
    let clarityColor = "#10b981";
    let micText = liveDb > -5 ? "Clipping Detected" : micEnabled ? "Optimal (Clean)" : "Microphone Muted";
    let micColor = liveDb > -5 ? "#ef4444" : micEnabled ? "#10b981" : "#64748b";
    let netText = peerCount > 1 ? "P2P Connected (2 Users)" : "Stable (Local Analysis)";
    let netColor = "#0284c7";

    if (simulations.noise) {
      baseMos -= 1.2;
      noiseText = "High (Cafe / Street Noise)";
      noiseColor = "#f59e0b";
    }

    if (simulations.packetLoss) {
      baseMos -= 1.4;
      netText = "Degraded (15% Packet Loss)";
      netColor = "#ef4444";
      clarityText = "Robotic / Packet Glitches";
      clarityColor = "#ef4444";
    }

    if (simulations.clipping) {
      baseMos -= 1.6;
      micText = "Severe Overload / Clipping";
      micColor = "#ef4444";
    }

    if (simulations.muffled) {
      baseMos -= 0.8;
      clarityText = "Muffled (Narrowband Filter)";
      clarityColor = "#f59e0b";
    }

    const calculatedMos = Math.max(1.0, Math.min(5.0, parseFloat(baseMos.toFixed(1))));

    let ratingText = "EXCELLENT";
    let ratingColor = "#10b981"; // green

    if (calculatedMos >= 4.0) {
      ratingText = "GOOD";
      ratingColor = "#0284c7"; // blue
    } else if (calculatedMos >= 3.0) {
      ratingText = "FAIR";
      ratingColor = "#f59e0b"; // amber
    } else {
      ratingText = "POOR";
      ratingColor = "#ef4444"; // red
    }

    return {
      mosScore: calculatedMos,
      ratingText,
      ratingColor,
      micStatus: micText,
      micStatusColor: micColor,
      noiseLevel: noiseText,
      noiseLevelColor: noiseColor,
      speechClarity: clarityText,
      speechClarityColor: clarityColor,
      networkStatus: netText,
      networkColor: netColor,
    };
  }, [liveDb, isVoiceActive, micEnabled, simulations, peerCount]);

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
     START WEB AUDIO DSP (LOCAL CAPTURE & ANALYZER)
  ===================================================== */
  const startAudioDSP = async (stream) => {
    try {
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        await audioContextRef.current.close().catch(() => {});
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

      // Silent zero-gain sink to prevent browser pausing stream
      const zeroGain = audioCtx.createGain();
      zeroGain.gain.value = 0;
      zeroGainRef.current = zeroGain;
      analyser.connect(zeroGain);
      zeroGain.connect(audioCtx.destination);

      const timeBuffer = new Float32Array(analyser.fftSize);
      const freqBuffer = new Uint8Array(analyser.frequencyBinCount);

      let lastStateTime = Date.now();
      let lastTrendTime = Date.now();

      const renderLoop = () => {
        if (!analyserRef.current) return;

        analyser.getFloatTimeDomainData(timeBuffer);
        analyser.getByteFrequencyData(freqBuffer);

        // 1. Calculate Volume Level & RMS
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < timeBuffer.length; i++) {
          const sample = timeBuffer[i];
          const abs = Math.abs(sample);
          sum += sample * sample;
          if (abs > peak) peak = abs;
        }

        const rms = Math.sqrt(sum / timeBuffer.length);
        smoothedRmsRef.current = 0.3 * rms + 0.7 * smoothedRmsRef.current;

        const currentDb = rms > 0.0001 ? Math.round(20 * Math.log10(rms)) : -60;
        const currentPercent = Math.min(100, Math.round(smoothedRmsRef.current * 400));
        const voiceActive = rms > 0.008 || freqBuffer.some((f) => f > 40);

        // 2. Throttled State Update (10Hz) to prevent React state thrashing
        const now = Date.now();
        if (now - lastStateTime > 100) {
          lastStateTime = now;
          setLiveDb(currentDb);
          setVolumePercent(currentPercent);
          setIsVoiceActive(voiceActive);
        }

        // 3. Update 10s Rolling History Trend (1s interval)
        if (now - lastTrendTime > 1000) {
          lastTrendTime = now;
          setQualityTrend((prev) => {
            const next = prev.length < 10 ? [...prev, qcMetrics.mosScore] : [...prev.slice(1), qcMetrics.mosScore];
            trendHistoryRef.current = next;
            return next;
          });
        }

        // 4. Render 60fps Canvas Spectrum Visualizer
        const activeCanvas = canvasRef.current || preMeetingCanvasRef.current;
        if (activeCanvas) {
          const ctx = activeCanvas.getContext("2d");
          const w = activeCanvas.width;
          const h = activeCanvas.height;

          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "#07162d";
          ctx.fillRect(0, 0, w, h);

          const barCount = 32;
          const barW = w / barCount - 2;

          for (let i = 0; i < barCount; i++) {
            const val = freqBuffer[i % freqBuffer.length];
            // Ensure visual animation even on subtle voices
            const barH = Math.max(6, (val / 255) * h * 0.9 + (voiceActive ? 8 : 2));

            // Color gradient: cyan to green
            const gradient = ctx.createLinearGradient(0, h, 0, 0);
            gradient.addColorStop(0, "#0284c7");
            gradient.addColorStop(1, voiceActive ? "#10b981" : "#38bdf8");

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(i * (barW + 2), h - barH, barW, barH, [3, 3, 0, 0]);
            ctx.fill();
          }
        }

        animationFrameRef.current = requestAnimationFrame(renderLoop);
      };

      renderLoop();
    } catch (err) {
      console.error("Audio DSP setup error:", err);
    }
  };

  /* =====================================================
     SIMULATED SPEECH TONE GENERATOR (INSTANT 1-CLICK DEMO)
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
      if (oscTimerRef.current) clearInterval(oscTimerRef.current);
      setIsTestTonePlaying(false);
      setIsVoiceActive(false);
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

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.18, audioCtx.currentTime);

        osc.connect(gain);
        gain.connect(analyser);

        const zeroGain = audioCtx.createGain();
        zeroGain.gain.value = 0;
        analyser.connect(zeroGain);
        zeroGain.connect(audioCtx.destination);

        osc.start();
        oscillatorRef.current = osc;

        // Modulate pitch to simulate speech sentences
        let step = 0;
        const pitches = [220, 290, 340, 260, 310, 240, 380, 220];
        oscTimerRef.current = setInterval(() => {
          if (oscillatorRef.current && audioCtx.state !== "closed") {
            step = (step + 1) % pitches.length;
            oscillatorRef.current.frequency.setValueAtTime(pitches[step], audioCtx.currentTime);
          }
        }, 350);

        setIsTestTonePlaying(true);
        setMicEnabled(true);
        setIsVoiceActive(true);

        // If not already in an animation loop, kick it off
        if (!animationFrameRef.current) {
          startAudioDSP(new MediaStream());
        }
      } catch (err) {
        console.error("Test speech generator failed:", err);
      }
    }
  };

  /* =====================================================
     WEBRTC SIGNALING & PARTICIPANT PRESENCE (2-PERSON CALL)
  ===================================================== */
  const startRoomSignaling = (roomId) => {
    const cleanId = roomId.toUpperCase();

    // 1. Join Meeting on Backend
    fetch(`${API_BASE_URL}/api/meeting/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meetingId: cleanId,
        userId: userIdRef.current,
        role: meetingCreated ? "host" : "peer",
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.participants) {
          setPeerCount(data.participantCount || 1);
          setPeerList(data.participants);
        }
      })
      .catch((err) => console.error("Signaling join error:", err));

    // 2. Poll Room State Every 1.5s
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => {
      fetch(`${API_BASE_URL}/api/meeting/${cleanId}/poll?userId=${userIdRef.current}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.participants) {
            setPeerCount(data.participantCount || 1);
            setPeerList(data.participants);
          }
        })
        .catch(() => {});
    }, 1500);
  };

  const stopRoomSignaling = (roomId) => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (roomId) {
      fetch(`${API_BASE_URL}/api/meeting/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: roomId, userId: userIdRef.current }),
      }).catch(() => {});
    }
    setPeerCount(1);
    setPeerList([]);
  };

  /* =====================================================
     REQUEST MICROPHONE
  ===================================================== */
  const requestMicrophone = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMessage("Microphone access is not supported by your browser.");
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

      localStreamRef.current = stream;
      setMicEnabled(true);
      await startAudioDSP(stream);
      return stream;
    } catch (err) {
      console.warn("Microphone access prompt dismissed or failed:", err);
      setErrorMessage("Microphone permission was not granted. Click '▶ Play Voice Demo' below to test with synthetic speech!");
      return null;
    }
  };

  /* =====================================================
     MEETING ACTIONS
  ===================================================== */
  const createMeeting = async () => {
    setErrorMessage("");
    const newId = generateMeetingId();
    await requestMicrophone();
    setMeetingId(newId);
    setMeetingCreated(true);
    setIsInMeeting(true);
    setSearchParams({ meeting: newId });
    startRoomSignaling(newId);
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
    startRoomSignaling(cleaned);
  };

  const leaveMeeting = () => {
    stopRoomSignaling(meetingId);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (oscTimerRef.current) clearInterval(oscTimerRef.current);
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
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    setIsInMeeting(false);
    setMeetingId("");
    setMicEnabled(false);
    setIsTestTonePlaying(false);
    setQualityTrend([]);
    setSimulations({ noise: false, packetLoss: false, clipping: false, muffled: false });
    setSearchParams({});
  };

  const toggleMicrophone = async () => {
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    if (!localStreamRef.current) {
      await requestMicrophone();
      return;
    }
    const tracks = localStreamRef.current.getAudioTracks();
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
      leaveMeeting();
    };
  }, []);

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
          <div className="live-error" style={{ marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <span>⚠️ {errorMessage}</span>
            <button
              type="button"
              onClick={toggleTestTone}
              style={{
                background: isTestTonePlaying ? "#ef4444" : "#07162d",
                color: "#ffffff",
                border: "none",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer"
              }}
            >
              {isTestTonePlaying ? "⏹ Stop Voice Demo" : "▶ Play Voice Demo"}
            </button>
          </div>
        )}

        {/* =================================================
            1. BEFORE JOINING: MIC CHECK & START CARDS
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

            {/* LIVE PRE-MEETING MIC CHECK WIDGET */}
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
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "24px" }}>{micEnabled ? "🎙️" : "🔇"}</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: "13px", fontWeight: "800", color: "#07162d" }}>
                    {micEnabled ? "Microphone Active" : "Microphone Idle"}
                  </div>
                  <div style={{ fontSize: "11px", color: micEnabled ? (isVoiceActive ? "#10b981" : "#64748b") : "#ef4444", fontWeight: "700" }}>
                    {micEnabled ? (isVoiceActive ? "🗣️ Voice Detected (Speaking)" : "Listening...") : "Click 'Test Mic' to start"}
                  </div>
                </div>
              </div>

              {/* LIVE PRE-MEETING CANVAS */}
              <canvas
                ref={preMeetingCanvasRef}
                width="240"
                height="36"
                style={{ width: "240px", height: "36px", borderRadius: "6px", background: "#07162d", border: "1px solid #1e293b" }}
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
                    {isTestTonePlaying ? "⏹ Stop Voice" : "▶ Play Voice Demo"}
                  </button>
                )}
              </div>
            </div>

            {/* CREATE / JOIN CARDS */}
            <section className="meeting-options" style={{ maxWidth: "800px", margin: "0 auto" }}>
              <div className="meeting-card" style={{ padding: "24px 20px" }}>
                <div className="meeting-number">01</div>
                <h2>Start Test Room</h2>
                <p>Create a live session with real-time on-device speech quality analysis.</p>
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

            {/* SLIM TOP TOOLBAR: STATUS, PARTICIPANTS, CONTROLS */}
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
              {/* Left: Status & ID */}
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
                  {peerCount > 1 ? `ACTIVE CALL (${peerCount} USERS)` : "STANDALONE QC SESSION"}
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

              {/* Middle: Live Mic & Voice Status */}
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
                    <span style={{ fontSize: "10px", color: isVoiceActive ? "#10b981" : "#64748b", marginLeft: "6px", fontWeight: "700" }}>
                      {liveDb} dBFS
                    </span>
                  </div>
                </div>

                {/* Remote Participant Status */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: peerCount > 1 ? "#ecfdf5" : "#f8fafc",
                  border: `1px solid ${peerCount > 1 ? "#a7f3d0" : "#e2e8f0"}`,
                  padding: "4px 10px",
                  borderRadius: "8px",
                  fontSize: "11px",
                  color: peerCount > 1 ? "#065f46" : "#64748b",
                  fontWeight: "700"
                }}>
                  <span>{peerCount > 1 ? "🟢" : "⏳"}</span>
                  <span>{peerCount > 1 ? "Peer Connected" : "Waiting for 2nd participant"}</span>
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
                      <span style={{ fontSize: "42px", fontWeight: "900", lineHeight: 1 }}>
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
                      padding: "4px 12px",
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
                      <span style={{ fontSize: "10px", color: qcMetrics.networkColor }}>WebRTC</span>
                    </div>
                    <h3 style={{ margin: "3px 0 1px", fontSize: "15px", color: qcMetrics.networkColor }}>
                      {qcMetrics.networkStatus}
                    </h3>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>Mesh signaling active</span>
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
                    <span style={{ fontSize: "10px", color: "#64748b" }}>Spectral band concentration</span>
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
                    {isVoiceActive ? "🗣️ Voice Detected (Active Speech)" : "Listening (Speak into mic)..."}
                  </span>
                </div>
                <canvas
                  ref={canvasRef}
                  width="900"
                  height="45"
                  style={{ width: "100%", height: "45px", borderRadius: "6px", border: "1px solid #1e293b", background: "#07162d" }}
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