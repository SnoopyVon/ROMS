const assert = require('node:assert/strict');
const test = require('node:test');
const logic = require('./business-logic.js');
const ocr = require('./ivs-ocr.js');
const faceMatching = require('./face-matching.js');

const kg = { name: 'Kilogram', abbreviation: 'kg', dimension: 'weight', conversionToBase: 1000 };
const g = { name: 'Gram', abbreviation: 'g', dimension: 'weight', conversionToBase: 1 };
const liter = { name: 'Liter', abbreviation: 'L', dimension: 'volume', conversionToBase: 1000 };
const asOfDate = '2026-11-11';

test('face matching scores ID and live descriptors using verification thresholds', () => {
  const first = Array(128).fill(0);
  const same = Array(128).fill(0);
  const withinThreshold = Array(128).fill(0);
  const outsideThreshold = Array(128).fill(0);
  withinThreshold[0] = 0.6;
  outsideThreshold[0] = 0.61;

  assert.equal(faceMatching.compareDescriptors(first, same), 0);
  assert.equal(faceMatching.compareDescriptors(first, withinThreshold), 0.6);
  assert.equal(faceMatching.compareDescriptors(first, outsideThreshold), 0.61);
  assert.equal(faceMatching.classifyDistance(0.3), 'match');
  assert.equal(faceMatching.classifyDistance(0.32), 'manual_review');
  assert.equal(faceMatching.classifyDistance(0.6), 'manual_review');
  assert.equal(faceMatching.classifyDistance(0.62), 'no_match');
  assert.equal(faceMatching.classifyDistance(Number.NaN), 'no_match');
  assert.equal(faceMatching.classifySimilarity(85), 'match');
  assert.equal(faceMatching.classifySimilarity(84), 'manual_review');
  assert.equal(faceMatching.classifySimilarity(70), 'manual_review');
  assert.equal(faceMatching.classifySimilarity(69), 'no_match');
  assert.equal(faceMatching.similarityScore(0), 100);
  assert.equal(faceMatching.similarityIndicator(1), 50);
  assert.equal(faceMatching.similarityScore(0.6), 70);
  assert.throws(() => faceMatching.compareDescriptors([0], [0]), /missing or invalid/);
});

test('face login and Add User share the exact instructions and scan sequence', () => {
  const straight = { label: 'straight', ratio: 0.2, yaw: 0 };
  const expectedSteps = ['straight', 'left', 'right', 'closer', 'farther'];
  const expectedInstructions = [
    'Look straight at the camera.',
    'Look to the left.',
    'Look to the right.',
    'Move closer to the camera.',
    'Move slightly farther away.'
  ];

  assert.deepEqual(faceMatching.FACE_SCAN_INSTRUCTIONS, expectedInstructions);
  assert.deepEqual(faceMatching.FACE_SCAN_STEPS.map(step => step.key), expectedSteps);
  assert.deepEqual(faceMatching.LIVE_POSES, faceMatching.FACE_SCAN_STEPS);
  assert.deepEqual(faceMatching.APPLICANT_LIVE_POSES, faceMatching.FACE_SCAN_STEPS);
  assert.deepEqual(faceMatching.LOGIN_LIVE_POSES, faceMatching.FACE_SCAN_STEPS);
  assert.equal(faceMatching.poseMatches('left', { label: 'straight', yaw: 0.13 }, straight), true);
  assert.equal(faceMatching.poseMatches('left', { label: 'straight', yaw: 0.11 }, straight), false);
  assert.equal(faceMatching.poseMatches('right', { label: 'straight', yaw: -0.13 }, straight), true);
  assert.equal(faceMatching.poseMatches('right', { label: 'straight', yaw: -0.11 }, straight), false);
  assert.equal(faceMatching.poseMatches('closer', { label: 'straight', ratio: 0.23 }, straight), true);
  assert.equal(faceMatching.poseMatches('closer', { label: 'straight', ratio: 0.22 }, straight), false);
  assert.equal(faceMatching.poseMatches('farther', { label: 'straight', ratio: 0.18 }, straight), true);
  assert.equal(faceMatching.poseMatches('farther', { label: 'straight', ratio: 0.19 }, straight), false);
  assert.equal(faceMatching.liveFrameIssue('partial'), 'Ensure that the entire face is visible.');
  assert.equal(faceMatching.liveFrameIssue('too_dark'), 'Improve lighting and try again.');
  assert.equal(faceMatching.liveFrameIssue('too_bright'), 'Reduce glare and excessive lighting.');
  assert.equal(faceMatching.liveFrameIssue('too_close'), 'Move slightly away from the camera.');
});

test('live face tracking tolerates short dropouts and confirms multiple faces across frames', () => {
  const stabilizer = faceMatching.createLiveFaceStabilizer();
  const detected = { status: 'detected', ratio: 0.2 };
  assert.equal(stabilizer.update(detected, 0).status, 'detected');
  assert.equal(stabilizer.update({ status: 'not_detected' }, 180).status, 'detected');

  const multiple = { status: 'multiple', count: 2 };
  assert.equal(stabilizer.update(multiple, 360).status, 'detected');
  assert.equal(stabilizer.update(multiple, 540).status, 'detected');
  assert.equal(stabilizer.update(multiple, 720).status, 'detected');
  assert.equal(stabilizer.update(multiple, 900).status, 'detected');
  assert.equal(stabilizer.update(multiple, 1080).status, 'pending');
  assert.equal(stabilizer.update(multiple, 1260).status, 'pending');
  assert.equal(stabilizer.update(multiple, 1440).status, 'multiple');

  const secondStabilizer = faceMatching.createLiveFaceStabilizer();
  for (let frame = 0; frame < 6; frame += 1) {
    assert.equal(secondStabilizer.update(multiple, frame * 180).status, 'pending');
  }
  assert.equal(secondStabilizer.update(multiple, 1080).status, 'multiple');
});

test('live multiple-face candidates must be strong, large, and near the guide', () => {
  const face = (score, box) => ({ detection: { score, box } });
  const primary = face(0.92, { x: 265, y: 160, width: 110, height: 140 });
  const weakFalsePositive = face(0.7, { x: 390, y: 190, width: 85, height: 110 });
  const distantFalsePositive = face(0.95, { x: 0, y: 170, width: 105, height: 130 });
  const nearbyDuplicate = face(0.9, { x: 310, y: 175, width: 110, height: 140 });
  const realSecondFace = face(0.88, { x: 400, y: 170, width: 110, height: 140 });

  assert.deepEqual(
    faceMatching.distinctLiveFaces(
      [primary, weakFalsePositive, distantFalsePositive, nearbyDuplicate],
      640,
      480
    ),
    [primary]
  );
  assert.deepEqual(
    faceMatching.distinctLiveFaces([primary, realSecondFace], 640, 480),
    [primary, realSecondFace]
  );
});

test('live face positioning allows faces mostly inside the circular guide', () => {
  assert.ok(faceMatching.faceGuideOverlapRatio({ x: 270, y: 190, width: 100, height: 100 }, 640, 480) >= 0.82);
  assert.ok(faceMatching.faceGuideOverlapRatio({ x: 0, y: 0, width: 100, height: 100 }, 640, 480) < 0.82);
});

test('ID face scan failures explain the specific image issue', () => {
  assert.equal(
    faceMatching.faceScanError('not_detected', 'id'),
    'No face was detected in the uploaded ID. Please upload a valid ID image.'
  );
  assert.equal(
    faceMatching.faceScanError('blurry', 'id'),
    'The ID photo is too blurry for verification. Please upload a clearer image.'
  );
  assert.equal(
    faceMatching.faceScanError('too_small', 'id'),
    'The face in the uploaded ID is too small to verify. Please upload a higher-quality image.'
  );
  assert.equal(
    faceMatching.faceScanError('multiple', 'id'),
    'Multiple faces were detected. Only one face should appear on the uploaded ID.'
  );
});

test('ID OCR parsing extracts labeled fields and identifies a supported PhilSys ID', () => {
  const text = [
    'PAMBANSANG PAGKAKAKILANLAN',
    'Apelyido/Last Name:',
    'Dela Cruz',
    'Mga Pangalan/Given Names:',
    'Juan',
    'Gitnang Apelyido/Middle Name:',
    'Martinez',
    'DATE OF BIRTH: January 1, 2000',
    'ADDRESS: Balayan, Batangas',
    'ID NUMBER: 1234 5678 9012 3456'
  ].join('\n');
  const idType = ocr.detectIdType(text);
  const parsed = ocr.parseIdText(text, idType);

  assert.equal(idType, 'philid');
  assert.deepEqual(parsed.fields, {
    full_name: 'Juan Martinez Dela Cruz',
    dob: '2000-01-01',
    address: 'Balayan, Batangas',
    id_number: '1234 5678 9012 3456'
  });
});

test('PhilID names and dates come only from the official labels', () => {
  const unlabeled = ocr.parseIdText([
    'PAMBANSANG PAGKAKAKILANLAN',
    'PSN',
    'FULL NAME: RANDOM PERSON',
    'JUAN MARIA DELA CRUZ',
    'JANUARY 01, 1990'
  ].join('\n'));
  assert.equal(unlabeled.fields.full_name, '');
  assert.equal(unlabeled.fields.dob, '');

  const nonOfficialDateLabel = ocr.parseIdText(
    'Apelyido/Last Name: DELA CRUZ\nMga Pangalan/Given Names: JUAN\nARAW NG KAPANGANAKAN: JANUARY 01, 1990',
    'philid'
  );
  assert.equal(nonOfficialDateLabel.fields.full_name, 'JUAN DELA CRUZ');
  assert.equal(nonOfficialDateLabel.fields.dob, '');

  const labeled = ocr.parseIdText([
    'Mga Pangalan/Given Names',
    'JUAN',
    'MARTINEZ',
    'Apelyido/Last Name',
    'DELA CRUZ',
    'Date of Birth',
    'JANUARY 01, 1990'
  ].join('\n'), 'philid');
  assert.equal(labeled.fields.full_name, 'JUAN DELA CRUZ');
  assert.equal(labeled.fields.dob, '1990-01-01');

  const mergedLabels = ocr.parseIdText([
    'Apelyido/Last Name',
    'DELA CRUZ Mga Pangalan/Given Names',
    'JUAN Gitnang Apelyido/Middle Name',
    'MARTINEZ',
    'Petsa ng Kapanganakan',
    'JANUARY 01, 1990 ADDRESS: BALAYAN'
  ].join('\n'), 'philid');
  assert.equal(mergedLabels.fields.full_name, 'JUAN MARTINEZ DELA CRUZ');
  assert.equal(mergedLabels.fields.dob, '1990-01-01');
});

test('ID OCR keeps wrapped names and address spacing and reads Philippine birthdays day-first', () => {
  const parsed = ocr.parseIdText([
    'PAMBANSANG PAGKAKAKILANLAN',
    'Apelyido/Last Name',
    'DELA CRUZ',
    'Mga Pangalan/Given Names',
    'JUAN ALBERTO',
    'Gitnang Apelyido/Middle Name',
    'MARTINEZ',
    'Date of Birth',
    '04/07/1990',
    'ADDRESS: 123 SAMPLE STREET,',
    'UNIT 4, MANILA',
    'ID NUMBER: 1234 5678 9012 3456'
  ].join('\n'), 'philid');

  assert.deepEqual(parsed.fields, {
    full_name: 'JUAN ALBERTO MARTINEZ DELA CRUZ',
    dob: '1990-07-04',
    address: '123 SAMPLE STREET, UNIT 4, MANILA',
    id_number: '1234 5678 9012 3456'
  });
});

