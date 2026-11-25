(function exposeCostTrackOcr(root) {
  const MIN_FIELD_CONFIDENCE = 0.65;
  const MIN_SHARPNESS = 40;
  const MAX_IMAGE_WIDTH = 2200;
  const ID_PATTERNS = {
    philid: /\b\d{4}(?:[\s-]{0,3}\d{4}){3}\b/,
    drivers: /\b[A-Z]\s?\d{2}[\s-]{0,3}\d{2}[\s-]{0,3}\d{6}\b/,
    umid: /\b\d{4}[\s-]{0,3}\d{7}[\s-]{0,3}\d\b/,
    sss: /\b(?:\d{2}[\s-]?\d{7}[\s-]?\d|\d{3}[\s-]?\d{7}[\s-]?\d)\b/,
    philhealth: /\b\d{2}[\s-]?\d{8,9}[\s-]?\d{1,2}\b/
  };
  const CARD_ID_NUMBER_RULES = {
    philid: { digitCounts: [16], groupings: [[4, 4, 4, 4]], targetY: 0.34 },
    sss: { digitCounts: [10, 11], groupings: [[2, 7, 1], [3, 7, 1]], targetY: 0.48 },
    philhealth: { digitCounts: [12], groupings: [[2, 9, 1], [2, 8, 2]], targetY: 0.42 }
  };
  const CARD_TYPE_MARKERS = {
    philid: /\b(?:PHILSYS|PHIL\s*ID|PHILIPPINE\s+(?:NATIONAL\s+)?IDENTIFICATION(?:\s+SYSTEM)?|NATIONAL\s+ID)\b/i,
    drivers: /\b(?:DRIVER'?S?\s+LICEN[CS]E|DRIVING\s+LICEN[CS]E|LAND\s+TRANSPORTATION\s+OFFICE|LTO)\b/i,
    sss: /\b(?:SOCIAL\s+SECURITY\s+SYSTEM|MY\s*SSS(?:\s+CARD)?|SSS\s+CARD|SSS\s*(?:NO\.?|NUMBER|ID))\b/i,
    philhealth: /\b(?:PHILHEALTH|PHILIPPINE\s+HEALTH\s+INSURANCE(?:\s+CORPORATION)?)\b/i,
    pagibig: /\b(?:PAG\s*[- ]?\s*IBIG\s+FUND|LOYALTY\s+CARD\s+PLUS)\b/i
  };
  const CARD_TYPE_INDICATORS = {
    philid: [
      /\bPAMBANSANG\s+PAGKAKAKILAN\w*/i,
      /\bPHILIPPINE\s+IDENTIFICATION\s+CARD\b/i
    ],
    drivers: [
      /\bDEPARTMENT\s+OF\s+TRANSPORTATION\b/i,
      /\bLAND\s+TRANSPORTATION\s+OFFICE\b/i,
      /\bDRIVER'?S?\s+LICEN[CS]E\b/i
    ],
    sss: [
      /\bSOCIAL\s+SECURITY\s+SYSTEM\b/i
    ],
    philhealth: [
      /\bPHILHEALTH\b|\bPHILIPPINE\s+HEALTH\s+INSURANCE\s+CORPORATION\b/i
    ],
    pagibig: [
      /\bPAG\s*[- ]?\s*IBIG\b/i
    ]
  };
  const CARD_TYPE_INDICATOR_THRESHOLD = 1;
  const CARD_TYPE_INDICATOR_THRESHOLDS = {
    drivers: 3
  };
  const ID_TYPE_MARKERS = {
    philid: CARD_TYPE_MARKERS.philid,
    drivers: CARD_TYPE_MARKERS.drivers,
    umid: /\b(?:SSS|UMID|UNIFIED\s+MULTI[- ]PURPOSE(?:\s+ID)?|PHILHEALTH|PHILIPPINE\s+HEALTH\s+INSURANCE|PAG\s*[- ]?\s*IBIG|LOYALTY\s+CARD\s+PLUS)\b/i
  };
  const ID_TYPE_NAMES = {
    philid: 'Philippine National ID (PhilSys)',
    drivers: "Driver's License",
    umid: 'UMID (SSS, PhilHealth, and Pag-IBIG)'
  };
  const CARD_TYPE_NAMES = {
    philid: 'Philippine National ID',
    drivers: "Driver's License",
    sss: 'SSS Card',
    philhealth: 'PhilHealth ID',
    pagibig: 'Pag-IBIG Loyalty Card Plus'
  };
  const CARD_TYPE_CATEGORIES = {
    philid: 'philid',
    drivers: 'drivers',
    sss: 'umid',
    philhealth: 'umid',
    pagibig: 'umid'
  };
  const CARD_TYPE_EVIDENCE = {
    philid: {
      labels: [/\b(?:PSN|PCN|CRN)\b/i, /\b(?:given|first|last|middle)\s*names?\b|apelyido|pangalan/i, /\bdate\s*of\s*birth|kapanganakan\b/i, /\baddress|tirahan\b/i],
      layouts: [/\b(?:PSN|PCN|CRN)\b/i, /\b(?:date\s*of\s*birth|kapanganakan)\b[\s\S]{0,120}\b(?:address|tirahan)\b/i]
    },
    drivers: {
      labels: [/\b(?:license|licen[cs]e)\s*(?:number|no\.?)|DLN\b/i, /\b(?:given|first|last|middle)\s*names?\b|surname/i, /\b(?:date\s*of\s*birth|birth\s*date|birthday)\b/i, /\b(?:restriction|expiration|expiry)\b/i],
      layouts: [/\b(?:license|licen[cs]e)\s*(?:number|no\.?)|DLN\b/i, /\b(?:restriction|expiration|expiry)\b/i]
    },
    sss: {
      labels: [/\bSSS\s*(?:NO\.?|NUMBER|ID)\b/i, /\b(?:given|first)\s*names?\b/i, /\b(?:surname|last\s*name)\b/i],
      layouts: [/\bSSS\s*(?:NO\.?|NUMBER|ID)\b/i, /\b(?:given|first)\s*names?[\s\S]{0,100}\b(?:surname|last\s*name)\b/i]
    },
    philhealth: {
      labels: [/\b(?:PHILHEALTH\s*)?(?:NUMBER|NO\.?|ID)\b/i, /\b(?:member\s*)?name\b/i, /\b(?:date\s*of\s*birth|birth\s*date|birthday)\b/i, /\bmembership\s*category\b/i],
      layouts: [/\b(?:PHILHEALTH\s*)?(?:NUMBER|NO\.?|ID)\b/i, /\bmember\s*name\b/i]
    },
    pagibig: {
      labels: [/\bMID\s*(?:NO\.?|NUMBER)\b/i, /\b(?:full\s*)?name\b/i, /\bcard\s*(?:number|no\.?)\b/i],
      layouts: [/\bMID\s*(?:NO\.?|NUMBER)\b/i, /\b(?:LOYALTY\s+CARD\s+PLUS|card\s*(?:number|no\.?))\b/i]
    }
  };
  const CARD_REQUIRED_FIELDS = {
    philid: ['full_name', 'dob', 'id_number'],
    drivers: ['full_name', 'dob', 'id_number'],
    sss: ['full_name', 'id_number'],
    philhealth: ['full_name', 'dob', 'id_number'],
    pagibig: ['full_name', 'id_number'],
    umid: ['full_name', 'id_number']
  };
  const ID_FIELD_LAYOUTS = {
    philid: {
      givenName: /\b(?:mga\s*pangalan\s*\/\s*given\s*names?|given\s*names?|mga\s*pangalan)\b\s*[:：-]?/i,
      middleName: /\b(?:gitnang\s*apelyido\s*\/\s*middle\s*name|middle\s*name|gitnang\s*apelyido)\b\s*[:：-]?/i,
      familyName: /^\s*(?:apelyido\s*\/\s*last\s*name|last\s*name|apelyido)\b\s*[:：-]?/i,
      dob: /\b(?:pets?\s*a\s+ng\s+kapanganakan|date\s*of\s*birth)\b\s*[:：-]?/i
    },
    drivers: {
      fullName: /(?:\bfull\s*name\b|^\s*name\b)\s*[:：-]?/i,
      givenName: /\b(?:given\s*names?|given\s*name|first\s*names?|first\s*name|mga\s*pangalan|pangalan)\b\s*[:：-]?/i,
      middleName: /\b(?:middle\s*names?|middle\s*name|middle\s*initials?|middlename|gitnang\s*apelyido)\b\s*[:：-]?/i,
      familyName: /\b(?:last\s*name|family\s*name|surname|apelyido)\b\s*[:：-]?/i,
      dob: /(?:date\s*of\s*birth|birth\s*date|birthdate|birthday|b[i1]r[t7]h|d\s*\.?\s*[o0]\s*\.?\s*b|petsa\s+ng\s+kapanganakan|araw\s+ng\s+kapanganakan|kapanganakan)\b\s*[:：-]?/i
    },
    umid: {
      fullName: /(?:\bfull\s*name\b|\bmember\s*name\b|\bcardholder\s*name\b|^\s*name\b)\s*[:：-]?/i,
      givenName: /\b(?:first\s*names?|first\s*name|given\s*names?|given\s*name|mga\s*pangalan|pangalan)\b\s*[:：-]?/i,
      middleName: /\b(?:middle\s*names?|middle\s*name|middle\s*initials?|middlename|gitnang\s*apelyido)\b\s*[:：-]?/i,
      familyName: /\b(?:surname|last\s*name|family\s*name|apelyido)\b\s*[:：-]?/i,
      dob: /(?:date\s*of\s*birth|date\s*birth|birth\s*date|birthdate|birthday|b[i1]r[t7]h|d\s*\.?\s*[o0]\s*\.?\s*b|petsa\s+ng\s+kapanganakan|araw\s+ng\s+kapanganakan|kapanganakan)\b\s*[:：-]?/i
    }
  };
  const MAX_OCR_ATTEMPTS = 3;
  const FIELD_LABELS = /\b(?:full\s*name|member\s*name|cardholder\s*name|given\s*names?|first\s*names?|mga\s*pangalan|last\s*name|family\s*name|surname|middle\s*names?|middle\s*initials?|middlename|gitnang\s*apelyido|name|pangalan|apelyido|date\s*of\s*birth|date\s*birth|birth\s*date|birthdate|birthday|b[i1]r[t7]h|d[o0]b|d\.o\.b|petsa\s+ng\s+kapanganakan|araw\s+ng\s+kapanganakan|kapanganakan|address|residential\s*address|current\s*address|permanent\s*address|place\s*of\s*residence|residence|tirahan|id\s*(?:number|no\.?)|(?:sss|philhealth)\s*(?:(?:identification|id)\s*)?(?:number|no\.?|id)|mid\s*(?:number|no\.?)|umid\s*(?:number|no\.?|id)|license\s*(?:number|no\.?)|pin|crn|psn|pcn|dln|philsys(?:\s+card)?\s*(?:number|no\.?)|nationality|signature|sex|date\s*of\s*expiry|expiry|expiration|valid\s*(?:until|thru|through)|membership\s*category|card\s*(?:number|no\.?))\b/i;
  const NON_PERSON_NAME = /\b(?:republic|republik(?:a|ang)?|philippines|pilipinas|government|identification|national|pambansang|pagkakakilanlan|passport|license|driver|transportation|signature|address|nationality|birth|expiry|valid|until|sex|male|female|blood|agency|philsys|umid|sss|philhealth|pag-?ibig|loyalty|card)\b/i;
  const MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  const PHILIPPINE_PROVINCES = [
    'Abra', 'Agusan del Norte', 'Agusan del Sur', 'Aklan', 'Albay', 'Antique',
    'Apayao', 'Aurora', 'Basilan', 'Bataan', 'Batanes', 'Batangas', 'Benguet',
    'Biliran', 'Bohol', 'Bukidnon', 'Bulacan', 'Cagayan', 'Camarines Norte',
    'Camarines Sur', 'Camiguin', 'Capiz', 'Catanduanes', 'Cavite', 'Cebu',
    'Cotabato', 'Davao de Oro', 'Davao del Norte', 'Davao del Sur',
    'Davao Occidental', 'Davao Oriental', 'Dinagat Islands', 'Eastern Samar',
    'Guimaras', 'Ifugao', 'Ilocos Norte', 'Ilocos Sur', 'Iloilo', 'Isabela',
    'Kalinga', 'La Union', 'Laguna', 'Lanao del Norte', 'Lanao del Sur',
    'Leyte', 'Maguindanao del Norte', 'Maguindanao del Sur', 'Marinduque',
    'Masbate', 'Misamis Occidental', 'Misamis Oriental', 'Mountain Province',
    'Negros Occidental', 'Negros Oriental', 'Northern Samar', 'Nueva Ecija',
    'Nueva Vizcaya', 'Occidental Mindoro', 'Oriental Mindoro', 'Palawan',
    'Pampanga', 'Pangasinan', 'Quezon', 'Quirino', 'Rizal', 'Romblon', 'Samar',
    'Sarangani', 'Siquijor', 'Sorsogon', 'South Cotabato', 'Southern Leyte',
    'Sultan Kudarat', 'Sulu', 'Surigao del Norte', 'Surigao del Sur', 'Tarlac',
    'Tawi-Tawi', 'Zambales', 'Zamboanga del Norte', 'Zamboanga del Sur',
    'Zamboanga Sibugay'
  ];
  const ID_NUMBER_LABEL = /\b(?:ID\s*(?:NUMBER|NO\.?)|LICENSE\s*(?:NUMBER|NO\.?)|LICEN[CS]E\s*(?:NUMBER|NO\.?)|DRIVER'?S?\s+LICEN[CS]E\s*(?:NUMBER|NO\.?)|DLN|(?:SSS|PHILHEALTH)\s*(?:(?:IDENTIFICATION|ID)\s*)?(?:NUMBER|NO\.?|ID)|PHILSYS(?:\s+CARD)?\s*(?:NUMBER|NO\.?)|MID\s*(?:NUMBER|NO\.?)|UMID\s*(?:NUMBER|NO\.?|ID)|(?:P\.?\s*S\.?\s*N\.?|P\.?\s*C\.?\s*N\.?|CRN|PIN)\s*(?:NUMBER|NO\.?)?|CARD\s*(?:NUMBER|NO\.?))(?=$|[\s:：#-])/i;
  const TESSERACT_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let tesseractLoadPromise = null;
  let paddleOcrLoadPromise = null;

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
    for (const match of String(text || '').matchAll(/\b(\d{4})\s+(\d{1,2})\s+(\d{1,2})\b/g)) {
      dates.push(isoDate(match[1], match[2], match[3]));
    }
    for (const match of String(text || '').matchAll(/\b([0-9Oo]{1,2})\s*[-/.]\s*([0-9Oo]{1,2})\s*[-/.]\s*(\d{4})\b/g)) {
      const first = Number(match[1].replace(/[Oo]/g, '0'));
      const second = Number(match[2].replace(/[Oo]/g, '0'));
      const month = second > 12 ? first : second;
      const day = second > 12 ? second : first;
      dates.push(isoDate(match[3], month, day));
    }
    for (const match of String(text || '').matchAll(/\b([0-9Oo]{1,2})\s+([0-9Oo]{1,2})\s+(\d{4})\b/g)) {
      const first = Number(match[1].replace(/[Oo]/g, '0'));
      const second = Number(match[2].replace(/[Oo]/g, '0'));
      const month = second > 12 ? first : second;
      const day = second > 12 ? second : first;
      dates.push(isoDate(match[3], month, day));
    }
    for (const match of String(text || '').matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
      const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
      if (month) dates.push(isoDate(match[3], month, match[2]));
    }
    for (const match of String(text || '').matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/g)) {
      const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
      if (month) dates.push(isoDate(match[3], month, match[1]));
    }
    for (const match of String(text || '').matchAll(/\b([0-9Oo]{8})\b/g)) {
      const digits = match[1].replace(/[Oo]/g, '0');
      const currentYear = new Date().getUTCFullYear();
      const yearFirst = Number(digits.slice(0, 4));
      if (yearFirst >= 1900 && yearFirst <= currentYear) {
        dates.push(isoDate(yearFirst, digits.slice(4, 6), digits.slice(6, 8)));
        continue;
      }
      const year = digits.slice(4);
      const dayFirst = isoDate(year, digits.slice(2, 4), digits.slice(0, 2));
      const monthFirst = isoDate(year, digits.slice(0, 2), digits.slice(2, 4));
      dates.push(dayFirst || monthFirst);
    }
    return dates.filter(Boolean);
  }

  function matchingCardTypes(value) {
    const combined = String(value || '').toUpperCase();
    const marked = Object.entries(CARD_TYPE_INDICATORS)
      .filter(([type]) => cardTypeIndicatorPoints(combined, type)
        >= (CARD_TYPE_INDICATOR_THRESHOLDS[type] || CARD_TYPE_INDICATOR_THRESHOLD)
        || hasLayoutSupportedTypeEvidence(combined, type))
      .map(([type]) => type);
    const uniqueMarked = [...new Set(marked)];
    return uniqueMarked;
  }

  function cardTypeIndicatorPoints(text, cardType) {
    const patterns = CARD_TYPE_INDICATORS[cardType] || [];
    const normalizedText = String(text || '').toUpperCase();
    return patterns.reduce((points, pattern) => points + Number(pattern.test(normalizedText)), 0);
  }

  function hasLayoutSupportedTypeEvidence(text, cardType) {
    if (['philid', 'drivers'].includes(cardType)
      || cardTypeIndicatorPoints(text, cardType) < 1) return false;
    const evidence = CARD_TYPE_EVIDENCE[cardType];
    if (!evidence) return false;
    const normalizedText = String(text || '').toUpperCase();
    return evidence.labels.some(pattern => pattern.test(normalizedText))
      && evidence.layouts.some(pattern => pattern.test(normalizedText));
  }

  function detectSingleCardType(value) {
    const marked = matchingCardTypes(value);
    if (marked.length === 1) return marked[0];
    if (marked.length > 1) {
      const ranked = marked
        .map(type => ({ type, points: cardTypeIndicatorPoints(value, type) }))
        .sort((first, second) => second.points - first.points);
      if (ranked[0].points - ranked[1].points >= CARD_TYPE_INDICATOR_THRESHOLD) return ranked[0].type;
      return null;
    }
    const combined = String(value || '').toUpperCase();
    return null;
  }

  function detectCardType(texts) {
    const combined = Array.isArray(texts) ? texts.filter(Boolean).join('\n') : texts;
    return detectSingleCardType(combined);
  }

  function detectIdType(texts) {
    const cardType = detectCardType(texts);
    return CARD_TYPE_CATEGORIES[cardType] || null;
  }

  function cardTypeConfidence(text, cardType, ocrConfidence = 1) {
    const evidence = CARD_TYPE_EVIDENCE[cardType];
    if (!CARD_TYPE_INDICATORS[cardType] || !evidence) return 0;
    const normalizedText = String(text || '').toUpperCase();
    const indicatorPoints = cardTypeIndicatorPoints(normalizedText, cardType);
    const matchedLabels = evidence.labels.filter(pattern => pattern.test(normalizedText)).length;
    const matchedLayouts = evidence.layouts.filter(pattern => pattern.test(normalizedText)).length;
    const confidence = Math.max(0, Math.min(1, Number(ocrConfidence) || 0));
    return Math.round(
      Math.min(indicatorPoints / CARD_TYPE_INDICATOR_THRESHOLD, 1) * 50
      + Math.min(matchedLabels / 3, 1) * 20
      + Math.min(matchedLayouts / 2, 1) * 20
      + confidence * 10
    );
  }

  function confidenceStatus(confidence) {
    if (confidence >= 90) return 'verified';
    if (confidence >= 60) return 'accepted';
    if (confidence >= 40) return 'needs_review';
    return 'rejected';
  }

  function requiredFieldsForIdType(idType, cardType = '') {
    const resolvedCardType = cardType || (idType === 'philid' ? 'philid' : idType === 'drivers' ? 'drivers' : '');
    return [...(CARD_REQUIRED_FIELDS[resolvedCardType] || CARD_REQUIRED_FIELDS[idType] || [])];
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

  function valueAfterLabel(lines, pattern, followingLines = 1, minInlineLength = 2, skipTypeMarkers = false) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = pattern.exec(lines[index]);
      if (!match) continue;
      const inline = trimAtFieldLabel(lines[index].slice(match.index + match[0].length));
      const parts = inline.length >= minInlineLength && !FIELD_LABELS.test(inline) ? [inline] : [];
      if (parts.length && parts[0].split(/\s+/).length >= 3) return parts[0];
      for (let offset = 1; offset <= followingLines && index + offset < lines.length; offset += 1) {
        const next = cleanValue(lines[index + offset]);
        if (!next || FIELD_LABELS.test(next)) break;
        if (Object.values(ID_TYPE_MARKERS).some(marker => marker.test(next)) || NON_PERSON_NAME.test(next)) {
          if (skipTypeMarkers) continue;
          break;
        }
        if (/\d{4,}/.test(next)) break;
        if (findDates(next).length) break;
        const part = trimAtFieldLabel(next);
        if (part) parts.push(part);
      }
      if (parts.length) return cleanValue(parts.join(' '));
    }
    return '';
  }

  function valueAfterOfficialNameLabel(lines, pattern) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = pattern.exec(lines[index]);
      if (!match) continue;
      const inline = trimAtFieldLabel(lines[index].slice(match.index + match[0].length));
      if (inline && !FIELD_LABELS.test(inline)) return inline;
      const next = cleanValue(lines[index + 1] || '');
      if (!next
        || Object.values(ID_TYPE_MARKERS).some(marker => marker.test(next))
        || /\d{4,}/.test(next) || findDates(next).length) continue;
      const value = trimAtFieldLabel(next);
      if (value && !FIELD_LABELS.test(value)) return value;
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

  function stripNameHeaderArtifacts(value) {
    const text = String(value || '');
    const match = /\b(?:sy(?=.*\b(?:midd|middle|last)\b)|sur(?:name)?|surname|midd(?:le)?|middle|last|given|first|family|apelyido|pangalan)\b/i.exec(text);
    return cleanName(match ? text.slice(0, match.index) : text);
  }

  function isLikelyPersonName(value) {
    const candidate = cleanName(value);
    const words = candidate.split(/\s+/).filter(Boolean);
    return words.length >= 2
      && words.length <= 7
      && words.every(word => /\p{L}/u.test(word))
      && !NON_PERSON_NAME.test(candidate);
  }

  function composeName(given, middle, family) {
    const givenAndMiddle = cleanName([given, middle].filter(Boolean).join(' '));
    const givenWords = givenAndMiddle.toLowerCase().split(/\s+/).filter(Boolean);
    const familyValue = cleanName(family);
    const familyWords = familyValue.toLowerCase().split(/\s+/).filter(Boolean);
    const familyOutputWords = familyValue.split(/\s+/).filter(Boolean);
    if (!familyWords.length) return givenAndMiddle;
    for (let start = 0; start <= givenWords.length - familyWords.length; start += 1) {
      if (familyWords.every((word, index) => givenWords[start + index] === word)) return givenAndMiddle;
    }
    let overlap = Math.min(givenWords.length, familyWords.length);
    while (overlap > 0 && !givenWords.slice(-overlap).every((word, index) => word === familyWords[index])) overlap -= 1;
    return cleanName(`${givenAndMiddle} ${familyOutputWords.slice(overlap).join(' ')}`);
  }

  function nameHeaderFields(line, philidOnly = false) {
    const fields = philidOnly
      ? [
        { key: 'family', pattern: /\b(?:apelyido\s*\/\s*last\s*name|last\s*name|apelyido)\b/i },
        { key: 'given', pattern: /\b(?:mga\s*pangalan\s*\/\s*given\s*names?|given\s*names?|mga\s*pangalan)\b/i },
        { key: 'middle', pattern: /\b(?:gitnang\s*apelyido\s*\/\s*middle\s*name|middle\s*name|gitnang\s*apelyido)\b/i }
      ]
      : [
        { key: 'family', pattern: /\b(?:last(?:\s*name)?|family(?:\s*name)?|surname|apelyido)\b/i },
        { key: 'given', pattern: /\b(?:first\s*names?|given\s*names?|mga\s*pangalan|pangalan)\b/i },
        { key: 'middle', pattern: /\b(?:middle\s*(?:names?|initials?)?|middlename|gitnang\s*apelyido)\b/i }
      ];
    return fields.map(field => {
      const match = field.pattern.exec(line);
      return match ? { key: field.key, start: match.index } : null;
    }).filter(Boolean).sort((first, second) => first.start - second.start);
  }

  function nameHeaderKind(line) {
    if (/^\s*(?:apelyido\s*\/\s*last\s*name|last\s*name|apelyido)\s*[:/,-]?\s*$/i.test(line)) return 'family';
    if (/^\s*(?:mga\s*pangalan\s*\/\s*given\s*names?|given\s*names?|mga\s*pangalan)\s*[:/,-]?\s*$/i.test(line)) return 'given';
    if (/^\s*(?:gitnang\s*apelyido\s*\/\s*middle\s*name|middle\s*name|gitnang\s*apelyido)\s*[:/,-]?\s*$/i.test(line)) return 'middle';
    return '';
  }

  function parseNameColumns(lines, requireMiddle = false) {
    for (let index = 0; index < lines.length; index += 1) {
      let headerFields = nameHeaderFields(lines[index], requireMiddle);
      let valuesIndex = index + 1;
      if (headerFields.length < 2) {
        const headerKinds = [];
        let nextIndex = index;
        while (nextIndex < lines.length && headerKinds.length < 3) {
          const kind = nameHeaderKind(lines[nextIndex]);
          if (!kind) break;
          headerKinds.push({ key: kind, start: headerKinds.length });
          nextIndex += 1;
        }
        if (headerKinds.length < 2 || (requireMiddle && headerKinds.length < 3)) continue;
        headerFields = headerKinds;
        valuesIndex = nextIndex;
      }

      if (!headerFields.some(field => field.key === 'family')
        || !headerFields.some(field => field.key === 'given')
        || (requireMiddle && !headerFields.some(field => field.key === 'middle'))
        || valuesIndex >= lines.length) continue;

      const columnValues = lines[valuesIndex].trim().split(/\s{2,}/).filter(Boolean);
      if (columnValues.length === headerFields.length) {
        const names = {};
        headerFields.forEach((field, fieldIndex) => {
          names[field.key] = stripNameHeaderArtifacts(columnValues[fieldIndex]);
        });
        const composed = composeName(names.given, names.middle, names.family);
        if (isLikelyPersonName(composed)) return composed;
      }

      const verticalValues = lines.slice(valuesIndex, valuesIndex + headerFields.length);
      if (verticalValues.length === headerFields.length
        && verticalValues.every(value => value && !FIELD_LABELS.test(value)
          && !findDates(value).length && !/\d{4,}/.test(value))) {
        const names = {};
        headerFields.forEach((field, fieldIndex) => {
          names[field.key] = stripNameHeaderArtifacts(verticalValues[fieldIndex]);
        });
        const composed = composeName(names.given, names.middle, names.family);
        if (isLikelyPersonName(composed)) return composed;
      }

      if (headerFields.length === 2) {
        const words = lines[valuesIndex].trim().split(/\s+/).filter(Boolean);
        if (words.length >= 2 && !FIELD_LABELS.test(lines[valuesIndex])) {
          const composed = headerFields[0].key === 'family'
            ? composeName(words.slice(1).join(' '), '', words[0])
            : composeName(words.slice(0, -1).join(' '), '', words[words.length - 1]);
          if (isLikelyPersonName(composed)) return composed;
        }
      }
    }

    return '';
  }

  function parseName(lines, idType) {
    if (idType === 'philid') {
      const columnName = parseNameColumns(lines, true);
      if (columnName) return columnName;
      const layout = ID_FIELD_LAYOUTS.philid;
      const given = stripNameHeaderArtifacts(valueAfterOfficialNameLabel(lines, layout.givenName));
      const middle = stripNameHeaderArtifacts(valueAfterOfficialNameLabel(lines, layout.middleName));
      const family = stripNameHeaderArtifacts(valueAfterOfficialNameLabel(lines, layout.familyName));
      if (!given || !family) return '';
      const composed = composeName(given, middle, family);
      return isLikelyPersonName(composed) ? composed : '';
    }

    const columnName = parseNameColumns(lines);
    if (columnName) return columnName;

    const layout = ID_FIELD_LAYOUTS[idType] || {
      fullName: /(?:\bfull\s*name\b|^\s*name\b|\bpangalan\b)/i,
      givenName: /\b(?:given\s*names?|first\s*names?|mga\s*pangalan|pangalan)\b/i,
      middleName: /\b(?:middle\s*names?|middle\s*initials?|middlename|gitnang\s*apelyido)\b/i,
      familyName: /\b(?:last\s*name|family\s*name|surname|apelyido)\b/i
    };
    const fullName = stripNameHeaderArtifacts(valueAfterLabel(lines, layout.fullName, 2, 2, true));
    const given = stripNameHeaderArtifacts(valueAfterLabel(lines, layout.givenName, 2));
    const family = stripNameHeaderArtifacts(valueAfterLabel(lines, layout.familyName, 2));
    const middle = stripNameHeaderArtifacts(valueAfterLabel(lines, layout.middleName, 2, 1));
    if (given && family) {
      const composed = composeName(given, middle, family);
      if (isLikelyPersonName(composed) && nameWordCount(composed) >= nameWordCount(fullName)) return composed;
    }
    if (isLikelyPersonName(fullName)) return cleanName(fullName);

    return '';
  }

  function parseDateOfBirth(lines, idType) {
    const labels = ID_FIELD_LAYOUTS[idType]?.dob
      || /^\s*(?:date\s*of\s*birth|date\s*birth|birth\s*date|birthdate|birthday|b[i1]r[t7]h|d[o0]b|d\.o\.b|petsa\s+ng\s+kapanganakan|araw\s+ng\s+kapanganakan|kapanganakan)\b\s*[:：-]?/i;
    for (let index = 0; index < lines.length; index += 1) {
      const match = labels.exec(lines[index]);
      if (!match) continue;
      const inline = findDates(lines[index].slice(match.index + match[0].length));
      if (inline.length) return inline[0];
      if (idType === 'philid') {
        const next = lines[index + 1];
        const value = trimAtFieldLabel(next || '');
        if (value && !FIELD_LABELS.test(value)) {
          const dates = findDates(value);
          if (dates.length) return dates[0];
        }
        continue;
      }
      for (const next of lines.slice(index + 1, index + 3)) {
        const value = trimAtFieldLabel(next);
        if (!value) break;
        const dates = findDates(value);
        if (dates.length) return dates[0];
        if (FIELD_LABELS.test(next)) break;
      }
    }
    return '';
  }

  function trimAddressAtFieldLabel(value) {
    const match = FIELD_LABELS.exec(value);
    const part = match ? value.slice(0, match.index) : value;
    return String(part || '')
      .replace(/^[\s:：]+|[\s:：]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeAddressSpacing(value) {
    let address = String(value || '')
      .replace(/[|¦~`]/g, ' ')
      .replace(/([A-Z])(?=\d)/gi, '$1 ')
      .replace(/(\d)(?=[A-Z])/gi, '$1 ')
      .replace(/([A-Z0-9])\.(?=[A-Z])/gi, '$1. ');
    address = address.replace(/CITYOF(?=[A-Z])/gi, 'CITY OF ');
    for (const term of [
      'CITY', 'BARANGAY', 'BRGY', 'BLOCK', 'BLK', 'LOT', 'PHASE',
      'PUROK', 'SITIO', 'ZONE', 'STREET', 'ROAD', 'BUILDING', 'BLDG',
      'VILLAGE', 'SUBDIVISION', 'SUBD'
    ]) {
      address = address.replace(
        new RegExp(`([\\p{L}])(${term})(?=\\b|[\\p{N}])`, 'giu'),
        '$1 $2'
      );
    }
    address = address
      .replace(/(\d)\.\s*(?=[\p{L}])/gu, '$1, ')
      .replace(/\s+((?:CITY|MUNICIPALITY|BARANGAY|BRGY)\s+(?:OF\s+)?)/gi, ', $1')
      .replace(/\b([\p{L}\p{N}]+)(\s+\1\b)+/giu, '$1');
    const provincePattern = new RegExp(
      `\\s+(${PHILIPPINE_PROVINCES.slice().sort((first, second) => second.length - first.length).join('|')})$`,
      'i'
    );
    const provinceMatch = provincePattern.exec(address);
    if (provinceMatch) {
      const beforeProvince = address.slice(0, provinceMatch.index).trimEnd();
      if (!beforeProvince.endsWith(',')) {
        address = `${beforeProvince}, ${provinceMatch[1]}`;
      }
    }
    return address
      .replace(/\s*[,;]\s*/g, ', ')
      .replace(/(?:,\s*){2,}/g, ', ')
      .replace(/\s+/g, ' ')
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .trim();
  }

  function parseAddress(lines) {
    const labels = /^\s*(?:residential\s*address|current\s*address|permanent\s*address|place\s*of\s*residence|address|residence|tirahan)\b\s*[:：-]?/i;
    for (let index = 0; index < lines.length; index += 1) {
      const match = labels.exec(lines[index]);
      if (!match) continue;
      const parts = [];
      const inline = trimAddressAtFieldLabel(lines[index].slice(match[0].length));
      if (inline.length >= 2) parts.push(inline);
      for (const next of lines.slice(index + 1, index + 4)) {
        if (FIELD_LABELS.test(next) || /\d{10,}/.test(next)) break;
        const part = trimAddressAtFieldLabel(next);
        if (part.length >= 2) parts.push(part);
        if (part.length < next.length) break;
      }
      return normalizeAddressSpacing(parts.join(' '));
    }
    return '';
  }

  function idNumberCardType(text, idType, cardTypeOverride = null) {
    const detectedCardType = cardTypeOverride || detectCardType(text);
    if (CARD_ID_NUMBER_RULES[detectedCardType]) return detectedCardType;
    return CARD_ID_NUMBER_RULES[idType] ? idType : null;
  }

  function idNumberFormatScore(value, cardType) {
    const rule = CARD_ID_NUMBER_RULES[cardType];
    if (!rule) return 0;
    const groups = String(value || '').match(/\d+/g) || [];
    const digitCount = groups.join('').length;
    if (!rule.digitCounts.includes(digitCount)) return 0;
    return rule.groupings.some(grouping =>
      grouping.length === groups.length
      && grouping.every((length, index) => groups[index].length === length)
    ) ? 2 : 1;
  }

  function idNumberPositionScore(y, cardType) {
    const rule = CARD_ID_NUMBER_RULES[cardType];
    if (!rule || !Number.isFinite(y)) return 0;
    return Math.max(0, 1 - Math.abs(y - rule.targetY));
  }

  function parseUnlabeledIdNumber(text, cardType, ocrMetadata = {}) {
    if (!CARD_ID_NUMBER_RULES[cardType]) return '';
    const sourceLines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!sourceLines.length) return '';
    const lines = sourceLines.map((line, index) => ({
      text: line,
      y: (index + 0.5) / sourceLines.length,
      confidence: Number(ocrMetadata.confidence || 0)
    }));
    const coordinateLines = ocrWordLines(ocrMetadata.words);
    if (coordinateLines.length && Number(ocrMetadata.height) > 0) {
      for (const line of coordinateLines) {
        const coordinateY = ((line.bbox.y0 + line.bbox.y1) / 2) / ocrMetadata.height;
        const match = lines.find(candidate => normalizeField(candidate.text) === normalizeField(line.text));
        if (match) match.y = coordinateY;
        else lines.push({
          text: line.text,
          y: coordinateY,
          confidence: Number(ocrMetadata.confidence || 0)
        });
      }
    }

    const candidates = [];
    for (const line of lines) {
      if (/\b(?:date\s*of\s*birth|birth\s*date|birthday|address|residence|expiration|expiry|given\s*names?|first\s*name|middle\s*name|last\s*name|surname)\b/i.test(line.text)) {
        continue;
      }
      const values = line.text.match(/\d+(?:[\s-]+\d+)*/g) || [];
      for (const value of values) {
        const formatScore = idNumberFormatScore(value, cardType);
        if (!formatScore) continue;
        candidates.push({
          value: value.trim(),
          formatScore,
          positionScore: idNumberPositionScore(line.y, cardType),
          confidence: line.confidence
        });
      }
    }
    candidates.sort((first, second) =>
      second.formatScore - first.formatScore
      || second.positionScore - first.positionScore
      || second.confidence - first.confidence);
    return candidates[0]?.value || '';
  }

  function parseIdNumber(text, idType, cardTypeOverride = null, ocrMetadata = {}) {
    const lines = String(text || '').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const label = ID_NUMBER_LABEL.exec(lines[index]);
      if (!label) continue;
      const candidates = [
        lines[index].slice(label.index + label[0].length),
        lines[index + 1] || '',
        lines[index + 2] || ''
      ];
      for (const candidate of candidates) {
        if (!candidate.trim() || FIELD_LABELS.test(candidate)) continue;
        const value = trimAddressAtFieldLabel(candidate)
          .replace(/^(?:NO\.?|NUMBER)\s*[:：#-]?\s*/i, '')
          .replace(/^[\s:：#-]+|[\s:：#-]+$/g, '')
          .replace(/\s+/g, ' ');
        const match = value.match(/^[A-Z0-9][A-Z0-9 /-]{3,30}[A-Z0-9]/i);
        if (match && plausibleField('id_number', match[0])) return match[0].trim();
      }
    }
    const cardType = idNumberCardType(text, idType, cardTypeOverride);
    return parseUnlabeledIdNumber(text, cardType, ocrMetadata);
  }

  function parseExpirationDate(lines, idType) {
    if (idType === 'philid') return '';
    const labels = /\b(?:date\s*of\s*expiry|expiry\s*date|expiration\s*date|valid\s*(?:until|thru|through)|expires?|exp\.?|expiry|expiration)\b\s*[:：-]?/i;
    for (let index = 0; index < lines.length; index += 1) {
      const match = labels.exec(lines[index]);
      if (!match) continue;
      const inline = findDates(lines[index].slice(match.index + match[0].length));
      if (inline.length) return inline[0];
      const next = trimAtFieldLabel(lines[index + 1] || '');
      const following = findDates(next);
      if (following.length) return following[0];
    }
    return '';
  }

  function parseIdText(rawText, idType = null, cardTypeOverride = null, ocrMetadata = {}) {
    const lines = String(rawText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const text = lines.join('\n');
    const resolvedIdType = idType || detectIdType(text);
    return {
      lines,
      fields: {
        full_name: parseName(lines, resolvedIdType),
        dob: parseDateOfBirth(lines, resolvedIdType),
        address: parseAddress(lines),
        id_number: parseIdNumber(text, resolvedIdType, cardTypeOverride, ocrMetadata)
      }
    };
  }

  function parseIdDocument(rawText) {
    const detectedCardType = detectCardType(rawText);
    if (!detectedCardType) {
      return {
        id_type: null,
        full_name: null,
        date_of_birth: null,
        address: null,
        id_number: null,
        expiration_date: null
      };
    }
    const idType = CARD_TYPE_CATEGORIES[detectedCardType] || null;
    const parsed = parseIdText(rawText, idType);
    const nullable = value => String(value || '').trim() || null;
    const documentType = {
      sss: 'UMID - SSS CARD',
      philhealth: 'UMID - PHILHEALTH CARD',
      pagibig: 'UMID - PAG-IBIG CARD'
    }[detectedCardType] || CARD_TYPE_NAMES[detectedCardType];
    return {
      id_type: documentType || null,
      full_name: nullable(parsed.fields.full_name),
      date_of_birth: nullable(parsed.fields.dob),
      address: nullable(parsed.fields.address),
      id_number: nullable(parsed.fields.id_number),
      expiration_date: nullable(parseExpirationDate(parsed.lines, idType))
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
    if (key === 'full_name') return isLikelyPersonName(value);
    if (key === 'dob') return validDateOfBirth(value);
    if (key === 'address') return value.length >= 6 && /[\p{L}\p{N}]/u.test(value);
    return value.replace(/[^A-Z0-9]/gi, '').length >= 5;
  }

  function fieldLabelPattern(key) {
    return {
      full_name: /\b(?:full\s*name|given\s*names?|first\s*names?|mga\s*pangalan|middle\s*names?|gitnang\s*apelyido|last\s*name|surname|name|pangalan|apelyido)\b/i,
      dob: /\b(?:date\s*of\s*birth|date\s*birth|birth\s*date|birthdate|birthday|b[i1]r[t7]h|d\s*\.?\s*o\s*\.?\s*b|petsa\s+ng\s+kapanganakan|araw\s+ng\s+kapanganakan|kapanganakan)\b/i,
      address: /\b(?:address|place\s*of\s*residence|residence|tirahan)\b/i,
      id_number: /\b(?:id\s*(?:number|no\.?)|(?:sss|philhealth)\s*(?:number|no\.?|id)|mid\s*(?:number|no\.?)|license\s*(?:number|no\.?)|crn|psn|pcn|dln|philsys|driver'?s?\s+licen[cs]e|umid)\b/i
    }[key];
  }

  function editDistance(first, second) {
    let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
    for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
      const current = [firstIndex + 1];
      for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
        current.push(Math.min(
          current[secondIndex] + 1,
          previous[secondIndex + 1] + 1,
          previous[secondIndex] + (first[firstIndex] === second[secondIndex] ? 0 : 1)
        ));
      }
      previous = current;
    }
    return previous[second.length];
  }

  function nameWordCount(value) {
    return cleanName(value).split(/\s+/).filter(Boolean).length;
  }

  function isNameExtension(currentName, candidateName) {
    const currentWords = cleanName(currentName).toLowerCase().split(/\s+/).filter(Boolean);
    const candidateWords = cleanName(candidateName).toLowerCase().split(/\s+/).filter(Boolean);
    if (!currentWords.length || candidateWords.length <= currentWords.length) return false;
    for (let start = 0; start <= candidateWords.length - currentWords.length; start += 1) {
      if (currentWords.every((word, index) => {
        const candidateWord = candidateWords[start + index];
        return word === candidateWord
          || (Math.min(word.length, candidateWord.length) >= 3
            && editDistance(word, candidateWord) === 1);
      })) return true;
    }
    return false;
  }

  function resolveNameVariants(reads) {
    const clusters = reads.map(seed => reads.filter(read => {
      const maxLength = Math.max(seed.normalized.length, read.normalized.length);
      return editDistance(seed.normalized, read.normalized) <= (maxLength >= 18 ? 2 : 1);
    })).sort((first, second) => second.length - first.length);
    const cluster = clusters[0];
    const hasCompetingCluster = clusters.some(candidate =>
      candidate.length === cluster?.length
      && candidate.some((read, index) => read !== cluster[index]));
    if (!cluster || cluster.length < 2 || hasCompetingCluster) return '';
    const distanceTotal = read => cluster.reduce(
      (total, other) => total + editDistance(read.normalized, other.normalized),
      0
    );
    return [...cluster].sort((first, second) =>
      distanceTotal(first) - distanceTotal(second) || second.confidence - first.confidence
    )[0].value;
  }

  function mergeCandidates(candidates, idType) {
    const fields = { full_name: '', dob: '', address: '', id_number: '' };
    const cardType = detectCardType(candidates.map(candidate => candidate.text));
    for (const key of Object.keys(fields)) {
      const groups = new Map();
      const reads = [];
      for (const candidate of [...candidates]) {
        const value = String(candidate.parsed.fields[key] || '').trim();
        if (!value || !plausibleField(key, value)) continue;
        const normalized = normalizeField(value);
        reads.push({ value, normalized, confidence: candidate.confidence });
        const group = groups.get(normalized) || {
          value,
          count: 0,
          bestConfidence: 0,
          bestFormatScore: 0,
          bestPositionScore: 0,
          labeled: false
        };
        group.count += 1;
        group.bestConfidence = Math.max(group.bestConfidence, candidate.confidence);
        group.labeled = group.labeled || fieldLabelPattern(key).test(candidate.text);
        if (key === 'id_number') {
          group.bestFormatScore = Math.max(
            group.bestFormatScore,
            idNumberFormatScore(value, cardType),
            ID_PATTERNS[idType]?.test(value) ? 1 : 0
          );
          const words = ocrWordLines(candidate.words);
          const normalizedValue = normalizeField(value);
          const matchingLine = words.find(line =>
            normalizeField(line.text).includes(normalizedValue));
          const height = Number(candidate.ocrHeight || candidate.preparedCanvas?.height);
          if (matchingLine && height > 0) {
            group.bestPositionScore = Math.max(
              group.bestPositionScore,
              idNumberPositionScore(
                ((matchingLine.bbox.y0 + matchingLine.bbox.y1) / 2) / height,
                cardType
              )
            );
          }
        }
        groups.set(normalized, group);
      }
      const ranked = [...groups.values()].sort((a, b) => b.count - a.count || b.bestConfidence - a.bestConfidence);
      const winner = ranked[0];
      if (!winner) continue;
      if (key === 'id_number' && ranked.length > 1) {
        const confidenceRanked = [...ranked].sort((a, b) =>
          b.bestFormatScore - a.bestFormatScore
          || b.bestConfidence - a.bestConfidence
          || b.bestPositionScore - a.bestPositionScore
          || b.count - a.count);
        const confidenceWinner = confidenceRanked[0];
        const confidenceRunnerUp = confidenceRanked[1];
        if (confidenceWinner.bestFormatScore > 0
          && confidenceWinner.bestConfidence >= MIN_FIELD_CONFIDENCE
          && (confidenceWinner.bestFormatScore > confidenceRunnerUp.bestFormatScore
            || confidenceWinner.bestConfidence > confidenceRunnerUp.bestConfidence
            || confidenceWinner.bestPositionScore > confidenceRunnerUp.bestPositionScore
            || confidenceWinner.count > confidenceRunnerUp.count)) {
          fields[key] = confidenceWinner.value;
          continue;
        }
      }
      const secondCount = ranked[1]?.count || 0;
      const hasClearMajority = winner.count >= 2 && winner.count > secondCount;
      if (hasClearMajority) {
        fields[key] = winner.value;
        continue;
      }
      const labeledGroups = ranked.filter(group => group.labeled);
      const labeledWinner = labeledGroups[0];
      const labeledRunnerUp = labeledGroups[1];
      if (labeledWinner && (!labeledRunnerUp
        || labeledWinner.count > labeledRunnerUp.count
        || labeledWinner.bestConfidence >= labeledRunnerUp.bestConfidence + 0.15)) {
        fields[key] = labeledWinner.value;
        continue;
      }
      if (key === 'full_name' && ranked.length > 1) {
        fields[key] = resolveNameVariants(reads);
        if (fields[key]) continue;
      }
      const isStrongSingleRead = ranked.length === 1
        && winner.count === 1
        && winner.bestConfidence >= MIN_FIELD_CONFIDENCE
        && (winner.labeled
          || ((key === 'full_name' || key === 'dob') && winner.bestConfidence >= 0.85)
          || (key === 'id_number' && Boolean(
            ID_PATTERNS[idType]?.test(winner.value)
            || idNumberFormatScore(winner.value, cardType)
          )));
      if (isStrongSingleRead) fields[key] = winner.value;
    }
    if (fields.full_name) {
      const fullerRead = candidates
        .map(candidate => ({
          value: String(candidate.parsed.fields.full_name || '').trim(),
          confidence: Number(candidate.confidence || 0)
        }))
        .filter(read => read.confidence >= MIN_FIELD_CONFIDENCE
          && plausibleField('full_name', read.value)
          && isNameExtension(fields.full_name, read.value))
        .sort((first, second) =>
          nameWordCount(second.value) - nameWordCount(first.value)
          || second.confidence - first.confidence)[0];
      if (fullerRead) fields.full_name = fullerRead.value;
    }
    const combinedText = candidates.map(candidate => candidate.text).filter(Boolean).join('\n');
    const hasGivenNameLabel = /\b(?:given\s*names?|first\s*names?|mga\s*pangalan|pangalan)\b/i.test(combinedText);
    const hasFamilyNameLabel = /\b(?:last\s*name|family\s*name|surname|apelyido)\b/i.test(combinedText);
    if (hasGivenNameLabel && hasFamilyNameLabel) {
      const segmentedName = parseName(combinedText.split(/\r?\n/).map(line => line.trim()).filter(Boolean), idType);
      if (isLikelyPersonName(segmentedName)
        && nameWordCount(segmentedName) > nameWordCount(fields.full_name)) {
        fields.full_name = segmentedName;
      }
    }
    return fields;
  }

  function reconstructTextFromWords(words) {
    const lines = new Map();
    for (const [index, word] of (Array.isArray(words) ? words : []).entries()) {
      const text = String(word.text || '').trim();
      if (!text) continue;
      const bbox = word.bbox || {};
      const y = Number(bbox.y0);
      const block = Number(word.block_num || 0);
      const paragraph = Number(word.paragraph_num || 0);
      const lineNumber = Number(word.line_num);
      const lineKey = Number.isFinite(lineNumber)
        ? `${block}:${paragraph}:line:${lineNumber}`
        : `${block}:${paragraph}:y:${Number.isFinite(y) ? Math.round(y / 12) : index}`;
      const line = lines.get(lineKey) || {
        block,
        paragraph,
        lineNumber: Number.isFinite(lineNumber) ? lineNumber : Number.MAX_SAFE_INTEGER,
        y: Number.isFinite(y) ? y : index,
        words: []
      };
      line.words.push({
        text,
        x: Number(bbox.x0),
        endX: Number(bbox.x1),
        height: Number(bbox.y1) - Number(bbox.y0),
        index
      });
      lines.set(lineKey, line);
    }
    return [...lines.values()]
      .sort((first, second) => first.block - second.block
        || first.paragraph - second.paragraph
        || first.y - second.y
        || first.lineNumber - second.lineNumber)
      .map(line => {
        const wordsOnLine = line.words
          .sort((first, second) => first.x - second.x || first.index - second.index);
        return wordsOnLine.map((word, index) => {
          if (!index) return word.text;
          const previous = wordsOnLine[index - 1];
          const gap = word.x - previous.endX;
          const height = Math.max(word.height || 0, previous.height || 0);
          const separator = Number.isFinite(gap) && gap > Math.max(16, height * 1.5) ? '  ' : ' ';
          return separator + word.text;
        }).join('');
      })
      .join('\n');
  }

  function ocrWordLines(words) {
    const sortedWords = (Array.isArray(words) ? words : [])
      .map((word, index) => {
        const bbox = word.bbox || {};
        const x0 = Number(bbox.x0);
        const y0 = Number(bbox.y0);
        const x1 = Number(bbox.x1);
        const y1 = Number(bbox.y1);
        if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
        return {
          text: String(word.text || '').trim(),
          x0,
          y0,
          x1,
          y1,
          lineNumber: Number(word.line_num),
          block: Number(word.block_num || 0),
          paragraph: Number(word.paragraph_num || 0),
          index
        };
      })
      .filter(word => word && word.text)
      .sort((first, second) =>
        first.block - second.block
        || first.paragraph - second.paragraph
        || first.y0 - second.y0
        || first.x0 - second.x0);
    const lines = [];
    for (const word of sortedWords) {
      const line = Number.isFinite(word.lineNumber)
        ? lines.find(candidate => candidate.lineNumber === word.lineNumber
          && candidate.block === word.block
          && candidate.paragraph === word.paragraph)
        : lines.find(candidate => !Number.isFinite(candidate.lineNumber)
          && candidate.block === word.block
          && candidate.paragraph === word.paragraph
          && Math.abs(candidate.centerY - ((word.y0 + word.y1) / 2))
            <= Math.max(8, (word.y1 - word.y0) * 0.75));
      if (line) {
        line.words.push(word);
        line.bbox.y0 = Math.min(line.bbox.y0, word.y0);
        line.bbox.y1 = Math.max(line.bbox.y1, word.y1);
        line.bbox.x0 = Math.min(line.bbox.x0, word.x0);
        line.bbox.x1 = Math.max(line.bbox.x1, word.x1);
        line.centerY = (line.bbox.y0 + line.bbox.y1) / 2;
      } else {
        lines.push({
          block: word.block,
          paragraph: word.paragraph,
          lineNumber: word.lineNumber,
          centerY: (word.y0 + word.y1) / 2,
          bbox: { x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 },
          words: [word]
        });
      }
    }
    return lines.map(line => ({
      ...line,
      words: line.words.sort((first, second) => first.x0 - second.x0 || first.index - second.index),
      text: line.words.map(word => word.text).join(' ')
    })).sort((first, second) => first.bbox.y0 - second.bbox.y0);
  }

  function idTypeMismatchReason(selectedIdType, detectedCardType) {
    return `This photo appears to show a ${CARD_TYPE_NAMES[detectedCardType]}, but you selected ${ID_TYPE_NAMES[selectedIdType]}. Please check your selection or upload the matching ID.`;
  }

  function validateIdDocument(fields, idType, text, ocrConfidence = 1) {
    if (idType && !ID_TYPE_NAMES[idType]) {
      return {
        valid: false,
        code: 'unsupported_id',
        status: 'rejected',
        reason: "We couldn't recognize this ID. Please upload a clear photo of the ID you selected."
      };
    }
    const combinedText = String(text || '').toUpperCase();
    const cardTypeMatches = matchingCardTypes(combinedText);
    const detectedCardType = detectCardType(combinedText);
    const confidenceByType = Object.keys(CARD_TYPE_INDICATORS)
      .map(type => cardTypeConfidence(combinedText, type, ocrConfidence));
    const confidence = detectedCardType
      ? cardTypeConfidence(combinedText, detectedCardType, ocrConfidence)
      : Math.max(0, ...confidenceByType);
    const confidenceBand = confidenceStatus(confidence);
    if (!detectedCardType) {
      const multipleTypes = cardTypeMatches.length > 1;
      const code = confidence < 40
        ? 'unsupported_id'
        : (multipleTypes ? 'multiple_id_types' : 'needs_review');
      return {
        valid: false,
        code,
        status: code === 'unsupported_id' ? 'rejected' : 'needs_review',
        reason: code === 'unsupported_id'
          ? "We couldn't recognize this ID. Please upload a clear photo of the ID you selected."
          : (multipleTypes
            ? 'This photo appears to show more than one kind of ID. Please upload one ID at a time.'
            : "We couldn't tell which ID this is. Please upload a clearer photo showing the whole ID."),
        cardTypeConfidence: confidence,
        confidenceBand
      };
    }
    const detectedIdType = CARD_TYPE_CATEGORIES[detectedCardType];
    const resolvedIdType = idType || detectedIdType;
    if (detectedIdType !== resolvedIdType) {
      return {
        valid: false,
        code: 'wrong_id_type',
        status: 'rejected',
        reason: idTypeMismatchReason(resolvedIdType, detectedCardType),
        detectedCardType,
        detectedCardTypeName: CARD_TYPE_NAMES[detectedCardType],
        cardTypeConfidence: confidence,
        confidenceBand
      };
    }
    const requiredFields = requiredFieldsForIdType(resolvedIdType, detectedCardType);
    const missingRequiredFields = requiredFields.some(field => !plausibleField(field, String(fields[field] || '')));
    const idNumberPattern = ['philid', 'drivers'].includes(resolvedIdType) ? ID_PATTERNS[resolvedIdType] : null;
    const invalidIdNumber = plausibleField('id_number', String(fields.id_number || ''))
      && idNumberPattern
      && !idNumberPattern.test(fields.id_number);
    if (missingRequiredFields || invalidIdNumber) {
      return {
        valid: false,
        code: 'needs_review',
        status: 'needs_review',
        reason: invalidIdNumber
          ? 'The ID number could not be read clearly. Please check it before continuing.'
          : 'Some required information could not be read. Please check the details before continuing.',
        idType: resolvedIdType,
        idTypeName: ID_TYPE_NAMES[resolvedIdType],
        detectedCardType,
        detectedCardTypeName: CARD_TYPE_NAMES[detectedCardType],
        cardTypeConfidence: confidence,
        confidenceBand
      };
    }
    if (confidence < 60) {
      return {
        valid: false,
        code: 'needs_review',
        status: 'needs_review',
        reason: `This photo appears to show a ${CARD_TYPE_NAMES[detectedCardType]}, but some details could not be read clearly. Please check them before continuing.`,
        idType: resolvedIdType,
        idTypeName: ID_TYPE_NAMES[resolvedIdType],
        detectedCardType,
        detectedCardTypeName: CARD_TYPE_NAMES[detectedCardType],
        cardTypeConfidence: confidence,
        confidenceBand
      };
    }
    return {
      valid: true,
      code: confidence >= 90 ? 'verified' : 'accepted',
      status: confidenceBand,
      reason: `This photo appears to show a ${CARD_TYPE_NAMES[detectedCardType]}.`,
      idType,
      idTypeName: ID_TYPE_NAMES[idType],
      detectedCardType,
      detectedCardTypeName: CARD_TYPE_NAMES[detectedCardType],
      cardTypeConfidence: confidence,
      confidenceBand
    };
  }

  function canProceedToReview(validation) {
    return Boolean(validation?.valid)
      || (validation?.code === 'needs_review' && Boolean(validation?.detectedCardType));
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
      }).catch(error => {
        tesseractLoadPromise = null;
        throw error;
      });
    }
    return tesseractLoadPromise;
  }

  function loadPaddleOcr() {
    if (root.paddlejs?.ocr?.init && root.paddlejs?.ocr?.recognize) return Promise.resolve(root.paddlejs.ocr);
    if (!root.document) return Promise.reject(new Error('PaddleOCR is only available in a browser.'));
    if (!paddleOcrLoadPromise) {
      paddleOcrLoadPromise = import('https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm')
        .then(({ PaddleOCR }) => {
          if (!PaddleOCR) throw new Error('PaddleOCR did not load correctly.');
          return PaddleOCR.create({
            textDetectionModelName: 'PP-OCRv5_mobile_det',
            textRecognitionModelName: 'PP-OCRv5_mobile_rec',
            ortOptions: {
              backend: 'wasm',
              wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/'
            }
          });
        })
        .catch(error => {
          paddleOcrLoadPromise = null;
          throw error;
        });
    }
    return paddleOcrLoadPromise;
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

  function cropDobLabelArea(canvas, words) {
    const labelWords = (words || []).filter(word =>
      word.bbox && /b[i1]r[t7]h|kapanganakan|petsa|d[o0]b|d\.o\.b/i.test(word.text || ''));
    if (!labelWords.length) return null;

    const labelLeft = Math.min(...labelWords.map(word => word.bbox.x0));
    const labelTop = Math.min(...labelWords.map(word => word.bbox.y0));
    const width = Math.min(canvas.width, Math.round(canvas.width * 0.75));
    const left = Math.max(0, Math.min(canvas.width - width, Math.floor(labelLeft - width * 0.25)));
    const top = Math.max(0, Math.floor(labelTop - canvas.height * 0.025));
    const height = Math.min(Math.round(canvas.height * 0.3), canvas.height - top);
    if (width < 1 || height < 1) return null;

    const crop = root.document.createElement('canvas');
    crop.width = width;
    crop.height = height;
    crop.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, width, height);
    return crop;
  }

  function cropLabeledFieldArea(canvas, words, labelPattern) {
    const labelWords = (words || []).filter(word =>
      word.bbox && labelPattern.test(word.text || ''));
    if (!labelWords.length) return null;

    const labelLeft = Math.min(...labelWords.map(word => word.bbox.x0));
    const labelTop = Math.min(...labelWords.map(word => word.bbox.y0));
    const width = Math.min(canvas.width, Math.round(canvas.width * 0.8));
    const left = Math.max(0, Math.min(canvas.width - width, Math.floor(labelLeft - width * 0.15)));
    const top = Math.max(0, Math.floor(labelTop - canvas.height * 0.025));
    const height = Math.min(Math.round(canvas.height * 0.3), canvas.height - top);
    if (width < 1 || height < 1) return null;

    const crop = root.document.createElement('canvas');
    crop.width = width;
    crop.height = height;
    crop.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, width, height);
    return crop;
  }

  function cropAddressLabelArea(canvas, words) {
    return cropLabeledFieldArea(canvas, words, /address|residence|tirahan/i);
  }

  function cropIdNumberLabelArea(canvas, words) {
    return cropLabeledFieldArea(canvas, words, /id|number|psn|pcn|crn|pin|mid|dln|license|licen[cs]e|sss|philhealth|philsys|umid/i);
  }

  function cropIdNumberTemplateAreas(canvas, cardType) {
    const rule = CARD_ID_NUMBER_RULES[cardType];
    if (!rule || !canvas?.width || !canvas?.height) return [];
    const cropHeight = Math.min(canvas.height, Math.max(1, Math.round(canvas.height * 0.34)));
    const centers = [rule.targetY, rule.targetY + 0.2, rule.targetY - 0.2];
    const crops = [];
    for (const center of centers) {
      const top = Math.max(0, Math.min(
        canvas.height - cropHeight,
        Math.round(center * canvas.height - cropHeight / 2)
      ));
      if (crops.some(crop => crop.top === top)) continue;
      const crop = root.document.createElement('canvas');
      crop.width = canvas.width;
      crop.height = cropHeight;
      crop.getContext('2d').drawImage(
        canvas,
        0,
        top,
        canvas.width,
        cropHeight,
        0,
        0,
        crop.width,
        crop.height
      );
      crops.push({ canvas: crop, top });
      if (crops.length === 2) break;
    }
    return crops.map(item => item.canvas);
  }

  function cropNameLabelArea(canvas, words, currentName) {
    const wordsWithBoxes = (words || []).filter(word => word.bbox);
    const labelWords = wordsWithBoxes.filter(word => {
      if (!word.bbox) return false;
      const text = String(word.text || '').replace(/[^a-z]/gi, '').toLowerCase();
      return /^(?:full|name|given|first|middle|last|family|surname|mga|pangalan|gitnang|apelyido)$/.test(text);
    });
    const normalizedName = normalizeField(currentName);
    const nameTokens = cleanName(currentName).toLowerCase().split(/\s+/).filter(Boolean);
    const nameWords = labelWords.length ? labelWords : wordsWithBoxes.filter(word => {
      const normalizedWord = normalizeField(word.text);
      return nameTokens.includes(String(word.text || '').toLowerCase())
        || (normalizedWord.length >= 3 && normalizedName.includes(normalizedWord));
    });
    if (!nameWords.length) return null;

    const labelLeft = Math.min(...nameWords.map(word => word.bbox.x0));
    const labelTop = Math.min(...nameWords.map(word => word.bbox.y0));
    const width = Math.min(canvas.width, Math.round(canvas.width * (labelWords.length ? 0.8 : 1)));
    const left = labelWords.length
      ? Math.max(0, Math.min(canvas.width - width, Math.floor(labelLeft - width * 0.1)))
      : 0;
    const top = Math.max(0, Math.floor(labelTop - canvas.height * (labelWords.length ? 0.025 : 0.08)));
    const height = Math.min(Math.round(canvas.height * 0.3), canvas.height - top);
    if (width < 1 || height < 1) return null;

    const crop = root.document.createElement('canvas');
    crop.width = width;
    crop.height = height;
    crop.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, width, height);
    return crop;
  }

  function enlargeDetailCrop(canvas) {
    const scale = Math.min(3, 3200 / Math.max(1, canvas.width));
    if (scale <= 1) return canvas;
    const enlarged = root.document.createElement('canvas');
    enlarged.width = Math.round(canvas.width * scale);
    enlarged.height = Math.round(canvas.height * scale);
    enlarged.getContext('2d').drawImage(canvas, 0, 0, enlarged.width, enlarged.height);
    return enlarged;
  }

  function paddleBoxToBbox(rawBox, canvas) {
    if (!rawBox) return null;
    let coordinates;
    if (Array.isArray(rawBox)) {
      coordinates = rawBox.flat(Infinity).map(Number).filter(Number.isFinite);
      if (coordinates.length >= 8) {
        const xs = coordinates.filter((_, index) => index % 2 === 0);
        const ys = coordinates.filter((_, index) => index % 2 === 1);
        coordinates = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      } else if (coordinates.length >= 4) {
        coordinates = coordinates.slice(0, 4);
      }
    } else {
      const x0 = Number(rawBox.x0 ?? rawBox.left ?? rawBox.x);
      const y0 = Number(rawBox.y0 ?? rawBox.top ?? rawBox.y);
      const x1 = Number(rawBox.x1 ?? rawBox.right
        ?? (Number.isFinite(Number(rawBox.width)) ? x0 + Number(rawBox.width) : NaN));
      const y1 = Number(rawBox.y1 ?? rawBox.bottom
        ?? (Number.isFinite(Number(rawBox.height)) ? y0 + Number(rawBox.height) : NaN));
      coordinates = [x0, y0, x1, y1];
    }
    if (coordinates.length < 4 || !coordinates.slice(0, 4).every(Number.isFinite)) return null;
    let [x0, y0, x1, y1] = coordinates;
    if (Math.max(Math.abs(x0), Math.abs(y0), Math.abs(x1), Math.abs(y1)) <= 1
      && canvas?.width > 1 && canvas?.height > 1) {
      x0 *= canvas.width;
      x1 *= canvas.width;
      y0 *= canvas.height;
      y1 *= canvas.height;
    }
    return { x0, y0, x1, y1 };
  }

  function paddleItemsToWords(items, canvas) {
    return (Array.isArray(items) ? items : []).flatMap(item => {
      const text = String(item.text || '').trim();
      const bbox = paddleBoxToBbox(item.bbox || item.box || item.points, canvas);
      if (!text || !bbox) return [];
      return [{ text, bbox, confidence: Number(item.score ?? item.confidence) || 0 }];
    });
  }

  async function extractPaddleText(canvas) {
    const paddle = await loadPaddleOcr();
    if (paddle.predict) {
      const [result] = await paddle.predict(canvas);
      const items = (result?.items || []).filter(item => String(item.text || '').trim());
      const words = paddleItemsToWords(items, canvas);
      return {
        text: items.map(item => String(item.text || '').trim()).join('\n'),
        confidence: items.length
          ? items.reduce((sum, item) => sum + (Number(item.score) || 0), 0) / items.length
          : 0,
        words
      };
    }
    await paddle.init();
    const result = await paddle.recognize(canvas, {});
    const items = result?.items || result?.words || [];
    return {
      text: String(result?.text || '').trim(),
      confidence: Number(result?.confidence || 0),
      words: paddleItemsToWords(items, canvas)
    };
  }

  function parseCandidate(candidate, idType) {
    return parseIdText(
      candidate.text,
      idType,
      candidate.detectedCardType || null,
      {
        words: candidate.words,
        width: candidate.ocrWidth || candidate.preparedCanvas?.width,
        height: candidate.ocrHeight || candidate.preparedCanvas?.height,
        confidence: candidate.confidence
      }
    );
  }

  async function extractId(file, { idType: selectedIdType = '', onProgress, signal } = {}) {
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
      const imageLooksBlurry = laplacianVariance(gray.data, gray.width, gray.height) < MIN_SHARPNESS;

      reportProgress(onProgress, 'Reading image with PaddleOCR…', 0.1);
      let paddleRead = { text: '', confidence: 0 };
      let paddleEngineAvailable = false;
      try {
        paddleRead = await extractPaddleText(prepareForOcr(canvas, false));
        paddleEngineAvailable = true;
      } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) throw error;
        console.warn('Primary PaddleOCR pass was unavailable; using Tesseract.', error);
      }
      throwIfAborted();
      reportProgress(onProgress, 'Checking with secondary OCR…', 0.15);
      let Tesseract = null;
      try {
        Tesseract = await loadTesseract();
      } catch (error) {
        if (!paddleRead.text) throw error;
        console.warn('Secondary Tesseract pass was unavailable; keeping PaddleOCR results.', error);
      }
      throwIfAborted();
      let currentAttempt = 1;
      if (Tesseract) {
        try {
          worker = await Tesseract.createWorker('eng', 1, {
            logger: message => {
              if (message.status === 'recognizing text') {
                reportProgress(
                  onProgress,
                  `Checking with Tesseract (pass ${currentAttempt} of ${MAX_OCR_ATTEMPTS})…`,
                  0.15 + ((currentAttempt - 1 + Number(message.progress || 0)) / MAX_OCR_ATTEMPTS) * 0.75
                );
              }
            }
          });
        } catch (error) {
          if (!paddleRead.text) throw error;
          console.warn('Secondary Tesseract worker was unavailable; keeping PaddleOCR results.', error);
        }
      }
      const passes = [
        { threshold: false, pageSegMode: 6, whitelist: '' },
        { threshold: true, pageSegMode: 11, whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 /,-.:#' },
        { threshold: false, pageSegMode: 4, whitelist: '' }
      ];
      const candidates = paddleRead.text
        ? [{
          text: paddleRead.text,
          confidence: paddleRead.confidence,
          words: paddleRead.words || [],
          ocrWidth: canvas.width,
          ocrHeight: canvas.height,
          parsed: parseIdText(paddleRead.text, selectedIdType || null, null, {
            words: paddleRead.words || [],
            width: canvas.width,
            height: canvas.height,
            confidence: paddleRead.confidence
          }),
          preparedCanvas: canvas
        }]
        : [];
      let paddleEngineUsed = Boolean(paddleRead.text);
      const detailCrops = { dob: null, name: null, address: null, id_number: null };
      let acceptedResult = null;
      let lastValidation = null;
      let lastRecognitionError = null;
      const readDetailCrop = async (crop, cardTypeOverride = null) => {
        if (!worker) return '';
        throwIfAborted();
        await worker.setParameters({
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1'
        });
        const preparedCanvas = prepareForOcr(enlargeDetailCrop(crop), false);
        const result = await worker.recognize(preparedCanvas);
        const text = reconstructTextFromWords(result.data.words)
          || String(result.data.text || '').trim();
        if (!text) return '';
        const ocrWidth = preparedCanvas.width;
        const ocrHeight = preparedCanvas.height;
        candidates.push({
          text,
          confidence: Number(result.data.confidence || 0) / 100,
          parsed: parseIdText(text, selectedIdType || null, cardTypeOverride, {
            words: result.data.words || [],
            width: ocrWidth,
            height: ocrHeight,
            confidence: Number(result.data.confidence || 0) / 100
          }),
          detectedCardType: cardTypeOverride,
          words: result.data.words || [],
          ocrWidth,
          ocrHeight,
          preparedCanvas: crop
        });
        return text;
      };
      const refreshDetailValidation = () => {
        const detectedIdType = detectIdType(candidates.map(candidate => candidate.text));
        const idType = selectedIdType || detectedIdType;
        const ocrConfidence = candidates.length
          ? candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidates.length
          : 0;
        const candidateText = candidates.map(candidate => candidate.text).join('\n');
        const fields = mergeCandidates(candidates.map(candidate => ({
          ...candidate,
          parsed: parseCandidate(candidate, idType)
        })), idType);
        lastValidation = {
          fields,
          idType,
          detectedIdType,
          detectedCardType: detectCardType(candidateText),
          documentValidation: validateIdDocument(fields, idType, candidateText, ocrConfidence)
        };
        return lastValidation;
      };
      for (let index = 0; worker && index < passes.length; index += 1) {
        throwIfAborted();
        const pass = passes[index];
        currentAttempt = index + 1;
        reportProgress(
          onProgress,
          `Reading ID details (attempt ${index + 1} of ${MAX_OCR_ATTEMPTS})…`,
          0.15 + index / MAX_OCR_ATTEMPTS * 0.75
        );
        const parameters = {
          tessedit_pageseg_mode: String(pass.pageSegMode),
          preserve_interword_spaces: '1'
        };
        if (pass.whitelist) parameters.tessedit_char_whitelist = pass.whitelist;
        const preparedCanvas = prepareForOcr(canvas, pass.threshold);
        const ocrWidth = preparedCanvas.width;
        const ocrHeight = preparedCanvas.height;
        let result;
        try {
          await worker.setParameters(parameters);
          result = await worker.recognize(preparedCanvas);
        } catch (error) {
          if (error.name === 'AbortError' || signal?.aborted) throw error;
          lastRecognitionError = error;
          console.warn(`ID OCR attempt ${currentAttempt} failed; trying the next image pass.`, error);
          continue;
        }
        const text = reconstructTextFromWords(result.data.words)
          || String(result.data.text || '').trim();
        if (text) {
          candidates.push({
            text,
            confidence: Number(result.data.confidence || 0) / 100,
            parsed: parseIdText(text, selectedIdType || null, null, {
              words: result.data.words || [],
              width: ocrWidth,
              height: ocrHeight,
              confidence: Number(result.data.confidence || 0) / 100
            }),
            words: result.data.words || [],
            ocrWidth,
            ocrHeight,
            preparedCanvas
          });
          const detectedIdType = detectIdType(candidates.map(candidate => candidate.text));
          const detectedCardType = detectCardType(candidates.map(candidate => candidate.text));
          const resolvedIdType = selectedIdType || detectedIdType;
          const fields = mergeCandidates(candidates, resolvedIdType);
          const typeMismatch = Boolean(selectedIdType && detectedIdType && selectedIdType !== detectedIdType);
          const ocrConfidence = candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidates.length;
          const candidateText = candidates.map(candidate => candidate.text).join('\n');
          const documentValidation = typeMismatch
            ? {
              valid: false,
              code: 'wrong_id_type',
              status: 'rejected',
              reason: idTypeMismatchReason(resolvedIdType, detectedCardType),
              detectedCardType,
              detectedCardTypeName: CARD_TYPE_NAMES[detectedCardType] || '',
              cardTypeConfidence: detectedCardType ? cardTypeConfidence(candidateText, detectedCardType, ocrConfidence) : 0,
              confidenceBand: detectedCardType
                ? confidenceStatus(cardTypeConfidence(candidateText, detectedCardType, ocrConfidence))
                : 'rejected'
            }
            : validateIdDocument(fields, resolvedIdType, candidateText, ocrConfidence);
          lastValidation = { fields, idType: resolvedIdType, detectedIdType, detectedCardType, documentValidation };
          const hasAddressLabel = /\b(?:address|residential\s+address|current\s+address|permanent\s+address|residence|tirahan)\b/i.test(candidateText);
          if (
            documentValidation.valid
            && nameWordCount(fields.full_name) > 2
            && (!hasAddressLabel || fields.address)
          ) {
            acceptedResult = lastValidation;
            break;
          }
        }
        reportProgress(onProgress, `ID reading attempt ${index + 1} of ${MAX_OCR_ATTEMPTS} complete.`, 0.15 + ((index + 1) / MAX_OCR_ATTEMPTS) * 0.75);
      }
      throwIfAborted();
      if (!candidates.length && lastRecognitionError) throw lastRecognitionError;

      const confidence = candidates.length
        ? candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidates.length
        : 0;
      if (worker && !acceptedResult && !lastValidation?.fields.dob) {
        let detailScans = 0;
        for (const candidate of [...candidates]) {
          if (detailScans >= 2) break;
          const crop = cropDobLabelArea(candidate.preparedCanvas, candidate.words);
          if (!crop) continue;
          if (!detailCrops.dob) detailCrops.dob = crop;
          await readDetailCrop(crop);
          detailScans += 1;
          refreshDetailValidation();
          if (lastValidation.fields.dob) break;
        }
      }
      if (worker && !acceptedResult && nameWordCount(lastValidation?.fields.full_name || '') <= 2) {
        let detailScans = 0;
        for (const candidate of [...candidates]) {
          if (detailScans >= 2 || nameWordCount(lastValidation?.fields.full_name || '') > 2) break;
          const crop = cropNameLabelArea(
            candidate.preparedCanvas,
            candidate.words,
            lastValidation?.fields.full_name || ''
          );
          if (!crop) continue;
          if (!detailCrops.name) detailCrops.name = crop;
          await readDetailCrop(crop);
          detailScans += 1;
          refreshDetailValidation();
        }
      }
      if (worker && !acceptedResult && !lastValidation?.fields.address) {
        let detailScans = 0;
        for (const candidate of [...candidates]) {
          if (detailScans >= 2 || lastValidation?.fields.address) break;
          const crop = cropAddressLabelArea(candidate.preparedCanvas, candidate.words);
          if (!crop) continue;
          if (!detailCrops.address) detailCrops.address = crop;
          await readDetailCrop(crop);
          detailScans += 1;
          refreshDetailValidation();
        }
      }
      if (worker && !acceptedResult && !lastValidation?.fields.id_number) {
        let detailScans = 0;
        const cardType = detectCardType(candidates.map(candidate => candidate.text));
        for (const candidate of [...candidates]) {
          if (detailScans >= 2 || lastValidation?.fields.id_number) break;
          const crop = cropIdNumberLabelArea(candidate.preparedCanvas, candidate.words);
          if (!crop) continue;
          if (!detailCrops.id_number) detailCrops.id_number = crop;
          await readDetailCrop(crop, cardType);
          detailScans += 1;
          refreshDetailValidation();
        }
      }
      if (worker && !acceptedResult && !lastValidation?.fields.id_number) {
        let detailScans = 0;
        const cardType = detectCardType(candidates.map(candidate => candidate.text));
        if (CARD_ID_NUMBER_RULES[cardType]) {
          for (const candidate of [...candidates]) {
            if (detailScans >= 2 || lastValidation?.fields.id_number) break;
            if (candidate.preparedCanvas?.width !== candidate.ocrWidth
              || candidate.preparedCanvas?.height !== candidate.ocrHeight) continue;
            for (const crop of cropIdNumberTemplateAreas(candidate.preparedCanvas, cardType)) {
              if (detailScans >= 2 || lastValidation?.fields.id_number) break;
              if (!detailCrops.id_number) detailCrops.id_number = crop;
              await readDetailCrop(crop, cardType);
              detailScans += 1;
              refreshDetailValidation();
            }
          }
        }
      }

      let paddleText = paddleRead.text;
      let fields = acceptedResult?.fields || lastValidation?.fields || {
        full_name: '', dob: '', address: '', id_number: ''
      };
      let idType = acceptedResult?.idType || lastValidation?.idType || selectedIdType || null;
      let documentValidation = acceptedResult?.documentValidation || lastValidation?.documentValidation || null;
      const fieldsNeedRetry = !fields.full_name
        || nameWordCount(fields.full_name) <= 2
        || !fields.address
        || !fields.dob
        || !fields.id_number;
      if ((!paddleText && fieldsNeedRetry) || (paddleEngineAvailable && fieldsNeedRetry)) {
        try {
          throwIfAborted();
          reportProgress(onProgress, 'Retrying PaddleOCR for missing fields…', 0.93);
          const retryCanvas = prepareForOcr(canvas, true);
          const paddleResult = await extractPaddleText(retryCanvas);
          paddleText = [paddleText, paddleResult.text].filter(Boolean).join('\n');
          paddleEngineAvailable = true;
          throwIfAborted();
          paddleEngineUsed = Boolean(paddleText);
          if (paddleResult.text) {
            candidates.push({
              text: paddleResult.text,
              confidence: paddleResult.confidence,
              words: paddleResult.words || [],
              ocrWidth: retryCanvas.width,
              ocrHeight: retryCanvas.height,
              parsed: parseIdText(paddleResult.text, idType, null, {
                words: paddleResult.words || [],
                width: retryCanvas.width,
                height: retryCanvas.height,
                confidence: paddleResult.confidence
              }),
              preparedCanvas: retryCanvas
            });
          }
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          console.warn('PaddleOCR name/address pass was unavailable.', error);
        }
      }
      for (const [field, crop] of Object.entries(detailCrops)) {
        if (!paddleEngineAvailable) break;
        if (!crop) continue;
        const paddleFields = parseIdText(paddleText, idType).fields;
        const cropCardType = detectCardType([
          ...candidates.map(candidate => candidate.text),
          paddleText
        ]);
        const fieldIsMissing = field === 'dob'
          ? !paddleFields.dob
          : field === 'name'
            ? nameWordCount(paddleFields.full_name) <= 2
            : field === 'address'
              ? !plausibleField('address', paddleFields.address)
              : !plausibleField('id_number', paddleFields.id_number);
        if (!fieldIsMissing) continue;
        try {
          throwIfAborted();
          const cropCanvas = prepareForOcr(enlargeDetailCrop(crop), false);
          const cropResult = await extractPaddleText(cropCanvas);
          throwIfAborted();
          const cropText = cropResult.text;
          if (cropText) {
            paddleText = [paddleText, cropText].filter(Boolean).join('\n');
            paddleEngineUsed = true;
            candidates.push({
              text: cropText,
              confidence: cropResult.confidence,
              words: cropResult.words || [],
              ocrWidth: cropCanvas.width,
              ocrHeight: cropCanvas.height,
              detectedCardType: cropCardType,
              parsed: parseIdText(cropText, idType, cropCardType, {
                words: cropResult.words || [],
                width: cropCanvas.width,
                height: cropCanvas.height,
                confidence: cropResult.confidence
              }),
              preparedCanvas: crop
            });
          }
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          console.warn(`PaddleOCR ${field} crop pass was unavailable.`, error);
        }
      }
      const detectedIdType = detectIdType([
        ...candidates.map(candidate => candidate.text),
        paddleText
      ]);
      const detectedCardType = detectCardType([
        ...candidates.map(candidate => candidate.text),
        paddleText
      ]);
      idType = selectedIdType || detectedIdType || idType;
      if (!acceptedResult && candidates.length) {
        fields = mergeCandidates(candidates.map(candidate => ({
          ...candidate,
          parsed: parseCandidate(candidate, idType)
        })), idType);
      }
      if (paddleText) {
        const paddleFields = parseIdText(paddleText, idType).fields;
        const paddleNameIsLabeled = fieldLabelPattern('full_name').test(paddleText);
        const paddleHasAlternateLabeledName = paddleNameIsLabeled
          && nameWordCount(fields.full_name) <= 2
          && nameWordCount(paddleFields.full_name) >= 2
          && normalizeField(paddleFields.full_name) !== normalizeField(fields.full_name);
        if ((!plausibleField('full_name', fields.full_name)
          || isNameExtension(fields.full_name, paddleFields.full_name)
          || paddleHasAlternateLabeledName)
          && plausibleField('full_name', paddleFields.full_name)) {
          fields.full_name = paddleFields.full_name;
        }
        if (!plausibleField('address', fields.address) && plausibleField('address', paddleFields.address)) {
          fields.address = paddleFields.address;
        }
        if (!plausibleField('dob', fields.dob) && plausibleField('dob', paddleFields.dob)) {
          fields.dob = paddleFields.dob;
        }
        const hasSpecificIdPattern = Boolean(
          CARD_ID_NUMBER_RULES[detectedCardType]
          || ['philid', 'drivers'].includes(idType)
        );
        const idNumberMatches = value => {
          if (CARD_ID_NUMBER_RULES[detectedCardType]) {
            return idNumberFormatScore(value, detectedCardType) > 0;
          }
          if (['philid', 'drivers'].includes(idType)) return ID_PATTERNS[idType].test(value);
          return plausibleField('id_number', value);
        };
        if ((!plausibleField('id_number', fields.id_number)
          || (hasSpecificIdPattern && !idNumberMatches(fields.id_number)))
          && idNumberMatches(paddleFields.id_number)) {
          fields.id_number = paddleFields.id_number;
        }
      }
      const allText = [...candidates.map(candidate => candidate.text), paddleText].filter(Boolean).join('\n');
      const typeMismatch = Boolean(selectedIdType && detectedIdType && selectedIdType !== detectedIdType);
      documentValidation = typeMismatch
        ? {
          valid: false,
          code: 'wrong_id_type',
          status: 'rejected',
          reason: idTypeMismatchReason(idType, detectedCardType),
          detectedCardType,
          detectedCardTypeName: CARD_TYPE_NAMES[detectedCardType] || '',
          cardTypeConfidence: detectedCardType ? cardTypeConfidence(allText, detectedCardType, confidence) : 0,
          confidenceBand: detectedCardType
            ? confidenceStatus(cardTypeConfidence(allText, detectedCardType, confidence))
            : 'rejected'
        }
        : validateIdDocument(fields, idType, allText, confidence);
      if (imageLooksBlurry && !detectedCardType && documentValidation.code === 'unsupported_id') {
        documentValidation = {
          ...documentValidation,
          reason: 'This photo is too blurry to read. Please upload a clearer photo.'
        };
      }
      const warning = documentValidation.valid
        ? ''
        : documentValidation.reason;
      const code = documentValidation.valid ? 'ok' : documentValidation.code;
      const selectedCategoryConfidence = selectedIdType
        ? Math.max(0, ...Object.entries(CARD_TYPE_CATEGORIES)
          .filter(([, category]) => category === selectedIdType)
          .map(([cardType]) => cardTypeConfidence(allText, cardType, confidence)))
        : 0;
      const detectedTypeConfidence = documentValidation?.cardTypeConfidence
        ?? (detectedCardType ? cardTypeConfidence(allText, detectedCardType, confidence) : 0);
      const detectedTypeIsConfident = Boolean(detectedCardType && detectedTypeConfidence >= 60);
      return {
        fields,
        idType,
        idTypeName: ID_TYPE_NAMES[idType] || '',
        expiration_date: parseExpirationDate(allText.split(/\r?\n/), idType),
        detectedIdType,
        detectedCardType,
        detectedCardTypeName: CARD_TYPE_NAMES[detectedCardType] || '',
        cardTypeConfidence: detectedTypeConfidence,
        autoFillAllowed: Boolean(documentValidation?.code !== 'wrong_id_type'
          && (detectedTypeIsConfident || selectedCategoryConfidence >= 60)),
        confidence,
        documentValidation,
        paddleEngineUsed,
        warning,
        code
      };
    } finally {
      signal?.removeEventListener('abort', abortWorker);
      await terminateWorker();
    }
  }

  const api = {
    ID_TYPES: ID_TYPE_NAMES,
    MAX_OCR_ATTEMPTS,
    canProceedToReview,
    cardTypeConfidence,
    cardTypeIndicatorPoints,
    confidenceStatus,
    detectCardType,
    detectIdType,
    extractId,
    findDates,
    mergeCandidates,
    parseIdText,
    parseIdDocument,
    requiredFieldsForIdType,
    validateIdDocument
  };
  root.CostTrackOcr = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
