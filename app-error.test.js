const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, 'frontend', 'app.js'), 'utf8');
const helperStart = appSource.indexOf('function friendlyRpcError(error) {');
const helperEnd = appSource.indexOf('\nfunction lowStock()', helperStart);
assert.notEqual(helperStart, -1, 'friendlyRpcError must exist');
assert.notEqual(helperEnd, -1, 'friendlyRpcError must end before lowStock');

const context = {};
vm.runInNewContext(
  `${appSource.slice(helperStart, helperEnd)}\nthis.friendlyRpcError = friendlyRpcError;`,
  context
);

test('friendlyRpcError formats duplicate product messages', () => {
  assert.equal(
    context.friendlyRpcError({ message: 'A product with this name already exists in the selected category' }),
    'A product with this name already exists in the selected category. Please choose another name or category.'
  );
});

test('friendlyRpcError returns database errors without throwing', () => {
  const message = 'Recipe id, name, category, menu_price, and wastage are required';
  assert.equal(context.friendlyRpcError({ message }), message);
});