test('ID OCR skips ID headers, reads compact birthdays, and restores address spacing', () => {
  const genericText = [
    'FULL NAME:',
    'REPUBLIKANG PILIPINAS',
    'JUAN MARIA DELA CRUZ',
    'DATE OF BIRTH: 07121990',
    'ADDRESS: SNVDL2PH2BLK1LOT23.SABANGCITYOFLIPA BATANGAS'
  ].join('\n');
  const expected = {
    full_name: 'JUAN MARIA DELA CRUZ',
    dob: '1990-12-07',
    address: 'SNVDL 2 PH 2 BLK 1 LOT 23, SABANG, CITY OF LIPA, BATANGAS',
    id_number: ''
  };

  for (const idType of Object.keys(ocr.ID_TYPES)) {
    const text = idType === 'philid'
      ? [
        'FULL NAME:',
        'REPUBLIKANG PILIPINAS',
        'Apelyido/Last Name:',
        'DELA CRUZ',
        'Mga Pangalan/Given Names:',
        'JUAN MARIA',
        'Gitnang Apelyido/Middle Name:',
        'MARTINEZ',
        'Petsa ng Kapanganakan:',
        '07121990',
        'ADDRESS: SNVDL2PH2BLK1LOT23.SABANGCITYOFLIPA BATANGAS'
      ].join('\n')
      : genericText;
    const typeExpected = idType === 'philid'
        ? { ...expected, full_name: 'JUAN MARIA MARTINEZ DELA CRUZ' }
      : expected;
    assert.deepEqual(ocr.parseIdText(text, idType).fields, typeExpected, idType);
  }
  assert.deepEqual(ocr.findDates('19901207'), ['1990-12-07']);
  assert.deepEqual(ocr.findDates('12/31/2005'), ['2005-12-31']);
  assert.deepEqual(ocr.findDates('31/12/2005'), ['2005-12-31']);
  assert.deepEqual(ocr.findDates('2005-12-31'), ['2005-12-31']);
  assert.deepEqual(ocr.findDates('JAN 01 2000'), ['2000-01-01']);
});

test('ID OCR reads labeled ID-number variants and formats Philippine address components', () => {
  const examples = [
    ['LICENSE NO.: N 01 23 123456', 'drivers', 'N 01 23 123456'],
    ['SSS NUMBER:\n123-4567890-1', 'umid', '123-4567890-1'],
    ['SSS ID NO.: 123-4567890-1', 'umid', '123-4567890-1'],
    ['PHILHEALTH IDENTIFICATION NUMBER: 123456789012', 'umid', '123456789012'],
    ['PHILHEALTH NUMBER: 123456789012', 'umid', '123456789012'],
    ['MID NO.: 123456789012', 'umid', '123456789012'],
    ['PIN: 123456789012', 'umid', '123456789012'],
    ['CRN\n123456789012', 'umid', '123456789012'],
    ['PSN No.: 1234 5678 9012 3456', 'philid', '1234 5678 9012 3456'],
    ['PhilSys Number: 1234 5678 9012 3456', 'philid', '1234 5678 9012 3456'],
    ['PSN: 1234 5678 9012 3456', 'philid', '1234 5678 9012 3456']
  ];

  for (const [text, idType, expected] of examples) {
    assert.equal(ocr.parseIdText(text, idType).fields.id_number, expected, text);
  }
  assert.equal(
    ocr.parseIdText(
      'ADDRESS: SNVDL2PH2BLK1LOT23.SABANGCITYOFLIPA BATANGAS BATANGAS',
      'umid'
    ).fields.address,
    'SNVDL 2 PH 2 BLK 1 LOT 23, SABANG, CITY OF LIPA, BATANGAS'
  );
});

test('ID OCR extracts unlabeled numbers by detected card type and OCR layout', () => {
  const examples = [
    [
      'PHILIPPINE NATIONAL ID\n1234 5678 9012 3456',
      'philid',
      '1234 5678 9012 3456'
    ],
    [
      'SOCIAL SECURITY SYSTEM\n12-3456789-0',
      'umid',
      '12-3456789-0'
    ],
    [
      'PHILHEALTH\n12-345678901-2',
      'umid',
      '12-345678901-2'
    ]
  ];
  for (const [text, idType, expected] of examples) {
    assert.equal(ocr.parseIdText(text, idType).fields.id_number, expected, text);
  }

  const competingText = 'PHILHEALTH\n123456789012\n987654321098';
  const words = [
    { text: 'PHILHEALTH', bbox: { x0: 0, y0: 0, x1: 50, y1: 10 } },
    { text: '123456789012', bbox: { x0: 0, y0: 30, x1: 70, y1: 40 } },
    { text: '987654321098', bbox: { x0: 0, y0: 80, x1: 70, y1: 90 } }
  ];
  assert.equal(
    ocr.parseIdText(competingText, 'umid', null, { words, width: 100, height: 100 }).fields.id_number,
    '123456789012'
  );
  const lowerConfidenceRead = ocr.parseIdText(
    'PHILHEALTH\n123456789012',
    'umid'
  );
  const higherConfidenceRead = ocr.parseIdText(
    'PHILHEALTH\n987654321098',
    'umid'
  );
  assert.equal(ocr.mergeCandidates([
    { text: 'PHILHEALTH\n123456789012', confidence: 0.72, parsed: lowerConfidenceRead },
    { text: 'PHILHEALTH\n987654321098', confidence: 0.91, parsed: higherConfidenceRead }
  ], 'umid').id_number, '987654321098');
});

test('ID OCR composes labeled name fields and recognizes OCR-confused birthdays', () => {
  const genericText = [
    'FIRST NAME: Carl',
    'MIDDLE NAME: John',
    'LAST NAME: Smith',
    'DATE OF B1RTH: O1 02 2000'
  ].join('\n');
  for (const idType of Object.keys(ocr.ID_TYPES)) {
    const text = idType === 'philid'
      ? [
        'Mga Pangalan/Given Names: Carl',
        'Gitnang Apelyido/Middle Name: John',
        'Apelyido/Last Name: Smith',
        'Date of Birth: O1 02 2000'
      ].join('\n')
      : genericText;
    assert.deepEqual(ocr.parseIdText(text, idType).fields, {
      full_name: 'Carl John Smith',
      dob: '2000-02-01',
      address: '',
      id_number: ''
    }, idType);
  }
});

test('ID OCR uses each supported type’s name and birth-date labels', () => {
  const examples = [
    [
      'philid',
      'Apelyido/Last Name: Smith\nMga Pangalan/Given Names: Carl\nGitnang Apelyido/Middle Name: John\nPetsa ng Kapanganakan: 07 12 1990',
      'Carl John Smith'
    ],
    [
      'drivers',
      'FIRST NAME: Carl\nMIDDLE NAME: John\nLAST NAME: Smith\nBIRTH DATE: 07/12/1990',
      'Carl John Smith'
    ],
    [
      'umid',
      'FIRST NAME: Carl\nMIDDLE INITIAL: J\nSURNAME: Smith\nDOB: 07/12/1990',
      'Carl J Smith'
    ]
  ];

  for (const [idType, text, fullName] of examples) {
    const fields = ocr.parseIdText(text, idType).fields;
    assert.equal(fields.full_name, fullName, `${idType} full name`);
    assert.equal(fields.dob, '1990-12-07', `${idType} DOB`);
  }

  const tagalogText = [
    'APELYIDO: Smith',
    'MGA PANGALAN: Carl',
    'GITNANG APELYIDO: John',
    'ARAW NG KAPANGANAKAN: 07 12 1990'
  ].join('\n');
  const philidTagalogText = [
    'Apelyido/Last Name: Smith',
    'Mga Pangalan/Given Names: Carl',
    'Gitnang Apelyido/Middle Name: John',
    'Petsa ng Kapanganakan: 07 12 1990'
  ].join('\n');
  for (const idType of Object.keys(ocr.ID_TYPES)) {
    const fields = ocr.parseIdText(idType === 'philid' ? philidTagalogText : tagalogText, idType).fields;
    assert.equal(fields.full_name, 'Carl John Smith', `${idType} Tagalog name fields`);
    assert.equal(fields.dob, '1990-12-07', `${idType} Tagalog DOB label`);
  }
});

test('ID OCR removes split name-column labels and reads DOB labels within OCR lines for every type', () => {
  const text = [
    'CARL JOHN Sy Midd E A Last',
    'CARD DETAILS - DATE OF BIRTH: May 4, 1990'
  ].join('\n');
  const inlineFields = 'FIRST NAME: Carl MIDDLE NAME: John LAST NAME: Smith\nCARD DETAILS - DATE OF BIRTH: May 4, 1990';

  for (const idType of Object.keys(ocr.ID_TYPES)) {
    const fields = ocr.parseIdText(text, idType).fields;
    assert.equal(fields.full_name, '', `${idType} name without field labels`);
    assert.equal(fields.dob, '1990-05-04', `${idType} inline DOB label`);

    const inline = ocr.parseIdText(inlineFields, idType).fields;
    assert.equal(inline.full_name, idType === 'philid' ? '' : 'Carl John Smith', `${idType} inline name fields`);
    assert.equal(inline.dob, '1990-05-04', `${idType} inline DOB field`);
  }
  assert.equal(ocr.parseIdText('DATE OF BIRTH: 1990 05 04', 'drivers').fields.dob, '1990-05-04');
});

test('ID OCR leaves unlabelled names, dates, and numbers empty', () => {
  const fields = ocr.parseIdText([
    'JUAN MARIA DELA CRUZ',
    '1990-05-04',
    '123456789012'
  ].join('\n'), 'drivers').fields;

  assert.equal(fields.full_name, '');
  assert.equal(fields.dob, '');
  assert.equal(fields.id_number, '');
});

test('ID OCR composes names from separated column headers for every type', () => {
  const text = [
    'LAST NAME  GIVEN NAME  MIDDLE NAME',
    'Dela Cruz  Carl  John',
    'DATE OF BIRTH: May 4, 1990'
  ].join('\n');
  const stackedText = [
    'LAST NAME',
    'GIVEN NAME',
    'MIDDLE NAME',
    'Dela Cruz',
    'Carl',
    'John',
    'DATE OF BIRTH: May 4, 1990'
  ].join('\n');

  for (const idType of Object.keys(ocr.ID_TYPES)) {
    const fields = ocr.parseIdText(text, idType).fields;
    assert.equal(fields.full_name, 'Carl John Dela Cruz', `${idType} column name`);
    assert.equal(fields.dob, '1990-05-04', `${idType} column DOB`);

    const stacked = ocr.parseIdText(stackedText, idType).fields;
    assert.equal(stacked.full_name, 'Carl John Dela Cruz', `${idType} stacked column name`);
    assert.equal(stacked.dob, '1990-05-04', `${idType} stacked column DOB`);
  }
});

