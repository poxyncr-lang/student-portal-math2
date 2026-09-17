const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(__dirname + '/LineScoreBot.gs', 'utf8'), context);
const read = context.botValueByHeader_;
const headers = ['มาเรียน', 'เวลาเรียน', 'สถานะ', 'ลา', 'ขาด'];
const values = [36, 36 / 38, 'ปกติ', 2, 0];
assert.equal(read(headers, values, 'ลา'), '2');
assert.equal(read(headers, values, 'เวลาเรียน'), '94.74%');
assert.equal(read(headers, values, 'มาเรียน'), '36');
assert.equal(read(headers, values, 'ขาด'), '0');
assert.equal(read(headers, values, 'สถานะ'), 'ปกติ');
for (const [value, expected] of [[0, '0.00%'], [1, '100.00%'], ['94.74%', '94.74%'], ['', '-'], ['#DIV/0!', '-']]) {
  assert.equal(read(['เวลาเรียน'], [value], 'เวลาเรียน'), expected);
}
assert.equal(read([' ลา '], [3], 'ลา'), '3');
assert.throws(() => read(['เวลาเรียน'], [0.5], 'ลา'), /ไม่พบหัวคอลัมน์/);
console.log('PASS: exact leave column; percentage, zero, full attendance, blank and invalid values.');
