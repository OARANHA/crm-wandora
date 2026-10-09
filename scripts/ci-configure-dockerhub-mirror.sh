#!/usr/bin/env bash
# Runner efêmero de GitHub Actions: prefira a cópia em cache das imagens
# OFICIAIS do Docker Hub, sem criar registry/provedor paralelo.
# Google Artifact Registry: https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_OS:-}" != "Linux" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]]; then
  echo "Este helper só pode alterar o Docker no runner Linux de GitHub Actions." >&2
  exit 2
fi

sudo install -d -m 0755 /etc/docker
sudo python3 - <<'PY'
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

path = Path("/etc/docker/daemon.json")
data = json.loads(path.read_text()) if path.exists() else {}
if not isinstance(data, dict):
    raise ValueError("Docker daemon config inválida")
mirrors = data.get("registry-mirrors", [])
if not isinstance(mirrors, list) or not all(isinstance(x, str) for x in mirrors):
    raise ValueError("Docker registry-mirrors inválido")
mirror = "https://mirror.gcr.io"
data["registry-mirrors"] = [mirror] + [x for x in mirrors if x != mirror]
with NamedTemporaryFile(mode="w", dir=path.parent, prefix=".daemon-ci-", delete=False) as temp:
    json.dump(data, temp, separators=(",", ":"))
    temp.write("\n")
    temp_path = temp.name
os.chmod(temp_path, 0o644)
os.replace(temp_path, path)
PY

sudo systemctl restart docker
docker info --format '{{json .RegistryConfig.Mirrors}}' | grep -F 'mirror.gcr.io' >/dev/null
echo "Cache público Docker Hub habilitado no runner CI."
