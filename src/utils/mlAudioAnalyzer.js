import * as ort from "onnxruntime-web";

// Configure WASM paths for cloud edge & local deployment
try {
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
  ort.env.wasm.numThreads = 1; // 1 thread avoids SharedArrayBuffer cross-origin isolation requirements
} catch (e) {
  console.warn("[ML Audio QC] Error setting WASM paths:", e);
}

class MLAudioAnalyzer {
  constructor() {
    this.session = null;
    this.isLoading = false;
    this.isReady = false;
    this.modelPath = "/models/edgeaudio_model_int8.onnx";
    this.targetSampleRate = 16000;
    this.windowDuration = 1.0; // 1 second model input window
    this.windowSize = this.targetSampleRate * this.windowDuration; // 16,000 samples

    // Rolling circular audio buffer at 16 kHz
    this.audioBuffer = new Float32Array(this.windowSize);
    this.bufferIndex = 0;
    this.samplesAccumulated = 0;

    // 3.0-second active speech accumulator to bridge natural pauses between sentences
    this.speechWindowSize = 48000;
    this.speechBuffer = new Float32Array(this.speechWindowSize);
    this.speechBufferIndex = 0;
    this.speechBufferCount = 0;

    this.pendingFrame = new Float32Array(800); // 50ms sub-frame at 16 kHz
    this.pendingFrameIdx = 0;
    this.dynamicPeak = 0.1;

    // Smoothed metrics
    this.lastResult = {
      mos: 4.5,
      snr: 35.0,
      dropoutProb: 0.0,
      clipProb: 0.0,
      latencyMs: 0.0,
      engine: "heuristic_dsp",
      isReady: false,
    };
  }

  /**
   * Initializes and loads the quantized ONNX WebAssembly model.
   */
  async init(modelPath = "/models/edgeaudio_model_int8.onnx") {
    if (this.isReady && this.session) return true;
    if (this.isLoading) return false;

    this.isLoading = true;
    this.modelPath = modelPath;

    try {
      console.log(`[ML Audio QC] Loading ONNX model from: ${this.modelPath}...`);
      const t0 = performance.now();

      // Configure execution provider
      const options = {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      };

      this.session = await ort.InferenceSession.create(this.modelPath, options);
      const loadTime = (performance.now() - t0).toFixed(1);

      this.isReady = true;
      this.isLoading = false;
      this.lastResult.isReady = true;
      this.lastResult.engine = "neural_ml";

      console.log(
        `[ML Audio QC] EdgeAudioNet Neural Engine ready in ${loadTime}ms! Model: ${this.modelPath}`
      );
      return true;
    } catch (err) {
      console.warn(
        `[ML Audio QC] Failed to load WASM model (${this.modelPath}), fallback to heuristic:`,
        err
      );
      this.isLoading = false;
      this.isReady = false;
      this.lastResult.isReady = false;
      this.lastResult.engine = "heuristic_dsp";
      return false;
    }
  }

  /**
   * Pushes continuous PCM samples from Web Audio (e.g. 44.1k or 48k)
   * and resamples down to 16,000 Hz into the rolling window buffer.
   */
  /**
   * Pushes continuous PCM samples from Web Audio (e.g. 44.1k or 48k)
   * and resamples down to 16,000 Hz into the rolling window buffer.
   * Gated active speech accumulation bridges natural pauses between sentences.
   */
  pushAudio(rawPcm, inputSampleRate = 48000, isSpeechActive = true) {
    if (!rawPcm || rawPcm.length === 0) return;

    const ratio = inputSampleRate / this.targetSampleRate;
    const targetLen = inputSampleRate === this.targetSampleRate ? rawPcm.length : Math.floor(rawPcm.length / ratio);
    const resampled = new Float32Array(targetLen);

    if (inputSampleRate === this.targetSampleRate) {
      resampled.set(rawPcm);
    } else {
      for (let i = 0; i < targetLen; i++) {
        const srcPos = i * ratio;
        const index0 = Math.floor(srcPos);
        const index1 = Math.min(rawPcm.length - 1, index0 + 1);
        const weight = srcPos - index0;
        resampled[i] = rawPcm[index0] * (1.0 - weight) + rawPcm[index1] * weight;
      }
    }

    // 1. Regular 1.0s circular buffer
    for (let i = 0; i < targetLen; i++) {
      this.audioBuffer[this.bufferIndex] = resampled[i];
      this.bufferIndex = (this.bufferIndex + 1) % this.windowSize;
    }
    this.samplesAccumulated = Math.min(this.windowSize, this.samplesAccumulated + targetLen);

    // 2. 3.0s Active Speech Accumulator
    // Only writes frames containing vocal energy, preventing dead pause gaps between sentences
    let chunkSum = 0;
    for (let i = 0; i < targetLen; i++) chunkSum += resampled[i] * resampled[i];
    const chunkRms = Math.sqrt(chunkSum / targetLen);

    if (isSpeechActive || chunkRms > 0.004) {
      for (let i = 0; i < targetLen; i++) {
        this.speechBuffer[this.speechBufferIndex] = resampled[i];
        this.speechBufferIndex = (this.speechBufferIndex + 1) % this.speechWindowSize;
      }
      this.speechBufferCount = Math.min(this.speechWindowSize, this.speechBufferCount + targetLen);
    }
  }

