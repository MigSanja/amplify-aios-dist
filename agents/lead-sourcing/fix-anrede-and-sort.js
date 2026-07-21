#!/usr/bin/env node
// Setzt Anrede (Herr/Frau) aus dem Vornamen (in den Daten ist keine Anrede vorhanden),
// baut Briefanrede = "Hallo Herr/Frau <Nachname>" (locker, kein Vorname), und sortiert
// die Tabelle: Zeilen MIT persönlicher Mail nach oben (nach Verified-Qualität), Rest unten.
// Unsichere Vornamen -> Anrede LEER lassen (nicht falsch raten). Ein Bulk-Write.
//   LEAD_SHEET_ID=<sheet> node fix-anrede-and-sort.js

const { readRange, writeMatrix } = require("./gsheet-client");
const TAB = "Tabellenblatt1";
const C = { mail: 11, verified: 15, vor: 16, nach: 17, anrede: 18, brief: 19 };

// Gängige deutsche Vornamen -> Geschlecht. Nur eindeutige; alles andere bleibt leer.
const MALE = new Set("alexander andreas achim adrian albert alexej ali andre anton armin arndt arno artur axel bastian ben benedikt benjamin bernd bernhard bjoern bjørn boris burkhard carsten christian christoph clemens conrad daniel david denis dennis dieter dirk dominik eberhard elias emil erik ernst fabian felix florian frank franz friedrich fritz gabriel georg gerald gerd gerhard günter guenter gunnar hannes hans harald hartmut heiko heinrich heinz helmut henning henry holger horst hubert ingo jakob jan jannik jens jerome joachim jochen johann johannes jonas jonathan jörg joerg josef juergen jürgen julian kai karl karsten kevin klaus konrad kurt lars leon leonard lorenz ludwig lukas lutz manfred manuel marc marcel marco marcus marek mario mark markus martin mathias matthias max maximilian michael mike mirko moritz nico niklas nils norbert oliver olaf ole oskar otto patrick paul peter philipp rainer ralf ralph raphael reiner rene rené richard robert roland rolf ruediger rüdiger rudolf sascha sebastian sergej simon stefan stephan sven thomas thorsten till tim timo tobias tom udo ulf ulrich uwe valentin viktor vincent volker waldemar walter werner wilhelm willi wolfgang".split(/\s+/));
const FEMALE = new Set("alexandra andrea anett anette anja anke anna anne annett annette antje astrid barbara beate bettina birgit brigitte britta carina carmen carola caroline catrin christa christel christiane christin christina christine claudia cornelia dagmar daniela diana doreen doris dorothea edith elena elfriede elisabeth elke emma erika eva franziska frauke gabriele gerda gisela grit hanna hannah heide heidi heike helga henriette ilona ines inga ingrid irene iris isabel isabell isabelle jana janina janine jennifer jenny jessica johanna judith julia juliane jutta karin karina karla katarina katharina kathrin katja katrin kerstin kira klara kordula kristin lara laura lea lena lisa liane lena maike manuela mareike margarete maria marianne marina marion marlene martina melanie meike michaela monika nadine nadja natalia natalie nele nicole nina olga petra pia ramona regina renate rita romy ronja rosemarie ruth sabine sabrina sandra sara sarah silke simone sofia sonja stefanie stephanie susanne sylvia tanja theresa ulrike ursula ute vanessa vera veronika viktoria waltraud wibke yvonne".split(/\s+/));

function gender(vor) {
  const v = String(vor || "").trim().toLowerCase().split(/[\s-]/)[0];
  if (!v) return "";
  if (MALE.has(v)) return "Herr";
  if (FEMALE.has(v)) return "Frau";
  return "";
}
const vRank = s => ({ ok: 0, catch_all: 1, unknown: 2, invalid: 3 }[(s || "").trim()] ?? 4);

(async () => {
  const grid = await readRange(TAB, "A1:U100000");
  // WICHTIG: alle 21 Spalten (A..U inkl. Icebreaker) mitnehmen, sonst verrutscht U beim Sortieren.
  const header = grid[0].slice(0, 21); while (header.length < 21) header.push("");
  const rows = grid.slice(1).map(r => { const x = r.slice(0, 21); while (x.length < 21) x.push(""); return x; });

  let herr = 0, frau = 0, leer = 0;
  rows.forEach(r => {
    const g = gender(r[C.vor]);
    const nach = (r[C.nach] || "").trim();
    r[C.anrede] = g;
    if (g && nach) { r[C.brief] = `Hallo ${g} ${nach}`; }
    else { r[C.brief] = ""; }              // ohne sichere Anrede: leer (nicht "Damen und Herren")
    if (g === "Herr") herr++; else if (g === "Frau") frau++; else leer++;
  });

  // Priorität: Tier 0 = Mail + Briefanrede (persönlich, exportfertig),
  //            Tier 1 = Mail ohne Briefanrede, Tier 2 = keine Mail. Dann Verified, dann Firma.
  const hasMail = r => /@/.test(r[C.mail] || "");
  const hasBrief = r => (r[C.brief] || "").trim().length > 0;
  const tier = r => (hasMail(r) ? (hasBrief(r) ? 0 : 1) : 2);
  rows.sort((a, b) => (tier(a) - tier(b)) || (vRank(a[C.verified]) - vRank(b[C.verified])) || String(a[0]).localeCompare(String(b[0])));

  const tier0 = rows.filter(r => tier(r) === 0).length;
  const tier0ok = rows.filter(r => tier(r) === 0 && (r[C.verified] || "").trim() === "ok").length;
  await writeMatrix(TAB, [header, ...rows]);
  console.log(`Anrede gesetzt -> Herr: ${herr}, Frau: ${frau}, leer/unsicher: ${leer}`);
  console.log(`Tier 0 (Mail + Briefanrede) oben: ${tier0}  |  davon Verified=ok: ${tier0ok}`);
  console.log(`Sortiert. ${rows.length} Zeilen geschrieben.`);
})().catch(e => { console.error("fix-anrede-Fehler:", e.message); process.exit(1); });
