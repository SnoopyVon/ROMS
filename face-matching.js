(function exposeCostTrackFaceMatching(root) {
  const FACE_API_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.js';
  const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';
  const FACE_MATCH_DISTANCE = 0.60;
  const MIN_FACE_SHARPNESS = 40;
  const MAX_FACE_IMAGE_WIDTH = 1600;
  let faceApiPromise = null;
  let faceModelsPromise = null;

  function loadFaceApi() {
    if (root.faceapi?.nets?.ssdMobilenetv1) return Promise.resolve(root.faceapi);
    if (!root.document) return Promise.reject(new Error('Face matching is only available in a browser.'));
    if (!faceApiPromise) {
      faceApiPromise = new Promise((resolve, reject) => {
        const script = root.document.createElement('script');
        script.src = FACE_API_SCRIPT_URL;
        script.async = true;
        script.onload = () => root.faceapi?.nets?.ssdMobilenetv1
          ? resolve(root.faceapi)
          : reject(new Error('The face matching library did not load correctly.'));
        script.onerror = () => reject(new Error('The face matching library could not be downloaded.'));
        root.document.head.appendChild(script);
      }).catch(error => {
        faceApiPromise = null;
        throw error;
      });
    }
    return faceApiPromise;
  }

  async function loadFaceModels(faceapi) {
    if (!faceModelsPromise) {
      faceModelsPromise = Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL)
      ]).catch(error => {
        faceModelsPromise = null;
        throw error;
      });
    }
    return faceModelsPromise;
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(source);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The image could not be opened for face detection.'));
      };
      image.src = url;
    });
  }

  function faceSharpness(image, box) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const marginX = box.width * 0.12;
    const marginY = box.height * 0.12;
    const left = Math.max(0, Math.floor(box.x - marginX));
    const top = Math.max(0, Math.floor(box.y - marginY));
    const right = Math.min(imageWidth, Math.ceil(box.x + box.width + marginX));
    const bottom = Math.min(imageHeight, Math.ceil(box.y + box.height + marginY));
    const width = right - left;
    const height = bottom - top;
    if (width < 3 || height < 3) return 0;

    const canvas = root.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The face image could not be checked for clarity.');
    context.drawImage(image, left, top, width, height, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const gray = new Float32Array(width * height);
    for (let index = 0; index < gray.length; index += 1) {
      gray[index] = 0.299 * pixels[index * 4] + 0.587 * pixels[index * 4 + 1] + 0.114 * pixels[index * 4 + 2];
    }
    let sum = 0;
    let sumSquared = 0;
    let count = 0;
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

  function resizeForFaceDetection(image) {
    const scale = Math.min(1, MAX_FACE_IMAGE_WIDTH / image.naturalWidth);
    if (scale === 1) return image;
    const canvas = root.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The image could not be prepared for face detection.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function compareDescriptors(first, second) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== 128 || second.length !== 128) {
      throw new Error('A face descriptor is missing or invalid.');
    }
    let squaredDistance = 0;
    for (let index = 0; index < first.length; index += 1) {
      const a = Number(first[index]);
      const b = Number(second[index]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('A face descriptor contains invalid values.');
      squaredDistance += (a - b) ** 2;
    }
    return Math.sqrt(squaredDistance);
  }

  function similarityIndicator(distance) {
    return Math.round(100 / (1 + distance));
  }

  function classifyDistance(distance) {
    return Number.isFinite(distance) && distance <= FACE_MATCH_DISTANCE ? 'match' : 'no_match';
  }

  async function inspectFace(source) {
    const faceapi = await loadFaceApi();
    await loadFaceModels(faceapi);
    const loadedImage = await loadImage(source);
    const image = resizeForFaceDetection(loadedImage);
    const faces = await faceapi.detectAllFaces(
      image,
      new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 3 })
    ).withFaceLandmarks().withFaceDescriptors();

    if (!faces.length) return { status: 'not_detected', count: 0 };
    if (faces.length > 1) return { status: 'multiple', count: faces.length };

    const face = faces[0];
    const sharpness = faceSharpness(image, face.detection.box);
    const confidence = Number(face.detection.score);
    if (sharpness < MIN_FACE_SHARPNESS) {
      return {
        status: 'blurry',
        count: 1,
        confidence: Number.isFinite(confidence) ? confidence : null
      };
    }
    return {
      status: 'detected',
      count: 1,
      confidence: Number.isFinite(confidence) ? confidence : null,
      descriptor: Array.from(face.descriptor)
    };
  }

  async function compareImages(idImage, capturedImage) {
    const idFace = await inspectFace(idImage);
    const capturedFace = await inspectFace(capturedImage);
    const result = {
      idFace: { status: idFace.status, count: idFace.count, confidence: idFace.confidence ?? null },
      capturedFace: { status: capturedFace.status, count: capturedFace.count, confidence: capturedFace.confidence ?? null },
      distance: null,
      threshold: FACE_MATCH_DISTANCE,
      similarityIndicator: null,
      result: 'unable'
    };
    if (idFace.status !== 'detected' || capturedFace.status !== 'detected') return result;

    const distance = compareDescriptors(idFace.descriptor, capturedFace.descriptor);
    result.distance = distance;
    result.similarityIndicator = similarityIndicator(distance);
    result.result = classifyDistance(distance);
    return result;
  }

  const api = {
    compareDescriptors,
    compareImages,
    classifyDistance,
    faceMatchDistance: FACE_MATCH_DISTANCE,
    similarityIndicator
  };
  root.CostTrackFaceMatching = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
