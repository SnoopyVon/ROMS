(function exposeCostTrackOcr(root) {
  const MIN_OCR_CONFIDENCE = 0.3;
  const MIN_FIELD_CONFIDENCE = 0.65;
  const MIN_SHARPNESS = 40;
  const MAX_IMAGE_WIDTH = 2200;
  const ID_PATTERNS = {
    philid: /\b\d{4}(?:[\s-]{0,3}\d{4}){3}\b/,
    drivers: /\b[A-Z]\s?\d{2}[\s-]{0,3}\d{2}[\s-]{0,3}\d{6}\b/,
    umid: /\b\d{4}[\s-]{0,3}\d{7}[\s-]{0,3}\d\b/,
    passport: /\b[A-Z]\s?\d{7}\s?[A-Z]\b/
  };
  const ID_TYPE_MARKERS = {
    philid: /\b(?:PHILSYS|PHIL\s*ID|PHILIPPINE\s+(?:NATIONAL\s+)?IDENTIFICATION(?:\s+SYSTEM)?|NATIONAL\s+ID|PSN|PCN|CRN)\b/i,
    drivers: /\b(?:DRIVER'?S?\s+LICEN[CS]E|DRIVING\s+LICEN[CS]E|LAND\s+TRANSPORTATION\s+OFFICE|LTO|DLN)\b/i,
    passport: /\bPASSPORT\b/i,
    umid: /\b(?:UMID|UNIFIED\s+MULTI[- ]PURPOSE(?:\s+ID)?|SSS)\b/i
  };
  const ID_TYPE_NAMES = {
    philid: 'Philippine National ID (PhilSys)',
    drivers: "Driver's License",
    passport: 'Passport',
    umid: 'UMID'
  };
  const FIELD_LABELS = /\b(?:full\s*name|given\s*names?|first\s*names?|last\s*name|family\s*name|surname|middle\s*names?|middle\s*initial|middlename|name|pangalan|apelyido|date\s*of\s*birth|date\s*birth|birth\s*date|birthdate|birthday|birth|dob|d\.o\.b|kapanganakan|address|residential\s*address|current\s*address|permanent\s*address|place\s*of\s*residence|residence|tirahan|id\s*(?:number|no\.?)|crn|psn|pcn|dln|nationality|signature|sex|expiry|expiration|valid\s*until)\b/i;
  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  const TESSERACT_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let tesseractLoadPromise = null;

  function isoDate(year, month, day) {
    const y = Number(year), m = Number(month), d = Number(day);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return '';
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function findDates(text) {
    const dates = [];
    for (const match of String(text || '').matchAll(/\b(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\b/g)) {
      dates.push(isoDate(match[1], match[2], match[3]));
    }
    for (const match of String(text || '').matchAll(/\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})\b/g)) {
      const first = Number(match[1]), second = Number(match[2]);
      dates.push(first <= 12 ? isoDate(match[3], first, second) : isoDate(match[3], second, first));
    }
    for (const match of String(text || '').matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
      const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
      if (month) dates.push(isoDate(match[3], month, match[2]));
    }
    for (const match of String(text || '').matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/g)) {
      const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
      if (month) dates.push(isoDate(match[3], month, match[1]));
    }
    return dates.filter(Boolean);
  }

  function detectSingleIdType(value) {
    const combined = String(value || '').toUpperCase();
    const marked = Object.entries(ID_TYPE_MARKERS)
      .filter(([, pattern]) => pattern.test(combined))
      .map(([type]) => type);
    const uniqueMarked = [...new Set(marked)];
    if (uniqueMarked.length === 1) return uniqueMarked[0];
    if (uniqueMarked.length > 1) return null;

    const matchedNumbers = Object.entries(ID_PATTERNS)
      .filter(([, pattern]) => pattern.test(combined))
      .map(([type]) => type);
    const uniqueNumbers = [...new Set(matchedNumbers)];
    return uniqueNumbers.length === 1 ? uniqueNumbers[0] : null;
  }

  function detectIdType(texts) {
    const counts = new Map();
    (Array.isArray(texts) ? texts : [texts]).map(detectSingleIdType).filter(Boolean)
      .forEach(type => counts.set(type, (counts.get(type) || 0) + 1));
    const ranked = [...counts.entries()].sort((first, second) => second[1] - first[1]);
    return ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
  }

  function cleanValue(value) {
    return String(value || '')
      .replace(/^[\s:：/,-]+|[\s:：/,-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function trimAtFieldLabel(value) {
    const match = FIELD_LABELS.exec(value);
    return cleanValue(match ? value.slice(0, match.index) : value);
  }

  function valueAfterLabel(lines, pattern, followingLines = 1) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = pattern.exec(lines[index]);
      if (!match) continue;
      const inline = trimAtFieldLabel(lines[index].slice(match.index + match[0].length));
      if (inline.length >= 2 && !FIELD_LABELS.test(inline)) return inline;
      for (let offset = 1; offset <= followingLines && index + offset < lines.length; offset += 1) {
        const next = cleanValue(lines[index + offset]);
        if (!next || FIELD_LABELS.test(next) || /\d{4,}/.test(next)) break;
        if (findDates(next).length) break;
        return trimAtFieldLabel(next);
      }
    }
    return '';
  }

  function cleanName(value) {
    return cleanValue(value)
      .replace(/^[\s\-–—•|]+/u, '')
      .replace(/[^\p{L}' -]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(^|[\s.'-])\p{L}/gu, character => character.toUpperCase());
  }

  function composeName(given, middle, family) {
    const givenAndMiddle = cleanName([given, middle].filter(Boolean).join(' '));
    const givenWords = givenAndMiddle.toLowerCase().split(/\s+/).filter(Boolean);
    const familyWords = cleanName(family).toLowerCase().split(/\s+/).filter(Boolean);
    if (!familyWords.length) return givenAndMiddle;
    for (let start = 0; start <= givenWords.length - familyWords.length; start += 1) {
      if (familyWords.every((word, index) => givenWords[start + index] === word)) return givenAndMiddle;
    }
    let overlap = Math.min(givenWords.length, familyWords.length);
    while (overlap > 0 && !givenWords.slice(-overlap).every((word, index) => word === familyWords[index])) overlap -= 1;
    return cleanName(`${givenAndMiddle} ${familyWords.slice(overlap).join(' ')}`);
  }

  function parseName(lines) {
    const fullName = valueAfterLabel(lines, /^\s*(?:full\s*name|pangalan)\b\s*[:：-]?/i, 2)
      || valueAfterLabel(lines, /^\s*name\b\s*[:：-]?/i, 2);
    if (fullName) return cleanName(fullName);

    const given = valueAfterLabel(lines, /^\s*(?:given\s*names?|first\s*names?)\b\s*[:：-]?/i, 2);
    const family = valueAfterLabel(lines, /^\s*(?:last\s*name|family\s*name|surname|apelyido)\b\s*[:：-]?/i, 2);
    const middle = valueAfterLabel(lines, /^\s*(?:middle\s*names?|middle\s*initial|middlename)\b\s*[:：-]?/i, 2);
    if (given && family) return composeName(given, middle, family);

    const skip = /\b(?:republic|philippines|government|identification|national|pambansang|passport|license|driver|transportation|signature|address|nationality|birth|expiry|valid|until|sex|male|female|blood|agency|philsys|umid)\b/i;
    for (const line of lines) {
      if (FIELD_LABELS.test(line) || skip.test(line) || /\d/.test(line)) continue;
      const candidate = cleanName(line);
      const words = candidate.split(/\s+/).filter(Boolean);
      if (words.length >= 2 && words.length <= 7 && words.every(word => /\p{L}/u.test(word))) return candidate;
    }
    return '';
  }

  function parseDateOfBirth(lines) {
    const labels = /^\s*(?:date\s*of\s*birth|date\s*birth|birth\s*date|birthdate|birthday|birth|dob|d\.o\.b|kapanganakan)\b\s*[:：-]?/i;
    for (let index = 0; index < lines.length; index += 1) {
      const match = labels.exec(lines[index]);
      if (!match) continue;
      const inline = findDates(lines[index].slice(match[0].length));
      if (inline.length) return inline[0];
      for (const next of lines.slice(index + 1, index + 3)) {
        if (FIELD_LABELS.test(next)) break;
        const dates = findDates(next);
        if (dates.length) return dates[0];
      }
    }
    return '';
  }

  function parseAddress(lines) {
    const labels = /^\s*(?:residential\s*address|current\s*address|permanent\s*address|place\s*of\s*residence|address|residence|tirahan)\b\s*[:：-]?/i;
    for (let index = 0; index < lines.length; index += 1) {
      const match = labels.exec(lines[index]);
      if (!match) continue;
      const parts = [];
      const inline = trimAtFieldLabel(lines[index].slice(match[0].length));
      if (inline.length >= 2) parts.push(inline);
      for (const next of lines.slice(index + 1, index + 4)) {
        if (FIELD_LABELS.test(next) || /\d{10,}/.test(next)) break;
        const part = trimAtFieldLabel(next);
        if (part.length >= 2) parts.push(part);
        if (part.length < next.length) break;
      }
      return parts.join(' ').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
    }
    return '';
  }

  function parseIdNumber(text, idType) {
    const joined = String(text || '').toUpperCase();
    const pattern = ID_PATTERNS[idType];
    const match = pattern ? joined.match(pattern) : null;
    if (match) return match[0].replace(/\s+/g, '');
    const labeled = joined.match(/\b(?:ID\s*(?:NUMBER|NO\.?)|CRN|PSN|PCN|DLN)\b\s*[:：#-]?\s*([A-Z0-9][A-Z0-9 -]{4,24})/i);
    return labeled ? labeled[1].trim().replace(/\s+/g, '') : '';
  }

  function parseIdText(rawText, idType = null) {
    const lines = String(rawText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const text = lines.join('\n');
    return {
      lines,
      fields: {
        full_name: parseName(lines),
        dob: parseDateOfBirth(lines),
        address: parseAddress(lines),
        id_number: parseIdNumber(text, idType)
      }
    };
  }

  function normalizeField(value) {
    return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  }

  function validDateOfBirth(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    const today = new Date();
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || date > today) return false;
    return today.getUTCFullYear() - date.getUTCFullYear() <= 110;
  }

  function plausibleField(key, value) {
    if (key === 'full_name') {
      const words = value.split(/\s+/).filter(Boolean);
      return words.length >= 2 && words.length <= 7 && /\p{L}/u.test(value);
    }
    if (key === 'dob') return validDateOfBirth(value);
    if (key === 'address') return value.length >= 6 && /[\p{L}\p{N}]/u.test(value);
    return value.replace(/[^A-Z0-9]/gi, '').length >= 5;
  }

  function fieldLabelPattern(key) {
    return {
      full_name: /\b(?:full\s*name|given\s*names?|first\s*names?|middle\s*names?|last\s*name|surname|name|pangalan|apelyido)\b/i,
      dob: /\b(?:date\s*of\s*birth|date\s*birth|birth\s*date|birthdate|birthday|birth|dob|d\.o\.b|kapanganakan)\b/i,
      address: /\b(?:address|place\s*of\s*residence|residence|tirahan)\b/i,
      id_number: /\b(?:id\s*(?:number|no\.?)|crn|psn|pcn|dln|philsys|passport|driver'?s?\s+licen[cs]e|umid)\b/i
    }[key];
  }

  function mergeCandidates(candidates, idType) {
    const fields = { full_name: '', dob: '', address: '', id_number: '' };
    for (const key of Object.keys(fields)) {
      const groups = new Map();
      for (const candidate of candidates) {
        const value = String(candidate.parsed.fields[key] || '').trim();
        if (!value || !plausibleField(key, value)) continue;
        const normalized = normalizeField(value);
        const group = groups.get(normalized) || { value, count: 0, bestConfidence: 0, labeled: false };
        group.count += 1;
        group.bestConfidence = Math.max(group.bestConfidence, candidate.confidence);
        group.labeled = group.labeled || fieldLabelPattern(key).test(candidate.text);
        groups.set(normalized, group);
      }
      const ranked = [...groups.values()].sort((a, b) => b.count - a.count || b.bestConfidence - a.bestConfidence);
      const winner = ranked[0];
      if (!winner) continue;
      const secondCount = ranked[1]?.count || 0;
      const hasClearMajority = winner.count >= 2 && winner.count > secondCount;
      const isStrongSingleRead = ranked.length === 1
        && winner.count === 1
        && winner.bestConfidence >= MIN_FIELD_CONFIDENCE
        && winner.labeled
        && (key !== 'id_number' || Boolean(ID_PATTERNS[idType]?.test(winner.value)));
      if (hasClearMajority || isStrongSingleRead) fields[key] = winner.value;
    }
    return fields;
  }

  function reportProgress(onProgress, message, progress) {
    if (typeof onProgress === 'function') onProgress({ message, progress });
  }

  function loadTesseract() {
    if (root.Tesseract?.createWorker) return Promise.resolve(root.Tesseract);
    if (!root.document) return Promise.reject(new Error('OCR is only available in a browser.'));
    if (!tesseractLoadPromise) {
      tesseractLoadPromise = new Promise((resolve, reject) => {
        const script = root.document.createElement('script');
        script.src = TESSERACT_SCRIPT_URL;
        script.async = true;
        script.onload = () => {
          if (root.Tesseract?.createWorker) resolve(root.Tesseract);
          else reject(new Error('The OCR library did not load correctly.'));
        };
        script.onerror = () => reject(new Error('The OCR library could not be downloaded.'));
        root.document.head.appendChild(script);
      }).catch(error => {
        tesseractLoadPromise = null;
        throw error;
      });
    }
    return tesseractLoadPromise;
  }

  function fileToCanvas(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_IMAGE_WIDTH / image.width);
        const canvas = root.document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return reject(new Error('The image could not be prepared for text extraction.'));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The selected image could not be opened for text extraction.'));
      };
      image.src = url;
    });
  }

  function grayPixels(canvas, width) {
    const height = Math.max(1, Math.round(canvas.height * width / canvas.width));
    const grayCanvas = root.document.createElement('canvas');
    grayCanvas.width = width;
    grayCanvas.height = height;
    const context = grayCanvas.getContext('2d');
    context.drawImage(canvas, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const gray = new Float32Array(width * height);
    for (let index = 0; index < gray.length; index += 1) {
      gray[index] = 0.299 * pixels[index * 4] + 0.587 * pixels[index * 4 + 1] + 0.114 * pixels[index * 4 + 2];
    }
    return { data: gray, width, height };
  }

  function laplacianVariance(gray, width, height) {
    let sum = 0, sumSquared = 0, count = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const value = gray[index - width] + gray[index + width] + gray[index - 1] + gray[index + 1] - 4 * gray[index];
        sum += value;
        sumSquared += value * value;
        count += 1;
      }
    }
    if (!count) return 0;
    const mean = sum / count;
    return sumSquared / count - mean * mean;
  }

  function prepareForOcr(canvas, threshold) {
    const scale = canvas.width < 1200 ? 1.5 : 1;
    const prepared = root.document.createElement('canvas');
    prepared.width = Math.max(1, Math.round(canvas.width * scale));
    prepared.height = Math.max(1, Math.round(canvas.height * scale));
    const context = prepared.getContext('2d');
    context.drawImage(canvas, 0, 0, prepared.width, prepared.height);
    const image = context.getImageData(0, 0, prepared.width, prepared.height);
    const pixels = image.data;
    const histogram = new Uint32Array(256);
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = Math.max(0, Math.min(255,
        (0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2] - 128) * 1.4 + 128));
      const value = Math.round(gray);
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
      histogram[value] += 1;
    }
    if (threshold) applyOtsuThreshold(pixels, histogram);
    context.putImageData(image, 0, 0);
    return prepared;
  }

  function applyOtsuThreshold(pixels, histogram) {
    const total = pixels.length / 4;
    let sum = 0;
    for (let index = 0; index < histogram.length; index += 1) sum += index * histogram[index];
    let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, cutoff = 155;
    for (let index = 0; index < histogram.length; index += 1) {
      backgroundWeight += histogram[index];
      if (!backgroundWeight) continue;
      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += index * histogram[index];
      const meanBackground = backgroundSum / backgroundWeight;
      const meanForeground = (sum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        cutoff = index;
      }
    }
    for (let index = 0; index < pixels.length; index += 4) {
      const value = pixels[index] > cutoff ? 255 : 0;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
    }
  }

  async function extractId(file, { onProgress, signal } = {}) {
    let worker = null;
    let workerTerminated = false;
    const terminateWorker = async () => {
      if (!worker || workerTerminated) return;
      workerTerminated = true;
      await worker.terminate();
    };
    const throwIfAborted = () => {
      if (signal?.aborted) {
        const error = new Error('OCR was cancelled.');
        error.name = 'AbortError';
        throw error;
      }
    };
    const abortWorker = () => { void terminateWorker().catch(() => {}); };
    signal?.addEventListener('abort', abortWorker, { once: true });

    try {
      reportProgress(onProgress, 'Preparing the ID image…', 0.05);
      const canvas = await fileToCanvas(file);
      throwIfAborted();
      const gray = grayPixels(canvas, Math.min(800, canvas.width));
      if (laplacianVariance(gray.data, gray.width, gray.height) < MIN_SHARPNESS) {
        return {
          fields: { full_name: '', dob: '', address: '', id_number: '' },
          idType: null,
          confidence: 0,
          warning: 'The image looks blurry. Please review the fields manually or upload a clearer image.',
          code: 'blurry'
        };
      }

      reportProgress(onProgress, 'Loading text recognition…', 0.1);
      const Tesseract = await loadTesseract();
      throwIfAborted();
      worker = await Tesseract.createWorker('eng', 1, {
        logger: message => {
          if (message.status === 'recognizing text') {
            reportProgress(onProgress, 'Reading the ID image…', 0.15 + Number(message.progress || 0) * 0.8);
          }
        }
      });
      const passes = [
        { threshold: false, pageSegMode: 6 },
        { threshold: true, pageSegMode: 11 },
        { threshold: false, pageSegMode: 4 }
      ];
      const candidates = [];
      for (let index = 0; index < passes.length; index += 1) {
        throwIfAborted();
        const pass = passes[index];
        await worker.setParameters({
          tessedit_pageseg_mode: String(pass.pageSegMode),
          preserve_interword_spaces: '1'
        });
        const result = await worker.recognize(prepareForOcr(canvas, pass.threshold));
        const text = String(result.data.text || '').trim();
        if (text) candidates.push({ text, confidence: Number(result.data.confidence || 0) / 100 });
        reportProgress(onProgress, 'Comparing text reads…', 0.2 + ((index + 1) / passes.length) * 0.7);
      }
      throwIfAborted();

      if (!candidates.length) {
        return {
          fields: { full_name: '', dob: '', address: '', id_number: '' },
          idType: null,
          confidence: 0,
          warning: 'Unable to confidently extract information. Please review the fields manually or upload a clearer image.',
          code: 'no_text'
        };
      }

      const confidence = candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidates.length;
      if (confidence < MIN_OCR_CONFIDENCE) {
        return {
          fields: { full_name: '', dob: '', address: '', id_number: '' },
          idType: null,
          confidence,
          warning: 'Unable to confidently extract information. Please review the fields manually or upload a clearer image.',
          code: 'low_confidence'
        };
      }

      const idType = detectIdType(candidates.map(candidate => candidate.text));
      const parsedCandidates = candidates.map(candidate => ({
        ...candidate,
        parsed: parseIdText(candidate.text, idType)
      }));
      const fields = mergeCandidates(parsedCandidates, idType);
      const missing = Object.values(fields).some(value => !value);
      const warning = !idType
        ? `We could not identify a supported ID type. Review the extracted information manually.`
        : missing
          ? 'Unable to confidently extract some information. Please review the fields manually or upload a clearer image.'
          : '';
      return { fields, idType, idTypeName: ID_TYPE_NAMES[idType] || '', confidence, warning, code: warning ? 'partial' : 'ok' };
    } finally {
      signal?.removeEventListener('abort', abortWorker);
      await terminateWorker();
    }
  }

  const api = { detectIdType, extractId, findDates, mergeCandidates, parseIdText };
  root.CostTrackOcr = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