test('ID OCR preserves uppercase name parts when composing every supported ID type', () => {
  const text = [
    'FIRST NAME: CARL',
    'MIDDLE NAME: JOHN',
    'LAST NAME: ONERA'
  ].join('\n');

  for (const idType of Object.keys(ocr.ID_TYPES)) {
    const nameText = idType === 'philid'
      ? 'Mga Pangalan/Given Names: CARL\nGitnang Apelyido/Middle Name: JOHN\nApelyido/Last Name: ONERA'
      : text;
    assert.equal(
      ocr.parseIdText(nameText, idType).fields.full_name,
      'CARL JOHN ONERA',
      `${idType} name casing`
    );
  }
});

test('ID OCR keeps unique labeled name and DOB reads for low-confidence passes on every type', () => {
  for (const idType of Object.keys(ocr.ID_TYPES)) {
    const text = idType === 'philid'
      ? 'Mga Pangalan/Given Names: Carl\nGitnang Apelyido/Middle Name: John\nApelyido/Last Name: Smith\nDate of Birth: May 4, 1990'
      : 'FULL NAME: Carl John Smith\nDATE OF BIRTH: May 4, 1990';
    const candidate = {
      text,
      confidence: 0.4,
      parsed: ocr.parseIdText(text, idType)
    };
    const fields = ocr.mergeCandidates([candidate], idType);
    assert.equal(fields.full_name, 'Carl John Smith', `${idType} labeled name`);
    assert.equal(fields.dob, '1990-05-04', `${idType} labeled DOB`);
  }
});

test('ID OCR leaves conflicting single-pass values undetected and accepts matching reads', () => {
  const firstText = 'FULL NAME: Juan Dela Cruz\nDOB: January 1, 2000';
  const secondText = 'FULL NAME: Jose Dela Cruz\nDOB: January 1, 2000';
  const candidates = [
    { text: firstText, confidence: 0.9, parsed: ocr.parseIdText(firstText) },
    { text: secondText, confidence: 0.9, parsed: ocr.parseIdText(secondText) }
  ];

  assert.deepEqual(ocr.mergeCandidates(candidates, null), {
    full_name: '',
    dob: '2000-01-01',
    address: '',
    id_number: ''
  });
});

test('ID OCR accepts a strong unlabelled name and resolves minor OCR spelling variants', () => {
  const unlabelledText = 'PAMBANSANG PAGKAKAKILANLAN\nJUAN MARIA DELA CRUZ';
  const unlabelled = {
    text: unlabelledText,
    confidence: 0.9,
    parsed: ocr.parseIdText(unlabelledText, 'philid')
  };
  assert.equal(ocr.mergeCandidates([unlabelled], 'philid').full_name, '');

  const candidates = [
    'MARIA TERESA DELA CRUZ',
    'MARIA TERESA DELA CRUS',
    'MARIA TERESA DELA GRUZ'
  ].map(name => {
    const text = `FULL NAME: ${name}`;
    return { text, confidence: 0.9, parsed: ocr.parseIdText(text, 'drivers') };
  });
  assert.equal(ocr.mergeCandidates(candidates, 'drivers').full_name, 'MARIA TERESA DELA CRUZ');
});

test('ID OCR prefers a longer compatible full name across every supported ID type', () => {
  for (const idType of Object.keys(ocr.ID_TYPES)) {
    const texts = idType === 'philid'
      ? [
        'Mga Pangalan/Given Names: Carl\nApelyido/Last Name: John',
        'Mga Pangalan/Given Names: Carl\nApelyido/Last Name: John',
        'Mga Pangalan/Given Names: Carl John\nApelyido/Last Name: Smith'
      ]
      : [
        'FULL NAME: Carl John',
        'FULL NAME: Carl John',
        'FULL NAME: Carl John Smith'
      ];
    const candidates = texts.map(text => ({
      text,
      confidence: 0.9,
      parsed: ocr.parseIdText(text, idType)
    }));
    assert.equal(ocr.mergeCandidates(candidates, idType).full_name, 'Carl John Smith', idType);
  }
});

test('ID OCR detects an unsupported document without inventing a supported ID type', () => {
  assert.equal(ocr.detectIdType('POSTAL ID\nFULL NAME: Juan Dela Cruz'), null);
  assert.equal(ocr.detectIdType(['PAMBANSANG PAGKAKAKILANLAN', 'PSN', 'PASSPORT']), 'philid');
  assert.equal(ocr.detectIdType('PASSPORT\nB1234567A'), null);
});

test('ID OCR document validation accepts complete supported ID data', () => {
  const text = [
    'PAMBANSANG PAGKAKAKILANLAN',
    'FULL NAME: Juan Dela Cruz',
    'DATE OF BIRTH: January 1, 2000',
    'ADDRESS: Balayan, Batangas',
    'PSN: 1234 5678 9012 3456'
  ].join('\n');
  const result = ocr.validateIdDocument({
    full_name: 'Juan Dela Cruz',
    dob: '2000-01-01',
    address: 'Balayan, Batangas',
    id_number: '1234567890123456'
  }, 'philid', text);

  assert.equal(result.valid, true);
  assert.equal(result.idType, 'philid');
});

test('ID OCR supports the IVS ID choices and does not require an address on the card', () => {
  const examples = [
    ['philid', '1234 5678 9012 3456', 'PHILIPPINE IDENTIFICATION CARD'],
    ['drivers', 'N 01 23 123456', "DEPARTMENT OF TRANSPORTATION\nLAND TRANSPORTATION OFFICE\nDRIVER'S LICENSE"],
    ['umid', '1234 5678901 2', 'SOCIAL SECURITY SYSTEM']
  ];

  assert.deepEqual(Object.keys(ocr.ID_TYPES), examples.map(([type]) => type));
  for (const [type, idNumber, marker] of examples) {
    const additionalEvidence = type === 'philid'
      ? `PSN: ${idNumber}`
      : type === 'drivers'
        ? `FIRST NAME: Juan\nLAST NAME: Dela Cruz\nLICENSE NUMBER: ${idNumber}\nRESTRICTIONS: 1`
      : `GIVEN NAME: Juan\nSURNAME: Dela Cruz\nSSS NUMBER: ${idNumber}\nSEX: M`;
    const text = type === 'philid'
      ? `${marker}\nApelyido/Last Name: Dela Cruz\nMga Pangalan/Given Names: Juan\nDate of Birth: January 1, 2000\n${additionalEvidence}`
      : `${marker}\nFULL NAME: Juan Dela Cruz\nDATE OF BIRTH: January 1, 2000\n${additionalEvidence}`;
    assert.equal(ocr.detectIdType(text), type);
    const fields = ocr.parseIdText(text, type).fields;
    assert.equal(fields.full_name, 'Juan Dela Cruz');
    assert.equal(fields.dob, '2000-01-01');
    assert.equal(fields.id_number, idNumber);
    const result = ocr.validateIdDocument(fields, type, text);
    assert.equal(ocr.canProceedToReview(result), true, `${type} should reach review without an address`);
    assert.notEqual(result.code, 'incomplete_id', `${type} should not require an address`);
  }
  assert.equal(ocr.validateIdDocument({
    full_name: 'Juan Dela Cruz',
    dob: '2000-01-01',
    address: '',
    id_number: 'B1234567A'
  }, 'philid', 'PASSPORT\nB1234567A').valid, false);
});

test('ID OCR routes incomplete or ambiguous evidence to review without rejecting recognized IDs for low confidence', () => {
  assert.equal(ocr.canProceedToReview({ code: 'incomplete_id' }), false);
  assert.equal(ocr.canProceedToReview({ valid: true, code: 'valid' }), true);
  assert.equal(ocr.canProceedToReview({ code: 'needs_review' }), false);
  assert.equal(ocr.canProceedToReview({ code: 'needs_review', detectedCardType: 'philid' }), true);
  assert.equal(ocr.canProceedToReview({ code: 'wrong_id_type' }), false);
  assert.equal(ocr.canProceedToReview({ code: 'invalid_id_number' }), false);
  assert.equal(ocr.canProceedToReview({ code: 'unsupported_id' }), false);
  assert.equal(ocr.canProceedToReview({ code: 'multiple_id_types' }), false);
  assert.equal(ocr.canProceedToReview({ code: 'low_confidence' }), false);
  assert.equal(ocr.canProceedToReview({ code: 'id_markers_missing' }), false);
  assert.equal(ocr.canProceedToReview({ code: 'unexpected_error' }), false);
  assert.equal(ocr.validateIdDocument({
    full_name: '',
    dob: '',
    address: '',
    id_number: ''
  }, 'philid', 'POSTAL ID').code, 'unsupported_id');
  const missingFields = ocr.validateIdDocument({
    full_name: '',
    dob: '',
    address: '',
    id_number: ''
  }, 'philid', 'PAMBANSANG PAGKAKAKILANLAN\nFULL NAME: Juan Dela Cruz\nDATE OF BIRTH: January 1, 2000\nADDRESS: Balayan, Batangas');
  assert.equal(missingFields.code, 'needs_review');
  assert.equal(missingFields.reason, 'Some required information could not be read. Please check the details before continuing.');
  const invalidNumber = ocr.validateIdDocument({
    full_name: 'Juan Dela Cruz',
    dob: '2000-01-01',
    address: '',
    id_number: 'B1234567A'
  }, 'philid', 'PAMBANSANG PAGKAKAKILANLAN\nFULL NAME: Juan Dela Cruz\nDATE OF BIRTH: January 1, 2000\nADDRESS: Balayan, Batangas\nPSN: B1234567A');
  assert.equal(invalidNumber.code, 'needs_review');
  assert.equal(invalidNumber.reason, 'The ID number could not be read clearly. Please check it before continuing.');
  const lowConfidence = ocr.validateIdDocument({
    full_name: 'Juan Dela Cruz',
    dob: '2000-01-01',
    id_number: '1234567890123456'
  }, 'philid', 'REPUBLIKA NG PILIPINAS\nPAMBANSANG PAGKAKAKILANLAN', 0.2);
  assert.equal(lowConfidence.code, 'needs_review');
  assert.equal(lowConfidence.status, 'needs_review');
  assert.equal(lowConfidence.cardTypeConfidence >= 40 && lowConfidence.cardTypeConfidence < 60, true);
  assert.equal(ocr.canProceedToReview(lowConfidence), true);
});

test('ID OCR detects each card subtype and maps UMID-family cards to the UMID category', () => {
  const examples = [
    ['philid', 'philid', 'PAMBANSANG PAGKAKAKILANLAN\nPSN: 1234567890123456'],
    ['drivers', 'drivers', "DEPARTMENT OF TRANSPORTATION\nLAND TRANSPORTATION OFFICE\nDRIVER'S LICENSE\nDLN: N0123123456"],
    ['sss', 'umid', 'SOCIAL SECURITY SYSTEM\nSSS NUMBER: 1234567890'],
    ['philhealth', 'umid', 'PHILHEALTH\nPHILIPPINE HEALTH INSURANCE CORPORATION\nPHILHEALTH NUMBER: 123456789012'],
    ['pagibig', 'umid', 'PAG-IBIG FUND\nLOYALTY CARD PLUS\nMID NO: 123456789012']
  ];

  assert.deepEqual(Object.keys(ocr.ID_TYPES), ['philid', 'drivers', 'umid']);
  for (const [cardType, category, text] of examples) {
    assert.equal(ocr.detectCardType(text), cardType, `${cardType} card`);
    assert.equal(ocr.detectIdType(text), category, `${cardType} category`);
  }
  assert.equal(ocr.detectCardType('GSIS\nUNIFIED MULTI-PURPOSE ID\nCRN: 123456789012'), null);
  assert.equal(ocr.detectCardType('LAND TRANSPORTATION OFFICE\nDRIVER LICENSE'), null);
});

