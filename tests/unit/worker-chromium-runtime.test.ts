import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Dockerfile.worker inclui runtime do renderer de documentos", () => {
  const dockerfile = readFileSync(join(process.cwd(), "Dockerfile.worker"), "utf8");

  it("instala Chromium e expõe CHROMIUM_PATH estável", () => {
    expect(dockerfile).toContain("apk add --no-cache chromium font-liberation");
    expect(dockerfile).toContain("ln -s \"$CHROMIUM_BIN\" /usr/local/bin/elus-chromium");
    expect(dockerfile).toContain("ENV CHROMIUM_PATH=/usr/local/bin/elus-chromium");
  });
});
