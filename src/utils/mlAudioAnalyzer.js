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
    this.windowDuration = 1.0; // 1 second window
    this.windowSize = this.targetSampleRate * this.windowDuration; // 16,000 samples

    // Rolling circular audio buffer at 16 kHz
    this.audioBuffer = new Float32Array(this.windowSize);
    this.bufferIndex = 0;
    this.samplesAccumulated = 0;

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
   * Pushes raw time-domain PCM samples from Web Audio AnalyserNode (e.g. 44.1k or 48k)
   * and resamples down to 16,000 Hz into the rolling window buffer.
   *
   * @param {Float32Array} rawPcm - Audio buffer from analyser.getFloatTimeDomainData()
   * @param {number} inputSampleRate - Current Web Audio sampleRate (e.g. 48000)
   */
  pushAudio(rawPcm, inputSampleRate = 48000) {
    if (!rawPcm || rawPcm.length === 0) return;

    if (inputSampleRate === this.targetSampleRate) {
      // Direct copy into rolling buffer
      for (let i = 0; i < rawPcm.length; i++) {
        this.audioBuffer[this.bufferIndex] = rawPcm[i];
        this.bufferIndex = (this.bufferIndex + 1) % this.windowSize;
      }
      this.samplesAccumulated = Math.min(
        this.windowSize,
        this.samplesAccumulated + rawPcm.length
      );
    } else {
      // Linear interpolation downsampling to 16 kHz
      const ratio = inputSampleRate / this.targetSampleRate;
      const targetLen = Math.floor(rawPcm.length / ratio);

      for (let i = 0; i < targetLen; i++) {
        const srcPos = i * ratio;
        const index0 = Math.floor(srcPos);
        const index1 = Math.min(rawPcm.length - 1, index0 + 1);
        const weight = srcPos - index0;
        const sample = rawPcm[index0] * (1.0 - weight) + rawPcm[index1] * weight;

        this.audioBuffer[this.bufferIndex] = sample;
        this.bufferIndex = (this.bufferIndex + 1) % this.windowSize;
      }
      this.samplesAccumulated = Math.min(
        this.windowSize,
        this.samplesAccumulated + targetLen
      );
    }
  }

  /**
   * Extracts linear ordered 1.0 second (16,000 samples) window from the ring buffer.
   */
  getOrderedWindow() {
    const window = new Float32Array(this.windowSize);
    if (this.samplesAccumulated < this.windowSize) {
      // Buffer not full yet, return whatever is there padded with zeros
      for (let i = 0; i < this.samplesAccumulated; i++) {
        window[i] = this.audioBuffer[i];
      }
      return window;
    }

    // Unroll circular buffer so oldest sample is at index 0
    const tailLength = this.windowSize - this.bufferIndex;
    window.set(this.audioBuffer.subarray(this.bufferIndex, this.windowSize), 0);
    window.set(this.audioBuffer.subarray(0, this.bufferIndex), tailLength);
    return window;
  }

  /**
   * Runs neural inference on current 16,000 sample window.
   * Returns: { mos, snr, dropoutProb, clipProb, latencyMs, engine }
   */
  async predict() {
    if (!this.isReady || !this.session) {
      return this.lastResult;
    }

    const window = this.getOrderedWindow();

    // Check peak amplitude for silence
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < window.length; i++) {
      const absVal = Math.abs(window[i]);
      if (absVal > peak) peak = absVal;
      sumSq += window[i] * window[i];
    }
    const rms = Math.sqrt(sumSq / window.length);

    // If quiet ambient / silent (room noise RMS < 0.015 or peak amplitude < 0.05), flag silence and retain last valid speech score
    if (rms < 0.015 || peak < 0.05) {
      this.lastResult = {
        ...this.lastResult,
        isSilent: true,
        latencyMs: 0.1,
        engine: "neural_ml",
      };
      return this.lastResult;
    }

    try {
      const t0 = performance.now();
      // Prepare ONNX Tensor: shape [1, 1, 16000]
      const tensor = new ort.Tensor("float32", window, [1, 1, this.windowSize]);

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
      const alpha = 0.45; // responsiveness weight
      const smoothedMos = parseFloat(
        (alpha * clampedMos + (1 - alpha) * this.lastResult.mos).toFixed(2)
      );

      this.lastResult = {
        mos: smoothedMos,
        snr: clampedSnr,
        dropoutProb: clampedDropout,
        clipProb: clampedClip,
        latencyMs: parseFloat(latency.toFixed(2)),
        engine: "neural_ml",
        isReady: true,
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