test('ID OCR extracts numbers and names from agency-specific UMID card labels', () => {
  const examples = [
    ['sss', 'SOCIAL SECURITY SYSTEM\nGIVEN NAME: Juan\nMIDDLE NAME: Santos\nSURNAME: Dela Cruz\nSSS NUMBER: 123-4567890-1', '123-4567890-1'],
    ['philhealth', 'PHILHEALTH\nMEMBER NAME: Juan Santos Dela Cruz\nPHILHEALTH NUMBER: 123456789012', '123456789012'],
    ['pagibig', 'PAG-IBIG FUND\nLOYALTY CARD PLUS\nFULL NAME: Juan Santos Dela Cruz\nMID NO: 123456789012', '123456789012']
  ];

  for (const [cardType, text, idNumber] of examples) {
    const parsed = ocr.parseIdText(text, 'umid');
    assert.equal(ocr.detectCardType(text), cardType);
    assert.equal(parsed.fields.id_number, idNumber, `${cardType} ID number`);
    assert.match(parsed.fields.full_name, /Juan/);
    assert.match(parsed.fields.full_name, /Dela Cruz/);
  }
});

test('ID OCR validates UMID-family subtypes and mismatches while applying confidence status bands', () => {
  const examples = [
    ['sss', 'SOCIAL SECURITY SYSTEM\nSSS NUMBER: 1234567890\nGIVEN NAME: Juan\nSURNAME: Cruz', { full_name: 'Juan Dela Cruz', id_number: '1234567890' }],
    ['philhealth', 'PHILHEALTH\nPHILHEALTH NUMBER: 123456789012\nMEMBER NAME: Juan Dela Cruz\nDATE OF BIRTH: January 1, 1990', { full_name: 'Juan Dela Cruz', id_number: '123456789012', dob: '1990-01-01' }],
    ['pagibig', 'PAG-IBIG FUND\nLOYALTY CARD PLUS\nMID NO: 123456789012\nFULL NAME: Juan Dela Cruz\nCARD NUMBER: 9876543210', { full_name: 'Juan Dela Cruz', id_number: '123456789012' }]
  ];

  for (const [cardType, text, fields] of examples) {
    const result = ocr.validateIdDocument(fields, 'umid', text);
    assert.equal(result.valid, true, `${cardType} should pass its category`);
    assert.equal(result.detectedCardType, cardType);
    assert.equal(result.cardTypeConfidence >= 70, true);
  }
  assert.deepEqual(ocr.requiredFieldsForIdType('umid'), ['full_name', 'id_number']);

  const wrongCategory = ocr.validateIdDocument(
    { full_name: 'Juan Dela Cruz', dob: '1990-01-01', id_number: '123456789012' },
    'philid',
    'PHILHEALTH\nPHILHEALTH NUMBER: 123456789012\nMEMBER NAME: Juan Dela Cruz\nDATE OF BIRTH: January 1, 1990'
  );
  assert.equal(wrongCategory.code, 'wrong_id_type');
  assert.equal(wrongCategory.reason, 'This photo appears to show a PhilHealth ID, but you selected Philippine National ID (PhilSys). Please check your selection or upload the matching ID.');

  const multipleTypes = ocr.validateIdDocument(
    { full_name: 'Juan Dela Cruz', dob: '1990-01-01', id_number: '123456789012' },
    'umid',
    'REPUBLIKA NG PILIPINAS\nPAMBANSANG PAGKAKAKILANLAN\nPHILHEALTH\nPHILIPPINE HEALTH INSURANCE CORPORATION'
  );
  assert.equal(multipleTypes.code, 'multiple_id_types');
  assert.equal(multipleTypes.reason, 'This photo appears to show more than one kind of ID. Please upload one ID at a time.');
  assert.equal(ocr.canProceedToReview(multipleTypes), false);
  assert.equal(ocr.validateIdDocument({}, 'philid', 'PHILSYS', 0.2).code, 'unsupported_id');

  const needsReview = ocr.validateIdDocument(
    { full_name: 'Juan Dela Cruz', dob: '1990-01-01', id_number: '1234567890123456' },
    'philid',
    'REPUBLIKA NG PILIPINAS\nPAMBANSANG PAGKAKAKILANLAN',
    0.2
  );
  assert.equal(needsReview.code, 'needs_review');
  assert.equal(needsReview.cardTypeConfidence >= 40 && needsReview.cardTypeConfidence < 60, true);
  assert.deepEqual(
    [ocr.confidenceStatus(90), ocr.confidenceStatus(60), ocr.confidenceStatus(40), ocr.confidenceStatus(39)],
    ['verified', 'accepted', 'needs_review', 'rejected']
  );
});

test('ID OCR identifies Philippine National IDs and driver licenses from indicator scores', () => {
  const nationalIdIndicators = [
    'REPUBLIKA NG PILIPINAS',
    'PAMBANSANG PAGKAKAKILANLAN',
    'PHILIPPINE IDENTIFICATION CARD',
    'APELYIDO',
    'MGA PANGALAN',
    'GITNANG APELYIDO',
    'PETS A NG KAPANGANAKAN',
    'TIRAHAN',
    'PSN'
  ].join('\n');
  assert.equal(ocr.cardTypeIndicatorPoints(nationalIdIndicators, 'philid'), 2);
  assert.equal(ocr.detectCardType('REPUBLIKA NG PILIPINAS\nPAMBANSANG PAGKAKAKILANLAN'), 'philid');
  assert.equal(ocr.cardTypeIndicatorPoints('DEPARTMENT OF TRANSPORTATION\nLAND TRANSPORTATION OFFICE\nDRIVER LICENSE', 'drivers'), 3);
  assert.equal(ocr.detectCardType('DEPARTMENT OF TRANSPORTATION\nLAND TRANSPORTATION OFFICE\nDRIVER LICENSE'), 'drivers');
  assert.equal(ocr.detectCardType('CRN\nDATE OF BIRTH\nSEX'), null);

  const unidentifiedButReviewable = ocr.validateIdDocument(
    {},
    'philid',
    'PETS A NG KAPANGANAKAN\nGIVEN NAMES\nLAST NAME',
    0.9
  );
  assert.equal(unidentifiedButReviewable.code, 'unsupported_id');
  assert.equal(unidentifiedButReviewable.reason, "We couldn't recognize this ID. Please upload a clear photo of the ID you selected.");
  assert.equal(ocr.canProceedToReview(unidentifiedButReviewable), false);
});

test('ID OCR returns the requested structured fields with nulls for missing values', () => {
  assert.deepEqual(ocr.parseIdDocument('unreadable card text'), {
    id_type: null,
    full_name: null,
    date_of_birth: null,
    address: null,
    id_number: null,
    expiration_date: null
  });
  const licenseText = [
    'DEPARTMENT OF TRANSPORTATION',
    'LAND TRANSPORTATION OFFICE',
    "DRIVER'S LICENSE",
    'LICENSE NUMBER: N0123123456',
    'EXPIRATION DATE: December 31, 2030'
  ].join('\n');
  assert.deepEqual(ocr.parseIdDocument(licenseText), {
    id_type: "Driver's License",
    full_name: null,
    date_of_birth: null,
    address: null,
    id_number: 'N0123123456',
    expiration_date: '2030-12-31'
  });
  assert.equal(ocr.parseIdDocument(licenseText.replace('EXPIRATION DATE', 'EXP.')).expiration_date, '2030-12-31');
  assert.equal(
    ocr.parseIdDocument('SOCIAL SECURITY SYSTEM\nSSS NUMBER: 1234567890').id_type,
    'UMID - SSS CARD'
  );
});

test('ID OCR document validation rejects unsupported or incomplete data', () => {
  assert.equal(ocr.validateIdDocument({
    full_name: 'Juan',
    dob: '',
    address: '',
    id_number: ''
  }, null, 'POSTAL ID').valid, false);
  const undetected = ocr.validateIdDocument({}, 'philid', 'POSTAL ID', 0.2);
  assert.equal(undetected.code, 'unsupported_id');
  assert.equal(undetected.reason, "We couldn't recognize this ID. Please upload a clear photo of the ID you selected.");
  const identifiedWithoutSelection = ocr.validateIdDocument({
    full_name: 'Juan Dela Cruz',
    dob: '2000-01-01',
    id_number: '1234567890123456'
  }, null, 'REPUBLIKA NG PILIPINAS\nPAMBANSANG PAGKAKAKILANLAN', 0.2);
  assert.equal(identifiedWithoutSelection.code, 'needs_review');
  assert.equal(identifiedWithoutSelection.detectedCardType, 'philid');
});

test('ID OCR retries unread passes up to three times and returns the selected ID type', async () => {
  const keys = ['document', 'Image', 'Tesseract'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const restore = () => {
    for (const key of keys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  };
  class MockImage {
    width = 120;
    height = 80;
    set src(value) {
      queueMicrotask(() => this.onload());
    }
  }
  const canvasContext = {
    drawImage() {},
    putImageData() {},
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = (x + y) % 2 ? 255 : 0;
          const offset = (y * width + x) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = value;
          data[offset + 3] = 255;
        }
      }
      return { data, width, height };
    }
  };
  const recognizedText = [
    'PAMBANSANG PAGKAKAKILANLAN',
    'APELYIDO/LAST NAME: Dela Cruz',
    'MGA PANGALAN/GIVEN NAMES: Juan Alberto',
    'GITNANG APELYIDO/MIDDLE NAME: Santos',
    'PETSA NG KAPANGANAKAN: January 1, 2000',
    'ADDRESS: Balayan, Batangas',
    'PSN: 1234 5678 9012 3456'
  ].join('\n');
  const words = recognizedText.split('\n').flatMap((line, lineIndex) =>
    line.split(/\s+/).map((text, wordIndex) => ({
      text,
      block_num: 1,
      paragraph_num: 1,
      line_num: lineIndex + 1,
      bbox: {
        x0: wordIndex * 80,
        y0: lineIndex * 20,
        x1: wordIndex * 80 + 60,
        y1: lineIndex * 20 + 15
      }
    }))
  );
  let recognizeCount = 0;

  Object.defineProperties(global, {
    document: {
      configurable: true,
      value: { createElement: () => ({ getContext: () => canvasContext }) }
    },
    Image: { configurable: true, value: MockImage },
    Tesseract: {
      configurable: true,
      value: {
        createWorker: async () => ({
          setParameters: async () => {},
          recognize: async () => {
            const hasText = ++recognizeCount >= 3;
            return {
              data: {
                text: hasText ? recognizedText.replace(/\s+/g, '') : '',
                confidence: 90,
                words: hasText ? words : []
              }
            };
          },
          terminate: async () => {}
        })
      }
    }
  });

  try {
    const result = await ocr.extractId(new Blob(['ID image'], { type: 'image/png' }), {
      idType: 'philid'
    });
    assert.equal(recognizeCount, 3);
    assert.equal(result.idType, 'philid');
    assert.equal(result.documentValidation.valid, true);
    assert.equal(result.autoFillAllowed, true);
    assert.equal(result.fields.full_name, 'Juan Alberto Santos Dela Cruz');
    assert.equal(result.fields.address, 'Balayan, Batangas');
    assert.equal(result.fields.dob, '2000-01-01');
    assert.equal(result.fields.id_number, '1234 5678 9012 3456');
  } finally {
    restore();
  }
});