  resetBuffer() {
    this.audioBuffer.fill(0);
    this.bufferIndex = 0;
    this.samplesAccumulated = 0;
    this.speechBuffer.fill(0);
    this.speechBufferIndex = 0;
    this.speechBufferCount = 0;
    if (this.pendingFrame) this.pendingFrame.fill(0);
    this.pendingFrameIdx = 0;
    this.dynamicPeak = 0.1;
  }

  /**
   * Extracts linear ordered 1.0 second (16,000 samples) window from the ring buffer.
   * Prefers active continuous speech if available to bridge inter-sentence pauses.
   */
  getOrderedWindow() {
    const window = new Float32Array(this.windowSize);

    // If we have at least 1.0s of continuous active speech accumulated, use that!
    if (this.speechBufferCount >= this.windowSize) {
      if (this.speechBufferIndex >= this.windowSize) {
        window.set(this.speechBuffer.subarray(this.speechBufferIndex - this.windowSize, this.speechBufferIndex), 0);
      } else {
        const wrapLen = this.windowSize - this.speechBufferIndex;
        window.set(this.speechBuffer.subarray(this.speechWindowSize - wrapLen, this.speechWindowSize), 0);
        window.set(this.speechBuffer.subarray(0, this.speechBufferIndex), wrapLen);
      }
      return window;
    }

    if (this.samplesAccumulated === 0) return window;

    if (this.samplesAccumulated < this.windowSize) {
      for (let i = 0; i < this.windowSize; i++) {
        window[i] = this.audioBuffer[i % this.samplesAccumulated];
      }
      return window;
    }

    const tailLength = this.windowSize - this.bufferIndex;
    window.set(this.audioBuffer.subarray(this.bufferIndex, this.windowSize), 0);
    window.set(this.audioBuffer.subarray(0, this.bufferIndex), tailLength);
    return window;
  }

  /**
   * Runs neural inference on current 16,000 sample window.
   * Dynamically filters out inter-word dead silence pauses so natural pauses
   * do not falsely trigger packet dropout penalties.
   */
  async predict() {
    if (!this.isReady || !this.session) {
      return this.lastResult;
    }

    // Require at least ~250ms of audio before first inference
    if (this.samplesAccumulated < 4000 && this.speechBufferCount < 4000) {
      return { ...this.lastResult, isSilent: true };
    }

    const window = this.getOrderedWindow();

    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < window.length; i++) {
      const absVal = Math.abs(window[i]);
      if (absVal > peak) peak = absVal;
      sumSq += window[i] * window[i];
    }
    const rms = Math.sqrt(sumSq / window.length);

    // True silence / dead input
    if (peak < 0.008 || rms < 0.001) {
      this.lastResult = {
        ...this.lastResult,
        isSilent: true,
        latencyMs: 0.1,
      };
      return this.lastResult;
    }

