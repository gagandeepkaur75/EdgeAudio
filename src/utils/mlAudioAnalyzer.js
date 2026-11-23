import * as ort from "onnxruntime-web";

// Configure WASM paths for cloud edge & local deployment
try {
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
  ort.env.wasm.numThreads = 1; // 1 thread avoids SharedArrayBuffer cross-origin isolation requirements
  ort.env.wasm.simd = true;
} catch (e) {
  console.warn("[ML Audio QC] Error setting WASM paths:", e);
}

// -------------------------------------------------------------
// Fast Cooley-Tukey 512-Point Real FFT Precomputations
// -------------------------------------------------------------
const FFT_SIZE = 512;
const HANN_WINDOW = new Float32Array(FFT_SIZE);
const BIT_REVERSE_TABLE = new Uint16Array(FFT_SIZE);
const SIN_TABLE = new Float32Array(FFT_SIZE / 2);
const COS_TABLE = new Float32Array(FFT_SIZE / 2);

let fftTablesInitialized = false;

function initFftTables() {
  if (fftTablesInitialized) return;

  // Symmetric Hann window matching Python: (0.5 * (1.0 - cos(2*pi*i / 511)))
  for (let i = 0; i < FFT_SIZE; i++) {
    HANN_WINDOW[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (FFT_SIZE - 1)));
  }

  // Bit reversal table
  let j = 0;
  for (let i = 0; i < FFT_SIZE - 1; i++) {
    BIT_REVERSE_TABLE[i] = j;
    let k = FFT_SIZE >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }
  BIT_REVERSE_TABLE[FFT_SIZE - 1] = FFT_SIZE - 1;

  // Twiddle factors
  for (let i = 0; i < FFT_SIZE / 2; i++) {
    const theta = (-2.0 * Math.PI * i) / FFT_SIZE;
    COS_TABLE[i] = Math.cos(theta);
    SIN_TABLE[i] = Math.sin(theta);
  }

  fftTablesInitialized = true;
}

// In-place Radix-2 Real FFT producing 257 magnitude bins
function computeRealFftMagnitude(inputFrame, outMag) {
  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);

  // Apply window and bit reversal
  for (let i = 0; i < FFT_SIZE; i++) {
    const rev = BIT_REVERSE_TABLE[i];
    real[rev] = inputFrame[i] * HANN_WINDOW[i];
    imag[rev] = 0.0;
  }

  // Cooley-Tukey butterflies
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const halfLen = len >> 1;
    const step = FFT_SIZE / len;
    for (let i = 0; i < FFT_SIZE; i += len) {
      for (let k = 0; k < halfLen; k++) {
        const twiddleIdx = k * step;
        const c = COS_TABLE[twiddleIdx];
        const s = SIN_TABLE[twiddleIdx];

        const tr = c * real[i + k + halfLen] - s * imag[i + k + halfLen];
        const ti = s * real[i + k + halfLen] + c * imag[i + k + halfLen];

        real[i + k + halfLen] = real[i + k] - tr;
        imag[i + k + halfLen] = imag[i + k] - ti;
        real[i + k] += tr;
        imag[i + k] += ti;
      }
    }
  }

  // First 257 bins magnitude
  for (let k = 0; k < 257; k++) {
    outMag[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
  }
}

export class MLAudioAnalyzer {
  constructor() {
    this.session = null;
    this.isLoading = false;
    this.isReady = false;
    this.modelPath = "/models/model.onnx";
    this.melBasis = null;
    this.normStats = null;

    this.targetSampleRate = 16000;
    this.windowDuration = 2.0; // 2.0 second model input window
    this.windowSize = this.targetSampleRate * this.windowDuration; // 32,000 samples

    // Rolling circular audio buffer at 16 kHz (32,000 samples)
    this.audioBuffer = new Float32Array(this.windowSize);
    this.bufferIndex = 0;
    this.samplesAccumulated = 0;

    // 3.0-second active speech accumulator to bridge natural pauses between sentences
    this.speechWindowSize = 48000;
    this.speechBuffer = new Float32Array(this.speechWindowSize);
    this.speechBufferIndex = 0;
    this.speechBufferCount = 0;

    // VAD & smoothing state
    this.isVoiceActive = false;
    this.voiceHangoverTimer = 0; // ms
    this.smoothedMos = 4.5;

    // Smoothed metrics
    this.lastResult = {
      mos: 4.5,
      rawMos: 4.5,
      voiceProb: 1.0,
      snr: 35.0,
      dropoutProb: 0.0,
      clipProb: 0.0,
      muffleProb: 0.0,
      windProb: 0.0,
      noiseProb: 0.0,
      diagnostics: [0.0, 0.0, 0.0, 0.0, 0.0],
      latencyMs: 0.0,
      engine: "heuristic_dsp",
      isReady: false,
      hasPrediction: false,
      isSilent: true,
    };

    initFftTables();
  }

