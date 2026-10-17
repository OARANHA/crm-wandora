#!/usr/bin/env node
// CI-only structural test. It never authorizes an invoice or connects to VendaERP.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const KEY = "51240412345678000195550010000000011017478094";
const NS = "http://www.portalfiscal.inf.br/nfe";
const invalid = "invalido";
const obj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const text = v => typeof v === "string" ? v.trim() : "";

// Intentional result: structural candidate is NEVER authorization.
export function verificarCandidatoEstrutural(xml, expected, lib) {
  const reject = reason => ({ estado: invalid, motivo: reason });
  if (typeof xml !== "string" || !obj(expected)) return reject("entrada_invalida");
  if (Buffer.byteLength(xml, "utf8") > 262144 || xml.length < 80) return reject("limite_xml");
  if (!/^\d{44}$/.test(expected.chave) || !/^[1-9]\d{0,8}$/.test(expected.numero)) return reject("identidade_esperada_invalida");
  if (/<!|\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) return reject("marcador_proibido");
  const body = xml.replace(/^\uFEFF?\s*<\?xml\s+[^?]*\?>\s*/i, "");
  if (body.includes("<?")) return reject("instrucao_xml_proibida");
  if ((body.match(/</g) || []).length > 4000) return reject("complexidade_xml");
  let depth = 0;
  for (const match of body.matchAll(/<\/?[A-Za-z_][\w:.-]*\b[^>]*>/g)) {
    const tag = match[0];
    if (tag.startsWith("</")) depth--;
    else if (!tag.endsWith("/>")) depth++;
    if (depth < 0 || depth > 32) return reject("profundidade_xml");
  }
  if (depth !== 0) return reject("estrutura_xml");
  let data;
  try {
    if (lib.XMLValidator.validate(xml) !== true) return reject("xml_malformado");
    data = new lib.XMLParser({
      ignoreAttributes: false, removeNSPrefix: false, parseTagValue: false,
      parseAttributeValue: false, processEntities: false, trimValues: true,
      ignoreDeclaration: true, ignorePiTags: true
    }).parse(xml);
  } catch { return reject("xml_malformado"); }
  if (!obj(data) || Object.keys(data).length !== 1 || !obj(data.nfeProc)) return reject("envelope_invalido");
  const env = data.nfeProc;
  if (env["@_xmlns"] !== NS || text(env["@_versao"]) !== "4.00") return reject("namespace_versao");
  if (!obj(env.NFe) || !obj(env.protNFe)) return reject("estrutura_fiscal_incompleta");
  const info = env.NFe.infNFe, prot = env.protNFe.infProt;
  if (!obj(info) || !obj(prot) || !obj(info.ide)) return reject("estrutura_fiscal_incompleta");
  if (info["@_Id"] !== "NFe" + expected.chave || text(info["@_versao"]) !== "4.00") return reject("chave_divergente");
  if (text(info.ide.mod) !== "55" || text(info.ide.tpAmb) !== "1") return reject("modelo_ambiente");
  if (text(info.ide.nNF) !== expected.numero) return reject("numero_divergente");
  if (!obj(info.emit) || !obj(info.dest) || !obj(info.total)) return reject("campos_obrigatorios_ausentes");
  const items = Array.isArray(info.det) ? info.det : [info.det];
  if (items.length < 1 || items.length > 200 || items.some(x => !obj(x) || !obj(x.prod))) return reject("itens_invalidos");
  if (text(prot.chNFe) !== expected.chave) return reject("protocolo_chave_divergente");
  if (text(prot.cStat) !== "100" ||
      !/^\d{15}$/.test(text(prot.nProt)) ||
      text(prot.tpAmb) !== "1" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(text(prot.dhRecbto))) {
    return reject("protocolo_incompleto_ou_status");
  }
  // A cStat=100 supplied by untrusted XML cannot prove SEFAZ authorization.
  return { estado: "candidato_estrutural_sem_autenticidade_comprovada" };
}