test('ID OCR blocks a selected category when OCR detects a different supported ID type', async () => {
  const keys = ['document', 'Image', 'Tesseract'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const restore = () => {
    for (const key of keys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  };
  class MockImage {
    width = 120;
    height = 80;
    set src(value) {
      queueMicrotask(() => this.onload());
    }
  }
  const canvasContext = {
    drawImage() {},
    putImageData() {},
    getImageData(_x, _y, width, height) {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
  };
  const recognizedText = [
    "DRIVER'S LICENSE",
    'LICENSE NUMBER: N 01 23 123456',
    'PHILHEALTH',
    'PHILIPPINE HEALTH INSURANCE CORPORATION',
    'FULL NAME: Juan Dela Cruz',
    'DATE OF BIRTH: January 1, 2000',
    'ADDRESS: Balayan, Batangas'
  ].join('\n');

  Object.defineProperties(global, {
    document: {
      configurable: true,
      value: { createElement: () => ({ getContext: () => canvasContext }) }
    },
    Image: { configurable: true, value: MockImage },
    Tesseract: {
      configurable: true,
      value: {
        createWorker: async () => ({
          setParameters: async () => {},
          recognize: async () => ({ data: { text: recognizedText, confidence: 90, words: [] } }),
          terminate: async () => {}
        })
      }
    }
  });

  try {
    const result = await ocr.extractId(new Blob(['ID image'], { type: 'image/png' }), {
      idType: 'drivers'
    });
    assert.equal(result.detectedCardType, 'philhealth');
    assert.equal(result.documentValidation.code, 'wrong_id_type');
    assert.equal(result.autoFillAllowed, false);
  } finally {
    restore();
  }
});

test('ID OCR retries coordinate-cropped name, birth-date, and ID-number regions', async () => {
  const keys = ['document', 'Image', 'Tesseract'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const restore = () => {
    for (const key of keys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  };
  class MockImage {
    width = 120;
    height = 80;
    set src(value) {
      queueMicrotask(() => this.onload());
    }
  }
  const canvasContext = {
    drawImage() {},
    putImageData() {},
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = (x + y) % 2 ? 255 : 0;
          const offset = (y * width + x) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = value;
          data[offset + 3] = 255;
        }
      }
      return { data, width, height };
    }
  };
  const originalText = [
    'PAMBANSANG PAGKAKAKILANLAN',
    'MGA PANGALAN/GIVEN NAMES: Carl',
    'GITNANG APELYIDO/MIDDLE NAME: John',
    'APELYIDO/LAST NAME:',
    'DATE OF BIRTH:',
    'ADDRESS: Balayan, Batangas',
    'PSN:'
  ].join('\n');
  const words = originalText.split('\n').flatMap((line, lineIndex) =>
    line.split(/\s+/).map((text, wordIndex) => ({
      text,
      block_num: 1,
      paragraph_num: 1,
      line_num: lineIndex + 1,
      bbox: {
        x0: wordIndex * 20,
        y0: lineIndex * 16,
        x1: wordIndex * 20 + 15,
        y1: lineIndex * 16 + 12
      }
    }))
  );
  let recognizeCount = 0;
  const recognizeWidths = [];

  Object.defineProperties(global, {
    document: {
      configurable: true,
      value: { createElement: () => ({ getContext: () => canvasContext }) }
    },
    Image: { configurable: true, value: MockImage },
    Tesseract: {
      configurable: true,
      value: {
        createWorker: async () => ({
          setParameters: async () => {},
          recognize: async preparedCanvas => {
            recognizeCount += 1;
            recognizeWidths.push(preparedCanvas.width);
            if (recognizeCount <= 3) {
              return { data: { text: originalText, confidence: 90, words } };
            }
            return {
              data: {
                text: recognizeCount === 4
                  ? 'DATE OF BIRTH: January 1, 2000'
                  : recognizeCount === 5
                    ? 'APELYIDO/LAST NAME: Smith'
                    : 'PSN: 1234 5678 9012 3456',
                confidence: 95,
                words: []
              }
            };
          },
          terminate: async () => {}
        })
      }
    }
  });

  try {
    const result = await ocr.extractId(new Blob(['ID image'], { type: 'image/png' }), {
      idType: 'philid'
    });
    assert.equal(recognizeCount, 6);
    assert.equal(result.fields.full_name, 'Carl John Smith');
    assert.equal(result.fields.dob, '2000-01-01');
    assert.equal(result.fields.id_number, '1234 5678 9012 3456');
    assert.equal(result.documentValidation.valid, true);
    assert.ok(recognizeWidths[3] > recognizeWidths[0]);
    assert.ok(recognizeWidths[4] > recognizeWidths[0]);
    assert.ok(recognizeWidths[5] > recognizeWidths[0]);
  } finally {
    restore();
  }
});

test('ID OCR searches National ID template regions when the number has no label', async () => {
  const keys = ['document', 'Image', 'Tesseract', 'paddlejs'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const restore = () => {
    for (const key of keys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  };
  class MockImage {
    width = 120;
    height = 80;
    set src(value) {
      queueMicrotask(() => this.onload());
    }
  }
  const canvasContext = {
    drawImage() {},
    putImageData() {},
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < data.length; index += 4) {
        const value = index % 8 ? 255 : 0;
        data[index] = data[index + 1] = data[index + 2] = value;
        data[index + 3] = 255;
      }
      return { data, width, height };
    }
  };
  const cardText = [
    'PAMBANSANG PAGKAKAKILANLAN',
    'MGA PANGALAN/GIVEN NAMES: Carl',
    'GITNANG APELYIDO/MIDDLE NAME: John',
    'APELYIDO/LAST NAME: Smith',
    'DATE OF BIRTH: 01/01/2000'
  ].join('\n');
  let recognizeCount = 0;

  Object.defineProperties(global, {
    document: {
      configurable: true,
      value: { createElement: () => ({ getContext: () => canvasContext }) }
    },
    Image: { configurable: true, value: MockImage },
    Tesseract: {
      configurable: true,
      value: {
        createWorker: async () => ({
          setParameters: async () => {},
          recognize: async () => {
            recognizeCount += 1;
            return {
              data: {
                text: recognizeCount <= 3 ? cardText : '1234 5678 9012 3456',
                confidence: 95,
                words: []
              }
            };
          },
          terminate: async () => {}
        })
      }
    },
    paddlejs: {
      configurable: true,
      value: {
        ocr: {
          init: async () => {},
          recognize: async () => ({ text: '' })
        }
      }
    }
  });

  try {
    const result = await ocr.extractId(new Blob(['ID image'], { type: 'image/png' }), {
      idType: 'philid'
    });
    assert.equal(result.fields.id_number, '1234 5678 9012 3456');
    assert.equal(recognizeCount, 4);
  } finally {
    restore();
  }
});

test('ID OCR prefers an alternate labeled Paddle name and recovers the Filipino birth-date label', async () => {
  const keys = ['document', 'Image', 'Tesseract', 'paddlejs'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const restore = () => {
    for (const key of keys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  };
  class MockImage {
    width = 8;
    height = 8;
    set src(value) {
      queueMicrotask(() => this.onload());
    }
  }
  const canvasContext = {
    drawImage() {},
    putImageData() {},
    getImageData(_x, _y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = (x + y) % 2 ? 255 : 0;
          const offset = (y * width + x) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = value;
          data[offset + 3] = 255;
        }
      }
      return { data, width, height };
    }
  };
  const tesseractText = [
    'PAMBANSANG PAGKAKAKILANLAN',
    'FULL NAME: We Ng',
    'DATE OF BIRTH:',
    'ADDRESS: 123 Main Street',
    'PSN: 1234 5678 9012 3456'
  ].join('\n');
  const tesseractWords = tesseractText.split('\n').flatMap((line, lineIndex) =>
    line.split(/\s+/).map((text, wordIndex) => ({
      text,
      block_num: 1,
      paragraph_num: 1,
      line_num: lineIndex + 1,
      bbox: {
        x0: wordIndex * 12,
        y0: lineIndex * 12,
        x1: wordIndex * 12 + 10,
        y1: lineIndex * 12 + 9
      }
    }))
  );
  let paddleRecognizeCount = 0;
  const ocrEngineOrder = [];

  Object.defineProperties(global, {
    document: {
      configurable: true,
      value: { createElement: () => ({ getContext: () => canvasContext }) }
    },
    Image: { configurable: true, value: MockImage },
    Tesseract: {
      configurable: true,
      value: {
        createWorker: async () => {
          ocrEngineOrder.push('tesseract');
          return ({
          setParameters: async () => {},
          recognize: async () => ({
            data: {
              text: tesseractText,
              confidence: 90,
              words: tesseractWords
            }
          }),
          terminate: async () => {}
          });
        }
      }
    },
    paddlejs: {
      configurable: true,
      value: {
        ocr: {
          init: async () => {},
          recognize: async () => {
            paddleRecognizeCount += 1;
            ocrEngineOrder.push('paddle');
            return {
              text: paddleRecognizeCount === 1
                ? [
                  'PAMBANSANG PAGKAKAKILANLAN',
                  'MGA PANGALAN/GIVEN NAMES: Carl',
                  'APELYIDO/LAST NAME: Smith',
                  'ADDRESS: 123 Main Street',
                  'PSN: 1234 5678 9012 3456'
                ].join('\n')
                : 'PETSA NG KAPANGANAKAN: 07 12 1990'
            };
          }
        }
      }
    }
  });

  try {
    const result = await ocr.extractId(new Blob(['ID image'], { type: 'image/png' }));
    assert.deepEqual(ocrEngineOrder.slice(0, 2), ['paddle', 'tesseract']);
    assert.equal(result.paddleEngineUsed, true);
    assert.equal(result.fields.full_name, 'Carl Smith');
    assert.equal(result.fields.dob, '1990-12-07');
    assert.equal(result.fields.address, '123 Main Street');
    assert.equal(result.fields.id_number, '1234 5678 9012 3456');
    assert.equal(result.documentValidation.valid, true);
    assert.ok(paddleRecognizeCount > 1);
  } finally {
    restore();
  }
});

test('ID OCR composes a name from separate given, middle, and family name fields', () => {
  const parsed = ocr.parseIdText([
    'FIRST NAME: Juan',
    'MIDDLE NAME: Alberto',
    'LAST NAME: Dela Cruz'
  ].join('\n'));

  assert.equal(parsed.fields.full_name, 'Juan Alberto Dela Cruz');
});

test('ID image validation accepts JPG, JPEG, PNG, and WEBP under the 5 MB limit', () => {
  const examples = [
    { name: 'staff-id.JPG', type: 'image/jpeg', size: 128 },
    { name: 'staff-id.jpeg', type: 'image/jpeg', size: logic.ID_IMAGE_MAX_BYTES },
    { name: 'staff-id.png', type: 'image/png', size: 128 },
    { name: 'staff-id.webp', type: 'image/webp', size: 128 },
    { name: 'staff-id.png', type: '', size: 128 }
  ];

  examples.forEach(file => assert.deepEqual(logic.validateIdImageFile(file), { ok: true, message: '' }));
});

test('ID image validation rejects unsupported extensions and mismatched MIME types', () => {
  assert.match(logic.validateIdImageFile({ name: 'staff-id.gif', type: 'image/gif', size: 10 }).message, /Unsupported file type/);
  assert.match(logic.validateIdImageFile({ name: 'staff-id.jpg', type: 'image/png', size: 10 }).message, /Unsupported file type/);
});

test('ID image validation rejects files larger than 5 MB', () => {
  const result = logic.validateIdImageFile({
    name: 'staff-id.jpg',
    type: 'image/jpeg',
    size: logic.ID_IMAGE_MAX_BYTES + 1
  });

  assert.deepEqual(result, { ok: false, message: 'File exceeds the 5 MB maximum size.' });
});

test('closed-bill report totals keep voids separate and ignore unrelated legacy values', () => {
  const totals = logic.closedBillRevenueTotals([
    {
      closed_bill_count: 2,
      net_revenue: 1150,
      discount_total: 100,
      customers_served: 9,
      voided_bill_count: 2,
      voided_bill_amount: 450,
      legacy_revenue: 9999
    },
    {
      closed_bill_count: 0,
      net_revenue: 0,
      discount_total: 0,
      customers_served: 0,
      voided_bill_count: 0,
      voided_bill_amount: 0
    }
  ]);

  assert.deepEqual(totals, {
    closedBillCount: 2,
    netRevenue: 1150,
    discountTotal: 100,
    customersServed: 9,
    voidedBillCount: 2,
    voidedBillAmount: 450
  });
  assert.throws(() => logic.closedBillRevenueTotals(null), /must be an array/);
});

test('Lunch reservations fall back to the active All Day rate', () => {
  const rates = [{
    mealPeriod: 'All Day',
    dayType: 'weekday',
    adultRate: 449,
    childRate: 225,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true
  }];
  const rate = logic.activeBuffetRate(rates, 'Lunch', '2026-11-11', 'WEEKDAY');

  assert.equal(rate, rates[0]);
  assert.equal(logic.reservationRevenue({ guests: 2, adults: 2, children: 0 }, rate), 898);
});

test('missing buffet rate is represented without throwing', () => {
  const rate = logic.activeBuffetRate([], 'Lunch', '2026-11-11', 'weekday');

  assert.equal(rate, undefined);
  assert.equal(logic.reservationRevenue({ guests: 2, adults: 2, children: 0 }, rate), null);
});

test('reservation estimates and validated counts include Senior/PWD guests', () => {
  assert.deepEqual(
    logic.normalizeReservationGuestCounts('2', '1', '2'),
    { adults: 2, seniorPwdCount: 1, children: 2, total: 5 }
  );
  const counts = logic.normalizeReservationGuestCounts('4', '1', '2');
  assert.deepEqual(counts, { adults: 4, seniorPwdCount: 1, children: 2, total: 7 });
  assert.equal(
    logic.reservationRevenue(
      { guests: 7, adults: 4, seniorPwdCount: 1, children: 2 },
      { adultRate: 449, seniorPwdRate: 360, childRate: 225 }
    ),
    2606
  );
  assert.throws(() => logic.normalizeReservationGuestCounts(0, 0, 0), /between 1 and 1,000/);
  assert.throws(() => logic.normalizeReservationGuestCounts(1, -1, 1), /non-negative whole numbers/);
  assert.throws(() => logic.normalizeReservationGuestCounts(1, 0.5, 1), /non-negative whole numbers/);
});

test('reservation guest totals preserve large party counts above six', () => {
  const examples = [
    { adults: 7, seniorPwdCount: 0, children: 0, total: 7 },
    { adults: 5, seniorPwdCount: 1, children: 2, total: 8 },
    { adults: 5, seniorPwdCount: 2, children: 3, total: 10 },
    { adults: 6, seniorPwdCount: 2, children: 4, total: 12 }
  ];

  examples.forEach(({ adults, seniorPwdCount, children, total }) => {
    assert.deepEqual(
      logic.normalizeReservationGuestCounts(adults, seniorPwdCount, children),
      { adults, seniorPwdCount, children, total }
    );
  });
});

test('recent website reservation awareness requires a pending booking created within 24 hours', () => {
  const now = Date.parse('2026-11-19T06:00:00.000Z');
  const reservation = {
    source: 'Website',
    status: 'Pending',
    createdAt: new Date(now - 60 * 60 * 1000).toISOString()
  };

  assert.equal(logic.isRecentWebsiteReservation(reservation, now), true);
  assert.equal(logic.isRecentWebsiteReservation({
    ...reservation,
    createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString()
  }, now), false);
  assert.equal(logic.isRecentWebsiteReservation({
    ...reservation,
    status: 'Confirmed'
  }, now), false);
  assert.equal(logic.isRecentWebsiteReservation({
    ...reservation,
    source: 'Phone'
  }, now), false);
  assert.equal(logic.isRecentWebsiteReservation({
    ...reservation,
    createdAt: new Date(now + 60 * 1000).toISOString()
  }, now), false);
});

test('buffet rate lookup matches weekday, weekend, and holiday day types case-insensitively', () => {
  const rates = ['weekday', 'weekend', 'holiday'].map(dayType => ({
    mealPeriod: 'All Day',
    dayType: dayType.toUpperCase(),
    adultRate: 449,
    childRate: 225,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true
  }));

  for (const dayType of ['weekday', 'weekend', 'holiday']) {
    assert.equal(
      logic.activeBuffetRate(rates, 'Lunch', '2026-11-11', dayType),
      rates.find(rate => rate.dayType.toLowerCase() === dayType)
    );
  }
});

test('converts compatible units and rejects incompatible dimensions', () => {
  assert.equal(logic.convertQuantity(4000, g, kg), 4);
  assert.throws(() => logic.convertQuantity(1, kg, liter), /dimensions differ/);
});

test('recipe cost breakdown separates total batch cost from cost per portion', () => {
  const recipe = {
    batchYield: 4,
    wastage: 10,
    ingredients: [
      { ingredientId: 'rice', quantity: 2 },
      { ingredientId: 'chicken', quantity: 4 }
    ]
  };
  const ingredients = [
    { id: 'rice', name: 'Rice', unit: 'kg', cost: 10, stock: 7 },
    { id: 'chicken', name: 'Chicken', unit: 'kg', cost: 5, stock: 10 }
  ];
  const breakdown = logic.recipeCostBreakdown(recipe, ingredients);

  assert.equal(breakdown.totalBatchCost, 44);
  assert.equal(breakdown.costPerPortion, 11);
  assert.deepEqual(breakdown.ingredients.map(line => [line.name, line.lineCost, line.costPercent]), [
    ['Rice', 22, 50],
    ['Chicken', 22, 50]
  ]);
  assert.equal(logic.computedRecipeCost(recipe, ingredients), 44);
  assert.deepEqual(logic.recipeStockAvailability(recipe, ingredients), {
    batches: 2,
    limitingIngredientId: 'chicken'
  });
  assert.equal(logic.recipeFoodCostPercent(breakdown.costPerPortion, 449), 11 / 449 * 100);
});

test('production cost stays fixed to its snapshot after recipe cost changes', () => {
  const originalRecipe = {
    batchYield: 4,
    wastage: 10,
    ingredients: [{ ingredientId: 'rice', quantity: 2 }]
  };
  const originalIngredients = [{ id: 'rice', name: 'Rice', unit: 'kg', cost: 10, stock: 7 }];
  const log = { quantity: 1, batchCostSnapshot: 22 };
  const editedRecipe = { ...originalRecipe, ingredients: [{ ingredientId: 'rice', quantity: 8 }] };
  const editedIngredients = [{ ...originalIngredients[0], cost: 20 }];

  assert.equal(logic.productionLogCost(log, editedRecipe, editedIngredients), 22);
  assert.equal(logic.productionLogCost({ quantity: 2 }, editedRecipe, editedIngredients), 352);
});

test('recipe sanity warning flags an implausible unit quantity without blocking cost', () => {
  const recipe = {
    batchYield: 30,
    wastage: 0,
    ingredients: [{ ingredientId: 'oil', quantity: 101 }]
  };
  const ingredients = [{ id: 'oil', name: 'Cooking oil', unit: 'kg', cost: 20, stock: 500 }];
  const warnings = logic.recipeSanityWarnings(recipe, ingredients, 449);

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /101 kg.*verify the unit/);
  assert.equal(logic.recipeCostBreakdown(recipe, ingredients).totalBatchCost, 2020);
});

test('inactive recipe state is preserved and recognized', () => {
  assert.equal(logic.isRecipeActive({ isActive: true }), true);
  assert.equal(logic.isRecipeActive({ is_active: false }), false);
  assert.equal(logic.isRecipeActive({}), true);
});

test('plans FIFO consumption across batches using each batch cost', () => {
  const result = logic.planConsumption({
    batches: [
      { id: 'A', quantityRemaining: 50, unitCost: 120, receivedDate: '2026-11-01' },
      { id: 'B', quantityRemaining: 30, unitCost: 130, receivedDate: '2026-11-05' }
    ],
    quantity: 60,
    recipeUnit: kg,
    stockUnit: kg,
    asOfDate
  });

  assert.equal(result.isSufficient, true);
  assert.deepEqual(result.allocations.map(item => [item.batchId, item.quantity]), [['A', 50], ['B', 10]]);
  assert.equal(result.totalCost, 7300);
  assert.equal(result.shortageQuantity, 0);
});

test('does not consume expired batches and reports an exact shortage', () => {
  const result = logic.planConsumption({
    batches: [
      { id: 'expired', quantityRemaining: 20, unitCost: 5, receivedDate: '2026-10-01', expirationDate: '2026-11-10' },
      { id: 'active', quantityRemaining: 3, unitCost: 8, receivedDate: '2026-11-01' }
    ],
    quantity: 5,
    recipeUnit: kg,
    stockUnit: kg,
    asOfDate
  });

  assert.equal(result.isSufficient, false);
  assert.equal(result.allocatedQuantity, 3);
  assert.equal(result.shortageQuantity, 2);
  assert.deepEqual(result.allocations.map(item => item.batchId), ['active']);
});

test('FIFO uses the older batch first and warns when a newer batch expires sooner', () => {
  const result = logic.planConsumption({
    batches: [
      { id: 'older', quantityRemaining: 100, unitCost: 2, receivedDate: '2026-11-01', expirationDate: '2026-11-20' },
      { id: 'newer', quantityRemaining: 100, unitCost: 3, receivedDate: '2026-11-05', expirationDate: '2026-11-15' }
    ],
    quantity: 20,
    recipeUnit: kg,
    stockUnit: kg,
    asOfDate
  });
  assert.deepEqual(result.allocations.map(item => [item.batchId, item.quantity]), [['older', 20]]);
  assert.equal(result.warnings.length, 1);
});

test('FEFO sorts dated batches before undated batches', () => {
  const ordered = logic.orderBatches([
    { id: 'undated', receivedDate: '2026-11-01' },
    { id: 'later-expiry', receivedDate: '2026-11-01', expirationDate: '2026-12-01' },
    { id: 'sooner-expiry', receivedDate: '2026-11-05', expirationDate: '2026-11-15' }
  ], 'FEFO');
  assert.deepEqual(ordered.map(item => item.id), ['sooner-expiry', 'later-expiry', 'undated']);
});

test('classifies expiring, expired, and depleted stock and totals only available batches', () => {
  assert.equal(logic.batchStatus({ quantityRemaining: 2, expirationDate: '2026-11-13' }, asOfDate, 3).status, 'Expiring soon');
  assert.equal(logic.batchStatus({ quantityRemaining: 2, expirationDate: '2026-11-10' }, asOfDate, 3).status, 'Expired');
  assert.equal(logic.batchStatus({ quantityRemaining: 0 }, asOfDate).status, 'Depleted');
  assert.equal(logic.availableStock([
    { quantityRemaining: 4 },
    { quantityRemaining: 7, expirationDate: '2026-11-10' },
    { quantityRemaining: 3, status: 'Depleted' }
  ], asOfDate), 4);
});

test('computes stock health and batch-weighted average cost', () => {
  assert.equal(logic.stockHealth(0, 10), 'Out of Stock');
  assert.equal(logic.stockHealth(5, 10), 'Low Stock');
  assert.equal(logic.stockHealth(10, 10), 'Healthy');
  assert.equal(logic.weightedAverageUnitCost([
    { quantityRemaining: 50, unitCost: 120 },
    { quantityRemaining: 30, unitCost: 130 }
  ], asOfDate), 123.75);
});

test('modal type rules restrict backdrop and Escape behavior', () => {
  for (const type of ['form', 'money']) {
    assert.equal(logic.modalInteraction(type, 'backdrop'), 'ignore');
    assert.equal(logic.modalInteraction(type, 'escape'), 'request-close');
  }
  assert.equal(logic.modalInteraction('read-only', 'backdrop'), 'close');
  assert.equal(logic.modalInteraction('read-only', 'escape'), 'close');
  assert.equal(logic.modalInteraction('confirmation', 'backdrop'), 'ignore');
  assert.equal(logic.modalInteraction('confirmation', 'escape'), 'cancel');
  for (const type of ['popover', 'menu']) {
    assert.equal(logic.modalInteraction(type, 'backdrop'), 'close');
    assert.equal(logic.modalInteraction(type, 'escape'), 'close');
  }
});

test('notification feed deduplicates items and badge count equals unread rows', () => {
  const feed = logic.buildNotificationFeed([
    {
      key: 'stock:flour',
      dedupeKey: 'stock:flour',
      category: 'stock',
      title: 'Low stock',
      severity: 'warning',
      action: { view: 'receiving', label: 'Receive stock' }
    },
    {
      key: 'system:legacy-low-flour',
      dedupeKey: 'stock:flour',
      category: 'stock',
      title: 'Low stock',
      severity: 'warning',
      action: { view: 'receiving', label: 'Receive stock' }
    },
    {
      key: 'reservation:r1',
      category: 'reservation',
      title: 'Pending reservation',
      severity: 'info',
      action: { view: 'reservations', label: 'Review reservation' }
    }
  ], 'Manager', ['reservation:r1']);

  assert.equal(feed.length, 2);
  assert.equal(logic.notificationUnreadCount(feed), feed.filter(item => !item.isRead).length);
  assert.equal(logic.notificationUnreadCount(feed), 1);
});

test('notification role visibility excludes unauthorized operational and revenue alerts', () => {
  const stock = { category: 'stock' };
  const reservation = { category: 'reservation' };
  const pos = { category: 'pos' };
  const revenue = { category: 'system', type: 'Missing revenue entry' };

  assert.equal(logic.notificationVisibleToRole(stock, 'Inventory Clerk'), true);
  assert.equal(logic.notificationVisibleToRole(stock, 'Receptionist'), false);
  assert.equal(logic.notificationVisibleToRole(reservation, 'Receptionist'), true);
  assert.equal(logic.notificationVisibleToRole(reservation, 'Inventory Clerk'), false);
  assert.equal(logic.notificationVisibleToRole(pos, 'Manager'), true);
  assert.equal(logic.notificationVisibleToRole(pos, 'Receptionist'), false);
  assert.equal(logic.notificationVisibleToRole(revenue, 'Chef / Kitchen Staff'), false);
  assert.equal(logic.notificationVisibleToRole(revenue, 'Receptionist'), false);
});

test('notification actions are role-safe and point to the intended workflow', () => {
  const approval = {
    category: 'pos',
    action: { view: 'approvals', label: 'Open approval' }
  };
  const unresolved = {
    category: 'unresolved',
    action: { view: 'reservations', label: 'View unresolved bookings' }
  };

  assert.equal(logic.notificationActionForRole(approval, 'Manager').view, 'approvals');
  assert.equal(logic.notificationActionForRole(approval, 'Receptionist'), null);
  assert.equal(logic.notificationActionForRole(unresolved, 'Receptionist').view, 'reservations');
});

test('calendar legend and event presentation share accessible colors for every status', () => {
  const legend = logic.reservationCalendarStatusLegend();
  assert.deepEqual(legend.map(entry => entry.status), [
    'Pending', 'Confirmed', 'Seated', 'Checked-in', 'Completed', 'Cancelled', 'No-show'
  ]);

  const relativeLuminance = hex => {
    const channels = hex.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const { status, ...presentation } of legend) {
    assert.deepEqual(logic.reservationCalendarStatusPresentation(status), presentation);
    const contrast = relativeLuminance(presentation.color) > relativeLuminance(presentation.contrastColor)
      ? (relativeLuminance(presentation.color) + 0.05) / (relativeLuminance(presentation.contrastColor) + 0.05)
      : (relativeLuminance(presentation.contrastColor) + 0.05) / (relativeLuminance(presentation.color) + 0.05);
    assert.ok(contrast >= 4.5, `${status} event text contrast is below WCAG AA`);
  }
});

test('past unresolved marker applies only to earlier unresolved reservation statuses', () => {
  for (const status of ['Pending', 'Confirmed', 'Seated', 'Checked-in']) {
    assert.equal(logic.isPastUnresolvedReservation(status, '2026-11-17', '2026-11-18'), true);
    assert.equal(logic.isPastUnresolvedReservation(status, '2026-11-18', '2026-11-18'), false);
  }
  for (const status of ['Completed', 'Cancelled', 'No-show']) {
    assert.equal(logic.isPastUnresolvedReservation(status, '2026-11-17', '2026-11-18'), false);
  }
});

test('formats server timestamps as 12-hour Asia/Manila date and time', () => {
  assert.equal(
    logic.formatManilaTimestamp('2026-11-17T22:18:00.000Z'),
    '18/11/2026, 6:18 AM'
  );
  assert.throws(() => logic.formatManilaTimestamp('not-a-timestamp'), /invalid timestamp/i);
});

test('save completion does not wait for a separate list refresh', async () => {
  let releaseRefresh;
  let refreshFailure;
  const pendingRefresh = new Promise((resolve, reject) => {
    releaseRefresh = resolve;
  });
  const outcome = await logic.saveThenRefresh(
    async () => ({ id: 'saved-record' }),
    () => pendingRefresh,
    error => { refreshFailure = error; }
  );

  assert.deepEqual(outcome.saved, { id: 'saved-record' });
  releaseRefresh();
  await outcome.refresh;
  assert.equal(refreshFailure, undefined);

  const failedRefresh = new Error('refresh failed');
  const failedOutcome = await logic.saveThenRefresh(
    async () => 'committed',
    async () => { throw failedRefresh; },
    error => { refreshFailure = error; }
  );
  assert.equal(failedOutcome.saved, 'committed');
  await failedOutcome.refresh;
  assert.equal(refreshFailure, failedRefresh);

  let refreshStarted = false;
  await assert.rejects(logic.saveThenRefresh(
    async () => { throw new Error('save failed'); },
    async () => { refreshStarted = true; },
    () => {}
  ), /save failed/);
  assert.equal(refreshStarted, false);
});

test('tracks buffet prep targets across ready and cooking batches', () => {
  const progress = logic.productionProgress([
    { status: 'Ready', expectedCovers: 30 },
    { status: 'Ready', expectedCovers: 10 },
    { status: 'Cooking', expectedCovers: 30 },
    { status: 'Cooking', batchYield: 20, batchCount: 1 },
    { status: 'Cancelled', expectedCovers: 50 }
  ], 100);
  assert.deepEqual(progress, {
    target: 100,
    ready: 40,
    cooking: 50,
    remaining: 10,
    remainingAfterCooking: 60
  });
  assert.equal(logic.productionProgress([
    { status: 'Ready', expectedCovers: 65 },
    { status: 'Cooking', expectedCovers: 45 },
    { status: 'Cooking', expectedCovers: 20 }
  ], 100).remaining, 0);
  assert.throws(() => logic.productionProgress([], -1), /cannot be negative/);
});

test('enforces role actions and validates signed ledger movements', () => {
  assert.equal(logic.canPerformInventoryAction('Inventory Clerk', 'inventory.receive'), true);
  assert.equal(logic.canPerformInventoryAction('Inventory Clerk', 'product.manage'), false);
  assert.equal(logic.canPerformInventoryAction('Manager', 'product.manage'), false);
  assert.equal(logic.canPerformInventoryAction('Manager', 'inventory.receive'), true);
  assert.equal(logic.canPerformInventoryAction('Chef / Kitchen Staff', 'rates.manage'), false);
  assert.equal(logic.canPerformInventoryAction('Chef / Kitchen Staff', 'revenue.read'), false);
  assert.throws(() => logic.assertInventoryRole('Chef / Kitchen Staff', 'revenue.read'), { code: 'FORBIDDEN' });
  assert.throws(() => logic.createStockMovement({
    type: 'Production', quantity: 2, unitCost: 10, productId: 'p', batchId: 'b', referenceType: 'production', referenceId: '1'
  }), /negative quantity/);
  assert.equal(logic.createStockMovement({
    type: 'Production', quantity: -2, unitCost: 10, productId: 'p', batchId: 'b', referenceType: 'production', referenceId: '1'
  }).cost, 20);
});

test('limits two-hour reservation windows to restaurant hours and generates half-hour slots', () => {
  assert.equal(logic.isReservationTimeWithinOpenHours('10:00 AM'), true);
  assert.equal(logic.isReservationTimeWithinOpenHours('7:00 PM'), true);
  assert.equal(logic.isReservationTimeWithinOpenHours('07:00 PM'), true);
  assert.equal(logic.isReservationTimeWithinOpenHours('7:30 PM'), false);
  assert.equal(logic.isReservationTimeWithinOpenHours('8:30PM'), false);
  assert.equal(logic.isReservationTimeWithinOpenHours('9:00 PM'), false);
  assert.equal(logic.isReservationTimeWithinOpenHours('9:30 AM'), false);
  assert.equal(logic.isReservationTimeWithinOpenHours('invalid'), false);
  assert.equal(logic.reservationTimeSlots()[0], '10:00 AM');
  const slots = logic.reservationTimeSlots();
  assert.equal(slots[slots.length - 1], '7:00 PM');
  assert.equal(slots.length, 19);
  assert.equal(logic.reservationEndTime('7:00 PM'), '9:00 PM');
});

test('filters same-day reservation slots without blocking future dates', () => {
  const now = new Date(2026, 10, 16, 12, 1, 0);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-16', '12:00 PM', now), true);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-16', '12:30 PM', now), false);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-16', '12:30 PM', new Date(2026, 10, 16, 12, 30, 0)), false);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-16', '12:30 PM', new Date(2026, 10, 16, 12, 30, 1)), true);
  assert.equal(logic.reservationStartTimeIsInPast('2026-11-17', '10:00 AM', now), false);

  const todaySlots = logic.reservationTimeSlots('2026-11-16', now);
  assert.equal(todaySlots.includes('12:00 PM'), false);
  assert.equal(todaySlots.includes('12:30 PM'), true);
  assert.equal(logic.reservationTimeSlots('2026-11-17', now).length, 19);
});