    try {
      const t0 = performance.now();

      // Divide 1.0s window into 20 sub-slices of 50ms (800 samples)
      // Extract active speech slices to prevent natural pauses between words from triggering dropouts
      const sliceLen = 800;
      const sliceRms = [];
      let maxSliceRms = 0;
      for (let i = 0; i < this.windowSize; i += sliceLen) {
        let bSum = 0;
        for (let j = 0; j < sliceLen; j++) {
          const s = window[i + j];
          bSum += s * s;
        }
        const bRms = Math.sqrt(bSum / sliceLen);
        sliceRms.push(bRms);
        if (bRms > maxSliceRms) maxSliceRms = bRms;
      }

      // Robustly estimate room ambient noise floor (median of lowest 50% energy slices)
      const sortedRms = [...sliceRms].sort((a, b) => a - b);
      const halfLen = Math.floor(sortedRms.length / 2);
      const noiseFloor = sortedRms.slice(0, halfLen).reduce((a, b) => a + b, 0) / Math.max(1, halfLen);

      // Adaptive speech vocal threshold: separates true vocal formants from room noise floor
      // and natural inter-word pauses without falsely dropping soft phonemes
      const vocalThreshold = Math.max(0.0012, noiseFloor + 0.18 * (maxSliceRms - noiseFloor));

      // Collect active vocal slices
      const activeBlocks = [];
      for (let idx = 0; idx < sliceRms.length; idx++) {
        if (sliceRms[idx] >= vocalThreshold) {
          activeBlocks.push(window.subarray(idx * sliceLen, (idx + 1) * sliceLen));
        }
      }

      // If fewer than 3 slices (150ms) are active, this is a pause / silence, not speech!
      if (activeBlocks.length < 3) {
        return {
          ...this.lastResult,
          isSilent: true,
          latencyMs: 0.1,
        };
      }

      let evalWindow;
      if (activeBlocks.length >= 1) {
        evalWindow = new Float32Array(this.windowSize);
        const catLen = activeBlocks.length * sliceLen;
        for (let i = 0; i < this.windowSize; i++) {
          const bIdx = Math.floor((i % catLen) / sliceLen);
          const sIdx = (i % catLen) % sliceLen;
          evalWindow[i] = activeBlocks[bIdx][sIdx];
        }
      } else {
        evalWindow = window;
      }

      let evalPeak = 0;
      for (let i = 0; i < evalWindow.length; i++) {
        const absVal = Math.abs(evalWindow[i]);
        if (absVal > evalPeak) evalPeak = absVal;
      }

      // Dynamic Active Speech Level Normalization (target reference 0.88 peak)
      // Scales quiet laptop/headset microphones up to reference studio speech levels
      const normalizedWindow = new Float32Array(this.windowSize);
      const targetPeak = 0.88;
      const scaleFactor = Math.min(50.0, targetPeak / Math.max(evalPeak, 0.005));
      for (let i = 0; i < this.windowSize; i++) {
        normalizedWindow[i] = evalWindow[i] * scaleFactor;
      }

      // Prepare ONNX Tensor: shape [1, 1, 16000]
      const tensor = new ort.Tensor("float32", normalizedWindow, [1, 1, this.windowSize]);
      const feeds = { input_audio: tensor };
      const output = await this.session.run(feeds);
      const latency = performance.now() - t0;

      // Unpack predictions
      const rawMos = output.mos ? output.mos.data[0] : 4.5;
      const rawSnr = output.snr ? output.snr.data[0] : 30.0;
      const rawDropout = output.dropout_prob ? output.dropout_prob.data[0] : 0.0;
      const rawClip = output.clip_prob ? output.clip_prob.data[0] : 0.0;

      // Clamp values to valid ranges
      const clampedMos = Math.max(1.0, Math.min(5.0, parseFloat(rawMos.toFixed(2))));
      const clampedSnr = parseFloat(rawSnr.toFixed(1));
      const clampedDropout = Math.max(0.0, Math.min(1.0, parseFloat(rawDropout.toFixed(3))));
      const clampedClip = Math.max(0.0, Math.min(1.0, parseFloat(rawClip.toFixed(3))));

      // Exponential smoothing to prevent jitter
      const alpha = this.lastResult.hasPrediction ? 0.35 : 1.0;
      const smoothedMos = (this.lastResult.hasPrediction && Number.isFinite(this.lastResult.mos))
        ? parseFloat((alpha * clampedMos + (1 - alpha) * this.lastResult.mos).toFixed(2))
        : clampedMos;

      this.lastResult = {
        mos: smoothedMos,
        snr: clampedSnr,
        dropoutProb: clampedDropout,
        clipProb: clampedClip,
        latencyMs: parseFloat(latency.toFixed(2)),
        engine: "neural_ml",
        isReady: true,
        hasPrediction: true,
        isSilent: false,
      };

      return this.lastResult;
    } catch (err) {
      console.warn("[ML Audio QC] Inference error:", err);
      return this.lastResult;
    }
  }
}

// Export singleton instance
export const mlAudioAnalyzer = new MLAudioAnalyzer();
