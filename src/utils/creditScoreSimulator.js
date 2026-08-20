function hashString(value) { let hash = 2166136261; for (const char of String(value || '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function simulateCreditScore({ idNumber, dateOfBirth, fullName }) { return 550 + (hashString(`${String(idNumber || '').toUpperCase()}|${dateOfBirth || ''}|${String(fullName || '').trim().toLowerCase()}`) % 351); }
module.exports = { simulateCreditScore };
