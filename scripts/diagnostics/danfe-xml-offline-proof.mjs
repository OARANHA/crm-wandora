#!/usr/bin/env node
// Offline-only eligibility probe. NEVER used by the ELUS runtime.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const SYNTHETIC_KEY = "51240412345678000195550010000000011017478094";
const mode = process.argv[2];
if (mode === "generate") {
  const xml = readFileSync("/probe/fixture.xml", "utf8");
  assert(xml.length > 300 && xml.length < 10000, "synthetic_fixture_size");
  assert(xml.includes("EMPRESA TESTE EMITENTE"), "fixture_must_be_synthetic");
  assert(xml.includes("CLIENTE TESTE DESTINATARIO"), "fixture_must_be_synthetic");
  assert(!/<!DOCTYPE|<!ENTITY|<script/i.test(xml), "fixture_contains_active_content");
  assert(xml.includes('Id="NFe' + SYNTHETIC_KEY + '"'), "synthetic_key_missing");
  const requireFromSandbox = createRequire("/poc/package.json");
  const { GerarDanfeUseCase } = requireFromSandbox("@brasil-fiscal/nfe");
  assert.equal(typeof GerarDanfeUseCase, "function", "use_case_not_exported");
  const generated = await new GerarDanfeUseCase().execute(xml);
  assert(Buffer.isBuffer(generated), "not_a_buffer");
  assert(generated.length > 2000 && generated.length < 2 * 1024 * 1024, "pdf_size_invalid");
  assert(generated.subarray(0, 1024).includes(Buffer.from("%PDF-")), "pdf_header_missing");
  assert(generated.subarray(-2048).includes(Buffer.from("%%EOF")), "pdf_footer_missing");
  writeFileSync("/poc/proof.pdf", generated, { mode: 0o600 });
  console.log(JSON.stringify({
    offline: true, synthetic: true, generator: "brasil-fiscal",
    pdf_markers: true, pdf_written: true,
    fiscal_authorization_proven: false, provider_xml_compatibility_proven: false
  }));
} else if (mode === "verify") {
  const extracted = readFileSync(process.argv[3], "utf8");
  const normalized = extracted.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  assert(normalized.includes("DANFE"), "danfe_marker_not_in_pdf_text");
  const label = normalized.indexOf("CHAVE DE ACESSO");
  assert(label >= 0, "key_label_not_in_pdf_text");
  const field = normalized.slice(label + "CHAVE DE ACESSO".length, label + 200);
  const candidate = field.match(/^\s*:?\s*((?:\d[\s.\-]*){44})(?!\d)/);
  assert(candidate, "key_field_not_in_pdf_text");
  assert.equal(candidate[1].replace(/\D/g, ""), SYNTHETIC_KEY, "key_mismatch");
  console.log(JSON.stringify({
    offline: true, pdf_selectable_text: true, synthetic_key_matched: true,
    fiscal_authorization_proven: false, provider_xml_compatibility_proven: false
  }));
} else {
  console.error("usage: node danfe-xml-offline-proof.mjs generate|verify [textfile]");
  process.exitCode = 2;
}