test('preserves generated reservation IDs despite the form hidden ID and retains existing booking type', () => {
  const first = logic.buildReservationRecord(
    null,
    { id: '', name: 'Customer One', type: '' },
    'RS-FIRST'
  );
  const second = logic.buildReservationRecord(
    null,
    { id: '', name: 'Customer Two', type: '' },
    'RS-SECOND'
  );
  const edited = logic.buildReservationRecord(
    { id: 'RS-FIRST', type: 'Walk-in', name: 'Original' },
    { id: 'RS-FIRST', type: 'Reservation', name: 'Updated' },
    'RS-UNUSED'
  );

  assert.equal(first.id, 'RS-FIRST');
  assert.equal(second.id, 'RS-SECOND');
  assert.notEqual(first.id, second.id);
  assert.equal(edited.id, 'RS-FIRST');
  assert.equal(edited.type, 'Walk-in');
});

test('derives live table availability from bookings and checks overlapping two-hour windows', () => {
  const table = { id: 'T1', status: 'Available' };
  const bookings = [
    { id: 'r2', table: 'T1', date: '2026-11-12', time: '6:00 PM', status: 'Confirmed' },
    { id: 'r1', table: 'T1', date: '2026-11-12', time: '11:00 AM', status: 'Pending' },
    { id: 'no-show', table: 'T1', date: '2026-11-12', time: '3:00 PM', status: 'No-show' },
    { id: 'old', table: 'T1', date: '2026-11-12', time: '1:00 PM', status: 'Cancelled' }
  ];

  const availability = logic.tableAvailability(table, bookings, '2026-11-12', '2026-11-12');
  assert.equal(availability.status, 'Reserved Active');
  assert.equal(availability.primaryBooking.id, 'r1');
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '6:00 PM', bookings), true);
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '6:00 PM', bookings, 'r2'), false);
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '12:30 PM', bookings), true);
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '1:00 PM', bookings), false);
  assert.equal(logic.tableHasReservationConflict('T1', '2026-11-12', '3:00 PM', bookings), false);
  assert.equal(logic.reservationTimeOverlaps('1:00 PM', '2:30 PM'), true);
  assert.equal(logic.reservationTimeOverlaps('1:00 PM', '3:00 PM'), false);
  const sameDayBookings = [
    { id: 'first', table: 'T07', date: '2026-11-13', time: '1:00 PM', status: 'Pending' },
    { id: 'second', table: 'T15', date: '2026-11-13', time: '3:00 PM', status: 'Pending' }
  ];
  assert.equal(logic.tableHasReservationConflict('T07', '2026-11-13', '3:00 PM', sameDayBookings), false);
  assert.equal(logic.tableHasReservationConflict('T15', '2026-11-13', '1:00 PM', sameDayBookings), false);
  assert.equal(logic.tableHasReservationConflict('T07', '2026-11-13', '1:00 PM', sameDayBookings), true);

  const occupied = logic.tableAvailability(
    table,
    [...bookings, { id: 'r3', table: 'T1', date: '2026-11-12', time: '2:00 PM', status: 'Seated' }],
    '2026-11-12',
    '2026-11-12'
  );
  assert.equal(occupied.status, 'Occupied');
  assert.equal(occupied.primaryBooking.id, 'r3');

  const staleOccupied = logic.tableAvailability(
    { id: 'T2', status: 'Occupied', guest: 'Old cached guest' },
    [],
    '2026-11-12',
    '2026-11-12'
  );
  assert.equal(staleOccupied.status, 'Available');
  assert.equal(staleOccupied.primaryBooking, null);
});

