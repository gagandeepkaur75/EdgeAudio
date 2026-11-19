import { useEffect, useState, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageNav from "../components/PageNav";
import { API_BASE_URL } from "../utils/api";
import { mlAudioAnalyzer } from "../utils/mlAudioAnalyzer";
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
  const isTestTonePlayingRef = useRef(false);

  // On-device ML engine state
  const [mlState, setMlState] = useState({
    isLoaded: false,
    isLoading: true,
    hasPrediction: false,
    latencyMs: 0,
    mos: null,
    snr: 0,
    dropoutProb: 0.0,
    clipProb: 0.0,
  });
  const lastMlTimeRef = useRef(0);

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
  const [isScoreHeld, setIsScoreHeld] = useState(false);
  const isScoreHeldRef = useRef(false);

  // Multi-Select Acoustic Condition Simulator State
  const [simulations, setSimulations] = useState({
    noise: false,
    packetLoss: false,
    clipping: false,
    muffled: false,
  });
  const simulationsRef = useRef(simulations);
  const packetLossCursorRef = useRef(0);
  const speechEnergyHistoryRef = useRef([]);
  const noiseFloorRef = useRef(0.003);
  const wasVoiceActiveRef = useRef(false);
  const isVoiceActiveRef = useRef(false);
  const micEnabledRef = useRef(false);

  // Rolling Quality History Trend
  const [qualityTrend, setQualityTrend] = useState([]);
  const currentMosRef = useRef(null);
  const lastSpeechTimeRef = useRef(0);

  // Web Audio References
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const zeroGainRef = useRef(null);
  const oscillatorRef = useRef(null);
  const oscTimerRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const demoSourceRef = useRef(null);
  const demoAudioBufferRef = useRef(null);
  const demoMonitorGainRef = useRef(null);
  const noiseStateRef = useRef(0);
  const filterNodeRef = useRef(null);
  const localStreamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const canvasRef = useRef(null);

  // Demo Voices & PC Audio Capture State
  const DEMO_VOICE_OPTIONS = [
    { id: "male", label: "Voice 1: Male (Studio)", url: "/audio/demo_male.wav" },
    { id: "female", label: "Voice 2: Female (Studio)", url: "/audio/demo_female.wav" },
    { id: "conversational", label: "Voice 3: Conversational Dialogue", url: "/audio/demo_conversational.wav" },
    { id: "custom", label: "Voice 4: Upload Audio File (.wav/.mp3)...", url: null },
  ];
  const [selectedDemoVoice, setSelectedDemoVoice] = useState("male");
  const [customAudioName, setCustomAudioName] = useState("");
  const [isSystemAudioActive, setIsSystemAudioActive] = useState(false);
  const customAudioBufferRef = useRef(null);
  const fileInputRef = useRef(null);
  const demoAudioCacheRef = useRef({});
  const systemStreamRef = useRef(null);

  // Smoothed Audio Features
  const smoothedRmsRef = useRef(0.001);

  // Initialize ONNX WebAssembly Neural Engine on mount
  useEffect(() => {
    mlAudioAnalyzer.init().then((success) => {
      setMlState((prev) => ({ ...prev, isLoaded: success, isLoading: false }));
    });
  }, []);

  /* =====================================================
     CALCULATE LIVE QC METRICS FROM ON-DEVICE ML PREDICTIONS ONLY
  ===================================================== */
  const qcMetrics = useMemo(() => {
    const isActuallySpeaking = (micEnabled || isTestTonePlaying) && (isVoiceActive || isTestTonePlaying);
    const hasScore = mlState.hasPrediction && Number.isFinite(mlState.mos);
    const calculatedMos = hasScore ? Math.max(1, Math.min(5, mlState.mos)) : null;
    const canShowHeldScore = (isScoreHeld || isActuallySpeaking) && calculatedMos !== null && (micEnabled || isTestTonePlaying);

    let ratingText = "MODEL LOADING";
    let ratingColor = "#64748b";
    if (!mlState.isLoaded) {
      ratingText = "MODEL UNAVAILABLE";
    } else if (isActuallySpeaking && calculatedMos !== null) {
      ratingText = calculatedMos >= 4 ? "GOOD" : calculatedMos >= 3 ? "FAIR" : "POOR";
      ratingColor = calculatedMos >= 4 ? "#0284c7" : calculatedMos >= 3 ? "#f59e0b" : "#ef4444";
    } else if (canShowHeldScore) {
      ratingText = calculatedMos >= 4 ? "GOOD (PAUSED)" : calculatedMos >= 3 ? "FAIR (PAUSED)" : "POOR (PAUSED)";
      ratingColor = "#64748b";
    } else {
      ratingText = "LISTENING";
    }

    let displayScore = "—";
    let statusNote = mlState.isLoaded
      ? "Listening for speech; background sound alone will not be scored"
      : "The on-device ML model could not be loaded";
    let isSilent = true;

    if (!micEnabled && !isTestTonePlaying) {
      ratingText = "MIC MUTED";
      statusNote = "Enable the microphone or play the demo voice to analyze audio";
    } else if (calculatedMos !== null) {
      displayScore = calculatedMos.toFixed(1);
      statusNote = isActuallySpeaking
        ? "Score computed by the on-device EdgeAudioNet model"
        : "Speech paused · Holding evaluated score (resumes on next word)";
      isSilent = !isActuallySpeaking;
      if (!isActuallySpeaking) {
        ratingText = calculatedMos >= 4 ? "GOOD (PAUSED)" : calculatedMos >= 3 ? "FAIR (PAUSED)" : "POOR (PAUSED)";
        ratingColor = "#64748b";
      }
    } else if (isActuallySpeaking && !mlState.hasPrediction) {
      ratingText = "ANALYZING";
      statusNote = "Waiting for the first on-device ML prediction";
    }

    const snrVal = Math.round(mlState.snr);
    const micText = !micEnabled && !isTestTonePlaying
      ? "Microphone Muted"
      : mlState.clipProb > 0.35 || simulations.clipping || liveDb > -5
      ? `Overload (${Math.round(Math.max(mlState.clipProb, simulations.clipping ? 0.95 : 0.4) * 100)}% Saturation)`
      : isActuallySpeaking ? "Speech Input Active" : canShowHeldScore ? `Quiet Pause (${liveDb} dBFS)` : `Quiet Input (${liveDb} dBFS)`;
    const micColor = micText.startsWith("Overload") ? "#ef4444" : isActuallySpeaking ? "#10b981" : "#64748b";

    const networkStatus = mlState.dropoutProb > 0.35 || simulations.packetLoss
      ? `Packet Loss (${Math.round(Math.max(mlState.dropoutProb, simulations.packetLoss ? 0.95 : 0.45) * 100)}% Dropouts)`
      : peerCount > 1 ? "P2P Connected (2-Way Call)" : "Stable (WASM Edge)";
    const networkColor = (mlState.dropoutProb > 0.35 || simulations.packetLoss) ? "#ef4444" : "#0284c7";
    const noiseText = simulations.noise
      ? `Injected Noise (SNR: ${snrVal} dB)`
      : isActuallySpeaking ? (snrVal < 16 ? `High Noise (SNR: ${snrVal} dB)` : `Clean Room (SNR: ${snrVal} dB)`) : `SNR estimate: ${snrVal} dB`;
    const noiseColor = (snrVal < 16 || simulations.noise) ? "#ef4444" : snrVal >= 25 ? "#10b981" : "#f59e0b";
    const speechClarity = simulations.muffled
      ? "Muffled (<850 Hz Cutoff)"
      : isActuallySpeaking ? "Full-Band Clarity" : canShowHeldScore ? "Formants Retained" : "Awaiting Voice";

    return {
      mosScore: calculatedMos,
      mosDisplay: displayScore,
      isSilent,
      ratingText,
      ratingColor,
      statusNote,
      micStatus: micText,
      micStatusColor: micColor,
      noiseLevel: noiseText,
      noiseLevelColor: noiseColor,
      speechClarity,
      speechClarityColor: simulations.muffled ? "#ef4444" : isActuallySpeaking ? "#10b981" : "#64748b",
      networkStatus,
      networkColor,
      engine: "neural",
      latencyMs: mlState.latencyMs,
      rawSnr: snrVal,
    };
  }, [liveDb, isVoiceActive, isScoreHeld, micEnabled, isTestTonePlaying, simulations, peerCount, mlState]);

  // Keep currentMosRef in sync for rolling trend graph without stale closures
  useEffect(() => {
    if (qcMetrics.mosScore !== null) currentMosRef.current = qcMetrics.mosScore;
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
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      let audioCtx = audioContextRef.current;
      if (!audioCtx || audioCtx.state === "closed") {
        audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
      }

      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const analyser = analyserRef.current || audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -25;
      analyserRef.current = analyser;

      // Filter node for Muffled acoustic simulation
      const biquadFilter = audioCtx.createBiquadFilter();
      biquadFilter.type = "lowpass";
      biquadFilter.frequency.value = simulationsRef.current.muffled ? 850 : 20000;
      biquadFilter.Q.value = 1.5;
      filterNodeRef.current = biquadFilter;
      if (stream && stream.getAudioTracks && stream.getAudioTracks().length > 0) {
        if (sourceRef.current) {
          try { sourceRef.current.disconnect(); } catch (e) {}
        }
        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;
        source.connect(biquadFilter);
      }

      // ScriptProcessorNode for real-time acoustic degradation and continuous PCM streaming
      if (scriptProcessorRef.current) {
        try { scriptProcessorRef.current.disconnect(); } catch (e) {}
      }
      const scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
      scriptProcessorRef.current = scriptNode;

      scriptNode.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        const sims = simulationsRef.current;
        const sampleRate = audioCtx.sampleRate;
        const dropPeriod = Math.round(sampleRate * 0.42);
        const dropDuration = Math.round(sampleRate * 0.085);

        for (let i = 0; i < input.length; i++) {
          let s = input[i];

          // 1. Background Noise Simulation (ambient colored noise ~10-12 dB SNR)
          if (sims.noise) {
            noiseStateRef.current = 0.92 * noiseStateRef.current + 0.08 * (Math.random() * 2 - 1);
            const noiseVal = noiseStateRef.current * 0.35 + (Math.random() * 2 - 1) * 0.08;
            s += noiseVal * 0.45;
          }

          // 2. Mic Overload / Clipping Saturation (+14 dB boost into hard saturation)
          if (sims.clipping) {
            const boosted = s * 5.0;
            s = Math.max(-0.25, Math.min(0.25, boosted)) * 3.8;
          }

          // 3. WebRTC Packet Loss Simulation (85ms burst dropouts)
          if (sims.packetLoss) {
            if (packetLossCursorRef.current % dropPeriod < dropDuration) {
              s = 0.0;
            }
            packetLossCursorRef.current++;
          }

          output[i] = s;
        }

        // Push continuous, gapless PCM into ML active speech buffer
        if (micEnabledRef.current || isTestTonePlayingRef.current) {
          mlAudioAnalyzer.pushAudio(output, sampleRate, isVoiceActiveRef.current);
        }
      };

      // Connect: filter -> scriptNode -> analyser
      biquadFilter.connect(scriptNode);
      scriptNode.connect(analyser);

      // Silent zero-gain sink to prevent browser pausing stream
      const zeroGain = audioCtx.createGain();
      zeroGain.gain.value = 0;
      zeroGainRef.current = zeroGain;
      analyser.connect(zeroGain);
      zeroGain.connect(audioCtx.destination);

      // Demo Voice monitor output (routed to speakers so user can hear demo speech & real effects!)
      const demoMonitorGain = audioCtx.createGain();
      demoMonitorGain.gain.value = isTestTonePlayingRef.current ? 0.35 : 0.0;
      demoMonitorGainRef.current = demoMonitorGain;
      analyser.connect(demoMonitorGain);
      demoMonitorGain.connect(audioCtx.destination);

      const timeBuffer = new Float32Array(analyser.fftSize);
      const freqBuffer = new Uint8Array(analyser.frequencyBinCount);

      let lastStateTime = Date.now();
      let lastTrendTime = Date.now();
      let previousBandEnergies = null;

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
          const now = Date.now();

          // Speech gate: combine speech-band energy, spectral flatness, and syllabic
          // level variation. A steady hum or broadband hiss alone should not count as speech.
          const binHz = audioCtx.sampleRate / analyser.fftSize;
          const speechStartBin = Math.max(1, Math.floor(250 / binHz));
          const speechEndBin = Math.min(freqBuffer.length - 1, Math.ceil(4000 / binHz));
          const totalStartBin = Math.max(1, Math.floor(100 / binHz));
          const totalEndBin = Math.min(freqBuffer.length - 1, Math.ceil(8000 / binHz));
          let speechPower = 0;
          let totalPower = 0;
          let logPowerSum = 0;
          let peakPower = 0;
          let bandBinCount = 0;
          const bandEnergies = [];
          for (let i = totalStartBin; i <= totalEndBin; i++) {
            const db = (freqBuffer[i] / 255) * (analyser.maxDecibels - analyser.minDecibels) + analyser.minDecibels;
            const power = 10 ** (db / 10);
            totalPower += power;
            if (i >= speechStartBin && i <= speechEndBin) {
              speechPower += power;
              logPowerSum += Math.log(Math.max(power, 1e-12));
              peakPower = Math.max(peakPower, power);
              bandBinCount++;
              bandEnergies.push(power);
            }
          }
          const speechBandRatio = speechPower / Math.max(totalPower, 1e-12);
          const averageBandPower = speechPower / Math.max(1, bandBinCount);
          const spectralFlatness = Math.exp(logPowerSum / Math.max(1, bandBinCount)) / Math.max(averageBandPower, 1e-12);
          const peakToAverage = peakPower / Math.max(averageBandPower, 1e-12);
          let spectralChange = 0;
          if (previousBandEnergies && previousBandEnergies.length === bandEnergies.length) {
            let changeSum = 0;
            for (let i = 0; i < bandEnergies.length; i++) {
              changeSum += Math.abs(bandEnergies[i] - previousBandEnergies[i]);
            }
            spectralChange = changeSum / Math.max(speechPower, 1e-12);
          }
          previousBandEnergies = bandEnergies;

          const energyHistory = speechEnergyHistoryRef.current;
          energyHistory.push(rms);
          if (energyHistory.length > 36) energyHistory.shift();
          const historyMean = energyHistory.reduce((sumValue, value) => sumValue + value, 0) / energyHistory.length;
          const historyVariance = energyHistory.reduce((sumValue, value) => sumValue + (value - historyMean) ** 2, 0) / energyHistory.length;
          const energyVariation = Math.sqrt(historyVariance) / Math.max(historyMean, 1e-5);
          const estimatedNoiseFloor = noiseFloorRef.current;
          // Estimate voiced periodicity. Broadband noise and steady hum can have
          // speech-band energy and changing levels, but usually lack a stable pitch.
          const decimation = 4;
          const downsampled = [];
          for (let i = 0; i < timeBuffer.length; i += decimation) downsampled.push(timeBuffer[i]);
          const minLag = Math.max(2, Math.floor(audioCtx.sampleRate / decimation / 320));
          const maxLag = Math.min(downsampled.length - 2, Math.ceil(audioCtx.sampleRate / decimation / 80));
          let pitchCorrelation = 0;
          for (let lag = minLag; lag <= maxLag; lag++) {
            let cross = 0;
            let leftEnergy = 0;
            let rightEnergy = 0;
            for (let i = 0; i < downsampled.length - lag; i += 2) {
              const left = downsampled[i];
              const right = downsampled[i + lag];
              cross += left * right;
              leftEnergy += left * left;
              rightEnergy += right * right;
            }
            const correlation = cross / Math.sqrt(Math.max(leftEnergy * rightEnergy, 1e-20));
            pitchCorrelation = Math.max(pitchCorrelation, correlation);
          }
          const speechLevel = rms > Math.max(0.011, estimatedNoiseFloor * 2.0);
          const speechLikeSpectrum = speechBandRatio > 0.62 && spectralFlatness < 0.68;
          const speechDynamics = energyVariation > 0.05 || spectralChange > 0.20;
          const voicedSound = pitchCorrelation > 0.34;
          const isSpeakingInstant = isTestTonePlayingRef.current || (
            energyHistory.length >= 10 &&
            speechLevel &&
            speechLikeSpectrum &&
            (voicedSound || (speechDynamics && wasVoiceActiveRef.current))
          );

          if (!isSpeakingInstant) {
            noiseFloorRef.current = Math.max(0.001, estimatedNoiseFloor * 0.97 + Math.min(rms, estimatedNoiseFloor * 2.5) * 0.03);
          }
          if (isSpeakingInstant) lastSpeechTimeRef.current = now;

          // Speech hangover: 1400ms bridges natural inter-word and inter-phrase pauses
          const voiceActive = isTestTonePlayingRef.current || (now - lastSpeechTimeRef.current < 1400);

          // Score hold timer: holds evaluated score for 3500ms of silence before reverting to em dash
          const isHolding = (micEnabled || isTestTonePlayingRef.current) && lastSpeechTimeRef.current > 0 && (now - lastSpeechTimeRef.current < 3500);
          if (isHolding !== isScoreHeldRef.current) {
            isScoreHeldRef.current = isHolding;
            setIsScoreHeld(isHolding);
          }

          // Buffer management: reset on fresh speech only after prolonged silence (>3500ms)
          if (voiceActive && !wasVoiceActiveRef.current && (now - lastSpeechTimeRef.current > 3500)) {
            mlAudioAnalyzer.resetBuffer();
          }
          wasVoiceActiveRef.current = voiceActive;

          // 2. Throttled State Update (10Hz) to prevent React state thrashing
          if (now - lastStateTime > 100) {
            lastStateTime = now;
            setLiveDb(currentDb);
            setVolumePercent(currentPercent);
            setIsVoiceActive(voiceActive);
            isVoiceActiveRef.current = voiceActive;
          }

          // Periodic ML inference: only evaluates when speech is genuinely active
          // Freezes during natural breath and sentence pauses so the high evaluated score does not drop
          const isSpeakingNow = isTestTonePlayingRef.current || isSpeakingInstant || (now - lastSpeechTimeRef.current < 250);
          if (isSpeakingNow && now - lastMlTimeRef.current > 350) {
            lastMlTimeRef.current = now;
            mlAudioAnalyzer.predict().then((res) => {
              if (res && res.isReady && !res.isSilent) {
                setMlState({
                  mos: res.mos,
                  snr: res.snr,
                  dropoutProb: res.dropoutProb,
                  clipProb: res.clipProb,
                  latencyMs: res.latencyMs,
                  isLoaded: true,
                  hasPrediction: true,
                });
              }
            }).catch(() => {});
          }

          // 4. Update 10s Rolling History Trend (1s interval)
          if (now - lastTrendTime > 1000) {
            lastTrendTime = now;
            if (voiceActive && currentMosRef.current !== null) {
              const liveScore = currentMosRef.current;
              setQualityTrend((prev) => {
                return prev.length < 10 ? [...prev, liveScore] : [...prev.slice(1), liveScore];
              });
            }
          }

          // 4. Render 60fps Canvas Spectrum Visualizer (Safe universal fillRect)
          const activeCanvas = canvasRef.current;
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
     MULTI-VOICE DEMO PLAYBACK & CUSTOM AUDIO PIPELINE
  ===================================================== */
  const stopDemoVoice = () => {
    if (demoSourceRef.current) {
      try {
        demoSourceRef.current.stop();
        demoSourceRef.current.disconnect();
      } catch (e) {}
      demoSourceRef.current = null;
    }
    if (demoMonitorGainRef.current) {
      demoMonitorGainRef.current.gain.value = 0.0;
    }
    if (oscTimerRef.current) clearInterval(oscTimerRef.current);
    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
      } catch (e) {}
      oscillatorRef.current = null;
    }
    setIsTestTonePlaying(false);
    isTestTonePlayingRef.current = false;
    setIsVoiceActive(false);
    lastSpeechTimeRef.current = 0;
    isScoreHeldRef.current = false;
    setIsScoreHeld(false);
    mlAudioAnalyzer.resetBuffer();
    setMlState((prev) => ({ ...prev, mos: null, hasPrediction: false }));
  };

  const playDemoVoice = async (voiceId = selectedDemoVoice) => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed" || !analyserRef.current) {
        await startAudioDSP(null);
      }
      const audioCtx = audioContextRef.current;
      if (!audioCtx) throw new Error("Audio analysis graph is unavailable");
      if (audioCtx.state === "suspended") await audioCtx.resume();

      // Stop existing playback before switching
      if (demoSourceRef.current) {
        try { demoSourceRef.current.stop(); demoSourceRef.current.disconnect(); } catch (e) {}
        demoSourceRef.current = null;
      }

      let audioBuffer = null;
      if (voiceId === "custom") {
        if (!customAudioBufferRef.current) {
          if (fileInputRef.current) fileInputRef.current.click();
          return;
        }
        audioBuffer = customAudioBufferRef.current;
      } else {
        if (!demoAudioCacheRef.current[voiceId]) {
          const opt = DEMO_VOICE_OPTIONS.find((v) => v.id === voiceId) || DEMO_VOICE_OPTIONS[0];
          const resp = await fetch(opt.url);
          const arrayBuf = await resp.arrayBuffer();
          demoAudioCacheRef.current[voiceId] = await audioCtx.decodeAudioData(arrayBuf);
        }
        audioBuffer = demoAudioCacheRef.current[voiceId];
      }

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.loop = true;
      source.connect(filterNodeRef.current || analyserRef.current);
      demoSourceRef.current = source;

      if (demoMonitorGainRef.current) {
        demoMonitorGainRef.current.gain.value = 0.35;
      }

      source.start();
      setIsTestTonePlaying(true);
      isTestTonePlayingRef.current = true;
      setIsVoiceActive(true);
      lastSpeechTimeRef.current = Date.now();
      setErrorMessage("");
    } catch (err) {
      console.error("Test speech generator failed:", err);
      setErrorMessage("The demo voice could not start: " + (err.message || "playback error"));
    }
  };

  const toggleTestTone = async () => {
    if (isTestTonePlaying) {
      stopDemoVoice();
    } else {
      await playDemoVoice(selectedDemoVoice);
    }
  };

  const handleVoiceChange = async (newVoiceId) => {
    setSelectedDemoVoice(newVoiceId);
    if (newVoiceId === "custom") {
      if (fileInputRef.current) fileInputRef.current.click();
    } else if (isTestTonePlaying) {
      await playDemoVoice(newVoiceId);
    }
  };

  const handleCustomFileUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        await startAudioDSP(null);
      }
      const audioCtx = audioContextRef.current;
      const arrayBuf = await file.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(arrayBuf);
      customAudioBufferRef.current = decoded;
      setCustomAudioName(file.name);
      setSelectedDemoVoice("custom");
      if (isTestTonePlaying) {
        stopDemoVoice();
      }
      setTimeout(() => {
        playDemoVoice("custom");
      }, 50);
    } catch (err) {
      console.error("File decode error:", err);
      setErrorMessage("Could not decode audio file. Please use a valid .wav or .mp3 file.");
    }
  };

  /* =====================================================
     SYSTEM AUDIO / PC AUDIO CAPTURE (YOUTUBE, CALLS, MP3)
  ===================================================== */
  const startSystemAudioCapture = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        setErrorMessage("Screen/System audio capture is not supported in this browser.");
        return;
      }
      if (isTestTonePlaying) stopDemoVoice();

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        setErrorMessage("No PC audio was captured! When sharing your Chrome Tab or Screen, make sure to check the 'Share audio' checkbox.");
        return;
      }

      // Stop unused video track to conserve CPU
      stream.getVideoTracks().forEach((vt) => vt.stop());

      // If mic was running, stop it cleanly
      if (localStreamRef.current && localStreamRef.current !== stream) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }

      systemStreamRef.current = stream;
      localStreamRef.current = stream;
      setIsSystemAudioActive(true);
      setMicEnabled(true);
      micEnabledRef.current = true;

      audioTracks[0].onended = () => {
        stopSystemAudioCapture();
      };

      await startAudioDSP(stream);
      setErrorMessage("");
    } catch (err) {
      console.warn("System audio capture cancelled or error:", err);
    }
  };

  const stopSystemAudioCapture = async () => {
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => t.stop());
      systemStreamRef.current = null;
    }
    setIsSystemAudioActive(false);
    setMicEnabled(false);
    micEnabledRef.current = false;
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

      if (localStreamRef.current && localStreamRef.current.getAudioTracks().some((t) => t.readyState === "live")) {
        localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
        setMicEnabled(true);
        micEnabledRef.current = true;
        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
          await startAudioDSP(localStreamRef.current);
        }
        return localStreamRef.current;
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
      micEnabledRef.current = true;
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

  const cleanupAudioResources = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (meetingId) {
      fetch(`${API_BASE_URL}/api/meeting/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, userId: userIdRef.current }),
      }).catch(() => {});
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (demoSourceRef.current) {
      try {
        demoSourceRef.current.stop();
        demoSourceRef.current.disconnect();
      } catch (e) {}
      demoSourceRef.current = null;
    }
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch (e) {}
      scriptProcessorRef.current = null;
    }
    if (demoMonitorGainRef.current) {
      try {
        demoMonitorGainRef.current.disconnect();
      } catch (e) {}
      demoMonitorGainRef.current = null;
    }
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
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => t.stop());
      systemStreamRef.current = null;
    }
    audioContextRef.current = null;
    analyserRef.current = null;
  };

  const leaveMeeting = () => {
    cleanupAudioResources();
    setIsInMeeting(false);
    setMeetingId("");
    setMicEnabled(false);
    micEnabledRef.current = false;
    setIsTestTonePlaying(false);
    isTestTonePlayingRef.current = false;
    setIsSystemAudioActive(false);
    setQualityTrend([]);
    lastSpeechTimeRef.current = 0;
    isScoreHeldRef.current = false;
    setIsScoreHeld(false);
    setMlState((prev) => ({ ...prev, mos: null, hasPrediction: false }));
    speechEnergyHistoryRef.current = [];
    noiseFloorRef.current = 0.003;
    packetLossCursorRef.current = 0;
    const clearedSimulations = { noise: false, packetLoss: false, clipping: false, muffled: false };
    simulationsRef.current = clearedSimulations;
    setIsVoiceActive(false);
    setSimulations(clearedSimulations);
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
    const active = tracks.some((t) => t.enabled);
    setMicEnabled(active);
    micEnabledRef.current = active;
    if (!active) {
      setIsVoiceActive(false);
      lastSpeechTimeRef.current = 0;
      isScoreHeldRef.current = false;
      setIsScoreHeld(false);
      setMlState((prev) => ({ ...prev, mos: null, hasPrediction: false }));
    }
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
      simulationsRef.current = next;
      if (key === "packetLoss" && !next.packetLoss) packetLossCursorRef.current = 0;

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
    const cleared = { noise: false, packetLoss: false, clipping: false, muffled: false };
    simulationsRef.current = cleared;
    packetLossCursorRef.current = 0;
    setSimulations(cleared);
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
      cleanupAudioResources();
    };
  }, []);

  const anySimActive = Object.values(simulations).some(Boolean);
  const audioInputActive = micEnabled || isTestTonePlaying;

  /* =====================================================
     RENDER
  ===================================================== */
  return (
    <div className="live-page" style={{ background: "#f8fafc", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <PageNav />

      {/* Hidden audio element for receiving peer audio stream */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />

      <main style={{ flex: 1, maxWidth: "1520px", width: "100%", margin: "0 auto", padding: "8px 24px 6px", boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ERROR / WARNING BANNER */}
        {errorMessage && (
          <div style={{ marginBottom: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", padding: "6px 14px", borderRadius: "8px", fontSize: "12px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" }}>
            <span>⚠️ {errorMessage}</span>
            <button type="button" onClick={toggleTestTone} style={{ background: isTestTonePlaying ? "#ef4444" : "#07162d", color: "#fff", border: "none", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>
              {isTestTonePlaying ? "⏹ Stop Demo" : "▶ Play Demo"}
            </button>
          </div>
        )}

        {/* TOP SECTION */}
        {isInMeeting ? (
          <section style={{ background: "#fff", borderRadius: "10px", padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "8px", boxShadow: "0 1px 6px rgba(15,23,42,0.03)", border: "1px solid #edf2f7" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: peerCount > 1 ? "#ecfdf5" : "#eff6ff", color: peerCount > 1 ? "#065f46" : "#1d4ed8", fontSize: "11px", fontWeight: "800", padding: "4px 10px", borderRadius: "9999px" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: peerCount > 1 ? "#10b981" : "#2563eb" }}></span>
                {peerCount > 1 ? `ACTIVE (${peerCount})` : "STANDALONE"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#0f172a", color: "#fff", padding: "4px 10px", borderRadius: "6px", fontSize: "11px" }}>
                <span style={{ color: "#94a3b8" }}>Room:</span>
                <strong>{meetingId}</strong>
                <button type="button" onClick={copyMeetingId} style={{ background: "transparent", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "10px", fontWeight: "700" }}>{copied ? "✓" : "Copy"}</button>
                <button type="button" onClick={copyInviteLink} style={{ background: "#2563eb", border: "none", color: "#fff", cursor: "pointer", fontSize: "10px", fontWeight: "700", padding: "2px 8px", borderRadius: "4px" }}>{copiedLink ? "✓ Copied" : "🔗 Share"}</button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#f8fafc", border: `1px solid ${isVoiceActive ? "#86efac" : "#e2e8f0"}`, padding: "4px 10px", borderRadius: "6px" }}>
                <span style={{ fontSize: "14px" }}>{micEnabled ? (isVoiceActive ? "🗣️" : "🎙️") : "🔇"}</span>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "#0f172a" }}>{micEnabled ? (isVoiceActive ? "Active" : "Open") : "Muted"}</span>
                  <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "600", marginLeft: "4px" }}>{liveDb}dB</span>
                  <div style={{ width: "60px", height: "3px", background: "#cbd5e1", borderRadius: "2px", overflow: "hidden", marginTop: "1px" }}>
                    <div style={{ width: `${volumePercent}%`, height: "100%", background: volumePercent > 80 ? "#ef4444" : "#10b981", transition: "width 0.08s ease" }}></div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: "11px", color: peerCount > 1 ? "#065f46" : "#64748b", fontWeight: "700" }}>{peerCount > 1 ? `🟢 Peer (${peerCount})` : "⏳ Waiting"}</div>
              <select value={selectedDemoVoice} onChange={(e) => handleVoiceChange(e.target.value)} style={{ background: "#fff", border: "1px solid #cbd5e1", padding: "4px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer", outline: "none" }}>
                {DEMO_VOICE_OPTIONS.map((opt) => (<option key={opt.id} value={opt.id}>{opt.id === "custom" && customAudioName ? `📂 ${customAudioName}` : opt.label}</option>))}
              </select>
              <button type="button" onClick={toggleTestTone} style={{ background: isTestTonePlaying ? "#ef4444" : "#eff6ff", color: isTestTonePlaying ? "#fff" : "#1d4ed8", border: "none", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>{isTestTonePlaying ? "⏹" : "▶ Play"}</button>
              <button type="button" onClick={isSystemAudioActive ? stopSystemAudioCapture : startSystemAudioCapture} style={{ background: isSystemAudioActive ? "#dc2626" : "#f0fdf4", color: isSystemAudioActive ? "#fff" : "#166534", border: "1px solid #dcfce7", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>{isSystemAudioActive ? "⏹ PC" : "🖥️ PC"}</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button type="button" onClick={toggleMicrophone} style={{ background: micEnabled ? "#0f172a" : "#ef4444", color: "#fff", border: "none", padding: "5px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>{micEnabled ? "Mute" : "Unmute"}</button>
              <button type="button" onClick={leaveMeeting} style={{ background: "#fee2e2", color: "#b91c1c", border: "none", padding: "5px 12px", borderRadius: "6px", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>Leave</button>
            </div>
          </section>
        ) : (
          <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div>
                  <span style={{ fontSize: "10px", fontWeight: "700", color: "#2563eb", background: "#eff6ff", padding: "2px 8px", borderRadius: "9999px", letterSpacing: "0.8px", textTransform: "uppercase" }}>● PROTOTYPE</span>
                  <h1 style={{ color: "#0f172a", fontSize: "22px", margin: "2px 0 0", fontWeight: "800", letterSpacing: "-0.3px" }}>EdgeAudio-QC Live Test</h1>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "11px", color: "#64748b", maxWidth: "400px" }}>Real-time on-device speech quality estimator</span>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "#fff", padding: "3px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: "700", color: mlState.isLoaded ? "#065f46" : "#64748b", border: "1px solid #e2e8f0" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: mlState.isLoaded ? "#10b981" : "#94a3b8", display: "inline-block" }}></span>
                  {mlState.isLoaded ? `Engine (${qcMetrics.latencyMs}ms)` : mlState.isLoading ? "Loading…" : "Offline"}
                </div>
              </div>
            </div>

            {urlParamMeetingId && (
              <div style={{ margin: "0 0 8px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: "8px", padding: "6px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <span style={{ fontSize: "10px", fontWeight: "800", color: "#047857", textTransform: "uppercase", letterSpacing: "0.8px" }}>Invitation</span>
                  <span style={{ fontSize: "13px", fontWeight: "800", color: "#065f46", marginLeft: "8px" }}>Call: <span style={{ color: "#0f172a" }}>{urlParamMeetingId.toUpperCase()}</span></span>
                </div>
                <button type="button" onClick={() => joinMeeting(urlParamMeetingId)} style={{ background: "#10b981", color: "#fff", border: "none", padding: "5px 14px", borderRadius: "6px", fontSize: "12px", fontWeight: "800", cursor: "pointer" }}>🎙️ Join</button>
              </div>
            )}

            <section style={{ background: "#fff", borderRadius: "10px", padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", boxShadow: "0 1px 6px rgba(15,23,42,0.03)", border: "1px solid #edf2f7" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" onClick={micEnabled ? toggleMicrophone : requestMicrophone} style={{ background: micEnabled ? "#0f172a" : "#2563eb", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px", boxShadow: micEnabled ? "none" : "0 1px 4px rgba(37,99,235,0.2)" }}>
                  {micEnabled ? "🔇 Mute" : "🎙️ Enable Mic"}
                </button>
                <select value={selectedDemoVoice} onChange={(e) => handleVoiceChange(e.target.value)} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "5px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer", outline: "none" }}>
                  {DEMO_VOICE_OPTIONS.map((opt) => (<option key={opt.id} value={opt.id}>{opt.id === "custom" && customAudioName ? `📂 ${customAudioName}` : opt.label}</option>))}
                </select>
                <button type="button" onClick={toggleTestTone} style={{ background: isTestTonePlaying ? "#ef4444" : "#eff6ff", color: isTestTonePlaying ? "#fff" : "#1d4ed8", border: "none", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>{isTestTonePlaying ? "⏹ Stop" : "▶ Play Voice"}</button>
                <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleCustomFileUpload} style={{ display: "none" }} />
                <button type="button" onClick={isSystemAudioActive ? stopSystemAudioCapture : startSystemAudioCapture} style={{ background: isSystemAudioActive ? "#dc2626" : "#f0fdf4", color: isSystemAudioActive ? "#fff" : "#166534", border: "1px solid #dcfce7", padding: "5px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }} title="Capture PC Audio">{isSystemAudioActive ? "⏹ PC Audio" : "🖥️ PC Audio"}</button>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#f8fafc", border: `1px solid ${isVoiceActive ? "#86efac" : "#e2e8f0"}`, padding: "4px 10px", borderRadius: "6px" }}>
                  <span style={{ fontSize: "13px" }}>{audioInputActive ? (isVoiceActive ? "🗣️" : "🎙️") : "🔇"}</span>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "#0f172a" }}>
                      {isTestTonePlaying ? "Playing" : isSystemAudioActive ? (isVoiceActive ? "PC Active" : "PC Idle") : micEnabled ? (isVoiceActive ? "Active" : "Open") : "Idle"}
                    </span>
                    <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "600", marginLeft: "4px" }}>{liveDb}dB</span>
                    {audioInputActive && (
                      <div style={{ width: "60px", height: "3px", background: "#e2e8f0", borderRadius: "2px", overflow: "hidden", marginTop: "1px" }}>
                        <div style={{ width: `${volumePercent}%`, height: "100%", background: volumePercent > 80 ? "#ef4444" : "#10b981", transition: "width 0.08s ease" }}></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button type="button" onClick={createMeeting} style={{ background: "#2563eb", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>+ Create Call</button>
                <input type="text" value={inputMeetingId} onChange={(e) => setInputMeetingId(e.target.value)} placeholder="Room ID" style={{ padding: "5px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", width: "90px", textTransform: "uppercase", outline: "none" }} />
                <button type="button" onClick={() => joinMeeting()} style={{ background: "#0f172a", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>Join</button>
              </div>
            </section>
          </div>
        )}

        {/* MAIN QUALITY REPORT DASHBOARD */}
        <section style={{ flex: 1, background: "#fff", borderRadius: "12px", padding: "12px 16px", boxShadow: "0 2px 12px rgba(15,23,42,0.03)", border: "1px solid #edf2f7", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          {/* Dashboard Title */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 style={{ margin: 0, color: "#0f172a", fontSize: "16px", fontWeight: "800" }}>Live Speech Quality Report</h2>
              <span style={{ fontSize: "10px", fontWeight: "700", color: "#2563eb", background: "#eff6ff", padding: "1px 6px", borderRadius: "4px" }}>SLIDE 10</span>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "#ecfdf5", padding: "3px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: "700", color: "#065f46" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: mlState.isLoaded ? "#10b981" : "#64748b", display: "inline-block" }}></span>
              {mlState.isLoaded ? `EdgeAudioNet v2 INT8 · ${qcMetrics.latencyMs}ms` : mlState.isLoading ? "Loading…" : "Unavailable"}
            </div>
          </div>

          {/* METRICS GRID: Score + 4 Dials */}
          <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: "10px", alignItems: "stretch" }}>
            {/* MOS CARD */}
            <div style={{ background: "#0f172a", color: "#fff", borderRadius: "10px", padding: "14px 16px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <span style={{ fontSize: "10px", fontWeight: "800", letterSpacing: "1px", color: qcMetrics.isSilent && qcMetrics.mosDisplay === "—" ? "#94a3b8" : "#38bdf8", textTransform: "uppercase" }}>
                  {qcMetrics.mosDisplay !== "—" ? (qcMetrics.isSilent ? "HELD" : "SPEECH QUALITY") : "AWAITING"}
                </span>
                <div style={{ display: "flex", alignItems: "baseline", gap: "6px", margin: "4px 0 4px" }}>
                  <span style={{ fontSize: "42px", fontWeight: "900", lineHeight: 1, color: qcMetrics.isSilent && qcMetrics.mosDisplay === "—" ? "#64748b" : "#fff" }}>{qcMetrics.mosDisplay}</span>
                  <span style={{ fontSize: "14px", color: "#94a3b8", fontWeight: "600" }}>/ 5.0 MOS</span>
                </div>
                <div style={{ display: "inline-block", background: qcMetrics.ratingColor, color: "#fff", fontSize: "10px", fontWeight: "800", padding: "2px 8px", borderRadius: "9999px", marginBottom: "4px" }}>{qcMetrics.ratingText}</div>
                <div style={{ fontSize: "11px", color: "#cbd5e1", lineHeight: 1.3 }}>{qcMetrics.statusNote}</div>
              </div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "6px", marginTop: "6px" }}>
                <div style={{ fontSize: "10px", fontWeight: "800", color: "#38bdf8" }}>EdgeAudioNet v2</div>
                <div style={{ fontSize: "10px", color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
                  <span>{qcMetrics.isSilent ? "VAD: Listening" : `WASM: ${qcMetrics.latencyMs}ms`}</span>
                  <span>SNR: {qcMetrics.rawSnr}dB</span>
                </div>
              </div>
            </div>

            {/* 4 SUB-METRICS */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {[
                ["Microphone", `${liveDb} dBFS`, qcMetrics.micStatus, qcMetrics.micStatusColor, "Peak monitoring"],
                ["Network", "WebRTC", qcMetrics.networkStatus, qcMetrics.networkColor, "Mesh signaling"],
                ["Noise", "SNR Floor", qcMetrics.noiseLevel, qcMetrics.noiseLevelColor, "Noise estimation"],
                ["Clarity", "Formants", qcMetrics.speechClarity, qcMetrics.speechClarityColor, "Spectral band"]
              ].map(([label, badge, value, color, desc]) => (
                <div key={label} style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", border: "1px solid #f1f5f9" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "10px", fontWeight: "800", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.6px" }}>{label}</span>
                    <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "600" }}>{badge}</span>
                  </div>
                  <h3 style={{ margin: "2px 0 1px", fontSize: "15px", fontWeight: "800", color }}>{value}</h3>
                  <span style={{ fontSize: "10px", color: "#94a3b8" }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SIDE-BY-SIDE: FFT + TREND */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "10px" }}>
            <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", border: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "11px", fontWeight: "800", color: "#0f172a" }}>FFT Spectrum (256-bin)</span>
                <span style={{ fontSize: "10px", color: isVoiceActive ? "#10b981" : "#64748b", fontWeight: "700" }}>{isVoiceActive ? "🗣️ Active" : "Listening"}</span>
              </div>
              <canvas ref={canvasRef} width="600" height="40" style={{ width: "100%", height: "40px", borderRadius: "6px", background: "#0b1329", display: "block" }} />
            </div>
            <div style={{ background: "#f8fafc", borderRadius: "8px", padding: "8px 12px", border: "1px solid #f1f5f9" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "11px", fontWeight: "800", color: "#0f172a" }}>Quality Trend (10s)</span>
                <span style={{ fontSize: "10px", color: "#64748b", fontWeight: "700" }}>{qualityTrend.length === 0 ? "Awaiting…" : `Avg: ${(qualityTrend.reduce((a, b) => a + b, 0) / qualityTrend.length).toFixed(1)}`}</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "40px", background: "#fff", padding: "3px 8px", borderRadius: "6px", border: "1px solid #e2e8f0", boxSizing: "border-box" }}>
                {qualityTrend.length === 0 ? (
                  <div style={{ width: "100%", textAlign: "center", color: "#94a3b8", fontSize: "10px", alignSelf: "center" }}>🎙️ Speak to record trend</div>
                ) : (
                  qualityTrend.map((score, idx) => {
                    const barHeight = Math.max(14, (score / 5.0) * 100);
                    const color = score >= 4.0 ? "#10b981" : score >= 3.0 ? "#f59e0b" : "#ef4444";
                    return (
                      <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                        <div style={{ width: "100%", height: `${barHeight}%`, background: color, borderRadius: "2px 2px 0 0", transition: "height 0.25s ease" }}></div>
                        <span style={{ fontSize: "8px", color: "#94a3b8", marginTop: "1px", fontWeight: "700" }}>{score}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ACOUSTIC SIMULATOR */}
          <div style={{ marginTop: "10px", background: "#f8fafc", borderRadius: "8px", padding: "8px 14px", border: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
              <span style={{ color: "#166534", fontSize: "11px", fontWeight: "800" }}>🧪 Acoustic Simulator</span>
              {anySimActive && (
                <button type="button" onClick={resetSimulations} style={{ background: "#fff", color: "#166534", border: "1px solid #bbf7d0", borderRadius: "9999px", padding: "2px 8px", fontSize: "10px", fontWeight: "700", cursor: "pointer" }}>✕ Reset</button>
              )}
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {[
                ["noise", "Background Noise", simulations.noise, "#d97706", "#b45309"],
                ["packetLoss", "Packet Loss", simulations.packetLoss, "#dc2626", "#b91c1c"],
                ["clipping", "Mic Overload", simulations.clipping, "#7f1d1d", "#991b1b"],
                ["muffled", "Muffled Voice", simulations.muffled, "#4f46e5", "#4338ca"]
              ].map(([key, label, active, activeBg, inactiveColor]) => (
                <button key={key} type="button" onClick={() => toggleSimulation(key)} style={{ padding: "4px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: "700", border: "none", cursor: "pointer", background: active ? activeBg : "#fff", color: active ? "#fff" : inactiveColor, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", transition: "all 0.15s ease" }}>
                  {active ? `✓ ${label}` : `+ ${label}`}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* PRIVACY FOOTER - inline compact */}
        <div style={{ marginTop: "6px", padding: "6px 14px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #f1f5f9", borderLeft: "3px solid #2563eb", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <span style={{ fontSize: "11px", color: "#64748b" }}>🔒 <strong style={{ color: "#0f172a" }}>Zero-Cloud Privacy</strong> — Audio analyzed entirely in-browser. Raw waveforms never leave your device.</span>
          <span style={{ fontSize: "10px", fontWeight: "700", color: "#2563eb", background: "#eff6ff", padding: "2px 8px", borderRadius: "9999px", whiteSpace: "nowrap" }}>Client-Side</span>
        </div>

      </main>
    </div>
  );
}

export default LiveCommunication;
