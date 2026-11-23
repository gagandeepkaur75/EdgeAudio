import { useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import PageNav from "../components/PageNav";
import { API_BASE_URL } from "../utils/api";
import { mlAudioAnalyzer, remoteAudioAnalyzer } from "../utils/mlAudioAnalyzer";

const EMPTY_REMOTE_ML = {
  isLoaded: false,
  hasPrediction: false,
  isSilent: true,
  mos: null,
  latencyMs: 0,
  noiseProb: 0,
  clipProb: 0,
  muffleProb: 0,
  dropoutProb: 0,
  windProb: 0,
};
import "./live.css";

function LiveCommunication() {
  const [searchParams, setSearchParams] = useSearchParams();

  // User & Meeting Identity
  const userIdRef = useRef(`user_${Math.random().toString(36).substring(2, 9)}`);
  const [meetingId, setMeetingId] = useState("");
  const meetingIdRef = useRef("");
  useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);
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
    muffleProb: 0.0,
    windProb: 0.0,
    voiceProb: 1.0,
  });
  const lastMlTimeRef = useRef(0);

  // Peer & WebRTC State
  const [peerCount, setPeerCount] = useState(1);
  const [peerList, setPeerList] = useState([]);
  const [remoteAudioAttached, setRemoteAudioAttached] = useState(false);
  // True only while the WebRTC connection to the other participant is up.
  const [isCallConnected, setIsCallConnected] = useState(false);

  // Quality of the audio we RECEIVE from the other participant (what we hear).
  const [remoteMl, setRemoteMl] = useState(EMPTY_REMOTE_ML);
  const remoteNodesRef = useRef(null);
  const remoteTimerRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pollTimerRef = useRef(null);
  // Signals are applied strictly in arrival order (an ICE candidate must not be
  // added before the offer/answer it belongs to has been applied).
  const signalChainRef = useRef(Promise.resolve());
  // ICE candidates that arrive before a remote description is set are held here.
  const pendingCandidatesRef = useRef([]);
  const remotePeersKeyRef = useRef("");

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
        ? "Score computed by the on-device AudioModelCl neural model"
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
    
    const isMuffled = simulations.muffled || mlState.muffleProb > 0.45;
    const isWindPuff = mlState.windProb > 0.40;
    const speechClarity = isMuffled
      ? `Muffled (${Math.round(Math.max(mlState.muffleProb, simulations.muffled ? 0.95 : 0.5) * 100)}% Cutoff)`
      : isWindPuff
      ? `Turbulent Wind (${Math.round(mlState.windProb * 100)}%)`
      : isActuallySpeaking ? "Full-Band Clarity" : canShowHeldScore ? "Formants Retained" : "Awaiting Voice";
    const speechClarityColor = (isMuffled || isWindPuff) ? "#ef4444" : isActuallySpeaking ? "#10b981" : "#64748b";

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
      speechClarityColor,
      networkStatus,
      networkColor,
      engine: "neural",
      latencyMs: mlState.latencyMs,
      rawSnr: snrVal,
    };
  }, [liveDb, isVoiceActive, isScoreHeld, micEnabled, isTestTonePlaying, simulations, peerCount, mlState]);

  /* Incoming audio ("what you hear") summary for the call-only card */
  const showIncomingCard = isInMeeting && isCallConnected && remoteAudioAttached;
  const incomingMetrics = useMemo(() => {
    const r = remoteMl;
    const hasScore = r.hasPrediction && Number.isFinite(r.mos);
    const mos = hasScore ? Math.max(1, Math.min(5, r.mos)) : null;
    const grade = (m) => (m >= 4 ? "GOOD" : m >= 3 ? "FAIR" : "POOR");
    const gradeColor = (m) => (m >= 4 ? "#0284c7" : m >= 3 ? "#f59e0b" : "#ef4444");

    // Most likely problem in what we receive. Dropouts here usually mean network loss.
    const issues = [
      ["Dropouts (network loss)", r.dropoutProb, 0.35],
      ["Background noise", r.noiseProb, 0.45],
      ["Clipping / overload", r.clipProb, 0.35],
      ["Muffled audio", r.muffleProb, 0.45],
      ["Wind / mic bumps", r.windProb, 0.4],
    ].filter(([, p, t]) => p > t).sort((a, b) => b[1] - a[1]);

    if (!r.isLoaded) {
      return { display: "—", label: "LOADING", ratingText: "STARTING ANALYSIS", ratingColor: "#64748b", note: "Loading the on-device model for incoming audio", issue: "" };
    }
    if (mos === null) {
      return { display: "—", label: "AWAITING", ratingText: "LISTENING", ratingColor: "#64748b", note: "Waiting for the other person to speak", issue: "" };
    }
    return {
      display: mos.toFixed(1),
      label: r.isSilent ? "HELD" : "INCOMING QUALITY",
      ratingText: r.isSilent ? `${grade(mos)} (PAUSED)` : grade(mos),
      ratingColor: r.isSilent ? "#64748b" : gradeColor(mos),
      note: r.isSilent ? "Other person paused · holding last score" : "Scored on-device from the audio you receive",
      issue: issues.length ? `${issues[0][0]} (${Math.round(issues[0][1] * 100)}%)` : "No issues detected",
      issueColor: issues.length ? "#f87171" : "#34d399",
    };
  }, [remoteMl]);

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

      // Tear down nodes from any previous call to this function. Without this,
      // each rebuild leaves the old filter/gain nodes wired to the speakers,
      // leaking nodes and playing the demo monitor more than once.
      for (const ref of [filterNodeRef, zeroGainRef, demoMonitorGainRef]) {
        if (ref.current) {
          try { ref.current.disconnect(); } catch {}
          ref.current = null;
        }
      }
      try { analyser.disconnect(); } catch {}

      // Filter node for Muffled acoustic simulation
      const biquadFilter = audioCtx.createBiquadFilter();
      biquadFilter.type = "lowpass";
      biquadFilter.frequency.value = simulationsRef.current.muffled ? 850 : 20000;
      biquadFilter.Q.value = 1.5;
      filterNodeRef.current = biquadFilter;
      if (stream && stream.getAudioTracks && stream.getAudioTracks().length > 0) {
        if (sourceRef.current) {
          try { sourceRef.current.disconnect(); } catch {}
        }
        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;
        source.connect(biquadFilter);
      } else if (sourceRef.current) {
        // Keep an existing mic/PC source flowing into the rebuilt graph.
        try { sourceRef.current.disconnect(); } catch {}
        sourceRef.current.connect(biquadFilter);
      }
      if (demoSourceRef.current) {
        // A demo voice that is already playing must follow the new filter too.
        try { demoSourceRef.current.disconnect(); } catch {}
        demoSourceRef.current.connect(biquadFilter);
      }

      // ScriptProcessorNode for real-time acoustic degradation and continuous PCM streaming
      if (scriptProcessorRef.current) {
        try { scriptProcessorRef.current.disconnect(); } catch {}
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
          let bandBinCount = 0;
          const bandEnergies = [];
          for (let i = totalStartBin; i <= totalEndBin; i++) {
            const db = (freqBuffer[i] / 255) * (analyser.maxDecibels - analyser.minDecibels) + analyser.minDecibels;
            const power = 10 ** (db / 10);
            totalPower += power;
            if (i >= speechStartBin && i <= speechEndBin) {
              speechPower += power;
              logPowerSum += Math.log(Math.max(power, 1e-12));
              bandBinCount++;
              bandEnergies.push(power);
            }
          }
          const speechBandRatio = speechPower / Math.max(totalPower, 1e-12);
          const averageBandPower = speechPower / Math.max(1, bandBinCount);
          const spectralFlatness = Math.exp(logPowerSum / Math.max(1, bandBinCount)) / Math.max(averageBandPower, 1e-12);
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
          // Read the ref, not React state: this loop's closure was created once
          // and would otherwise see the mic state from when the graph was built.
          const isHolding = (micEnabledRef.current || isTestTonePlayingRef.current) && lastSpeechTimeRef.current > 0 && (now - lastSpeechTimeRef.current < 3500);
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
                  muffleProb: res.muffleProb ?? 0.0,
                  windProb: res.windProb ?? 0.0,
                  voiceProb: res.voiceProb ?? 1.0,
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
      } catch {}
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
      } catch {}
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
        try { demoSourceRef.current.stop(); demoSourceRef.current.disconnect(); } catch {}
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
    // Clear the input so picking the same file again still fires onChange.
    e.target.value = "";
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
      // Send the captured PC audio to the other participant instead of the old mic track.
      syncLocalTrackToPeer();

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
      if (localStreamRef.current === systemStreamRef.current) {
        // Don't leave a stopped stream behind; "Enable Mic" will request a fresh one.
        localStreamRef.current = null;
      }
      systemStreamRef.current = null;
    }
    syncLocalTrackToPeer();
    setIsSystemAudioActive(false);
    setMicEnabled(false);
    micEnabledRef.current = false;
  };

  /* =====================================================
     WEBRTC PEER CONNECTION & SIGNALING
  ===================================================== */
  const sendSignal = (roomId, signalData) =>
    fetch(`${API_BASE_URL}/api/meeting/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId: roomId, senderId: userIdRef.current, signalData }),
    }).catch(() => {});

  const getAudioTransceiver = (pc) =>
    pc.getTransceivers().find(
      (t) => t.receiver && t.receiver.track && t.receiver.track.kind === "audio" && t.direction !== "stopped"
    );

  // Swap whatever audio we are currently capturing (mic, PC audio, or nothing)
  // into the live call without renegotiating.
  const syncLocalTrackToPeer = () => {
    const pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") return;
    const transceiver = getAudioTransceiver(pc);
    if (!transceiver) return;
    const track = localStreamRef.current
      ? localStreamRef.current.getAudioTracks().find((t) => t.readyState === "live") || null
      : null;
    if (transceiver.sender.track !== track) {
      transceiver.sender.replaceTrack(track).catch((err) => console.warn("replaceTrack failed:", err));
    }
  };

  /* =====================================================
     INCOMING AUDIO ANALYSIS (what the listener actually hears)
     The remote stream plays through the hidden <audio> element; a silent
     Web Audio branch taps it and feeds a second on-device analyzer.
  ===================================================== */
  const stopRemoteAnalysis = () => {
    if (remoteTimerRef.current) {
      clearInterval(remoteTimerRef.current);
      remoteTimerRef.current = null;
    }
    if (remoteNodesRef.current) {
      const { src, proc, sink } = remoteNodesRef.current;
      for (const node of [src, proc, sink]) {
        try { node.disconnect(); } catch {}
      }
      proc.onaudioprocess = null;
      remoteNodesRef.current = null;
    }
    remoteAudioAnalyzer.resetAll();
    setRemoteMl(EMPTY_REMOTE_ML);
  };

  const startRemoteAnalysis = (stream) => {
    stopRemoteAnalysis();
    if (!stream || stream.getAudioTracks().length === 0) return;
    try {
      if (!remoteAudioAnalyzer.isReady) remoteAudioAnalyzer.init();

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      let ctx = audioContextRef.current;
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioCtx();
        audioContextRef.current = ctx;
      }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});

      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const sink = ctx.createGain();
      sink.gain.value = 0; // analysis only; the <audio> element does the playback
      proc.onaudioprocess = (e) => {
        // No local VAD here: the analyzer's energy gate + the model's voice_prob decide.
        remoteAudioAnalyzer.pushAudio(e.inputBuffer.getChannelData(0), ctx.sampleRate, false);
      };
      src.connect(proc);
      proc.connect(sink);
      sink.connect(ctx.destination);
      remoteNodesRef.current = { src, proc, sink };

      let busy = false;
      remoteTimerRef.current = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const res = await remoteAudioAnalyzer.predict();
          setRemoteMl({
            isLoaded: !!res.isReady,
            hasPrediction: !!res.hasPrediction,
            isSilent: !!res.isSilent,
            mos: res.hasPrediction ? res.mos : null,
            latencyMs: res.latencyMs || 0,
            noiseProb: res.noiseProb || 0,
            clipProb: res.clipProb || 0,
            muffleProb: res.muffleProb || 0,
            dropoutProb: res.dropoutProb || 0,
            windProb: res.windProb || 0,
          });
        } catch (err) {
          console.warn("Incoming audio analysis error:", err);
        } finally {
          busy = false;
        }
      }, 500);
    } catch (err) {
      console.warn("Could not start incoming audio analysis:", err);
    }
  };

  const closePeerConnection = () => {
    if (peerConnectionRef.current) {
      try { peerConnectionRef.current.close(); } catch {}
      peerConnectionRef.current = null;
    }
    pendingCandidatesRef.current = [];
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setRemoteAudioAttached(false);
    setIsCallConnected(false);
    stopRemoteAnalysis();
  };

  const flushPendingCandidates = async (pc) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("Failed to add queued ICE candidate:", err);
      }
    }
  };

  const initWebRTC = async (roomId, isInitiator) => {
    try {
      closePeerConnection();

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      peerConnectionRef.current = pc;

      // Always negotiate a two-way audio channel, even if we have no mic yet,
      // so we can still receive the other side and attach a track later.
      const localTrack = localStreamRef.current
        ? localStreamRef.current.getAudioTracks().find((t) => t.readyState === "live")
        : null;
      if (localTrack) {
        pc.addTrack(localTrack, localStreamRef.current);
      } else if (isInitiator) {
        pc.addTransceiver("audio", { direction: "sendrecv" });
      }

      // Handle incoming remote audio track
      pc.ontrack = (event) => {
        if (!remoteAudioRef.current) return;
        const stream = event.streams[0] || new MediaStream([event.track]);
        remoteAudioRef.current.srcObject = stream;
        setRemoteAudioAttached(true);
        startRemoteAnalysis(stream);
      };

      pc.onconnectionstatechange = () => {
        if (peerConnectionRef.current !== pc) return;
        setIsCallConnected(pc.connectionState === "connected");
        // If the connection dies, drop it so the poll loop can build a fresh one.
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeerConnection();
        }
      };

      // Handle local ICE candidates and send to backend
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(roomId, { type: "ice-candidate", candidate: event.candidate.toJSON() });
        }
      };

      // If initiator (host), create and send offer
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(roomId, { type: "offer", sdp: { type: offer.type, sdp: offer.sdp } });
      }
      return pc;
    } catch (err) {
      console.warn("WebRTC initialization warning:", err);
      return null;
    }
  };

  const handleIncomingSignal = async (signal, roomId) => {
    if (!signal || !signal.signalData) return;
    const { type, sdp, candidate } = signal.signalData;

    try {
      if (type === "offer") {
        // A new offer means the host (re)started negotiation. If we have no
        // connection, or one that already finished a previous negotiation,
        // start fresh so we never apply an offer to a stale connection.
        let pc = peerConnectionRef.current;
        if (!pc || pc.signalingState !== "stable" || pc.remoteDescription) {
          pc = await initWebRTC(roomId, false);
          if (!pc) return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        // Make the audio channel two-way so a mic enabled later can be swapped in.
        pc.getTransceivers().forEach((t) => {
          if (t.receiver.track && t.receiver.track.kind === "audio" && t.direction !== "stopped") {
            t.direction = "sendrecv";
          }
        });
        syncLocalTrackToPeer();
        await flushPendingCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(roomId, { type: "answer", sdp: { type: answer.type, sdp: answer.sdp } });
      } else if (type === "answer") {
        const pc = peerConnectionRef.current;
        if (pc && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          await flushPendingCandidates(pc);
        }
      } else if (type === "ice-candidate" && candidate) {
        const pc = peerConnectionRef.current;
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          // Remote description not applied yet: hold until it is.
          pendingCandidatesRef.current.push(candidate);
        }
      }
    } catch (sigErr) {
      console.warn("Signal processing error:", sigErr);
    }
  };

  // Queue a signal behind all previously received ones so they apply in order.
  const enqueueSignal = (signal, roomId) => {
    signalChainRef.current = signalChainRef.current
      .then(() => handleIncomingSignal(signal, roomId))
      .catch(() => {});
  };

  /* =====================================================
     ROOM SIGNALING & PARTICIPANT PRESENCE (2-PERSON CALL)
  ===================================================== */
  const startRoomSignaling = (roomId, isHost = false) => {
    const cleanId = roomId.trim().toUpperCase();
    remotePeersKeyRef.current = "";
    signalChainRef.current = Promise.resolve();
    pendingCandidatesRef.current = [];

    // 1. Join Meeting on Backend. Also used to re-join if the server dropped us
    // (e.g. a background tab whose polling was throttled past the 45 s timeout,
    // or a server restart).
    let joinState = "joining"; // "joining" | "joined" | "failed"
    const joinRoom = () => {
      joinState = "joining";
      return fetch(`${API_BASE_URL}/api/meeting/join`, {
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
          joinState = "joined";
          if (data.participants) {
            setPeerCount(data.participantCount || 1);
            setPeerList(data.participants);
            // Connections are created by the poll loop (host) or on the first
            // incoming offer (peer), so nothing to start here.
          }
        })
        .catch((err) => {
          joinState = "failed";
          console.error("Signaling join error:", err);
          setErrorMessage(err.message || "Failed to connect to room.");
        });
    };
    joinRoom();

    // 2. Poll Room State Every 1.2s
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => {
      fetch(`${API_BASE_URL}/api/meeting/${encodeURIComponent(cleanId)}/poll?userId=${encodeURIComponent(userIdRef.current)}`)
        .then((res) => {
          if (!res.ok) throw new Error("Poll returned non-200");
          return res.json();
        })
        .then((data) => {
          if (data.joined === false) {
            // The server no longer has us in the room: re-join (once the first
            // join has finished) and skip this tick's participant logic.
            if (joinState === "joined") joinRoom();
            return;
          }
          if (data.participants) {
            setPeerCount(data.participantCount || 1);
            setPeerList(data.participants);

            const othersKey = data.participants
              .map((p) => p.userId)
              .filter((id) => id !== userIdRef.current)
              .sort()
              .join(",");
            const othersChanged = othersKey !== remotePeersKeyRef.current;
            remotePeersKeyRef.current = othersKey;

            if (data.participantCount <= 1 && peerConnectionRef.current) {
              // The other participant left: drop the dead connection so a
              // fresh one is negotiated when someone joins again.
              closePeerConnection();
            } else if (data.participantCount > 1 && isHost && (othersChanged || !peerConnectionRef.current)) {
              // Host drives negotiation (and re-negotiates when the other side
              // changes, e.g. a peer refreshes). The peer builds its connection
              // when the offer arrives.
              initWebRTC(cleanId, true);
            }
          }

          // Process incoming WebRTC signals strictly in order. The server hands
          // each signal out exactly once, so no client-side de-duplication is needed.
          if (data.signals && data.signals.length > 0) {
            data.signals.forEach((sig) => enqueueSignal(sig, cleanId));
          }
        })
        .catch(() => {});
    }, 1200);
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
      syncLocalTrackToPeer();
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
    pendingCandidatesRef.current = [];
    remotePeersKeyRef.current = "";
    signalChainRef.current = Promise.resolve();
    stopRemoteAnalysis();
    setIsCallConnected(false);
    // Use the ref: on unmount this function comes from the first render, where
    // the meetingId state is still "". keepalive lets the request finish even
    // if the tab is closing.
    if (meetingIdRef.current) {
      fetch(`${API_BASE_URL}/api/meeting/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId: meetingIdRef.current, userId: userIdRef.current }),
        keepalive: true,
      }).catch(() => {});
      meetingIdRef.current = "";
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (demoSourceRef.current) {
      try {
        demoSourceRef.current.stop();
        demoSourceRef.current.disconnect();
      } catch {}
      demoSourceRef.current = null;
    }
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch {}
      scriptProcessorRef.current = null;
    }
    if (demoMonitorGainRef.current) {
      try {
        demoMonitorGainRef.current.disconnect();
      } catch {}
      demoMonitorGainRef.current = null;
    }
    if (oscTimerRef.current) clearInterval(oscTimerRef.current);
    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
      } catch {}
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
    setPeerCount(1);
    setPeerList([]);
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
    } catch {}
  };

  const copyInviteLink = async () => {
    if (!meetingId) return;
    try {
      const inviteUrl = `${window.location.origin}/live-communication?meeting=${meetingId}`;
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {}
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

  // Always call the latest cleanup on unmount (avoids a stale first-render closure).
  const cleanupRef = useRef(cleanupAudioResources);
  cleanupRef.current = cleanupAudioResources;
  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
  }, []);

  const anySimActive = Object.values(simulations).some(Boolean);
  const audioInputActive = micEnabled || isTestTonePlaying;

  /* =====================================================
     RENDER
  ===================================================== */
  return (
    <div className="live-page" style={{ background: "#f8fafc", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <PageNav />

      {/* Hidden audio element for receiving peer audio stream */}
      <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />

      {/* Hidden file picker for "Upload Audio File". Rendered outside the
          in-call / standalone branches so it works in both views. */}
      <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleCustomFileUpload} style={{ display: "none" }} />

      <main style={{ maxWidth: "1520px", width: "100%", margin: "0 auto", padding: "16px 28px 40px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* ERROR / WARNING BANNER */}
        {errorMessage && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", padding: "10px 18px", borderRadius: "10px", fontSize: "14px", background: "#fef2f2", border: "1.5px solid #fecaca", color: "#991b1b" }}>
            <span>⚠️ {errorMessage}</span>
            <button type="button" onClick={toggleTestTone} style={{ background: isTestTonePlaying ? "#ef4444" : "#07162d", color: "#fff", border: "none", padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>
              {isTestTonePlaying ? "⏹ Stop Demo" : "▶ Play Demo"}
            </button>
          </div>
        )}

        {/* TOP SECTION */}
        {isInMeeting ? (
          <section style={{ background: "#fff", borderRadius: "14px", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", boxShadow: "0 2px 10px rgba(15,23,42,0.03)", border: "1.5px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: peerCount > 1 ? "#ecfdf5" : "#eff6ff", color: peerCount > 1 ? "#065f46" : "#1d4ed8", fontSize: "13px", fontWeight: "800", padding: "6px 14px", borderRadius: "9999px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: peerCount > 1 ? "#10b981" : "#2563eb" }}></span>
                {peerCount > 1 ? `ACTIVE CALL (${peerCount})` : "STANDALONE QC"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0f172a", color: "#fff", padding: "6px 14px", borderRadius: "8px", fontSize: "13px" }}>
                <span style={{ color: "#94a3b8" }}>Room:</span>
                <strong>{meetingId}</strong>
                <button type="button" onClick={copyMeetingId} style={{ background: "transparent", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "12px", fontWeight: "700", marginLeft: "4px" }}>{copied ? "✓ Copied" : "Copy"}</button>
                <button type="button" onClick={copyInviteLink} style={{ background: "#2563eb", border: "none", color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: "700", padding: "3px 10px", borderRadius: "6px", marginLeft: "4px" }}>{copiedLink ? "✓ Copied" : "🔗 Share"}</button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f8fafc", border: `1.5px solid ${isVoiceActive ? "#86efac" : "#cbd5e1"}`, padding: "6px 14px", borderRadius: "10px" }}>
                <span style={{ fontSize: "16px" }}>{micEnabled ? (isVoiceActive ? "🗣️" : "🎙️") : "🔇"}</span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>{micEnabled ? (isVoiceActive ? "Voice Active" : "Mic Open") : "Muted"}</span>
                    <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "700" }}>{liveDb} dBFS</span>
                  </div>
                  <div style={{ width: "80px", height: "4px", background: "#cbd5e1", borderRadius: "2px", overflow: "hidden", marginTop: "2px" }}>
                    <div style={{ width: `${volumePercent}%`, height: "100%", background: volumePercent > 80 ? "#ef4444" : "#10b981", transition: "width 0.08s ease" }}></div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: "13px", color: peerCount > 1 ? "#065f46" : "#64748b", fontWeight: "700" }}>{peerCount > 1 ? `🟢 Connected (${peerCount})` : "⏳ Waiting"}</div>
              <select value={selectedDemoVoice} onChange={(e) => handleVoiceChange(e.target.value)} style={{ background: "#fff", border: "1.5px solid #cbd5e1", padding: "7px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: "600", cursor: "pointer", outline: "none" }}>
                {DEMO_VOICE_OPTIONS.map((opt) => (<option key={opt.id} value={opt.id}>{opt.id === "custom" && customAudioName ? `📂 ${customAudioName}` : opt.label}</option>))}
              </select>
              <button type="button" onClick={toggleTestTone} style={{ background: isTestTonePlaying ? "#ef4444" : "#eff6ff", color: isTestTonePlaying ? "#fff" : "#1d4ed8", border: "none", padding: "7px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>{isTestTonePlaying ? "⏹ Stop" : "▶ Play Voice"}</button>
              <button type="button" onClick={isSystemAudioActive ? stopSystemAudioCapture : startSystemAudioCapture} style={{ background: isSystemAudioActive ? "#dc2626" : "#f0fdf4", color: isSystemAudioActive ? "#fff" : "#166534", border: "1.5px solid #bbf7d0", padding: "7px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>{isSystemAudioActive ? "⏹ PC Audio" : "🖥️ PC Audio"}</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button type="button" onClick={toggleMicrophone} style={{ background: micEnabled ? "#0f172a" : "#ef4444", color: "#fff", border: "none", padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>{micEnabled ? "Mute Mic" : "Unmute Mic"}</button>
              <button type="button" onClick={leaveMeeting} style={{ background: "#fee2e2", color: "#b91c1c", border: "none", padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}>Leave Call</button>
            </div>
          </section>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* COMPACT SLEEK HEADER */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#eff6ff", color: "#2563eb", padding: "4px 12px", borderRadius: "9999px", fontSize: "12px", fontWeight: "700", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" }}>
                  <span>●</span> 06 — PROTOTYPE EVALUATION
                </div>
                <h1 style={{ color: "#0f172a", fontSize: "clamp(28px, 3vw, 36px)", margin: 0, fontWeight: "800", letterSpacing: "-0.5px" }}>EdgeAudio-QC Live Test</h1>
                <p style={{ color: "#64748b", margin: "4px 0 0", fontSize: "15px", lineHeight: "1.4" }}>
                  Real-time on-device speech quality estimator. Speak into your microphone or play a demo voice to compute live MOS scores.
                </p>
              </div>

              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "#fff", padding: "8px 16px", borderRadius: "9999px", fontSize: "13px", fontWeight: "700", color: mlState.isLoaded ? "#065f46" : "#64748b", border: "1.5px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: mlState.isLoaded ? "#10b981" : "#94a3b8", display: "inline-block" }}></span>
                {mlState.isLoaded ? `On-Device Neural Engine (${qcMetrics.latencyMs}ms)` : mlState.isLoading ? "Loading Model…" : "Model Offline"}
              </div>
            </div>

            {urlParamMeetingId && (
              <div style={{ background: "#ecfdf5", border: "1.5px solid #a7f3d0", borderRadius: "10px", padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#047857", textTransform: "uppercase", letterSpacing: "0.8px" }}>Invitation</span>
                  <span style={{ fontSize: "15px", fontWeight: "800", color: "#065f46", marginLeft: "8px" }}>Call: <span style={{ color: "#0f172a" }}>{urlParamMeetingId.toUpperCase()}</span></span>
                </div>
                <button type="button" onClick={() => joinMeeting(urlParamMeetingId)} style={{ background: "#10b981", color: "#fff", border: "none", padding: "8px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: "800", cursor: "pointer" }}>🎙️ Join</button>
              </div>
            )}

            {/* ACTION BAR */}
            <section style={{ background: "#fff", borderRadius: "14px", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", boxShadow: "0 2px 10px rgba(15,23,42,0.03)", border: "1.5px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <button type="button" onClick={micEnabled ? toggleMicrophone : requestMicrophone} style={{ background: micEnabled ? "#0f172a" : "#2563eb", color: "#fff", border: "none", padding: "9px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: "700", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px", boxShadow: micEnabled ? "none" : "0 2px 8px rgba(37,99,235,0.2)" }}>
                  {micEnabled ? "🔇 Mute Mic" : "🎙️ Enable Mic"}
                </button>
                <select value={selectedDemoVoice} onChange={(e) => handleVoiceChange(e.target.value)} style={{ background: "#f8fafc", border: "1.5px solid #cbd5e1", padding: "9px 14px", borderRadius: "8px", fontSize: "14px", fontWeight: "600", cursor: "pointer", outline: "none" }}>
                  {DEMO_VOICE_OPTIONS.map((opt) => (<option key={opt.id} value={opt.id}>{opt.id === "custom" && customAudioName ? `📂 ${customAudioName}` : opt.label}</option>))}
                </select>
                <button type="button" onClick={toggleTestTone} style={{ background: isTestTonePlaying ? "#ef4444" : "#eff6ff", color: isTestTonePlaying ? "#fff" : "#1d4ed8", border: "none", padding: "9px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: "700", cursor: "pointer" }}>{isTestTonePlaying ? "⏹ Stop" : "▶ Play Voice"}</button>
                <button type="button" onClick={isSystemAudioActive ? stopSystemAudioCapture : startSystemAudioCapture} style={{ background: isSystemAudioActive ? "#dc2626" : "#f0fdf4", color: isSystemAudioActive ? "#fff" : "#166534", border: "1.5px solid #bbf7d0", padding: "9px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: "700", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }} title="Capture PC Audio">{isSystemAudioActive ? "⏹ PC Audio" : "🖥️ PC Audio"}</button>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f8fafc", border: `1.5px solid ${isVoiceActive ? "#86efac" : "#cbd5e1"}`, padding: "6px 14px", borderRadius: "10px" }}>
                  <span style={{ fontSize: "16px" }}>{audioInputActive ? (isVoiceActive ? "🗣️" : "🎙️") : "🔇"}</span>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
                        {isTestTonePlaying ? "Voice Sample Playing" : isSystemAudioActive ? (isVoiceActive ? "PC Audio Active" : "PC Audio (Idle)") : micEnabled ? (isVoiceActive ? "Voice Active" : "Mic Open") : "Mic Idle"}
                      </span>
                      <span style={{ fontSize: "12px", color: isVoiceActive ? "#10b981" : "#64748b", fontWeight: "700" }}>{liveDb} dBFS</span>
                    </div>
                    {audioInputActive && (
                      <div style={{ width: "80px", height: "4px", background: "#e2e8f0", borderRadius: "2px", overflow: "hidden", marginTop: "2px" }}>
                        <div style={{ width: `${volumePercent}%`, height: "100%", background: volumePercent > 80 ? "#ef4444" : "#10b981", transition: "width 0.08s ease" }}></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button type="button" onClick={createMeeting} style={{ background: "#2563eb", color: "#fff", border: "none", padding: "9px 18px", borderRadius: "8px", fontSize: "14px", fontWeight: "700", cursor: "pointer", boxShadow: "0 2px 8px rgba(37,99,235,0.2)" }}>+ Create Call</button>
                <input type="text" value={inputMeetingId} onChange={(e) => setInputMeetingId(e.target.value)} placeholder="Room ID" style={{ padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "14px", width: "110px", textTransform: "uppercase", outline: "none" }} />
                <button type="button" onClick={() => joinMeeting()} style={{ background: "#0f172a", color: "#fff", border: "none", padding: "9px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: "700", cursor: "pointer" }}>Join</button>
              </div>
            </section>
          </div>
        )}

        {/* MAIN QUALITY REPORT DASHBOARD */}
        <section style={{ background: "#fff", borderRadius: "16px", padding: "24px 28px", boxShadow: "0 4px 20px rgba(15,23,42,0.04)", border: "1.5px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Dashboard Title */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", borderBottom: "1.5px solid #f1f5f9", paddingBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h2 style={{ margin: 0, color: "#0f172a", fontSize: "22px", fontWeight: "800", letterSpacing: "-0.3px" }}>Live Speech Quality Report</h2>
              <span style={{ fontSize: "12px", fontWeight: "700", color: "#2563eb", background: "#eff6ff", padding: "3px 10px", borderRadius: "6px" }}>SLIDE 10 SPEC</span>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#ecfdf5", padding: "6px 14px", borderRadius: "9999px", fontSize: "13px", fontWeight: "700", color: "#065f46" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: mlState.isLoaded ? "#10b981" : "#64748b", display: "inline-block" }}></span>
              {mlState.isLoaded ? `SpeechQualityModel (AudioModelCI · ${qcMetrics.latencyMs}ms)` : mlState.isLoading ? "Loading model…" : "Model unavailable"}
            </div>
          </div>

          {/* METRICS GRID: Score (+ incoming score while in a connected call) + 4 Blue Report Result Boxes */}
          <div style={{ display: "grid", gridTemplateColumns: showIncomingCard ? "300px 300px 1fr" : "300px 1fr", gap: "16px", alignItems: "stretch" }}>
            {/* OVERALL MOS CARD */}
            <div style={{
              background: "linear-gradient(145deg, #0f172a 0%, #1e3a8a 100%)",
              color: "#fff",
              borderRadius: "14px",
              padding: "24px 22px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)",
              border: "1.5px solid #3b82f6"
            }}>
              <div>
                {showIncomingCard && (
                  <div style={{ fontSize: "12px", fontWeight: "800", color: "#94a3b8", letterSpacing: "1.2px", marginBottom: "4px" }}>🎙️ YOUR MIC</div>
                )}
                <span style={{ fontSize: "12px", fontWeight: "800", letterSpacing: "1.2px", color: qcMetrics.isSilent && qcMetrics.mosDisplay === "—" ? "#94a3b8" : "#38bdf8", textTransform: "uppercase" }}>
                  {qcMetrics.mosDisplay !== "—" ? (qcMetrics.isSilent ? "SPEECH QUALITY (HELD)" : "OVERALL SPEECH QUALITY") : "AWAITING SPEECH"}
                </span>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "10px 0 8px" }}>
                  <span style={{ fontSize: "56px", fontWeight: "900", lineHeight: 1, color: qcMetrics.isSilent && qcMetrics.mosDisplay === "—" ? "#64748b" : "#fff" }}>{qcMetrics.mosDisplay}</span>
                  <span style={{ fontSize: "18px", color: "#94a3b8", fontWeight: "600" }}>/ 5.0 MOS</span>
                </div>
                <div style={{ display: "inline-block", background: qcMetrics.ratingColor, color: "#fff", fontSize: "13px", fontWeight: "800", padding: "4px 14px", borderRadius: "9999px", letterSpacing: "0.5px", marginBottom: "8px" }}>{qcMetrics.ratingText}</div>
                <div style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: 1.5 }}>{qcMetrics.statusNote}</div>
              </div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: "12px", marginTop: "14px" }}>
                <div style={{ fontSize: "13px", fontWeight: "800", color: "#38bdf8" }}>SpeechQualityModel (AudioModelCI)</div>
                <div style={{ fontSize: "12px", color: "#94a3b8", display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
                  <span>{qcMetrics.isSilent ? "VAD: Listening..." : `WASM: ${qcMetrics.latencyMs}ms`}</span>
                  <span>SNR: {qcMetrics.rawSnr} dB</span>
                </div>
              </div>
            </div>

            {/* INCOMING AUDIO CARD ("what you hear"): only while the call is connected */}
            {showIncomingCard && (
              <div style={{
                background: "linear-gradient(145deg, #1e1b4b 0%, #3730a3 100%)",
                color: "#fff",
                borderRadius: "14px",
                padding: "24px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)",
                border: "1.5px solid #818cf8"
              }}>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "800", color: "#c7d2fe", letterSpacing: "1.2px", marginBottom: "4px" }}>🎧 WHAT YOU HEAR</div>
                  <span style={{ fontSize: "12px", fontWeight: "800", letterSpacing: "1.2px", color: incomingMetrics.display === "—" ? "#94a3b8" : "#a5b4fc", textTransform: "uppercase" }}>
                    {incomingMetrics.label}
                  </span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "10px 0 8px" }}>
                    <span style={{ fontSize: "56px", fontWeight: "900", lineHeight: 1, color: incomingMetrics.display === "—" ? "#64748b" : "#fff" }}>{incomingMetrics.display}</span>
                    <span style={{ fontSize: "18px", color: "#94a3b8", fontWeight: "600" }}>/ 5.0 MOS</span>
                  </div>
                  <div style={{ display: "inline-block", background: incomingMetrics.ratingColor, color: "#fff", fontSize: "13px", fontWeight: "800", padding: "4px 14px", borderRadius: "9999px", letterSpacing: "0.5px", marginBottom: "8px" }}>{incomingMetrics.ratingText}</div>
                  <div style={{ fontSize: "13px", color: "#cbd5e1", lineHeight: 1.5 }}>{incomingMetrics.note}</div>
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: "12px", marginTop: "14px" }}>
                  <div style={{ fontSize: "13px", fontWeight: "800", color: "#a5b4fc" }}>Received from peer (WebRTC)</div>
                  <div style={{ fontSize: "12px", color: incomingMetrics.issueColor || "#94a3b8", fontWeight: "700", marginTop: "3px" }}>
                    {incomingMetrics.issue || "—"}
                  </div>
                </div>
              </div>
            )}

            {/* 4 SUB-METRICS: BLUE THEME MATCHED REPORT BOXES */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
              {[
                ["Microphone", `${liveDb} dBFS`, qcMetrics.micStatus, qcMetrics.micStatusColor, "Peak & overload monitoring"],
                ["Network", "WebRTC", qcMetrics.networkStatus, qcMetrics.networkColor, "Mesh signaling active"],
                ["Background Noise", "SNR Floor", qcMetrics.noiseLevel, qcMetrics.noiseLevelColor, "Dynamic noise floor estimation"],
                ["Speech Clarity", "Formants", qcMetrics.speechClarity, qcMetrics.speechClarityColor, "Spectral band concentration"]
              ].map(([label, badge, value, color, desc]) => (
                <div key={label} style={{
                  background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
                  borderRadius: "0 14px 14px 0",
                  padding: "16px 20px",
                  border: "1.5px solid #93c5fd",
                  borderLeft: "6px solid #2563eb",
                  boxShadow: "0 2px 8px rgba(37, 99, 235, 0.06)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: "800", color: "#1e40af", textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</span>
                    <span style={{ fontSize: "12px", color: "#1d4ed8", fontWeight: "700", background: "#dbeafe", padding: "2px 8px", borderRadius: "6px" }}>{badge}</span>
                  </div>
                  <h3 style={{ margin: "6px 0 4px", fontSize: "20px", fontWeight: "800", color }}>{value}</h3>
                  <span style={{ fontSize: "13px", color: "#334155" }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* FFT SPECTRUM & QUALITY TREND STACKED: QUALITY TREND BAR DOWN TO FFT SPECTRUM */}
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* 1. FFT SPECTRUM (TOP) */}
            <div style={{
              background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
              borderRadius: "0 14px 14px 0",
              padding: "16px 20px",
              border: "1.5px solid #93c5fd",
              borderLeft: "6px solid #2563eb",
              boxShadow: "0 2px 8px rgba(37, 99, 235, 0.06)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>Frequency Spectrum (256-bin FFT Analyser)</span>
                <span style={{ fontSize: "13px", color: isVoiceActive ? "#059669" : "#64748b", fontWeight: "700" }}>{isVoiceActive ? "🗣️ Voice Detected (Active Speech)" : "Listening..."}</span>
              </div>
              <canvas ref={canvasRef} width="1200" height="54" style={{ width: "100%", height: "54px", borderRadius: "8px", background: "#0b1329", display: "block" }} />
            </div>

            {/* 2. QUALITY TREND ROLLING GRAPH (DOWN TO FFT SPECTRUM) */}
            <div style={{
              background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
              borderRadius: "0 14px 14px 0",
              padding: "16px 20px",
              border: "1.5px solid #93c5fd",
              borderLeft: "6px solid #2563eb",
              boxShadow: "0 2px 8px rgba(37, 99, 235, 0.06)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>Quality Trend (Rolling 10s History)</span>
                <span style={{ fontSize: "14px", color: "#1e40af", fontWeight: "700" }}>
                  {qualityTrend.length === 0 ? "Awaiting speech to record quality trend..." : `Average MOS: ${(qualityTrend.reduce((a, b) => a + b, 0) / qualityTrend.length).toFixed(1)} / 5.0`}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "54px", background: "#ffffff", padding: "4px 12px", borderRadius: "8px", border: "1.5px solid #bfdbfe", boxSizing: "border-box" }}>
                {qualityTrend.length === 0 ? (
                  <div style={{ width: "100%", textAlign: "center", color: "#64748b", fontSize: "13px", alignSelf: "center", fontWeight: "500" }}>🎙️ Speak into microphone or play voice demo to record live trend...</div>
                ) : (
                  qualityTrend.map((score, idx) => {
                    const barHeight = Math.max(16, (score / 5.0) * 100);
                    const color = score >= 4.0 ? "#10b981" : score >= 3.0 ? "#f59e0b" : "#ef4444";
                    return (
                      <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                        <div style={{ width: "100%", height: `${barHeight}%`, background: color, borderRadius: "3px 3px 0 0", transition: "height 0.25s ease" }}></div>
                        <span style={{ fontSize: "11px", color: "#475569", marginTop: "2px", fontWeight: "700" }}>{score}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* ACOUSTIC SIMULATOR */}
          <div style={{
            background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
            borderRadius: "0 14px 14px 0",
            padding: "16px 20px",
            border: "1.5px solid #93c5fd",
            borderLeft: "6px solid #2563eb",
            boxShadow: "0 2px 8px rgba(37, 99, 235, 0.06)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
              <span style={{ color: "#1e40af", fontSize: "14px", fontWeight: "800", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🧪</span> Multi-Condition Acoustic Simulator (Compound Audio Effects)
              </span>
              {anySimActive && (
                <button type="button" onClick={resetSimulations} style={{ background: "#fff", color: "#1e40af", border: "1.5px solid #93c5fd", borderRadius: "9999px", padding: "4px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>✕ Reset All</button>
              )}
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {[
                ["noise", "Background Noise", simulations.noise, "#d97706", "#b45309"],
                ["packetLoss", "Packet Loss", simulations.packetLoss, "#dc2626", "#b91c1c"],
                ["clipping", "Mic Overload", simulations.clipping, "#7f1d1d", "#991b1b"],
                ["muffled", "Muffled Voice", simulations.muffled, "#4f46e5", "#4338ca"]
              ].map(([key, label, active, activeBg, inactiveColor]) => (
                <button key={key} type="button" onClick={() => toggleSimulation(key)} style={{ padding: "8px 16px", borderRadius: "9999px", fontSize: "13px", fontWeight: "700", border: "none", cursor: "pointer", background: active ? activeBg : "#fff", color: active ? "#fff" : inactiveColor, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", transition: "all 0.15s ease" }}>
                  {active ? `✓ ${label}` : `+ ${label}`}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* PRIVACY FOOTER */}
        <div style={{ padding: "12px 20px", borderRadius: "12px", background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", border: "1.5px solid #93c5fd", borderLeft: "6px solid #2563eb", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", color: "#334155" }}>🔒 <strong style={{ color: "#0f172a" }}>Zero-Cloud Privacy Guarantee</strong> — Audio is captured and scored entirely in-browser. Raw waveforms never leave your device.</span>
          <span style={{ fontSize: "12px", fontWeight: "700", color: "#1d4ed8", background: "#ffffff", padding: "4px 12px", borderRadius: "9999px", border: "1px solid #bfdbfe", whiteSpace: "nowrap" }}>100% Client-Side</span>
        </div>

      </main>
    </div>
  );
}

export default LiveCommunication;