function fixture() {
  return '<nfeProc xmlns="' + NS + '" versao="4.00"><NFe><infNFe versao="4.00" Id="NFe' + KEY +
    '"><ide><mod>55</mod><tpAmb>1</tpAmb><nNF>1</nNF></ide>' +
    '<emit><xNome>EMITENTE TESTE</xNome></emit><dest><xNome>DESTINATARIO TESTE</xNome></dest>' +
    '<det nItem="1"><prod><xProd>ITEM TESTE</xProd></prod></det><total><ICMSTot><vNF>1.00</vNF></ICMSTot></total>' +
    '</infNFe></NFe><protNFe><infProt><tpAmb>1</tpAmb><chNFe>' + KEY +
    '</chNFe><dhRecbto>2024-04-29T14:00:00-03:00</dhRecbto><nProt>123456789012345</nProt>' +
    '<cStat>100</cStat></infProt></protNFe></nfeProc>';
}

if (process.argv[1]?.endsWith("validar-envelope-nfe-offline.mjs")) {
  const lib = createRequire("/poc/package.json")("fast-xml-parser");
  const expected = { chave: KEY, numero: "1" };
  const original = fixture();
  const cases = [
    ["fake_candidate_not_authorized", original, "candidato_estrutural_sem_autenticidade_comprovada"],
    ["wrong_root", original.replace("<nfeProc ", "<foo ").replace("</nfeProc>", "</foo>"), invalid],
    ["xxe", '<!DOCTYPE nfeProc [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' + original, invalid],
    ["billion_laughs", '<!DOCTYPE nfeProc [<!ENTITY a "x"><!ENTITY b "&a;&a;">]>' + original, invalid],
    ["pi", original.replace("<emit>", "<?processing fake?><emit>"), invalid],
    ["cdata", original.replace("EMITENTE TESTE", "<![CDATA[EMITENTE TESTE]]>"), invalid],
    ["malformed", original.replace("</protNFe>", "</prot>>"), invalid],
    ["no_protocol", original.replace(/<protNFe>[\s\S]*?<\/protNFe>/, ""), invalid],
    ["bad_status", original.replace("<cStat>100</cStat>", "<cStat>101</cStat>"), invalid],
    ["protocol_key", original.replace("<chNFe>" + KEY + "</chNFe>", "<chNFe>" + "0".repeat(44) + "</chNFe>"), invalid],
    ["invoice_key", original.replace('Id="NFe' + KEY + '"', 'Id="NFe' + "0".repeat(44) + '"'), invalid],
    ["invoice_number", original.replace("<nNF>1</nNF>", "<nNF>2</nNF>"), invalid],
    ["model_65", original.replace("<mod>55</mod>", "<mod>65</mod>"), invalid],
    ["homologation", original.replaceAll("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>"), invalid],
    ["duplicate_protocol", original.replace("</protNFe>", "</protNFe><protNFe><infProt><cStat>100</cStat></infProt></protNFe>"), invalid],
    ["oversize", original.replace("</nfeProc>", "<extra>" + "A".repeat(262144) + "</extra></nfeProc>"), invalid],
    ["deep", original.replace("<emit>", "<x>".repeat(35) + "<emit>").replace("</emit>", "</emit>" + "</x>".repeat(35)), invalid],
  ];
  for (const [name, xml, state] of cases) {
    const result = verificarCandidatoEstrutural(xml, expected, lib);
    assert.equal(result.estado, state, name + "_unexpected_state");
    assert.deepEqual(Object.keys(result).sort(), state === invalid ? ["estado", "motivo"] : ["estado"], name + "_leaked_metadata");
    if (state === invalid) assert(/^[a-z_]+$/.test(result.motivo), name + "_unsanitized_error");
  }
  assert.equal(verificarCandidatoEstrutural(original, {chave:"0".repeat(44),numero:"1"}, lib).estado, invalid);
  assert.equal(verificarCandidatoEstrutural(original, {chave:KEY,numero:"2"}, lib).estado, invalid);
  console.log(JSON.stringify({
    offline:true, synthetic:true, scenarios:cases.length+2,
    outcome:"structural_only", authorization_proven:false, provider_called:false
  }));
}
