function luminance(hex) {
  const rgb = hex.replace('#', '').match(/.{2}/g).map(value => parseInt(value, 16) / 255);
  const [r, g, b] = rgb.map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

const pairs = [
  ['White on adjusted primary button', '#FFFFFF', '#B55C12'],
  ['Body text on warm alabaster', '#2B2118', '#FAF7F2'],
  ['Secondary text on white', '#6B5B4E', '#FFFFFF'],
  ['Secondary text on warm alabaster', '#6B5B4E', '#FAF7F2'],
  ['Success text on success badge', '#24563B', '#E8F1EB'],
  ['Warning text on warning badge', '#4A3A00', '#F5EAB8'],
  ['Danger text on danger badge', '#8F2F2A', '#F9E9E7'],
  ['Info text on info badge', '#36516A', '#EAF0F5'],
  ['Sidebar text on espresso', '#FFFFFF', '#2C1E16'],
  ['Active sidebar text on lighter espresso', '#FFFFFF', '#604B40'],
  ['Chart label on white card', '#6B5B4E', '#FFFFFF'],
  ['Chart label on warm alabaster', '#6B5B4E', '#FAF7F2']
];

let failed = false;
for (const [label, foreground, background] of pairs) {
  const ratio = contrast(foreground, background);
  const pass = ratio >= 4.5;
  failed ||= !pass;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}: ${ratio.toFixed(2)}:1`);
}
process.exitCode = failed ? 1 : 0;