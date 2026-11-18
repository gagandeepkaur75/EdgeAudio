const fs = require('fs');
const path = require('path');

// 512-pt FFT implementation in JS
const FFT_SIZE = 512;
const HANN_WINDOW = new Float32Array(FFT_SIZE);
const BIT_REVERSE_TABLE = new Uint16Array(FFT_SIZE);
const SIN_TABLE = new Float32Array(FFT_SIZE / 2);
const COS_TABLE = new Float32Array(FFT_SIZE / 2);

function initFftTables() {
  for (let i = 0; i < FFT_SIZE; i++) {
    HANN_WINDOW[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (FFT_SIZE - 1)));
  }
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

  for (let i = 0; i < FFT_SIZE / 2; i++) {
    const theta = (-2.0 * Math.PI * i) / FFT_SIZE;
    COS_TABLE[i] = Math.cos(theta);
    SIN_TABLE[i] = Math.sin(theta);
  }
}

function computeRealFftMagnitude(inputFrame, outMag) {
  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);

  for (let i = 0; i < FFT_SIZE; i++) {
    const rev = BIT_REVERSE_TABLE[i];
    real[rev] = inputFrame[i] * HANN_WINDOW[i];
    imag[rev] = 0.0;
  }

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

  for (let k = 0; k < 257; k++) {
    outMag[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
  }
}

function extractFeaturesJs(audio, melBasis) {
  const TARGET_FRAMES = 201;
  const HOP_LENGTH = 160;
  const WIN_LENGTH = 512;
  const N_MELS = 80;

  const padded = new Float32Array(32512);
  for (let i = 0; i < 256; i++) {
    padded[i] = audio[256 - i];
  }
  padded.set(audio, 256);
  for (let i = 0; i < 256; i++) {
    padded[32256 + i] = audio[31998 - i];
  }

  const outFeatures = [];
  const fftMag = new Float32Array(257);
  let prevNormMag = null;

  for (let t = 0; t < TARGET_FRAMES; t++) {
    const start = t * HOP_LENGTH;
    const frameRaw = padded.subarray(start, start + WIN_LENGTH);

    // 1. RMS dB
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

    // 3. FFT
    computeRealFftMagnitude(frameRaw, fftMag);

    // 4. Flatness & High-band
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

    // 5. Flux
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

    // 6. Mel
    const row = new Array(85);
    for (let m = 0; m < N_MELS; m++) {
      const filter = melBasis[m];
      let melVal = 0;
      for (let k = 0; k < 257; k++) {
        melVal += filter[k] * fftMag[k];
      }
      row[m] = Math.log(Math.max(melVal, 1e-5));
    }
    row[80] = rmsDb;
    row[81] = flatness;
    row[82] = zcr;
    row[83] = highRatio;
    row[84] = flux;

    outFeatures.push(row);
  }

  return outFeatures;
}

function main() {
  initFftTables();

  const melJson = JSON.parse(fs.readFileSync('project/web/mel_basis.json', 'utf8'));
  const melBasis = melJson.mel_basis;

  const testData = JSON.parse(fs.readFileSync('project/train/test_clips.json', 'utf8'));
  const results = [];

  for (let idx = 0; idx < testData.clips.length; idx++) {
    const audio = new Float32Array(testData.clips[idx]);
    const feats = extractFeaturesJs(audio, melBasis);
    results.push(feats);
  }

  fs.writeFileSync('project/train/js_features.json', JSON.stringify({ features: results }));
  console.log(`Extracted JS features for ${results.length} clips.`);
}

main();