  /**
   * Initializes and loads the ONNX WebAssembly model, Mel filterbanks, and norm stats.
   */
  async init(modelPath = "/models/model.onnx") {
    if (this.isReady && this.session) return true;
    if (this.isLoading) return false;

    this.isLoading = true;
    this.modelPath = modelPath;

    try {
      console.log(`[ML Audio QC] Initializing AudioModelCl SpeechQualityModel...`);
      const t0 = performance.now();

      // 1. Fetch Mel Basis and Normalization Constants
      const [melResp, normResp] = await Promise.all([
        fetch("/models/mel_basis.json"),
        fetch("/models/norm_stats.json"),
      ]);

      if (!melResp.ok || !normResp.ok) {
        throw new Error(
          `Failed to load feature assets: mel_basis (${melResp.status}), norm_stats (${normResp.status})`
        );
      }

      const melJson = await melResp.json();
      this.melBasis = melJson.mel_basis;
      this.normStats = await normResp.json();

      // 2. Configure execution provider & create ONNX session
      const options = {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      };

      try {
        this.session = await ort.InferenceSession.create(this.modelPath, options);
      } catch (loadErr) {
        // Fallback to alias if specific model path fails
        console.warn(`[ML Audio QC] Could not load ${this.modelPath}, trying /models/edgeaudio_model.onnx:`, loadErr);
        this.session = await ort.InferenceSession.create("/models/edgeaudio_model.onnx", options);
      }

      const loadTime = (performance.now() - t0).toFixed(1);

      this.isReady = true;
      this.isLoading = false;
      this.lastResult.isReady = true;
      this.lastResult.engine = "neural_ml";

      console.log(
        `[ML Audio QC] SpeechQualityModel Neural Engine ready in ${loadTime}ms! Model: ${this.modelPath}`
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
   * Gated active speech accumulation bridges natural pauses between sentences.
   */
  pushAudio(rawPcm, inputSampleRate = 48000, isSpeechActive = true) {
    if (!rawPcm || rawPcm.length === 0) return;

    const resampled =
      inputSampleRate === this.targetSampleRate
        ? Float32Array.from(rawPcm)
        : this._resample(rawPcm, inputSampleRate);
    const targetLen = resampled.length;
    if (targetLen === 0) return;

    // 1. Regular 2.0s circular buffer
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

  /**
   * Streaming resampler to 16 kHz.
   * 1. Low-pass FIR (windowed sinc, 7 kHz cutoff) so content above the new
   *    8 kHz Nyquist limit doesn't fold back into the band (aliasing).
   * 2. Linear interpolation whose fractional read position and filter history
   *    carry across chunks, so no samples are dropped or repeated at chunk edges.
   */
  _resample(input, inputSampleRate) {
    if (this._rsRate !== inputSampleRate) {
      const taps = 63;
      const fc = 7000 / inputSampleRate; // normalized cutoff (cycles/sample)
      const h = new Float32Array(taps);
      const mid = (taps - 1) / 2;
      let sum = 0;
      for (let i = 0; i < taps; i++) {
        const x = i - mid;
        const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
        const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
        h[i] = sinc * hamming;
        sum += h[i];
      }
      for (let i = 0; i < taps; i++) h[i] /= sum; // unity gain at DC
      this._rsRate = inputSampleRate;
      this._rsTaps = h;
      this._rsHistory = new Float32Array(taps - 1);
      this._rsPhase = 0;
      this._rsLast = 0;
    }

    const h = this._rsTaps;
    const taps = h.length;
    const hist = this._rsHistory;
    const n = input.length;

    // FIR low-pass over [history | input]
    const ext = new Float32Array(hist.length + n);
    ext.set(hist, 0);
    ext.set(input, hist.length);
    const filtered = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += h[k] * ext[i + k];
      filtered[i] = acc;
    }
    hist.set(ext.subarray(n, n + hist.length));

    // Fractional-position linear interpolation (position -1 = last sample of previous chunk)
    const ratio = inputSampleRate / this.targetSampleRate;
    const out = new Float32Array(Math.ceil((n - this._rsPhase) / ratio) + 1);
    let count = 0;
    let pos = this._rsPhase;
    while (pos <= n - 1) {
      const i0 = Math.floor(pos);
      const w = pos - i0;
      const a = i0 < 0 ? this._rsLast : filtered[i0];
      const b = i0 + 1 < n ? filtered[i0 + 1] : a;
      out[count++] = a * (1 - w) + b * w;
      pos += ratio;
    }
    this._rsPhase = pos - n;
    this._rsLast = filtered[n - 1];
    return out.subarray(0, count);
  }

  /** Clears buffers AND the previous score, e.g. when a new call starts. */
  resetAll() {
    this.resetBuffer();
    this.isVoiceActive = false;
    this.voiceHangoverTimer = 0;
    this.lastResult = { ...this.lastResult, hasPrediction: false, isSilent: true };
  }

  resetBuffer() {
    this.audioBuffer.fill(0);
    this.bufferIndex = 0;
    this.samplesAccumulated = 0;
    this.speechBuffer.fill(0);
    this.speechBufferIndex = 0;
    this.speechBufferCount = 0;
    this.smoothedMos = 4.5;
  }

  /**
   * Extracts linear ordered 2.0 second (32,000 samples) window from the ring buffer.
   * Prefers active continuous speech if available to bridge inter-sentence pauses.
   */
  getOrderedWindow() {
    const window = new Float32Array(this.windowSize);

    // If we have at least 2.0s of continuous active speech accumulated, use that!
    if (this.speechBufferCount >= this.windowSize) {
      if (this.speechBufferIndex >= this.windowSize) {
        window.set(
          this.speechBuffer.subarray(
            this.speechBufferIndex - this.windowSize,
            this.speechBufferIndex
          ),
          0
        );
      } else {
        const wrapLen = this.windowSize - this.speechBufferIndex;
        window.set(
          this.speechBuffer.subarray(
            this.speechWindowSize - wrapLen,
            this.speechWindowSize
          ),
          0
        );
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
   * Exact Feature Extraction matching Python features.py and AudioModelCl
   * Input: 32,000 float32 samples (2.0s at 16kHz)
   * Output: Float32Array of shape [201, 85]
   */
  extractFeatures(audio) {
    const TARGET_FRAMES = 201;
    const HOP_LENGTH = 160;
    const WIN_LENGTH = 512;
    const N_MELS = 80;

    // Symmetric reflection padding: 256 samples on left and right -> 32,512 samples
    const padded = new Float32Array(32512);
    for (let i = 0; i < 256; i++) {
      padded[i] = audio[256 - i];
    }
    padded.set(audio, 256);
    for (let i = 0; i < 256; i++) {
      padded[32256 + i] = audio[31998 - i];
    }

    const outFeatures = new Float32Array(TARGET_FRAMES * 85);
    const fftMag = new Float32Array(257);
    let prevNormMag = null;

    for (let t = 0; t < TARGET_FRAMES; t++) {
      const start = t * HOP_LENGTH;
      const frameRaw = padded.subarray(start, start + WIN_LENGTH);

      // 1. RMS dB (from unwindowed raw frame)
      let sumSq = 0;
      for (let i = 0; i < WIN_LENGTH; i++) {
        sumSq += frameRaw[i] * frameRaw[i];
      }
      const rms = Math.sqrt(sumSq / WIN_LENGTH);
      const rmsDb = 20.0 * Math.log10(Math.max(rms, 1e-5));

      // 2. Zero-crossing rate
      let zcrCount = 0;
      let prevSign = frameRaw[0] >= 0;
      for (let i = 1; i < WIN_LENGTH; i++) {
        const s = frameRaw[i] >= 0;
        if (s !== prevSign) zcrCount++;
        prevSign = s;
      }
      const zcr = zcrCount / (WIN_LENGTH - 1);

      // 3. FFT Magnitude
      computeRealFftMagnitude(frameRaw, fftMag);

      // 4. Spectral Flatness & High-Band Energy
      let logPowerSum = 0;
      let totalPower = 0;
      let highPower = 0;

      for (let k = 0; k < 257; k++) {
        const p = fftMag[k] * fftMag[k] + 1e-10;
        logPowerSum += Math.log(p);
        totalPower += p;
        if (k >= 128) {
          highPower += p;
        }
      }
      const meanPower = totalPower / 257;
      const geomPower = Math.exp(logPowerSum / 257);
      const flatness = geomPower / meanPower;
      const highRatio = highPower / totalPower;

      // 5. Spectral Flux
      let magSum = 0;
      for (let k = 0; k < 257; k++) {
        magSum += fftMag[k];
      }
      magSum += 1e-5;

      let flux = 0.0;
      if (prevNormMag) {
        for (let k = 0; k < 257; k++) {
          flux += Math.abs(fftMag[k] / magSum - prevNormMag[k]);
        }
      } else {
        prevNormMag = new Float32Array(257);
      }
      for (let k = 0; k < 257; k++) {
        prevNormMag[k] = fftMag[k] / magSum;
      }

      // 6. Mel Filterbank Multiplication & Log-Mel
      const rowOffset = t * 85;
      for (let m = 0; m < N_MELS; m++) {
        const filter = this.melBasis[m];
        let melVal = 0;
        for (let k = 0; k < 257; k++) {
          melVal += filter[k] * fftMag[k];
        }
        outFeatures[rowOffset + m] = Math.log(Math.max(melVal, 1e-5));
      }

      outFeatures[rowOffset + 80] = rmsDb;
      outFeatures[rowOffset + 81] = flatness;
      outFeatures[rowOffset + 82] = zcr;
      outFeatures[rowOffset + 83] = highRatio;
      outFeatures[rowOffset + 84] = flux;

      // 7. Global Fixed Normalization
      if (this.normStats) {
        const mean = this.normStats.mean;
        const std = this.normStats.std;
        for (let f = 0; f < 85; f++) {
          outFeatures[rowOffset + f] =
            (outFeatures[rowOffset + f] - mean[f]) / (std[f] + 1e-6);
        }
      }
    }

    return outFeatures;
  }

  /**
   * Runs neural inference on current 32,000 sample window using AudioModelCl.
   */
  async predict() {
    if (!this.isReady || !this.session || !this.melBasis || !this.normStats) {
      return this.lastResult;
    }

    // Require at least ~400ms of audio before first inference
    if (this.samplesAccumulated < 6400 && this.speechBufferCount < 6400) {
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

      // Extract 85-channel normalized features [1, 201, 85]
      const featData = this.extractFeatures(window);
      const tensor = new ort.Tensor("float32", featData, [1, 201, 85]);

      // Execute ONNX session
      const feeds = { features: tensor };
      const output = await this.session.run(feeds);
      const latency = performance.now() - t0;

      // Parse outputs from AudioModelCl
      // mos: [1, 1], voice_prob: [1, 1], diagnostics: [1, 5] (noise, clip, muffle, dropout, wind)
      const rawMos = output.mos ? output.mos.data[0] : 4.5;
      const voiceProb = output.voice_prob ? output.voice_prob.data[0] : 1.0;
      const diag = output.diagnostics
        ? output.diagnostics.data
        : [0.0, 0.0, 0.0, 0.0, 0.0];

      const noiseProb = Math.max(0.0, Math.min(1.0, parseFloat(diag[0].toFixed(3))));
      const clipProb = Math.max(0.0, Math.min(1.0, parseFloat(diag[1].toFixed(3))));
      const muffleProb = Math.max(0.0, Math.min(1.0, parseFloat(diag[2].toFixed(3))));
      const dropoutProb = Math.max(0.0, Math.min(1.0, parseFloat(diag[3].toFixed(3))));
      const windProb = Math.max(0.0, Math.min(1.0, parseFloat(diag[4].toFixed(3))));

      // Voice Activity Detection with Hysteresis
      if (voiceProb >= 0.45) {
        this.isVoiceActive = true;
        this.voiceHangoverTimer = 350;
      } else if (voiceProb < 0.25) {
        if (this.voiceHangoverTimer > 0) {
          this.voiceHangoverTimer -= 250;
        } else {
          this.isVoiceActive = false;
        }
      }

      // Clamp MOS score
      const clampedMos = Math.max(1.0, Math.min(5.0, parseFloat(rawMos.toFixed(2))));

      // EMA smoothing on MOS
      const alpha = this.lastResult.hasPrediction ? 0.35 : 1.0;
      this.smoothedMos = this.lastResult.hasPrediction
        ? parseFloat((alpha * clampedMos + (1 - alpha) * this.smoothedMos).toFixed(2))
        : clampedMos;

      // Estimate SNR from noise diagnostic and physical signal energy
      const estimatedSnr = Math.round(
        Math.max(5.0, Math.min(42.0, (1.0 - noiseProb) * 35.0 + 5.0))
      );

      this.lastResult = {
        mos: this.smoothedMos,
        rawMos: clampedMos,
        voiceProb: parseFloat(voiceProb.toFixed(3)),
        isVoiceActive: this.isVoiceActive,
        snr: estimatedSnr,
        dropoutProb,
        clipProb,
        muffleProb,
        windProb,
        noiseProb,
        diagnostics: [noiseProb, clipProb, muffleProb, dropoutProb, windProb],
        latencyMs: parseFloat(latency.toFixed(2)),
        engine: "neural_ml",
        isReady: true,
        hasPrediction: true,
        isSilent: !this.isVoiceActive && voiceProb < 0.3,
      };

      return this.lastResult;
    } catch (err) {
      console.warn("[ML Audio QC] Inference error:", err);
      return this.lastResult;
    }
  }
}

// Analyzer for the local signal (your mic / demo voice / PC audio)
export const mlAudioAnalyzer = new MLAudioAnalyzer();

// Separate analyzer (own buffers and ONNX session) for the audio received from
// the other participant in a call, i.e. what the listener actually hears.
export const remoteAudioAnalyzer = new MLAudioAnalyzer();
