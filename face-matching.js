(function exposeCostTrackFaceMatching(root) {
  const FACE_API_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.js';
  const FACE_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';
  const PASSED_SIMILARITY_SCORE = 85;
  const MANUAL_REVIEW_SIMILARITY_SCORE = 70;
  const MIN_FACE_SHARPNESS = 40;
  const MIN_ID_FACE_SHARPNESS = 8;
  const MIN_ID_FACE_WIDTH_RATIO = 0.035;
  const MAX_FACE_IMAGE_WIDTH = 1600;
  const FACE_SCAN_INSTRUCTIONS = [
    'Look straight at the camera.',
    'Look to the left.',
    'Look to the right.',
    'Move closer to the camera.',
    'Move slightly farther away.'
  ];
  const FACE_SCAN_STEPS = [
    { key: 'straight', text: 'Look straight at the camera.' },
    { key: 'left', text: 'Look to the left.' },
    { key: 'right', text: 'Look to the right.' },
    { key: 'closer', text: 'Move closer to the camera.' },
    { key: 'farther', text: 'Move slightly farther away.' }
  ];
  const LIVE_POSES = FACE_SCAN_STEPS;
  const APPLICANT_LIVE_POSES = FACE_SCAN_STEPS;
  const LOGIN_LIVE_POSES = FACE_SCAN_STEPS;
  const CLOSER_FACTOR = 1.12;
  const FARTHER_FACTOR = 0.90;
  const MIN_LIVE_FACE_WIDTH = 0.14;
  const MAX_LIVE_FACE_WIDTH = 0.48;
  const MIN_LIVE_FACE_CANDIDATE_WIDTH = 0.09;
  const MIN_LIVE_DETECTION_SCORE = 0.6;
  const MIN_SECOND_FACE_WIDTH = 0.12;
  const MIN_SECOND_FACE_SCORE = 0.75;
  const MIN_FACE_GUIDE_OVERLAP = 0.82;
  const REQUIRED_STEADY_FRAMES = 5;
  const MULTIPLE_FACE_CONFIRMATION_FRAMES = 7;
  const FACE_DETECTION_GRACE_MS = 900;
  const LIVE_FACE_EDGE_MARGIN = 0.02;
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
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL),
        faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL)
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
    const imageWidth = image.naturalWidth || image.videoWidth || image.width;
    const imageHeight = image.naturalHeight || image.videoHeight || image.height;
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

  function faceLighting(image, box) {
    const imageWidth = image.naturalWidth || image.videoWidth || image.width;
    const imageHeight = image.naturalHeight || image.videoHeight || image.height;
    const left = Math.max(0, Math.floor(box.x));
    const top = Math.max(0, Math.floor(box.y));
    const right = Math.min(imageWidth, Math.ceil(box.x + box.width));
    const bottom = Math.min(imageHeight, Math.ceil(box.y + box.height));
    if (right - left < 3 || bottom - top < 3) return { average: 0, clippedRatio: 1 };

    const canvas = root.document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The face image could not be checked for lighting.');
    context.drawImage(image, left, top, right - left, bottom - top, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    let brightness = 0;
    let clippedPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
      brightness += luminance;
      if (luminance >= 245) clippedPixels += 1;
    }
    const pixelCount = pixels.length / 4;
    return {
      average: brightness / pixelCount,
      clippedRatio: clippedPixels / pixelCount
    };
  }

  function resizeForFaceDetection(image) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, MAX_FACE_IMAGE_WIDTH / imageWidth);
    if (scale === 1) return image;
    const canvas = root.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(imageWidth * scale));
    canvas.height = Math.max(1, Math.round(imageHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The image could not be prepared for face detection.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function enhanceImage(image, brightnessOffset = 0, contrast = 1.15) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = root.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The image could not be enhanced for face detection.');
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    for (let index = 0; index < imageData.data.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        imageData.data[index + channel] = Math.max(
          0,
          Math.min(255, (imageData.data[index + channel] - 128) * contrast + 128 + brightnessOffset)
        );
      }
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }

  function cropFaceRegion(image, box) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const size = Math.min(
      imageWidth,
      imageHeight,
      Math.max(box.width, box.height) * 1.65
    );
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const left = Math.max(0, Math.min(imageWidth - size, centerX - size / 2));
    const top = Math.max(0, Math.min(imageHeight - size, centerY - size / 2));
    const canvas = root.document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 384;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The face region could not be prepared for verification.');
    context.drawImage(image, left, top, size, size, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function detectFaces(faceapi, image, detector) {
    const detection = detector === 'tiny'
      ? faceapi.detectAllFaces(
        image,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.2 })
      )
      : faceapi.detectAllFaces(
        image,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35, maxResults: 5 })
      );
    return detection.withFaceLandmarks().withFaceDescriptors();
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

  function similarityScore(distance) {
    if (!Number.isFinite(distance) || distance < 0) return 0;
    return Math.max(0, Math.min(100, Math.round((1 - distance / 2) * 100)));
  }

  function classifySimilarity(score) {
    if (!Number.isFinite(score) || score < MANUAL_REVIEW_SIMILARITY_SCORE) return 'no_match';
    return score >= PASSED_SIMILARITY_SCORE ? 'match' : 'manual_review';
  }

  function classifyDistance(distance) {
    return classifySimilarity(similarityScore(distance));
  }

  function eyeAspectRatio(eye) {
    const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
    return (distance(eye[1], eye[5]) + distance(eye[2], eye[4])) /
      (2 * Math.max(distance(eye[0], eye[3]), 1));
  }

  function poseFromLandmarks(points, box, imageWidth) {
    const leftEye = eyeAspectRatio(points.slice(36, 42));
    const rightEye = eyeAspectRatio(points.slice(42, 48));
    const nose = points[30];
    return {
      label: 'straight',
      ratio: box.width / imageWidth,
      eyeRatio: (leftEye + rightEye) / 2,
      yaw: (nose.x - (box.x + box.width / 2)) / box.width
    };
  }

  function poseMatches(pose, info, straight) {
    if (!info) return false;
    if (pose === 'straight') return info.label === 'straight';
    if (!straight || straight.label !== 'straight' || info.label !== 'straight') return false;
    if (pose === 'closer') return info.ratio >= straight.ratio * CLOSER_FACTOR;
    if (pose === 'farther') return info.ratio <= straight.ratio * FARTHER_FACTOR;
    if (pose === 'left') return info.yaw >= straight.yaw + 0.12;
    if (pose === 'right') return info.yaw <= straight.yaw - 0.12;
    return false;
  }

  function faceGuideOverlapRatio(box, videoWidth, videoHeight) {
    if (!box || !box.width || !box.height || !videoWidth || !videoHeight) return 0;
    const visibleSourceWidth = Math.min(videoWidth, videoHeight * (4 / 3));
    const guideRadius = visibleSourceWidth * 0.29;
    const centerX = videoWidth / 2;
    const centerY = videoHeight / 2;
    const samplesPerAxis = 10;
    let insideCount = 0;

    for (let row = 0; row < samplesPerAxis; row += 1) {
      for (let column = 0; column < samplesPerAxis; column += 1) {
        const x = box.x + ((column + 0.5) / samplesPerAxis) * box.width;
        const y = box.y + ((row + 0.5) / samplesPerAxis) * box.height;
        if (Math.hypot(x - centerX, y - centerY) <= guideRadius) insideCount += 1;
      }
    }

    return insideCount / (samplesPerAxis * samplesPerAxis);
  }

  function boxIntersectionOverUnion(first, second) {
    const left = Math.max(first.x, second.x);
    const top = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = first.width * first.height + second.width * second.height - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function distinctLiveFaces(faces, videoWidth, videoHeight) {
    const candidates = (Array.isArray(faces) ? faces : [])
      .filter(face => face?.detection?.box
        && Number(face.detection.score) >= MIN_LIVE_DETECTION_SCORE
        && face.detection.box.width / videoWidth >= MIN_LIVE_FACE_CANDIDATE_WIDTH)
      .sort((first, second) => Number(second.detection.score) - Number(first.detection.score));
    const distinct = [];

    for (const candidate of candidates) {
      if (distinct.some(face => {
        const first = face.detection.box;
        const second = candidate.detection.box;
        const firstCenterX = first.x + first.width / 2;
        const firstCenterY = first.y + first.height / 2;
        const secondCenterX = second.x + second.width / 2;
        const secondCenterY = second.y + second.height / 2;
        const centerDistance = Math.hypot(firstCenterX - secondCenterX, firstCenterY - secondCenterY);
        return boxIntersectionOverUnion(first, second) >= 0.35
          || centerDistance <= Math.max(first.width, first.height, second.width, second.height) * 0.55;
      })) continue;
      distinct.push(candidate);
    }

    if (distinct.length < 2) return distinct;
    const [primary, ...others] = distinct.sort((first, second) =>
      faceGuideOverlapRatio(second.detection.box, videoWidth, videoHeight)
        - faceGuideOverlapRatio(first.detection.box, videoWidth, videoHeight)
      || Number(second.detection.score) - Number(first.detection.score));
    const primaryWidthRatio = primary.detection.box.width / videoWidth;
    const visibleSourceWidth = Math.min(videoWidth, videoHeight * (4 / 3));
    const guideCenterX = videoWidth / 2;
    const guideCenterY = videoHeight / 2;
    const credibleOthers = others.filter(face => {
      const { box } = face.detection;
      const widthRatio = box.width / videoWidth;
      const aspectRatio = box.width / box.height;
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const guideDistance = Math.hypot(centerX - guideCenterX, centerY - guideCenterY);
      return Number(face.detection.score) >= MIN_SECOND_FACE_SCORE
        && widthRatio >= MIN_SECOND_FACE_WIDTH
        && widthRatio >= primaryWidthRatio * 0.5
        && aspectRatio >= 0.45
        && aspectRatio <= 1.5
        && guideDistance <= visibleSourceWidth * 0.4;
    });

    return [primary, ...credibleOthers];
  }

  function createLiveFaceStabilizer() {
    let lastDetectedInfo = null;
    let lastDetectedAt = Number.NEGATIVE_INFINITY;
    let multipleFrames = 0;
    let pendingIssue = '';
    let pendingIssueFrames = 0;

    function update(info, now = Date.now()) {
      if (info?.status === 'multiple') {
        multipleFrames += 1;
        pendingIssue = '';
        pendingIssueFrames = 0;
        if (multipleFrames >= MULTIPLE_FACE_CONFIRMATION_FRAMES) {
          return { status: 'multiple', info, current: false };
        }
        if (lastDetectedInfo && now - lastDetectedAt <= FACE_DETECTION_GRACE_MS) {
          return { status: 'detected', info: lastDetectedInfo, current: false };
        }
        return { status: 'pending', info: null, current: false };
      }

      multipleFrames = 0;
      if (info?.status === 'detected') {
        lastDetectedInfo = info;
        lastDetectedAt = now;
        pendingIssue = '';
        pendingIssueFrames = 0;
        return { status: 'detected', info, current: true };
      }

      const issue = info?.status || 'not_detected';
      if (lastDetectedInfo && now - lastDetectedAt <= FACE_DETECTION_GRACE_MS) {
        pendingIssue = '';
        pendingIssueFrames = 0;
        return { status: 'detected', info: lastDetectedInfo, current: false };
      }

      lastDetectedInfo = null;
      if (issue === pendingIssue) {
        pendingIssueFrames += 1;
      } else {
        pendingIssue = issue;
        pendingIssueFrames = 1;
      }
      if (pendingIssueFrames < 3) return { status: 'pending', info: null, current: false };
      return { status: issue, info, current: false };
    }

    return { update };
  }

  function liveFrameIssue(status) {
    if (status === 'not_detected' || status === 'unavailable') return 'Position your face inside the guide frame.';
    if (status === 'multiple') return 'Only one person should be visible during verification.';
    if (status === 'too_far') return 'Move closer to the camera.';
    if (status === 'too_close') return 'Move slightly away from the camera.';
    if (status === 'too_dark' || status === 'poor_lighting') return 'Improve lighting and try again.';
    if (status === 'too_bright') return 'Reduce glare and excessive lighting.';
    if (status === 'blurry') return 'Hold still while the camera focuses.';
    if (status === 'partial') return 'Ensure that the entire face is visible.';
    if (status === 'off_center') return 'Position your face inside the guide frame.';
    return '';
  }

  function faceScanError(status, context = 'id') {
    if (context === 'id') {
      if (status === 'not_detected') return 'No face was detected in the uploaded ID. Please upload a valid ID image.';
      if (status === 'blurry') return 'The ID photo is too blurry for verification. Please upload a clearer image.';
      if (status === 'too_small') return 'The face in the uploaded ID is too small to verify. Please upload a higher-quality image.';
      if (status === 'multiple') return 'Multiple faces were detected. Only one face should appear on the uploaded ID.';
    }
    return liveFrameIssue(status) || 'The face could not be read clearly. Please try the face scan again.';
  }

  async function captureLiveFace(video, {
    isCancelled = () => false,
    onStatus = () => {},
    onProgress = () => {}
  } = {}) {
    let straightPose = null;
    let photo = null;
    const faceStabilizer = createLiveFaceStabilizer();
    const captureFrame = () => new Promise((resolve, reject) => {
      const canvas = root.document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('The face scan could not be prepared.'));
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('The face scan image could not be created.')),
        'image/jpeg',
        0.95
      );
    });

    for (let stepIndex = 0; stepIndex < FACE_SCAN_STEPS.length; stepIndex += 1) {
      if (isCancelled()) return null;
      const step = FACE_SCAN_STEPS[stepIndex];
      onStatus(step.text);
      onProgress(0);
      let steadyFrames = 0;
      let stepPassed = false;

      while (!stepPassed) {
        if (isCancelled()) return null;
        const info = await inspectLiveFrame(video);
        if (isCancelled()) return null;
        const tracked = faceStabilizer.update(info);

        if (tracked.status === 'detected' && !tracked.current) {
          onStatus(step.text);
        } else if (tracked.status === 'pending') {
          onStatus(step.text);
        } else if (tracked.status !== 'detected') {
          steadyFrames = 0;
          onStatus(liveFrameIssue(tracked.status) || step.text);
        } else {
          const currentInfo = tracked.info;
          if (step.key === 'straight') {
            const lookingForward = currentInfo.eyeRatio >= 0.18 && Math.abs(currentInfo.yaw) <= 0.12;
            steadyFrames = lookingForward ? steadyFrames + 1 : 0;
            if (steadyFrames >= REQUIRED_STEADY_FRAMES) {
              straightPose = currentInfo;
              photo = await captureFrame();
              stepPassed = true;
            }
          } else if (['left', 'right', 'closer', 'farther'].includes(step.key)) {
            steadyFrames = poseMatches(step.key, currentInfo, straightPose) ? steadyFrames + 1 : 0;
            stepPassed = steadyFrames >= REQUIRED_STEADY_FRAMES;
          }
          if (!stepPassed) onStatus(step.text);
        }

        onProgress(Math.min(steadyFrames / REQUIRED_STEADY_FRAMES, 1));
        if (stepPassed) break;
        await new Promise(resolve => setTimeout(resolve, 180));
      }

      onStatus(`${step.text} — complete.`);
      onProgress(1);
      await new Promise(resolve => setTimeout(resolve, 180));
    }

    if (isCancelled()) return null;
    if (!photo) throw new Error('The face scan could not be captured. Please try again.');
    onStatus('Wait while verification is being completed.');
    const inspected = await inspectFace(photo, { context: 'live' });
    if (isCancelled()) return null;
    if (inspected.status !== 'detected' || !Array.isArray(inspected.descriptor)) {
      throw new Error(faceScanError(inspected.status, 'live'));
    }
    return { descriptor: inspected.descriptor, photo };
  }

  async function inspectLiveFrame(video) {
    if (!video?.videoWidth || !video?.videoHeight) {
      return { status: 'unavailable' };
    }
    const faceapi = await loadFaceApi();
    await loadFaceModels(faceapi);
    const detectedFaces = await faceapi.detectAllFaces(
      video,
      new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_LIVE_DETECTION_SCORE, maxResults: 5 })
    ).withFaceLandmarks();
    const faces = distinctLiveFaces(detectedFaces, video.videoWidth, video.videoHeight);

    if (!faces.length) return { status: 'not_detected' };

    const face = faces[0];
    const box = face.detection.box;
    const faceWidthRatio = box.width / video.videoWidth;
    if (faceWidthRatio < MIN_LIVE_FACE_WIDTH) return { status: 'too_far' };
    if (faceWidthRatio > MAX_LIVE_FACE_WIDTH) return { status: 'too_close' };
    const edgeMarginX = video.videoWidth * LIVE_FACE_EDGE_MARGIN;
    const edgeMarginY = video.videoHeight * LIVE_FACE_EDGE_MARGIN;
    if (
      box.x < edgeMarginX
      || box.y < edgeMarginY
      || box.x + box.width > video.videoWidth - edgeMarginX
      || box.y + box.height > video.videoHeight - edgeMarginY
    ) {
      return { status: 'partial' };
    }
    if (faceGuideOverlapRatio(box, video.videoWidth, video.videoHeight) < MIN_FACE_GUIDE_OVERLAP) {
      return { status: 'off_center' };
    }
    const lighting = faceLighting(video, box);
    if (lighting.average < 50) return { status: 'too_dark' };
    if (lighting.average > 215 || lighting.clippedRatio > 0.35) return { status: 'too_bright' };
    if (faceSharpness(video, box) < MIN_FACE_SHARPNESS) {
      return { status: 'blurry' };
    }
    if (faces.length > 1) return { status: 'multiple', count: faces.length };

    return {
      status: 'detected',
      confidence: Number(face.detection.score),
      ratio: faceWidthRatio,
      ...poseFromLandmarks(face.landmarks.positions, box, video.videoWidth)
    };
  }

  async function inspectFace(source, { context: sourceContext = 'id' } = {}) {
    const faceapi = await loadFaceApi();
    await loadFaceModels(faceapi);
    const loadedImage = await loadImage(source);
    const image = resizeForFaceDetection(loadedImage);
    const brightened = enhanceImage(image, 20, 1.2);
    const darkened = enhanceImage(image, -15, 1.2);
    const detectionAttempts = [
      { image, detector: 'ssd' },
      { image: brightened, detector: 'ssd' },
      { image: darkened, detector: 'tiny' }
    ];
    let sawSmallFace = false;
    let sawBlurryFace = false;

    for (const attempt of detectionAttempts) {
      const faces = await detectFaces(faceapi, attempt.image, attempt.detector);
      if (faces.length > 1) return { status: 'multiple', count: faces.length };
      if (!faces.length) continue;

      const face = faces[0];
      const width = attempt.image.naturalWidth || attempt.image.width;
      const faceWidthRatio = face.detection.box.width / width;
      if (sourceContext === 'id' && faceWidthRatio < MIN_ID_FACE_WIDTH_RATIO) {
        sawSmallFace = true;
        continue;
      }

      const originalSharpness = faceSharpness(attempt.image, face.detection.box);
      if (originalSharpness < MIN_ID_FACE_SHARPNESS) sawBlurryFace = true;
      const crop = cropFaceRegion(attempt.image, face.detection.box);
      const cropAttempts = [
        { image: crop, detector: 'ssd' },
        { image: enhanceImage(crop, 18, 1.25), detector: 'ssd' },
        { image: enhanceImage(crop, -12, 1.25), detector: 'tiny' }
      ];

      for (const cropAttempt of cropAttempts) {
        const croppedFaces = await detectFaces(faceapi, cropAttempt.image, cropAttempt.detector);
        if (croppedFaces.length > 1) return { status: 'multiple', count: croppedFaces.length };
        if (!croppedFaces.length) continue;
        const croppedFace = croppedFaces[0];
        const sharpness = faceSharpness(cropAttempt.image, croppedFace.detection.box);
        const minimumSharpness = sourceContext === 'id'
          ? MIN_ID_FACE_SHARPNESS
          : MIN_FACE_SHARPNESS;
        if (sharpness < minimumSharpness) {
          sawBlurryFace = true;
          continue;
        }
        return {
          status: 'detected',
          count: 1,
          confidence: Number.isFinite(Number(croppedFace.detection.score))
            ? Number(croppedFace.detection.score)
            : null,
          descriptor: Array.from(croppedFace.descriptor)
        };
      }

      const minimumSharpness = sourceContext === 'id'
        ? MIN_ID_FACE_SHARPNESS
        : MIN_FACE_SHARPNESS;
      if (
        originalSharpness >= minimumSharpness
        && Array.isArray(face.descriptor)
      ) {
        return {
          status: 'detected',
          count: 1,
          confidence: Number.isFinite(Number(face.detection.score))
            ? Number(face.detection.score)
            : null,
          descriptor: Array.from(face.descriptor)
        };
      }
    }

    if (sawSmallFace) return { status: 'too_small', count: 1 };
    if (sawBlurryFace) return { status: 'blurry', count: 1 };
    return { status: 'not_detected', count: 0 };
  }

  async function compareImages(idImage, capturedImage) {
    const idFace = await inspectFace(idImage);
    const capturedFace = await inspectFace(capturedImage, { context: 'live' });
    const result = {
      idFace: { status: idFace.status, count: idFace.count, confidence: idFace.confidence ?? null },
      capturedFace: { status: capturedFace.status, count: capturedFace.count, confidence: capturedFace.confidence ?? null },
      distance: null,
      passedSimilarityScore: PASSED_SIMILARITY_SCORE,
      manualReviewSimilarityScore: MANUAL_REVIEW_SIMILARITY_SCORE,
      similarityScore: null,
      similarityIndicator: null,
      result: 'unable'
    };
    if (idFace.status !== 'detected' || capturedFace.status !== 'detected') return result;

    const distance = compareDescriptors(idFace.descriptor, capturedFace.descriptor);
    result.distance = distance;
    result.similarityScore = similarityScore(distance);
    result.similarityIndicator = result.similarityScore;
    result.result = classifyDistance(distance);
    return result;
  }

  const api = {
    compareDescriptors,
    compareImages,
    classifyDistance,
    classifySimilarity,
    similarityScore,
    similarityIndicator: similarityScore,
    LIVE_POSES,
    FACE_SCAN_INSTRUCTIONS,
    FACE_SCAN_STEPS,
    APPLICANT_LIVE_POSES,
    LOGIN_LIVE_POSES,
    captureLiveFace,
    createLiveFaceStabilizer,
    distinctLiveFaces,
    faceScanError,
    faceGuideOverlapRatio,
    liveFrameIssue,
    inspectFace,
    inspectLiveFrame,
    poseFromLandmarks,
    poseMatches
  };
  root.CostTrackFaceMatching = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