test('distinguishes a reservation with safe walk-in time from one that must be protected now', () => {
  const booking = {
    id: 'reservation-noon',
    table: 'T1',
    date: '2026-11-13',
    time: '12:00 PM',
    status: 'Confirmed'
  };
  const bookings = [booking];
  const table = { id: 'T1', status: 'Available' };

  assert.equal(
    logic.tableAvailability(table, bookings, '2026-11-13', '2026-11-13', 9 * 60).status,
    'Reserved Later'
  );
  assert.equal(
    logic.tableAvailability(table, bookings, '2026-11-13', '2026-11-13', 10 * 60).status,
    'Reserved Later'
  );
  assert.equal(
    logic.tableAvailability(table, bookings, '2026-11-13', '2026-11-13', 10 * 60 + 1).status,
    'Reserved Active'
  );
  assert.equal(
    logic.tableAvailability(table, bookings, '2026-11-13', '2026-11-13', 12 * 60).status,
    'Reserved Active'
  );
  assert.equal(
    logic.tableAvailability(table, [{ ...booking, date: '2026-11-14' }], '2026-11-14', '2026-11-13', 9 * 60).status,
    'Reserved Later'
  );

  assert.equal(
    logic.tableHasReservationConflict('T1', '2026-11-13', '9:30 AM', bookings),
    false
  );
  assert.equal(
    logic.tableHasReservationConflict('T1', '2026-11-13', '10:00 AM', bookings),
    false
  );
  assert.equal(
    logic.tableHasReservationConflict('T1', '2026-11-13', '11:00 AM', bookings),
    true
  );
  assert.equal(
    logic.tableReservationConflict('T1', '2026-11-13', '11:00 AM', bookings).id,
    'reservation-noon'
  );
});

