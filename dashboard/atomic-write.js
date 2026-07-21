// atomic-write.js — gemeinsamer Helper für atomare Datei-/JSON-Writes (Audit-Fix 2).
// Muster: erst in eine tmp-Datei IM SELBEN Verzeichnis schreiben, dann fs.renameSync —
// rename ist auf APFS atomar → nie halb geschriebene JSONs, auch wenn parallel gelesen
// wird oder der Prozess mitten im Write stirbt. Nur Node-Stdlib.
// Nutzung: const { writeJsonAtomic, writeFileAtomic } = require("./atomic-write");
const fs = require("fs");
const path = require("path");

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), "." + path.basename(file) + "." + process.pid + ".tmp");
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
// indent weglassen = kompakt (wie JSON.stringify(obj)), indent=2 = pretty (wie bisherige Stellen).
function writeJsonAtomic(file, obj, indent) {
  writeFileAtomic(file, JSON.stringify(obj, null, indent));
}
module.exports = { writeFileAtomic, writeJsonAtomic };
