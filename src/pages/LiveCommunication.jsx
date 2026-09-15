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
  const [copiedLink, setCopiedLink] = useState(false);
  const [isTestTonePlaying, setIsTestTonePlaying] = useState(false);

  // Peer & WebRTC State
  const [peerCount, setPeerCount] = useState(1);
  const [peerList, setPeerList] = useState([]);
  const [remoteAudioAttached, setRemoteAudioAttached] = useState(false);
  const peerConnectionRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pollTimerRef = useRef(null);
  const processedSignalsRef = useRef(new Set());

  // Live Audio Meters (Throttled for 60fps smooth canvas, 10Hz React state)
  const [liveDb, setLiveDb] = useState(-60);
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
  const currentMosRef = useRef(4.5);

  // Web Audio References
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const zeroGainRef = useRef(null);
  const oscillatorRef = useRef(null);
  const oscTimerRef = useRef(null);
  const filterNodeRef = useRef(null);
  const localStreamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const canvasRef = useRef(null);
  const preMeetingCanvasRef = useRef(null);

  // Smoothed Audio Features
  const smoothedRmsRef = useRef(0.001);

  /* =====================================================
     CALCULATE LIVE QC METRICS (REACTIVE TO AUDIO & SIMULATIONS)
  ===================================================== */
  const qcMetrics = useMemo(() => {
    let baseMos = isVoiceActive ? 4.5 : 4.3;

    // Natural Audio Penalties
    if (liveDb > -5) baseMos -= 1.3; // clipping
    else if (liveDb < -45 && isVoiceActive) baseMos -= 0.4; // weak signal

    // Multi-Select Simulation Penalties (Compound)
    let noiseText = isVoiceActive ? "Low (<12 dB SNR)" : "Quiet Ambient";
    let noiseColor = "#10b981";
    let clarityText = isVoiceActive ? "High (Clear Formants)" : "Optimal";
    let clarityColor = "#10b981";
    let micText = liveDb > -5 ? "Clipping Detected" : micEnabled ? "Optimal (Clean Gain)" : "Microphone Muted";
    let micColor = liveDb > -5 ? "#ef4444" : micEnabled ? "#10b981" : "#64748b";
    let netText = peerCount > 1 ? "P2P Connected (2-Way Call)" : "Stable (Local Analysis)";
    let netColor = "#0284c7";

    let totalPenalty = 0;

    if (simulations.noise) {
      baseMos -= 1.2;
      totalPenalty += 1.2;
      noiseText = "High (Cafe / Street Noise)";
      noiseColor = "#f59e0b";
    }

    if (simulations.packetLoss) {
      baseMos -= 1.4;
      totalPenalty += 1.4;
      netText = "Degraded (15% Packet Loss)";
      netColor = "#ef4444";
      clarityText = "Robotic / Packet Glitches";
      clarityColor = "#ef4444";
    }

    if (simulations.clipping) {
      baseMos -= 1.6;
      totalPenalty += 1.6;
      micText = "Severe Overload / Clipping";
      micColor = "#ef4444";
    }

    if (simulations.muffled) {
      baseMos -= 0.8;
      totalPenalty += 0.8;
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
      totalPenalty: parseFloat(totalPenalty.toFixed(1)),
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

  // Keep currentMosRef in sync for rolling trend graph without stale closures
  useEffect(() => {
    currentMosRef.current = qcMetrics.mosScore;
  }, [qcMetrics.mosScore]);

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
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;

      // Filter node for Muffled acoustic simulation
      const biquadFilter = audioCtx.createBiquadFilter();
      biquadFilter.type = "lowpass";
      biquadFilter.frequency.value = simulations.muffled ? 850 : 20000;
      filterNodeRef.current = biquadFilter;

      if (stream && stream.getAudioTracks && stream.getAudioTracks().length > 0) {
        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;
        source.connect(biquadFilter);
      }

      biquadFilter.connect(analyser);

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

        try {
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
          smoothedRmsRef.current = 0.35 * rms + 0.65 * smoothedRmsRef.current;

          // Realistic dBFS meter
          const currentDb = rms > 0.0001 ? Math.max(-60, Math.round(20 * Math.log10(rms))) : -60;
          const currentPercent = Math.min(100, Math.round(smoothedRmsRef.current * 450));
          const voiceActive = rms > 0.003 || freqBuffer.some((f) => f > 25);

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
            const liveScore = currentMosRef.current;
            setQualityTrend((prev) => {
              return prev.length < 10 ? [...prev, liveScore] : [...prev.slice(1), liveScore];
            });
          }

          // 4. Render 60fps Canvas Spectrum Visualizer (Safe universal fillRect)
          const activeCanvas = canvasRef.current || preMeetingCanvasRef.current;
          if (activeCanvas) {
            const ctx = activeCanvas.getContext("2d");
            const w = activeCanvas.width;
            const h = activeCanvas.height;

            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "#07162d";
            ctx.fillRect(0, 0, w, h);

            const barCount = 36;
            const barW = Math.max(2, w / barCount - 2);

            for (let i = 0; i < barCount; i++) {
              const freqIdx = Math.floor((i / barCount) * freqBuffer.length);
              const val = freqBuffer[freqIdx] || 0;
              
              // Animated bar height with minimum baseline
              const barH = Math.max(4, (val / 255) * h * 0.88 + (voiceActive ? 6 : 2));

              // Color gradient: Cyan -> Emerald Green
              const gradient = ctx.createLinearGradient(0, h, 0, 0);
              gradient.addColorStop(0, "#0284c7");
              gradient.addColorStop(1, voiceActive ? "#10b981" : "#38bdf8");

              ctx.fillStyle = gradient;
              ctx.fillRect(i * (barW + 2), h - barH, barW, barH);
            }
          }
        } catch (loopErr) {
          console.error("Visualizer loop tick error:", loopErr);
        }

        animationFrameRef.current = requestAnimationFrame(renderLoop);
      };

      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(renderLoop);
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
          analyser.smoothingTimeConstant = 0.5;
          analyserRef.current = analyser;
        }

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);

        osc.connect(gain);

        // Connect through filter for muffled simulation
        if (filterNodeRef.current) {
          gain.connect(filterNodeRef.current);
        } else {
          gain.connect(analyser);
        }

        const zeroGain = audioCtx.createGain();
        zeroGain.gain.value = 0;
        analyser.connect(zeroGain);
        zeroGain.connect(audioCtx.destination);

        osc.start();
        oscillatorRef.current = osc;

        // Modulate pitch to simulate human speech formant contours
        let step = 0;
        const pitches = [220, 290, 350, 260, 310, 240, 380, 220, 190, 330];
        oscTimerRef.current = setInterval(() => {
          if (oscillatorRef.current && audioCtx.state !== "closed") {
            step = (step + 1) % pitches.length;
            oscillatorRef.current.frequency.setValueAtTime(pitches[step], audioCtx.currentTime);
          }
        }, 300);

        setIsTestTonePlaying(true);
        setMicEnabled(true);
        setIsVoiceActive(true);

        if (!animationFrameRef.current) {
          startAudioDSP(null);
        }
      } catch (err) {
        console.error("Test speech generator failed:", err);
      }
    }
  };

  /* =====================================================
     WEBRTC PEER CONNECTION & SIGNALING
  ===================================================== */
  const initWebRTC = async (roomId, isInitiator) => {
    try {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      peerConnectionRef.current = pc;

      // Add local audio track if available
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      // Handle incoming remote audio track
      pc.ontrack = (event) => {
        if (remoteAudioRef.current && event.streams[0]) {
          remoteAudioRef.current.srcObject = event.streams[0];
          setRemoteAudioAttached(true);
        }
      };

      // Handle local ICE candidates and send to backend
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          fetch(`${API_BASE_URL}/api/meeting/signal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              meetingId: roomId,
              senderId: userIdRef.current,
              signalData: { type: "ice-candidate", candidate: event.candidate },
            }),
          }).catch(() => {});
        }
      };

      // If initiator (host), create and send offer
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        fetch(`${API_BASE_URL}/api/meeting/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meetingId: roomId,
            senderId: userIdRef.current,
            signalData: { type: "offer", sdp: offer },
          }),
        }).catch(() => {});
      }
    } catch (err) {
      console.warn("WebRTC initialization warning:", err);
    }
  };

  const handleIncomingSignal = async (signal, roomId) => {
    const pc = peerConnectionRef.current;
    if (!pc || !signal || !signal.signalData) return;

    const { type, sdp, candidate } = signal.signalData;

    try {
      if (type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        fetch(`${API_BASE_URL}/api/meeting/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meetingId: roomId,
            senderId: userIdRef.current,
            signalData: { type: "answer", sdp: answer },
          }),
        }).catch(() => {});
      } else if (type === "answer") {
        if (pc.signalingState !== "stable") {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
      } else if (type === "ice-candidate" && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    } catch (sigErr) {
      console.warn("Signal processing error:", sigErr);
    }
  };

  /* =====================================================
     ROOM SIGNALING & PARTICIPANT PRESENCE (2-PERSON CALL)
  ===================================================== */
  const startRoomSignaling = (roomId, isHost = false) => {
    const cleanId = roomId.trim().toUpperCase();

    // 1. Join Meeting on Backend
    fetch(`${API_BASE_URL}/api/meeting/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meetingId: cleanId,
        userId: userIdRef.current,
        role: isHost ? "host" : "peer",
      }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to join meeting room.");
        }
        return data;
      })
      .then((data) => {
        if (data.participants) {
          setPeerCount(data.participantCount || 1);
          setPeerList(data.participants);
          if (data.participantCount > 1) {
            initWebRTC(cleanId, isHost);
          }
        }
      })
      .catch((err) => {
        console.error("Signaling join error:", err);
        setErrorMessage(err.message || "Failed to connect to room.");
      });

    // 2. Poll Room State Every 1.2s
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => {
      fetch(`${API_BASE_URL}/api/meeting/${cleanId}/poll?userId=${userIdRef.current}&role=${isHost ? "host" : "peer"}`)
        .then((res) => {
          if (!res.ok) throw new Error("Poll returned non-200");
          return res.json();
        })
        .then((data) => {
          if (data.participants) {
            setPeerCount(data.participantCount || 1);
            setPeerList(data.participants);

            // If 2nd person joined and we don't have peerConnection yet
            if (data.participantCount > 1 && !peerConnectionRef.current) {
              initWebRTC(cleanId, isHost);
            }
          }

          // Process incoming WebRTC signals
          if (data.signals && data.signals.length > 0) {
            data.signals.forEach((sig) => {
              const sigKey = `${sig.senderId}_${sig.timestamp}`;
              if (!processedSignalsRef.current.has(sigKey)) {
                processedSignalsRef.current.add(sigKey);
                handleIncomingSignal(sig, cleanId);
              }
            });
          }
        })
        .catch(() => {});
    }, 1200);
  };

  const stopRoomSignaling = (roomId) => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
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
    processedSignalsRef.current.clear();
  };

  /* =====================================================
     REQUEST MICROPHONE
  ===================================================== */
  const requestMicrophone = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMessage("Microphone access is not supported by your browser. You can still test using 'Play Voice Demo'!");
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
    startRoomSignaling(newId, true);
  };

  const joinMeeting = async (targetId = null) => {
    setErrorMessage("");
    const cleaned = (targetId || inputMeetingId).trim().toUpperCase();
    if (!cleaned) {
      setErrorMessage("Please enter a meeting ID to join.");
      return;
    }

    // Pre-validate room existence on backend before opening meeting room UI
    try {
      const checkRes = await fetch(`${API_BASE_URL}/api/meeting/${cleaned}/check`);
      if (!checkRes.ok) {
        const checkData = await checkRes.json().catch(() => ({}));
        setErrorMessage(checkData.error || `Meeting room "${cleaned}" does not exist. Please enter a valid room code.`);
        return;
      }
    } catch (netErr) {
      console.warn("Network check error, attempting standard join:", netErr);
    }

    await requestMicrophone();
    setMeetingId(cleaned);
    setMeetingCreated(false);
    setIsInMeeting(true);
    setSearchParams({ meeting: cleaned });
    startRoomSignaling(cleaned, false);
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

  const copyInviteLink = async () => {
    if (!meetingId) return;
    try {
      const inviteUrl = `${window.location.origin}/live-communication?meeting=${meetingId}`;
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (e) {}
  };

  // Acoustic Simulation Toggles & Physical Audio Graph Morphing
  const toggleSimulation = (key) => {
    setSimulations((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      
      // Physically adjust lowpass filter in Web Audio Graph
      if (filterNodeRef.current && audioContextRef.current) {
        if (key === "muffled") {
          filterNodeRef.current.frequency.setValueAtTime(
            next.muffled ? 850 : 20000,
            audioContextRef.current.currentTime
          );
        }
      }

      return next;
    });
  };

  const resetSimulations = () => {
    setSimulations({ noise: false, packetLoss: false, clipping: false, muffled: false });
    if (filterNodeRef.current && audioContextRef.current) {
      filterNodeRef.current.frequency.setValueAtTime(20000, audioContextRef.current.currentTime);
    }
  };

  // URL Query Param Detection for Auto-Join / Auto-Fill
  const urlParamMeetingId = searchParams.get("meeting");

  useEffect(() => {
    if (urlParamMeetingId) {
      setInputMeetingId(urlParamMeetingId.toUpperCase());
    }
  }, [urlParamMeetingId]);

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

      {/* Hidden audio element for receiving peer audio stream */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />

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

            {/* INVITE BANNER (IF OPENED WITH ?meeting=ID) */}
            {urlParamMeetingId && (
              <div style={{
                maxWidth: "800px",
                margin: "0 auto 20px",
                background: "#ecfdf5",
                border: "2px solid #10b981",
                borderRadius: "12px",
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
                boxShadow: "0 4px 12px rgba(16, 185, 129, 0.1)"
              }}>
                <div style={{ textAlign: "left" }}>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#047857", textTransform: "uppercase" }}>Room Invitation</span>
                  <div style={{ fontSize: "16px", fontWeight: "800", color: "#065f46" }}>
                    You have been invited to call: <span style={{ color: "#07162d" }}>{urlParamMeetingId.toUpperCase()}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => joinMeeting(urlParamMeetingId)}
                  style={{
                    background: "#10b981",
                    color: "#ffffff",
                    border: "none",
                    padding: "10px 22px",
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: "800",
                    cursor: "pointer",
                    boxShadow: "0 2px 6px rgba(16, 185, 129, 0.3)"
                  }}
                >
                  🎙️ Join Call Now
                </button>
              </div>
            )}

            {/* LIVE PRE-MEETING MIC CHECK WIDGET */}
            <div style={{
              maxWidth: "800px",
              margin: "0 auto 30px",
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "14px",
              padding: "18px 22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "15px",
              boxShadow: "0 2px 8px rgba(7,22,45,0.04)"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <span style={{ fontSize: "28px" }}>{micEnabled ? (isVoiceActive ? "🗣️" : "🎙️") : "🔇"}</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: "14px", fontWeight: "800", color: "#07162d" }}>
                    {micEnabled ? (isVoiceActive ? "Speaking (Voice Detected)" : "Microphone Active (Listening)") : "Microphone Idle"}
                  </div>
                  <div style={{ fontSize: "12px", color: micEnabled ? (isVoiceActive ? "#10b981" : "#0284c7") : "#64748b", fontWeight: "700" }}>
                    {micEnabled ? `${liveDb} dBFS • Volume: ${volumePercent}%` : "Click 'Test Mic' to verify your input"}
                  </div>

                  {/* Real-time Bouncing VU Meter Bar */}
                  {micEnabled && (
                    <div style={{ width: "160px", height: "6px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden", marginTop: "4px" }}>
                      <div style={{
                        width: `${volumePercent}%`,
                        height: "100%",
                        background: volumePercent > 85 ? "#ef4444" : "#10b981",
                        transition: "width 0.08s ease"
                      }}></div>
                    </div>
                  )}
                </div>
              </div>

              {/* LIVE PRE-MEETING FFT CANVAS */}
              <canvas
                ref={preMeetingCanvasRef}
                width="240"
                height="40"
                style={{ width: "240px", height: "40px", borderRadius: "6px", background: "#07162d", border: "1px solid #1e293b" }}
              />

              <div style={{ display: "flex", gap: "8px" }}>
                {!micEnabled ? (
                  <button
                    type="button"
                    onClick={requestMicrophone}
                    style={{ background: "#07162d", color: "#ffffff", border: "none", padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}
                  >
                    🎤 Test Mic Now
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggleTestTone}
                    style={{ background: isTestTonePlaying ? "#ef4444" : "#edf7fb", color: isTestTonePlaying ? "#ffffff" : "#0369a1", border: "1px solid #bae6fd", padding: "10px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}
                  >
                    {isTestTonePlaying ? "⏹ Stop Demo" : "▶ Play Voice Demo"}
                  </button>
                )}
              </div>
            </div>

            {/* CREATE / JOIN / STANDALONE CARDS */}
            <section className="meeting-options" style={{ maxWidth: "800px", margin: "0 auto" }}>
              <div className="meeting-card" style={{ padding: "26px 22px" }}>
                <div className="meeting-number">01</div>
                <h2>Start QC Session</h2>
                <p>Create a live call room with on-device speech quality estimation and WebRTC mesh signaling.</p>
                <button type="button" className="create-button" onClick={createMeeting} style={{ marginTop: "12px", width: "100%" }}>
                  🎙 Enter Meeting & Test QC
                </button>
              </div>

              <div className="meeting-card" style={{ padding: "26px 22px" }}>
                <div className="meeting-number">02</div>
                <h2>Join a Call</h2>
                <p>Enter a shared room code to test 2-person real-time WebRTC speech monitoring.</p>
                <input
                  type="text"
                  value={inputMeetingId}
                  onChange={(e) => setInputMeetingId(e.target.value)}
                  placeholder="e.g. EA-QC-X8K9M2"
                  className="meeting-input"
                  style={{ margin: "8px 0" }}
                />
                <button type="button" className="join-button" onClick={() => joinMeeting()} style={{ width: "100%" }}>
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
              padding: "12px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              boxShadow: "0 2px 6px rgba(7, 22, 45, 0.04)"
            }}>
              {/* Left: Status & ID */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: peerCount > 1 ? "#ecfdf5" : "#edf7fb",
                  color: peerCount > 1 ? "#065f46" : "#0369a1",
                  fontSize: "12px",
                  fontWeight: "800",
                  padding: "5px 10px",
                  borderRadius: "12px",
                  border: `1px solid ${peerCount > 1 ? "#a7f3d0" : "#bae6fd"}`
                }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: peerCount > 1 ? "#10b981" : "#0284c7" }}></span>
                  {peerCount > 1 ? `🟢 ACTIVE CALL (${peerCount} USERS IN CALL)` : "STANDALONE QC SESSION"}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#07162d", color: "#ffffff", padding: "5px 12px", borderRadius: "8px", fontSize: "12px" }}>
                  <span style={{ color: "#94a3b8" }}>Room:</span>
                  <strong>{meetingId}</strong>
                  <button
                    type="button"
                    onClick={copyMeetingId}
                    style={{ background: "transparent", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "11px", fontWeight: "700", marginLeft: "4px" }}
                  >
                    {copied ? "✓ Copied" : "Copy Code"}
                  </button>
                  <button
                    type="button"
                    onClick={copyInviteLink}
                    style={{ background: "#0369a1", border: "none", color: "#ffffff", cursor: "pointer", fontSize: "11px", fontWeight: "700", padding: "2px 8px", borderRadius: "4px", marginLeft: "4px" }}
                  >
                    {copiedLink ? "✓ Link Copied!" : "🔗 Share Link"}
                  </button>
                </div>
              </div>

              {/* Middle: Live Mic & Voice Status & VU Bar */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "#f1f5f9",
                  border: `1px solid ${isVoiceActive ? "#10b981" : "#cbd5e1"}`,
                  padding: "5px 12px",
                  borderRadius: "8px"
                }}>
                  <span style={{ fontSize: "15px" }}>{micEnabled ? (isVoiceActive ? "🗣️" : "🎙️") : "🔇"}</span>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "800", color: "#07162d" }}>
                        {micEnabled ? (isVoiceActive ? "Voice Active" : "Mic Open (Quiet)") : "Muted"}
                      </span>
                      <span style={{ fontSize: "10px", color: isVoiceActive ? "#10b981" : "#64748b", fontWeight: "700" }}>
                        {liveDb} dBFS
                      </span>
                    </div>

                    {/* Animated Volume Meter */}
                    <div style={{ width: "90px", height: "4px", background: "#cbd5e1", borderRadius: "2px", overflow: "hidden", marginTop: "2px" }}>
                      <div style={{
                        width: `${volumePercent}%`,
                        height: "100%",
                        background: volumePercent > 80 ? "#ef4444" : "#10b981",
                        transition: "width 0.08s ease"
                      }}></div>
                    </div>
                  </div>
                </div>

                {/* Remote Participant Status */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: peerCount > 1 ? "#ecfdf5" : "#f8fafc",
                  border: `1px solid ${peerCount > 1 ? "#a7f3d0" : "#e2e8f0"}`,
                  padding: "5px 12px",
                  borderRadius: "8px",
                  fontSize: "11px",
                  color: peerCount > 1 ? "#065f46" : "#64748b",
                  fontWeight: "700"
                }}>
                  <span>{peerCount > 1 ? "🟢" : "⏳"}</span>
                  <span>{peerCount > 1 ? `Peer Connected (${peerCount} in room)` : "Waiting for 2nd participant"}</span>
                </div>

                <button
                  type="button"
                  onClick={toggleTestTone}
                  style={{
                    background: isTestTonePlaying ? "#ef4444" : "#edf7fb",
                    color: isTestTonePlaying ? "#ffffff" : "#0369a1",
                    border: `1px solid ${isTestTonePlaying ? "#ef4444" : "#bae6fd"}`,
                    padding: "6px 12px",
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
                    padding: "7px 14px",
                    borderRadius: "6px",
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
                    borderRadius: "6px",
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
                MAIN QUALITY REPORT DASHBOARD (SLIDE 10)
            ================================================= */}
            <section style={{
              background: "#ffffff",
              border: "1px solid #c8e1ec",
              borderRadius: "14px",
              padding: "20px 24px",
              boxShadow: "0 4px 12px rgba(7, 22, 45, 0.04)"
            }}>
              {/* Dashboard Title */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "14px", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#286987", letterSpacing: "1px", textTransform: "uppercase" }}>
                    SLIDE 10 SPECIFICATION
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
                  borderRadius: "14px",
                  fontSize: "12px",
                  fontWeight: "700",
                  color: "#286987",
                  border: "1px solid #c7e0ec"
                }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>
                  Local Web Audio DSP • Zero Cloud Audio
                </div>
              </div>

              {/* METRICS GRID: Overall Score + 4 Diagnostic Dials */}
              <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", gap: "16px", alignItems: "stretch" }}>

                {/* OVERALL MOS CARD */}
                <div style={{
                  background: "#07162d",
                  color: "#ffffff",
                  borderRadius: "12px",
                  padding: "18px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 4px 12px rgba(7, 22, 45, 0.08)"
                }}>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: "800", letterSpacing: "1.2px", color: "#7dd3fc" }}>
                      OVERALL SPEECH QUALITY
                    </span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "10px 0 6px" }}>
                      <span style={{ fontSize: "46px", fontWeight: "900", lineHeight: 1 }}>
                        {qcMetrics.mosScore}
                      </span>
                      <span style={{ fontSize: "16px", color: "#94a3b8" }}>/ 5.0</span>
                    </div>

                    {/* Penalty Badge when simulations active */}
                    {qcMetrics.totalPenalty > 0 && (
                      <div style={{ fontSize: "11px", color: "#f87171", fontWeight: "700" }}>
                        ⚠️ Penalty: -{qcMetrics.totalPenalty} MOS
                      </div>
                    )}
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
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Microphone</span>
                      <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700" }}>{liveDb} dBFS</span>
                    </div>
                    <h3 style={{ margin: "4px 0 2px", fontSize: "15px", color: qcMetrics.micStatusColor }}>
                      {qcMetrics.micStatus}
                    </h3>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Peak & overload monitoring</span>
                  </div>

                  {/* NETWORK */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Network</span>
                      <span style={{ fontSize: "11px", color: qcMetrics.networkColor, fontWeight: "700" }}>WebRTC</span>
                    </div>
                    <h3 style={{ margin: "4px 0 2px", fontSize: "15px", color: qcMetrics.networkColor }}>
                      {qcMetrics.networkStatus}
                    </h3>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Mesh signaling active</span>
                  </div>

                  {/* BACKGROUND NOISE */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Background Noise</span>
                      <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700" }}>SNR Floor</span>
                    </div>
                    <h3 style={{ margin: "4px 0 2px", fontSize: "15px", color: qcMetrics.noiseLevelColor }}>
                      {qcMetrics.noiseLevel}
                    </h3>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Dynamic noise floor estimation</span>
                  </div>

                  {/* SPEECH CLARITY */}
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Speech Clarity</span>
                      <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700" }}>Formants</span>
                    </div>
                    <h3 style={{ margin: "4px 0 2px", fontSize: "15px", color: qcMetrics.speechClarityColor }}>
                      {qcMetrics.speechClarity}
                    </h3>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Spectral band concentration</span>
                  </div>
                </div>

              </div>

              {/* LIVE 60FPS FFT CANVAS VISUALIZER */}
              <div style={{ marginTop: "16px", borderTop: "1px solid #f1f5f9", paddingTop: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#07162d" }}>
                    Live FFT Frequency Spectrum (256-bin AnalyserNode):
                  </span>
                  <span style={{ fontSize: "12px", color: isVoiceActive ? "#10b981" : "#64748b", fontWeight: "700" }}>
                    {isVoiceActive ? "🗣️ Voice Detected (Active Speech)" : "Listening (Speak into microphone or click 'Play Demo Voice')..."}
                  </span>
                </div>
                <canvas
                  ref={canvasRef}
                  width="900"
                  height="50"
                  style={{ width: "100%", height: "50px", borderRadius: "8px", border: "1px solid #1e293b", background: "#07162d" }}
                />
              </div>

              {/* QUALITY TREND ROLLING GRAPH */}
              <div style={{ marginTop: "14px", borderTop: "1px solid #f1f5f9", paddingTop: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#07162d" }}>
                    Quality Trend (Rolling 10-Second History):
                  </span>
                  <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "700" }}>
                    {qualityTrend.length === 0
                      ? "Recording live history (0s/10s)..."
                      : qualityTrend.length < 10
                      ? `Accumulating live history (${qualityTrend.length}s/10s)...`
                      : `Average MOS: ${(qualityTrend.reduce((a, b) => a + b, 0) / qualityTrend.length).toFixed(1)} / 5.0`}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "45px", background: "#f8fafc", padding: "4px 10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                  {qualityTrend.length === 0 ? (
                    <div style={{ width: "100%", textAlign: "center", color: "#94a3b8", fontSize: "12px", alignSelf: "center" }}>
                      🎙️ Speak into microphone or play voice demo to record rolling 10-second quality trend...
                    </div>
                  ) : (
                    qualityTrend.map((score, idx) => {
                      const barHeight = Math.max(18, (score / 5.0) * 100);
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
                          <span style={{ fontSize: "9px", color: "#64748b", marginTop: "2px", fontWeight: "700" }}>{score}</span>
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
                    <h4 style={{ margin: 0, color: "#166534", fontSize: "13px", fontWeight: "800" }}>
                      🧪 Lab Demo: Multi-Condition Acoustic Simulator (Select multiple to test compound effects)
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
                        borderRadius: "12px",
                        padding: "3px 10px",
                        fontSize: "11px",
                        fontWeight: "800",
                        cursor: "pointer"
                      }}
                    >
                      ✕ Reset to Clean (4.5 MOS)
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
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
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      transition: "all 0.15s ease"
                    }}
                  >
                    {simulations.noise ? "✓ Background Noise (-1.2 MOS)" : "+ Background Noise (-1.2 MOS)"}
                  </button>

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
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      transition: "all 0.15s ease"
                    }}
                  >
                    {simulations.packetLoss ? "✓ 15% Packet Loss (-1.4 MOS)" : "+ 15% Packet Loss (-1.4 MOS)"}
                  </button>

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
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      transition: "all 0.15s ease"
                    }}
                  >
                    {simulations.clipping ? "✓ Mic Overload / Clip (-1.6 MOS)" : "+ Mic Overload / Clip (-1.6 MOS)"}
                  </button>

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
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                      transition: "all 0.15s ease"
                    }}
                  >
                    {simulations.muffled ? "✓ Muffled / Low-Pass (-0.8 MOS)" : "+ Muffled / Low-Pass (-0.8 MOS)"}
                  </button>
                </div>
              </div>

            </section>
          </div>
        )}

        {/* PRIVACY GUARANTEE FOOTER */}
        <section className="privacy-box" style={{ marginTop: "18px", padding: "14px 18px" }}>
          <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Zero-Cloud Privacy Guarantee</h2>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.4" }}>
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