test('keeps an overdue seated table occupied and marks it for staff attention', () => {
  const now = new Date(2026, 10, 13, 15, 0);
  const seated = {
    id: 'walk-in-1',
    table: 'T1',
    date: '2026-11-13',
    time: '1:00 PM',
    seatedAt: '2026-11-13T13:15:00Z',
    status: 'Seated'
  };
  const availability = logic.tableAvailability(
    { id: 'T1', status: 'Available' },
    [seated],
    '2026-11-13',
    '2026-11-13',
    15 * 60,
    now
  );
  assert.equal(availability.status, 'Occupied');
  assert.equal(availability.stayLimitReached, true);
  assert.equal(logic.reservationStayLimitReached(seated, new Date(2026, 10, 13, 14, 59)), false);
});

test('keeps an unresolved prior-day seating occupied and blocks a new assignment today', () => {
  const priorDaySeating = {
    id: 'walk-in-previous-day',
    table: 'T1',
    date: '2026-11-12',
    time: '8:00 PM',
    status: 'Seated'
  };
  const availability = logic.tableAvailability(
    { id: 'T1', status: 'Available' },
    [priorDaySeating],
    '2026-11-13',
    '2026-11-13',
    10 * 60,
    new Date(2026, 10, 13, 10, 0)
  );
  assert.equal(availability.status, 'Occupied');
  assert.equal(availability.primaryBooking.id, 'walk-in-previous-day');
  assert.equal(
    logic.tableHasReservationConflict('T1', '2026-11-13', '10:00 AM', [priorDaySeating], '', '2026-11-13'),
    true
  );
});

test('flags unclosed bookings whose two-hour window has passed', () => {
  const booking = {
    id: 'reservation-1',
    table: 'T1',
    date: '2026-11-13',
    time: '10:00 AM',
    status: 'Confirmed'
  };
  const availability = logic.tableAvailability(
    { id: 'T1' },
    [booking],
    '2026-11-13',
    '2026-11-13',
    12 * 60
  );
  assert.equal(availability.status, 'Reserved Active');
  assert.equal(availability.bookingWindowEnded, true);
});

test('reconciles existing tables to the requested layout while preserving IDs and reservation details', () => {
  const emptyPlan = logic.planRestaurantTableLayout([]);
  assert.equal(emptyPlan.expectedTableCount, 15);
  assert.equal(emptyPlan.additions.length, 15);
  assert.equal(emptyPlan.additions.filter(table => table.tableType === 'Family').length, 3);
  assert.equal(emptyPlan.additions.filter(table => table.tableType === 'Casual' && table.area === 'Front').length, 6);
  assert.equal(emptyPlan.additions.filter(table => table.tableType === 'Casual' && table.area === 'Back').length, 6);
  assert.deepEqual(
    emptyPlan.additions.reduce((counts, table) => {
      counts[table.seats] = (counts[table.seats] || 0) + 1;
      return counts;
    }, {}),
    { 2: 1, 4: 4, 5: 3, 6: 3, 8: 2, 12: 2 }
  );

  const existing = [
    { id: 'T08', seats: 4, status: 'Reserved', tableType: 'Unassigned', area: 'Unassigned', guest: 'Guest A' },
    { id: 'T09', seats: 8, status: 'Available', tableType: 'Unassigned', area: 'Unassigned', guest: '' },
    { id: 'T10', seats: 12, status: 'Occupied', tableType: 'Unassigned', area: 'Unassigned', guest: 'Guest B' }
  ];
  const plan = logic.planRestaurantTableLayout(existing, [], '2026-11-12');
  assert.equal(plan.updates.length, 3);
  assert.equal(plan.additions.length, 12);
  assert.deepEqual(plan.updates.map(table => [table.id, table.seats]), [['T08', 12], ['T09', 12], ['T10', 8]]);
  for (const original of existing) {
    const updated = plan.updates.find(table => table.id === original.id);
    assert.ok(updated);
    assert.equal(updated.status, original.status);
    assert.equal(updated.guest, original.guest);
  }

  const finalTables = [...plan.updates, ...plan.additions];
  assert.equal(finalTables.length, 15);
  assert.equal(finalTables.reduce((sum, table) => sum + table.seats, 0), 91);
  assert.deepEqual(
    finalTables.reduce((counts, table) => {
      counts[table.seats] = (counts[table.seats] || 0) + 1;
      return counts;
    }, {}),
    { 2: 1, 4: 4, 5: 3, 6: 3, 8: 2, 12: 2 }
  );
});

test('blocks a capacity reduction that would make an upcoming active reservation too large', () => {
  const plan = logic.planRestaurantTableLayout(
    [
      { id: 'T01', seats: 12 },
      { id: 'T02', seats: 12 },
      { id: 'T03', seats: 12, status: 'Reserved' }
    ],
    [
      { id: 'active', table: 'T03', date: '2026-11-13', status: 'Confirmed', guests: 10 },
      { id: 'past', table: 'T03', date: '2026-11-10', status: 'Completed', guests: 12 },
      { id: 'cancelled', table: 'T03', date: '2026-11-14', status: 'Cancelled', guests: 12 }
    ],
    '2026-11-12'
  );
  assert.deepEqual(plan.conflicts, [{ tableId: 'T03', targetSeats: 8, reservationIds: ['active'] }]);
});

test('preserves extra legacy tables and marks them unclassified', () => {
  const plan = logic.planRestaurantTableLayout([
    ...Array.from({ length: 15 }, (_, index) => ({ id: `T${String(index + 1).padStart(2, '0')}`, seats: 2 })),
    { id: 'T16', seats: 6, tableType: 'Casual', area: 'Front', status: 'Available' }
  ], [], '2026-11-12');
  assert.equal(plan.additions.length, 0);
  assert.equal(plan.unmatchedTables.length, 1);
  assert.deepEqual(plan.updates.find(table => table.id === 'T16'), {
    id: 'T16', seats: 6, tableType: 'Unassigned', area: 'Unassigned', status: 'Available'
  });
});
